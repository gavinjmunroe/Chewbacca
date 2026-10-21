/**
 * LinkedIn Voyager connection scraper + profile enrichment.
 *
 * Two passes:
 *
 *   Pass 1 (broad): paginate
 *     /voyager/api/relationships/dash/connections
 *     to get every first-degree connection's name + headline +
 *     publicIdentifier. Upsert each into Firestore and embed.
 *     Bounded at 50 pages = 2000 connections per sync; subsequent
 *     re-syncs continue paginating.
 *
 *   Pass 2 (deep): for every persisted LinkedIn contact that does
 *     not yet have metadata.linkedin.enriched_at, fetch
 *     /voyager/api/identity/profiles/<publicId>/profileView and
 *     extract education + work history + location. Re-upsert with
 *     the enrichment and re-embed so semantic queries like
 *     "who in my contacts goes to Stanford" can hit education
 *     records even when the user's headline doesn't mention it.
 *     Bounded at 40 enrichments per sync (~30s with pacing). Each
 *     subsequent re-sync deepens 40 more.
 *
 * Both passes are best-effort. We never throw, never fail the
 * outer HTTP request. Each failure logs and moves on.
 */

import { listContacts, upsertContact } from "../../db/user-store.js";
import { resolveAmberIdByPrivyDid } from "../../db/store.js";

const VOYAGER_BASE =
  "https://www.linkedin.com/voyager/api/relationships/dash/connections";
const DECORATION_ID =
  "com.linkedin.voyager.dash.deco.web.mynetwork.ConnectionListWithProfile-16";
const PROFILE_VIEW_BASE =
  "https://www.linkedin.com/voyager/api/identity/profiles";

const PAGE_SIZE = 40;
const MAX_PAGES = 50;
const PAGE_TIMEOUT_MS = 12000;
const ENRICH_PER_SYNC = 40;
const ENRICH_TIMEOUT_MS = 10000;
const ENRICH_PACING_MS = 500;
const PAGE_PACING_MS = 250;

const BROWSER_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

function buildHeaders(liAt, jsessionidRaw) {
  const unquoted = jsessionidRaw.replace(/^"|"$/g, "");
  const csrf = unquoted.startsWith("ajax:") ? unquoted : `ajax:${unquoted}`;
  return {
    cookie: `li_at=${liAt}; JSESSIONID="${csrf}"`,
    "csrf-token": csrf,
    "x-restli-protocol-version": "2.0.0",
    accept: "application/vnd.linkedin.normalized+json+2.1",
    "accept-language": "en-US,en;q=0.9",
    "user-agent": BROWSER_USER_AGENT,
    "x-li-lang": "en_US",
    "x-li-track":
      '{"clientVersion":"1.13.0","mpVersion":"1.13.0","osName":"web","timezoneOffset":-7,"timezone":"America/Los_Angeles","deviceFormFactor":"DESKTOP","mpName":"voyager-web"}',
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

// ─── Pass 1: paginated connection list ─────────────────────────────────────

async function fetchConnectionsPage(liAt, jsessionidRaw, start, log) {
  const url =
    `${VOYAGER_BASE}?decorationId=${encodeURIComponent(DECORATION_ID)}` +
    `&count=${PAGE_SIZE}&q=search&sortType=RECENTLY_ADDED&start=${start}`;
  let res;
  try {
    res = await fetch(url, {
      method: "GET",
      headers: buildHeaders(liAt, jsessionidRaw),
      signal: AbortSignal.timeout(PAGE_TIMEOUT_MS),
    });
  } catch (err) {
    log?.warn(
      { start, ...describeFetchError(err) },
      "[voyager:scrape] page fetch failed",
    );
    return { ok: false, error: "fetch_failed" };
  }
  if (!res.ok) {
    log?.warn(
      { start, status: res.status },
      "[voyager:scrape] page non-200 response",
    );
    return { ok: false, error: `status_${res.status}` };
  }
  let body;
  try {
    body = await res.json();
  } catch (err) {
    return { ok: false, error: "parse_failed" };
  }
  const total =
    body?.data?.paging?.total ??
    body?.paging?.total ??
    body?.metadata?.totalResultCount ??
    null;
  const included = Array.isArray(body?.included) ? body.included : [];
  const profiles = included.filter((item) => {
    const t = item?.$type || "";
    return (
      t.endsWith(".Profile") ||
      t.endsWith("dash.identity.profile.Profile") ||
      (typeof item?.publicIdentifier === "string" &&
        typeof item?.firstName === "string")
    );
  });
  return { ok: true, profiles, total };
}

function profileToContact(profile) {
  const firstName = profile?.firstName || "";
  const lastName = profile?.lastName || "";
  const name = `${firstName} ${lastName}`.trim();
  if (!name) return null;
  const publicId =
    profile?.publicIdentifier || profile?.entityUrn?.split(":").pop() || null;
  if (!publicId) return null;
  const headline = profile?.headline || profile?.occupation || null;
  const location = profile?.geoLocationName || profile?.locationName || null;
  return {
    source: "linkedin",
    sourceHandle: publicId,
    externalId: `linkedin:${publicId}`,
    name,
    firstName: firstName || null,
    lastName: lastName || null,
    title: headline,
    location,
    metadata: {
      linkedin: {
        publicIdentifier: publicId,
        profileUrl: `https://www.linkedin.com/in/${publicId}`,
      },
    },
  };
}

// ─── Pass 2: per-profile enrichment ────────────────────────────────────────

async function fetchProfileDetail(publicId, liAt, jsessionidRaw, log) {
  const url = `${PROFILE_VIEW_BASE}/${encodeURIComponent(publicId)}/profileView`;
  let res;
  try {
    res = await fetch(url, {
      method: "GET",
      headers: buildHeaders(liAt, jsessionidRaw),
      signal: AbortSignal.timeout(ENRICH_TIMEOUT_MS),
    });
  } catch (err) {
    log?.warn(
      { publicId, ...describeFetchError(err) },
      "[voyager:enrich] fetch failed",
    );
    return null;
  }
  if (!res.ok) {
    log?.warn(
      { publicId, status: res.status },
      "[voyager:enrich] non-200 response",
    );
    return null;
  }
  let body;
  try {
    body = await res.json();
  } catch (err) {
    return null;
  }
  return parseProfileDetail(body);
}

function parseProfileDetail(body) {
  if (!body || typeof body !== "object") return null;
  const educations = [];
  const educationElements =
    body?.educationView?.elements ||
    body?.profileEducationView?.elements ||
    body?.included?.filter?.((i) => i?.$type?.endsWith?.(".Education")) ||
    [];
  for (const ed of educationElements) {
    if (!ed) continue;
    const school = ed.schoolName || ed.school?.name || ed.schoolUrn || null;
    if (!school) continue;
    educations.push({
      school,
      degree: ed.degreeName || null,
      field: ed.fieldOfStudy || null,
      startYear: ed.timePeriod?.startDate?.year || ed.startYear || null,
      endYear: ed.timePeriod?.endDate?.year || ed.endYear || null,
    });
  }

  const positions = [];
  const positionElements =
    body?.positionView?.elements ||
    body?.profilePositionView?.elements ||
    body?.included?.filter?.((i) => i?.$type?.endsWith?.(".Position")) ||
    [];
  for (const p of positionElements) {
    if (!p) continue;
    const company = p.companyName || p.company?.name || p.companyUrn || null;
    if (!company) continue;
    positions.push({
      company,
      title: p.title || null,
      location: p.locationName || null,
      startYear: p.timePeriod?.startDate?.year || null,
      endYear: p.timePeriod?.endDate?.year || null,
    });
  }

  const profile = body?.profile || body;
  const summary = profile?.summary || null;
  const location =
    profile?.geoLocationName ||
    profile?.locationName ||
    profile?.location?.name ||
    null;
  const industryName = profile?.industryName || null;

  return {
    educations,
    positions,
    summary,
    location,
    industryName,
  };
}

/**
 * Build the rich notes string that becomes the bulk of the contact's
 * embedding text. Education + work history + summary all woven in so a
 * semantic search for "Stanford" or "founder" or "design lead" hits the
 * right person.
 */
function buildEnrichedNotes(detail) {
  if (!detail) return null;
  const lines = [];
  if (detail.summary) lines.push(detail.summary.trim());
  if (detail.educations.length > 0) {
    const schools = detail.educations
      .map((e) => {
        const bits = [e.school];
        if (e.degree) bits.push(e.degree);
        if (e.field) bits.push(e.field);
        if (e.endYear) bits.push(String(e.endYear));
        return bits.join(", ");
      })
      .join("; ");
    lines.push(`Education: ${schools}.`);
  }
  if (detail.positions.length > 0) {
    const jobs = detail.positions
      .slice(0, 8)
      .map((p) => {
        const bits = [];
        if (p.title) bits.push(p.title);
        if (p.company) bits.push(`at ${p.company}`);
        if (p.endYear === null || p.endYear === undefined) {
          if (p.startYear) bits.push(`(since ${p.startYear})`);
        } else if (p.startYear) {
          bits.push(`(${p.startYear}–${p.endYear})`);
        }
        return bits.join(" ");
      })
      .filter(Boolean)
      .join("; ");
    lines.push(`Work history: ${jobs}.`);
  }
  if (detail.industryName) lines.push(`Industry: ${detail.industryName}.`);
  return lines.length > 0 ? lines.join(" ") : null;
}

// ─── Top-level orchestrator ───────────────────────────────────────────────

export async function scrapeAndIndexConnections(did, liAt, jsessionidRaw, log) {
  if (!did || !liAt || !jsessionidRaw) {
    return { ok: false, error: "missing_args" };
  }

  const ownerId = await resolveAmberIdByPrivyDid(did).catch(() => null);
  if (!ownerId) {
    log?.info({ did }, "[linkedin:scrape] privy_did not linked to amber, skipping");
    return { ok: false, error: "owner_not_linked" };
  }

  log?.info({ did }, "[voyager:scrape] starting pass 1 (connection list)");

  // ── Pass 1: paginated breadth scrape ──────────────────────────────────
  let pagesScraped = 0;
  let profilesFound = 0;
  let contactsPersisted = 0;
  const persistedThisRun = [];
  let total = null;

  for (let page = 0; page < MAX_PAGES; page++) {
    const start = page * PAGE_SIZE;
    const result = await fetchConnectionsPage(liAt, jsessionidRaw, start, log);
    if (!result.ok) break;
    pagesScraped++;
    if (typeof result.total === "number") total = result.total;
    if (result.profiles.length === 0) break;
    profilesFound += result.profiles.length;

    for (const profile of result.profiles) {
      const contact = profileToContact(profile);
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
          "[voyager:scrape] upsert failed",
        );
      }
    }

    if (typeof total === "number" && start + PAGE_SIZE >= total) break;
    await new Promise((r) => setTimeout(r, PAGE_PACING_MS));
  }

  // ── Pass 1.5: embed everything that was persisted ─────────────────────
  let contactsIndexed = 0;
  if (persistedThisRun.length > 0) {
  }

  log?.info(
    {
      did,
      pages: pagesScraped,
      profiles_found: profilesFound,
      contacts_persisted: contactsPersisted,
      contacts_indexed: contactsIndexed,
      total,
    },
    "[voyager:scrape] pass 1 done, starting pass 2 (enrichment)",
  );

  // ── Pass 2: enrich up to ENRICH_PER_SYNC un-enriched contacts ─────────
  // We pull the user's entire LinkedIn contact set (not just this run's
  // adds) so re-syncs gradually deepen the back-catalog, not just the
  // freshest connections.
  let enrichedThisRun = 0;
  let enrichFailures = 0;
  const enrichedContacts = [];
  try {
    const allContacts = await listContacts(ownerId);
    const candidates = allContacts.filter(
      (c) =>
        c?.source === "linkedin" &&
        c?.sourceHandle &&
        !c?.metadata?.linkedin?.enriched_at,
    );
    const toEnrich = candidates.slice(0, ENRICH_PER_SYNC);
    log?.info(
      { did, total_un_enriched: candidates.length, taking: toEnrich.length },
      "[voyager:enrich] pass 2 candidates",
    );
    for (const contact of toEnrich) {
      const detail = await fetchProfileDetail(
        contact.sourceHandle,
        liAt,
        jsessionidRaw,
        log,
      );
      if (!detail) {
        enrichFailures++;
        await new Promise((r) => setTimeout(r, ENRICH_PACING_MS));
        continue;
      }
      const notes = buildEnrichedNotes(detail);
      const primaryCompany = detail.positions[0]?.company || null;
      const primaryTitle = detail.positions[0]?.title || null;
      const enrichedContact = {
        ...contact,
        // contact.id is preserved so upsertContact targets the same doc
        // instead of creating a new one.
        company: primaryCompany || contact.company || null,
        title: primaryTitle || contact.title || null,
        location: detail.location || contact.location || null,
        notes: notes || contact.notes || null,
        metadata: {
          ...(contact.metadata || {}),
          linkedin: {
            ...(contact.metadata?.linkedin || {}),
            enriched_at: new Date().toISOString(),
            schools: detail.educations.map((e) => e.school),
            companies: detail.positions.map((p) => p.company),
          },
        },
      };
      try {
        const saved = await upsertContact(ownerId, enrichedContact);
        if (saved) {
          enrichedThisRun++;
          enrichedContacts.push(saved);
        }
      } catch (err) {
        log?.warn(
          { did, publicId: contact.sourceHandle, err: err.message },
          "[voyager:enrich] upsert failed",
        );
        enrichFailures++;
      }
      await new Promise((r) => setTimeout(r, ENRICH_PACING_MS));
    }
  } catch (err) {
    log?.warn(
      { did, err: err.message },
      "[voyager:enrich] pass 2 outer failure",
    );
  }

  // Re-embed every enriched contact so the richer notes string lands
  // in Pinecone and shows up in semantic queries immediately.
  let reIndexed = 0;
  if (enrichedContacts.length > 0) {
  }

  const summary = {
    ok: true,
    did,
    pass1: {
      pages: pagesScraped,
      profiles_found: profilesFound,
      contacts_persisted: contactsPersisted,
      contacts_indexed: contactsIndexed,
      total,
    },
    pass2: {
      enriched: enrichedThisRun,
      failures: enrichFailures,
      re_indexed: reIndexed,
    },
  };
  log?.info(summary, "[voyager:scrape] all passes done");
  return summary;
}
