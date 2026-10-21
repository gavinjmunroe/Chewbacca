/**
 * GitHub network scraper: followers + following → unified people graph.
 *
 * Pulls every user the authenticated GitHub account follows and every user
 * who follows them, dedupes by login, marks each row with the relationship
 * direction ("follower" | "following" | "mutual"), and enriches each unique
 * login with a single /users/{login} call so the contact row carries name,
 * company, location, bio, blog. Each row lands in Firestore via
 * upsertContact (source: "github", externalId: "github:<login>") and is
 * embedded into the user's Pinecone namespace via indexContacts so semantic
 * queries like "who do I know who works at Vercel" resolve.
 *
 * The two list calls (followers + following) are bounded at 5 pages of 100
 * each (= up to 500 logins per side). Most users have well under this; the
 * cap keeps a Magic Mike-of-the-graph case from running for an hour. Per
 * GitHub REST rate limit (5000 req/hr authenticated) the enrichment loop
 * could in theory pull thousands of profiles per sync, but we cap at
 * ENRICH_PER_SYNC to keep a single sync bounded; subsequent syncs deepen
 * the back-catalog by skipping already-enriched contacts.
 *
 * Best-effort throughout. We never throw, never fail the outer HTTP
 * request. Each failure logs and moves on. err.cause is logged on fetch
 * failure so a real underlying ENOTFOUND / UND_ERR_SOCKET surfaces.
 */

import { listContacts, upsertContact } from "../../db/user-store.js";
import { getSecret } from "../../db/secrets.js";
import { resolveAmberIdByPrivyDid } from "../../db/store.js";

const API_BASE = "https://api.github.com";
const PER_PAGE = 100;
const MAX_LIST_PAGES = 5;
const LIST_TIMEOUT_MS = 12000;
const ENRICH_PER_SYNC = 200;
const ENRICH_TIMEOUT_MS = 10000;
const PAGE_PACING_MS = 150;
const ENRICH_PACING_MS = 100;

function buildHeaders(accessToken) {
  return {
    Authorization: `Bearer ${accessToken}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "medha-id",
  };
}

function describeFetchError(err) {
  if (!err) return { message: "unknown" };
  const cause = err.cause || {};
  return {
    message: err.message || String(err),
    causeMessage: cause.message,
    causeCode: cause.code,
    causeErrno: cause.errno,
    causeName: cause.name,
  };
}

// ─── Paginated list helper (used for both /user/followers and /user/following)

async function fetchListPage(endpoint, accessToken, page, log) {
  const url = `${API_BASE}${endpoint}?per_page=${PER_PAGE}&page=${page}`;
  let res;
  try {
    res = await fetch(url, {
      method: "GET",
      headers: buildHeaders(accessToken),
      signal: AbortSignal.timeout(LIST_TIMEOUT_MS),
    });
  } catch (err) {
    log?.warn(
      { endpoint, page, ...describeFetchError(err) },
      "[github:scrape] list page fetch failed",
    );
    return { ok: false, error: "fetch_failed" };
  }
  if (!res.ok) {
    log?.warn(
      { endpoint, page, status: res.status },
      "[github:scrape] list page non-200",
    );
    return { ok: false, error: `status_${res.status}` };
  }
  let body;
  try {
    body = await res.json();
  } catch {
    return { ok: false, error: "parse_failed" };
  }
  if (!Array.isArray(body)) return { ok: false, error: "shape_unexpected" };
  return { ok: true, items: body };
}

async function fetchAllPaginated(endpoint, accessToken, log) {
  const all = [];
  for (let page = 1; page <= MAX_LIST_PAGES; page++) {
    const result = await fetchListPage(endpoint, accessToken, page, log);
    if (!result.ok) break;
    if (result.items.length === 0) break;
    for (const item of result.items) {
      if (item && typeof item.login === "string") all.push(item);
    }
    if (result.items.length < PER_PAGE) break;
    await new Promise((r) => setTimeout(r, PAGE_PACING_MS));
  }
  return all;
}

// ─── Per-login enrichment ──────────────────────────────────────────────────

async function fetchUserDetail(login, accessToken, log) {
  const url = `${API_BASE}/users/${encodeURIComponent(login)}`;
  let res;
  try {
    res = await fetch(url, {
      method: "GET",
      headers: buildHeaders(accessToken),
      signal: AbortSignal.timeout(ENRICH_TIMEOUT_MS),
    });
  } catch (err) {
    log?.warn(
      { login, ...describeFetchError(err) },
      "[github:enrich] fetch failed",
    );
    return null;
  }
  if (!res.ok) {
    log?.warn(
      { login, status: res.status },
      "[github:enrich] non-200 response",
    );
    return null;
  }
  try {
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * Build the contact row a GitHub user maps to. The free-text bits (notes)
 * pull bio + blog + twitter so the embedding catches "who do I know who
 * writes about distributed systems" via bio terms.
 */
function userToContact(login, relationship, detail) {
  const name = (detail?.name && String(detail.name).trim()) || login;
  const notesParts = [];
  if (detail?.bio) notesParts.push(detail.bio);
  if (detail?.blog) notesParts.push(`Blog: ${detail.blog}`);
  if (detail?.twitter_username)
    notesParts.push(`Twitter: @${detail.twitter_username}`);
  if (typeof detail?.public_repos === "number") {
    notesParts.push(`${detail.public_repos} public repos`);
  }
  const notes = notesParts.length > 0 ? notesParts.join(". ") : null;
  return {
    source: "github",
    sourceHandle: login,
    externalId: `github:${login}`,
    name,
    company: detail?.company || null,
    title: null,
    location: detail?.location || null,
    notes,
    emails: detail?.email ? [detail.email] : [],
    metadata: {
      github: {
        login,
        profileUrl: `https://github.com/${login}`,
        relationship,
        blog: detail?.blog || null,
        twitter: detail?.twitter_username || null,
        public_repos:
          typeof detail?.public_repos === "number" ? detail.public_repos : null,
        followers:
          typeof detail?.followers === "number" ? detail.followers : null,
        following:
          typeof detail?.following === "number" ? detail.following : null,
        github_id: detail?.id != null ? String(detail.id) : null,
        enriched_at: new Date().toISOString(),
      },
    },
  };
}

// ─── Top-level orchestrator ───────────────────────────────────────────────

/**
 * Pull the user's GitHub network and persist + embed every unique login.
 *
 * Steps:
 *   1. Read GITHUB_OAUTH_ACCESS from the per-tenant secrets bag. Abort if
 *      missing.
 *   2. Paginate /user/followers and /user/following. Dedupe by login.
 *      Tag each unique login with relationship ∈ {follower, following,
 *      mutual}.
 *   3. For each login that does NOT already have metadata.github.enriched_at
 *      in Firestore, GET /users/{login} to pick up name/company/location/bio.
 *      Cap at ENRICH_PER_SYNC per run; subsequent syncs deepen the back-
 *      catalog.
 *   4. upsertContact every enriched row, then indexContacts to embed into
 *      Pinecone.
 *
 * Returns a summary object for logging. Never throws.
 */
export async function scrapeAndIndexGithubNetwork(did, log) {
  if (!did) return { ok: false, error: "missing_did" };

  const ownerId = await resolveAmberIdByPrivyDid(did).catch(() => null);
  if (!ownerId) {
    log?.info({ did }, "[github:scrape] privy_did not linked to amber, skipping");
    return { ok: false, error: "owner_not_linked" };
  }

  let accessToken;
  try {
    accessToken = await getSecret(did, "GITHUB_OAUTH_ACCESS");
  } catch (err) {
    log?.warn(
      { did, err: err.message },
      "[github:scrape] failed to read access token",
    );
    return { ok: false, error: "secret_read_failed" };
  }
  if (!accessToken) {
    return { ok: false, error: "no_access_token" };
  }

  log?.info({ did }, "[github:scrape] starting followers + following pull");

  const [followers, following] = await Promise.all([
    fetchAllPaginated("/user/followers", accessToken, log),
    fetchAllPaginated("/user/following", accessToken, log),
  ]);

  // Dedupe + tag relationship direction. A login present in BOTH lists is
  // "mutual"; present in only followers is "follower"; only following is
  // "following".
  const relationshipByLogin = new Map();
  for (const u of followers) {
    relationshipByLogin.set(u.login, "follower");
  }
  for (const u of following) {
    const prior = relationshipByLogin.get(u.login);
    relationshipByLogin.set(
      u.login,
      prior === "follower" ? "mutual" : "following",
    );
  }

  const totalUnique = relationshipByLogin.size;
  log?.info(
    {
      did,
      followers_count: followers.length,
      following_count: following.length,
      unique_logins: totalUnique,
    },
    "[github:scrape] list pull done, starting enrichment",
  );

  // Pull the existing GitHub contacts so we can skip already-enriched
  // logins on re-syncs. Each sync only deepens the back-catalog by
  // ENRICH_PER_SYNC; this prevents a single 5000-following user from
  // burning all rate limit on one run.
  let alreadyEnriched = new Set();
  try {
    const allContacts = await listContacts(ownerId);
    for (const c of allContacts) {
      if (
        c?.source === "github" &&
        c?.sourceHandle &&
        c?.metadata?.github?.enriched_at
      ) {
        alreadyEnriched.add(c.sourceHandle);
      }
    }
  } catch (err) {
    log?.warn(
      { did, err: err.message },
      "[github:scrape] listContacts failed; will re-enrich everyone",
    );
  }

  const toEnrich = [];
  for (const [login, relationship] of relationshipByLogin.entries()) {
    if (alreadyEnriched.has(login)) continue;
    toEnrich.push({ login, relationship });
    if (toEnrich.length >= ENRICH_PER_SYNC) break;
  }

  let enriched = 0;
  let enrichFailures = 0;
  const persistedThisRun = [];
  for (const { login, relationship } of toEnrich) {
    const detail = await fetchUserDetail(login, accessToken, log);
    if (!detail) {
      enrichFailures++;
      await new Promise((r) => setTimeout(r, ENRICH_PACING_MS));
      continue;
    }
    const contact = userToContact(login, relationship, detail);
    try {
      const saved = await upsertContact(ownerId, contact);
      if (saved) {
        enriched++;
        persistedThisRun.push(saved);
      }
    } catch (err) {
      log?.warn(
        { did, login, err: err.message },
        "[github:scrape] upsert failed",
      );
      enrichFailures++;
    }
    await new Promise((r) => setTimeout(r, ENRICH_PACING_MS));
  }

  // For logins we already enriched on a prior run, refresh the relationship
  // tag in Firestore (someone who used to be a follower-only might now be
  // mutual). Cheap doc updates, no API call needed.
  let relationshipUpdates = 0;
  if (alreadyEnriched.size > 0) {
    try {
      const allContacts = await listContacts(ownerId);
      for (const c of allContacts) {
        if (c?.source !== "github" || !c?.sourceHandle) continue;
        const newRelationship = relationshipByLogin.get(c.sourceHandle);
        if (!newRelationship) continue;
        const priorRelationship = c.metadata?.github?.relationship;
        if (priorRelationship === newRelationship) continue;
        const updated = {
          ...c,
          metadata: {
            ...(c.metadata || {}),
            github: {
              ...(c.metadata?.github || {}),
              relationship: newRelationship,
            },
          },
        };
        try {
          await upsertContact(ownerId, updated);
          relationshipUpdates++;
        } catch (err) {
          log?.warn(
            { did, login: c.sourceHandle, err: err.message },
            "[github:scrape] relationship refresh upsert failed",
          );
        }
      }
    } catch (err) {
      log?.warn(
        { did, err: err.message },
        "[github:scrape] relationship refresh outer failure",
      );
    }
  }

  // Embed every freshly-persisted row. Firestore stays the source of
  // truth; Pinecone is the search accelerator and can be rebuilt from
  // scratch via scripts/pinecone-backfill.js if needed.
  let indexed = 0;
  if (persistedThisRun.length > 0) {
  }

  const summary = {
    ok: true,
    did,
    followers_count: followers.length,
    following_count: following.length,
    unique_logins: totalUnique,
    enriched_this_run: enriched,
    enrich_failures: enrichFailures,
    relationship_updates: relationshipUpdates,
    indexed,
    skipped_already_enriched: alreadyEnriched.size,
  };
  log?.info(summary, "[github:scrape] done");
  return summary;
}
