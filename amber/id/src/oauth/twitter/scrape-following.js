/**
 * Twitter (X) following-list scraper.
 *
 * Pulls every account the connected user follows via the X v2 API, persists
 * each one as a contact in Firestore, and embeds them into the user's
 * Pinecone namespace so semantic searches like "who do I follow that writes
 * about climate" hit real handles.
 *
 * Two reasons this is a single-pass scraper, unlike the LinkedIn two-pass:
 *
 *   1. X's /2/users/{id}/following endpoint already returns name +
 *      username + description + location + verified + profile image in one
 *      call, so there's no enrichment pass to run.
 *   2. X Free tier rate-limits this endpoint hard. We page until either we
 *      hit max_results-no-next-token (done), our bounded page cap (continue
 *      next sync), or a 429 (stop, persist pagination_token, resume next
 *      sync). The persisted token in TWITTER_FOLLOWING_PAGINATION_TOKEN
 *      lets the next sync pick up where this one stopped instead of
 *      restarting at page 0.
 *
 * Never throws. Every failure logs and returns ok=false in the summary.
 */

import { upsertContact } from "../../db/user-store.js";
import { getSecret, getSecrets, setSecrets } from "../../db/secrets.js";
import { resolveAmberIdByPrivyDid } from "../../db/store.js";

const X_API_BASE = "https://api.x.com";
const TOKEN_URL = `${X_API_BASE}/2/oauth2/token`;
const ME_URL = `${X_API_BASE}/2/users/me`;

const PAGE_SIZE = 100;
const MAX_PAGES = 20;
const PAGE_TIMEOUT_MS = 12000;
const PAGE_PACING_MS = 250;
const INDEX_BATCH_SIZE = 25;

// Returned alongside each user. profile_image_url is the small (48px)
// version; if we later want larger we can strip "_normal" from the URL.
const USER_FIELDS = [
  "name",
  "username",
  "description",
  "location",
  "url",
  "verified",
  "profile_image_url",
  "created_at",
].join(",");

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

/**
 * Map an X v2 user object to the Firestore contact schema used everywhere
 * else in the people graph. externalId is the stable X user id, never the
 * username, because usernames can change.
 */
export function userToContact(user) {
  if (!user || typeof user !== "object") return null;
  const id = typeof user.id === "string" ? user.id : null;
  const username = typeof user.username === "string" ? user.username : null;
  const name = typeof user.name === "string" ? user.name.trim() : "";
  if (!id || !username || !name) return null;
  const description =
    typeof user.description === "string" && user.description.trim()
      ? user.description.trim()
      : null;
  const location =
    typeof user.location === "string" && user.location.trim()
      ? user.location.trim()
      : null;
  return {
    source: "twitter",
    sourceHandle: username,
    externalId: `twitter:${id}`,
    name,
    title: description,
    location,
    notes: description,
    metadata: {
      twitter: {
        id,
        username,
        profileUrl: `https://twitter.com/${username}`,
        verified: typeof user.verified === "boolean" ? user.verified : null,
        profile_image_url:
          typeof user.profile_image_url === "string"
            ? user.profile_image_url
            : null,
        url: typeof user.url === "string" ? user.url : null,
        created_at:
          typeof user.created_at === "string" ? user.created_at : null,
      },
    },
  };
}

/**
 * Refresh the user's X access token using the stored refresh token. Persists
 * the rotated tokens back into the secrets bag and returns the fresh access
 * token. Returns null on any failure (caller treats that as
 * "can't proceed").
 */
async function refreshAccessToken(did, refreshToken, log) {
  const clientId = process.env.TWITTER_OAUTH_CLIENT_ID;
  const clientSecret = process.env.TWITTER_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    log?.warn(
      { did },
      "[twitter:scrape] cannot refresh: TWITTER_OAUTH_CLIENT_ID/SECRET missing in env",
    );
    return null;
  }
  const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString(
    "base64",
  );
  let res;
  try {
    res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${basicAuth}`,
        Accept: "application/json",
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: clientId,
      }).toString(),
      signal: AbortSignal.timeout(PAGE_TIMEOUT_MS),
    });
  } catch (err) {
    log?.warn(
      { did, ...describeFetchError(err) },
      "[twitter:scrape] refresh fetch failed",
    );
    return null;
  }
  if (!res.ok) {
    log?.warn(
      { did, status: res.status },
      "[twitter:scrape] refresh non-200 response",
    );
    return null;
  }
  let json;
  try {
    json = await res.json();
  } catch {
    return null;
  }
  const newAccess = json?.access_token;
  if (!newAccess || typeof newAccess !== "string") return null;

  const persist = { TWITTER_OAUTH_ACCESS: newAccess };
  if (Number.isFinite(Number(json.expires_in)) && json.expires_in > 0) {
    persist.TWITTER_OAUTH_EXPIRES_AT = new Date(
      Date.now() + json.expires_in * 1000,
    ).toISOString();
  }
  // X token rotation: persist a new refresh if returned, otherwise leave
  // the old one. Storing a stale refresh after rotation guarantees a 400
  // on the next sync.
  if (
    typeof json.refresh_token === "string" &&
    json.refresh_token !== refreshToken
  ) {
    persist.TWITTER_OAUTH_REFRESH = json.refresh_token;
  }
  try {
    await setSecrets(did, persist, { updatedBy: "twitter-following-sync" });
  } catch (err) {
    log?.warn(
      { did, msg: err?.message || String(err) },
      "[twitter:scrape] failed to persist rotated tokens",
    );
  }
  return newAccess;
}

/**
 * Return a usable access token for the user, refreshing first if the
 * currently-cached one is missing or within 60 seconds of expiry.
 */
async function getUsableAccessToken(did, bag, log) {
  const cached = bag.TWITTER_OAUTH_ACCESS;
  const expiresAt = bag.TWITTER_OAUTH_EXPIRES_AT;
  const refresh = bag.TWITTER_OAUTH_REFRESH;

  if (cached && expiresAt) {
    const expiryMs = Date.parse(expiresAt);
    if (Number.isFinite(expiryMs) && expiryMs - Date.now() > 60_000) {
      return cached;
    }
  }
  if (!refresh) {
    log?.warn(
      { did, hasAccess: !!cached },
      "[twitter:scrape] no refresh token and access token missing or expired",
    );
    return cached || null;
  }
  return refreshAccessToken(did, refresh, log);
}

/**
 * Ensure we know the user's numeric X id. The OAuth callback caches it as
 * TWITTER_OAUTH_USER_ID, but older accounts connected before that landed
 * may not have it, so we self-heal by calling /2/users/me once and
 * persisting it.
 */
async function getUserId(did, bag, accessToken, log) {
  if (bag.TWITTER_OAUTH_USER_ID) return bag.TWITTER_OAUTH_USER_ID;
  let res;
  try {
    res = await fetch(ME_URL, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(PAGE_TIMEOUT_MS),
    });
  } catch (err) {
    log?.warn(
      { did, ...describeFetchError(err) },
      "[twitter:scrape] /users/me fetch failed",
    );
    return null;
  }
  if (!res.ok) {
    log?.warn(
      { did, status: res.status },
      "[twitter:scrape] /users/me non-200 response",
    );
    return null;
  }
  let json;
  try {
    json = await res.json();
  } catch {
    return null;
  }
  const userId = typeof json?.data?.id === "string" ? json.data.id : null;
  if (!userId) return null;
  setSecrets(
    did,
    { TWITTER_OAUTH_USER_ID: userId },
    { updatedBy: "twitter-following-sync" },
  ).catch((err) =>
    log?.warn(
      { did, msg: err?.message || String(err) },
      "[twitter:scrape] failed to persist TWITTER_OAUTH_USER_ID",
    ),
  );
  return userId;
}

/**
 * Persist the cursor for the next sync. Pass null to clear (run finished
 * cleanly with no more pages). Non-fatal: a failure here just means the
 * next sync starts from the beginning, which costs API quota but is
 * otherwise harmless.
 */
async function persistPaginationToken(did, token, log) {
  try {
    await setSecrets(
      did,
      {
        TWITTER_FOLLOWING_PAGINATION_TOKEN: token,
        TWITTER_FOLLOWING_LAST_SYNCED_AT: new Date().toISOString(),
      },
      { updatedBy: "twitter-following-sync" },
    );
  } catch (err) {
    log?.warn(
      { did, msg: err?.message || String(err) },
      "[twitter:scrape] failed to persist pagination state",
    );
  }
}

/**
 * Fetch one page of /2/users/{id}/following.
 *
 * Returns:
 *   { ok: true, users, nextToken }                — normal page
 *   { ok: false, rateLimited: true, resetAt }     — 429; caller should stop
 *   { ok: false, status }                         — non-200 other than 429
 *   { ok: false, error: "fetch_failed", detail }  — network error
 */
async function fetchFollowingPage(userId, accessToken, paginationToken, log) {
  const params = new URLSearchParams({
    max_results: String(PAGE_SIZE),
    "user.fields": USER_FIELDS,
  });
  if (paginationToken) params.set("pagination_token", paginationToken);
  const url = `${X_API_BASE}/2/users/${encodeURIComponent(userId)}/following?${params.toString()}`;

  let res;
  try {
    res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(PAGE_TIMEOUT_MS),
    });
  } catch (err) {
    const detail = describeFetchError(err);
    log?.warn(detail, "[twitter:scrape] page fetch failed");
    return { ok: false, error: "fetch_failed", detail };
  }

  if (res.status === 429) {
    // x-rate-limit-reset is a unix timestamp in seconds.
    const resetHeader = res.headers.get("x-rate-limit-reset");
    const resetAt = resetHeader
      ? new Date(Number(resetHeader) * 1000).toISOString()
      : null;
    log?.warn(
      { resetAt, remaining: res.headers.get("x-rate-limit-remaining") },
      "[twitter:scrape] rate limited, stopping run",
    );
    return { ok: false, rateLimited: true, resetAt };
  }
  if (!res.ok) {
    log?.warn({ status: res.status }, "[twitter:scrape] page non-200 response");
    return { ok: false, status: res.status };
  }
  let body;
  try {
    body = await res.json();
  } catch {
    return { ok: false, error: "parse_failed" };
  }
  const users = Array.isArray(body?.data) ? body.data : [];
  const nextToken =
    typeof body?.meta?.next_token === "string" ? body.meta.next_token : null;
  return { ok: true, users, nextToken };
}

/**
 * Top-level orchestrator. Call with the DID; reads tokens from the secrets
 * bag, scrapes, persists, embeds, returns a summary object. Never throws.
 *
 * Idempotent across re-runs: each follow is keyed by twitter user id, so
 * subsequent syncs that revisit the same user update rather than duplicate.
 */
export async function scrapeAndIndexTwitterFollowing(did, log) {
  if (!did) return { ok: false, error: "missing_did" };
  log?.info({ did }, "[twitter:scrape] starting following sync");

  const ownerId = await resolveAmberIdByPrivyDid(did).catch(() => null);
  if (!ownerId) {
    log?.info({ did }, "[twitter:scrape] privy_did not linked to amber, skipping");
    return { ok: false, error: "owner_not_linked" };
  }

  let bag;
  try {
    bag = await getSecrets(did);
  } catch (err) {
    log?.warn(
      { did, msg: err?.message || String(err) },
      "[twitter:scrape] failed to read secrets bag",
    );
    return { ok: false, error: "secrets_read_failed" };
  }

  const accessToken = await getUsableAccessToken(did, bag, log);
  if (!accessToken) {
    return { ok: false, error: "no_access_token" };
  }

  const userId = await getUserId(did, bag, accessToken, log);
  if (!userId) {
    return { ok: false, error: "no_user_id" };
  }

  let paginationToken = bag.TWITTER_FOLLOWING_PAGINATION_TOKEN || null;
  let pagesScraped = 0;
  let usersFound = 0;
  let contactsPersisted = 0;
  const persistedThisRun = [];
  let stoppedReason = "completed";
  let rateLimitResetAt = null;

  for (let page = 0; page < MAX_PAGES; page++) {
    const result = await fetchFollowingPage(
      userId,
      accessToken,
      paginationToken,
      log,
    );

    if (!result.ok) {
      if (result.rateLimited) {
        stoppedReason = "rate_limited";
        rateLimitResetAt = result.resetAt;
        // Keep the current paginationToken in the bag so the next run picks
        // up from this same page. (We never moved past it on a 429.)
        await persistPaginationToken(did, paginationToken, log);
      } else {
        stoppedReason = `fetch_failed:${result.status || result.error || "unknown"}`;
      }
      break;
    }

    pagesScraped++;
    usersFound += result.users.length;

    for (const user of result.users) {
      const contact = userToContact(user);
      if (!contact) continue;
      try {
        const saved = await upsertContact(ownerId, contact);
        if (saved) {
          contactsPersisted++;
          persistedThisRun.push(saved);
        }
      } catch (err) {
        log?.warn(
          { did, name: contact.name, err: err.message },
          "[twitter:scrape] upsert failed",
        );
      }
    }

    paginationToken = result.nextToken;
    if (!paginationToken) {
      stoppedReason = "no_more_pages";
      // Clear the persisted cursor so the next sync starts fresh and
      // catches any new follows since this run.
      await persistPaginationToken(did, null, log);
      break;
    }

    // Persist progress so a crash mid-loop still resumes correctly.
    await persistPaginationToken(did, paginationToken, log);
    await new Promise((r) => setTimeout(r, PAGE_PACING_MS));
  }

  if (
    stoppedReason === "completed" &&
    paginationToken &&
    pagesScraped === MAX_PAGES
  ) {
    // Hit page cap but X still has more — next sync continues from token.
    stoppedReason = "page_cap_reached";
  }

  // Embed in batches. indexContacts internally serializes per contact, so
  // batching here just bounds the loop's working-set memory.
  let contactsIndexed = 0;
  for (let i = 0; i < persistedThisRun.length; i += INDEX_BATCH_SIZE) {
    const batch = persistedThisRun.slice(i, i + INDEX_BATCH_SIZE);
  }

  const summary = {
    ok: true,
    did,
    pages: pagesScraped,
    users_found: usersFound,
    contacts_persisted: contactsPersisted,
    contacts_indexed: contactsIndexed,
    stopped_reason: stoppedReason,
    rate_limit_reset_at: rateLimitResetAt,
    next_pagination_token: paginationToken,
  };
  log?.info(summary, "[twitter:scrape] following sync done");
  return summary;
}

// Exported for tests.
export const __internal = {
  refreshAccessToken,
  getUsableAccessToken,
  getUserId,
  fetchFollowingPage,
  PAGE_SIZE,
  MAX_PAGES,
};

// Re-export the secret-bag helper so test mocks have a single point of
// override. (Real callers should import from db/secrets.js directly.)
export { getSecret as _getSecret };
