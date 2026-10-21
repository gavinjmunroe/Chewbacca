/**
 * Togari-search PeopleRank adapter.
 *
 * medha-id's CLAUDE.md defines `Amber ID = ... × PeopleRank × ...` where
 * PeopleRank is the "Togari relationship-intelligence adapter". This module is
 * that adapter for the live query-driven path: it delegates `/v1/me/people-rank`
 * to the deployed togari-search service (PeopleRank UC1), which ranks the
 * caller's own contacts by semantic relevance to their query and writes a
 * grounded answer with inline [[p:CONTACT_ID]] citations.
 *
 * Strictly opt-in and fail-open:
 *   - Returns null (so the caller falls back to the local warmth+recency
 *     scorer) unless PEOPLERANK_ENGINE === "togari" AND both TOGARI_SEARCH_URL
 *     and TOGARI_SEARCH_KEY are configured.
 *   - Returns null on any upstream error / unexpected shape, so a togari-search
 *     outage degrades to the existing local ranking instead of a 500.
 *
 * The bearer key lives only in this server's env, never in the iOS bundle, so
 * the client contract (POST /v1/me/people-rank with the session token) is
 * unchanged — the app does not know which engine produced the ranking.
 */

import { listContactsForRanking, getProfile } from "../db/user-store.js";
import { resolveAmberIdByPrivyDid } from "../db/store.js";
import { filterRealContacts } from "../lib/people-rank-realness.js";
import { dedupeContacts } from "../lib/people-rank-dedup.js";

const DEFAULT_TIMEOUT_MS = 30_000;

function engineEnabled() {
  return (
    (process.env.PEOPLERANK_ENGINE || "").trim().toLowerCase() === "togari"
  );
}

function searchUrl() {
  return (process.env.TOGARI_SEARCH_URL || "").trim().replace(/\/+$/, "");
}

function searchKey() {
  return (process.env.TOGARI_SEARCH_KEY || "").trim();
}

/**
 * SAY AT BOOT WHETHER RANKING IS ON. THREE ENV VARS HAVE TO AGREE -- engine,
 * URL, key -- and every one of them fails by returning null, which the caller
 * treats as "use the local warmth scorer". So a missing key and a healthy
 * PeopleRank produce the same silent result: ranked-looking output that never
 * went through the ranker.
 *
 * That is the same shape as the credentials outage and the 2560-dim embeddings:
 * works locally, does nothing in production, says nothing either way. One line
 * at startup is the whole fix.
 */
export function reportPeopleRank(log = console) {
  const engine = (process.env.PEOPLERANK_ENGINE || "").trim().toLowerCase();
  const url = searchUrl();
  const key = searchKey();

  if (engine === "togari" && url && key) {
    log.info?.(`[peoplerank] ON -- ${url}`) ?? log.log(`[peoplerank] ON -- ${url}`);
    return { on: true, url };
  }

  const missing = [];
  if (engine !== "togari") {
    missing.push(engine ? `PEOPLERANK_ENGINE="${engine}" (must be "togari")` : "PEOPLERANK_ENGINE");
  }
  if (!url) missing.push("TOGARI_SEARCH_URL");
  if (!key) missing.push("TOGARI_SEARCH_KEY");

  const msg =
    `[peoplerank] OFF -- every ranked result is coming from the local ` +
    `warmth+recency scorer, not PeopleRank. Missing: ${missing.join(", ")}.`;
  log.error?.(msg) ?? log.log(msg);
  return { on: false, missing };
}

function firstString(...candidates) {
  for (const c of candidates) {
    if (Array.isArray(c)) {
      for (const v of c) {
        if (typeof v === "string" && v.trim()) return v.trim();
      }
    } else if (typeof c === "string" && c.trim()) {
      return c.trim();
    }
  }
  return undefined;
}

// Flatten strings/arrays into a trimmed, case-insensitively-deduped list.
// Returns undefined when nothing non-empty resolves (so the field is omitted).
function strList(...vals) {
  const out = [];
  const seen = new Set();
  const add = (v) => {
    if (typeof v !== "string") return;
    const t = v.trim();
    if (!t) return;
    const k = t.toLowerCase();
    if (!seen.has(k)) {
      seen.add(k);
      out.push(t);
    }
  };
  for (const v of vals) {
    if (Array.isArray(v)) v.forEach(add);
    else add(v);
  }
  return out.length ? out : undefined;
}

/**
 * Build the optional `me` (caller profile) that the engine uses for the warmth
 * term: same-city (+0.5) and occupation/title token overlap (+0.5). Sparse when
 * the owner profile is thin — absent fields just leave warmth at 0 (no
 * regression), present fields (city, occupation) make warmth real. This matters
 * most for no-query rankings, where the engine's warmth carries the whole
 * signal. Returns undefined when there's nothing useful to send.
 */
export function buildMe(profile) {
  if (!profile || typeof profile !== "object") return undefined;
  // Profile overflow lives under profile_extra (placesLived / schools /
  // almaMater / employers); accept either casing, and tolerate a flattened
  // profile too.
  const ex = profile.profileExtra || profile.profile_extra || {};
  const me = {
    id: "me",
    name: firstString(profile.name, profile.displayName, profile.fullName),
    // New prior fields the ranker now accepts (extra fields are ignored by
    // engines that predate them, so this is safe pre-deploy). Deduped/omitted
    // when empty.
    cities: strList(ex.placesLived, profile.placesLived),
    schools: strList(
      ex.schools,
      ex.almaMater,
      ex.alma_mater,
      profile.schools,
      profile.almaMater,
      profile.school,
    ),
    employers: strList(ex.employers, profile.employers),
    // The profile stores the user's city as `currentCity` (the PATCH /v1/me
    // field), so it MUST be the primary source — reading only city/location/
    // region missed it entirely, so `me.city` was always empty and the engine's
    // same-city proximity term never fired. `hometown` is a last-resort fallback
    // (a stored field) used only when no current city is set.
    city: firstString(
      profile.currentCity,
      profile.city,
      profile.location,
      profile.region,
      profile.hometown,
    ),
    // `profile.occupation` is already read first here; it resolves once the
    // occupation field is persisted (added to MUTABLE_FIELDS in profile.js).
    occupation: firstString(
      profile.occupation,
      profile.title,
      profile.role,
      profile.jobTitle,
      profile.headline,
    ),
    bio: firstString(profile.bio, profile.about, profile.summary),
    timezone: firstString(profile.timezone, profile.tz, profile.timeZone),
    mbti: firstString(profile.mbti),
    school: firstString(profile.school),
    hometown: firstString(profile.hometown),
  };
  for (const k of Object.keys(me)) {
    if (me[k] === undefined) delete me[k];
  }
  // Only the id is auto-set; if nothing else resolved, there's no signal worth
  // sending — let the engine treat the caller as unknown.
  return Object.keys(me).length > 1 ? me : undefined;
}

/** Map a Firestore contact doc to the togari-search ContactIn shape. */
function toContactIn(c) {
  if (!c || !c.id || !c.name) return null;
  // Apple contacts misuse the company field for relationship notes
  // ("USC Neighbor"), not an employer. For apple-sourced contacts fold it into
  // notes and leave company empty so it isn't ranked/displayed as a company.
  const src = String(c.source || c.sourcePlatform || "").toLowerCase();
  const isApple = src.includes("apple");
  let company = c.company || undefined;
  let notes = firstString(c.notes, c.bio, c.relationshipSummary);
  if (isApple && company) {
    notes = [company, notes].filter(Boolean).join(" | ");
    company = undefined;
  }
  return {
    contactId: c.id,
    name: c.name,
    company,
    title: c.title || undefined,
    city: c.city || c.location || undefined,
    email: firstString(c.emails, c.email),
    phone: firstString(c.phoneNumbers, c.phone),
    notes,
    // Enrichment-derived signals (ignored by engines that predate them).
    linkedin_url: firstString(c.linkedinUrl, c.linkedin_url),
    industry: firstString(c.enrichment?.industry),
    tags: Array.isArray(c.tags) ? c.tags : [],
    facts: Array.isArray(c.facts) ? c.facts : [],
  };
}

/**
 * Format the current instant as a human-readable local string so Stage 1 never
 * does date math. Uses native Intl (no external dependency).
 * Falls back to UTC if `tz` is missing or not a valid IANA zone.
 * Example output: "Tuesday, July 7, 2026, 8:47 PM (America/New_York)"
 */
function buildNowLocal(date, tz) {
  const tzLabel = typeof tz === "string" && tz.trim() ? tz.trim() : "UTC";
  const options = {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  };
  const format = (zone) => {
    const parts = new Intl.DateTimeFormat("en-US", { ...options, timeZone: zone }).formatToParts(date);
    const get = (type) => parts.find((p) => p.type === type)?.value ?? "";
    return `${get("weekday")}, ${get("month")} ${get("day")}, ${get("year")}, ${get("hour")}:${get("minute")} ${get("dayPeriod")}`;
  };
  try {
    return `${format(tzLabel)} (${tzLabel})`;
  } catch {
    return `${format("UTC")} (UTC)`;
  }
}

/**
 * Delegate ranking to togari-search. Returns the response body (already in the
 * { query, count, people, answer, answer_status, citations } contract the iOS
 * middle tab consumes) on success, or null to signal "fall back to local".
 *
 * @param {object} args
 * @param {string|null} args.query
 * @param {number} args.limit
 * @param {Array<object>} args.contacts  raw Firestore contact docs
 * @param {object} [args.me]             optional caller profile for warmth
 * @param {boolean} [args.answer=true]   false skips the engine's Stage 3 answer
 *   synthesis and returns ranked people only (~1.3s vs ~6s). Defaults to true,
 *   so every existing caller behaves exactly as before.
 * @param {object} [deps]                { fetch } injectable for tests
 */
export async function rankViaTogariSearch(
  { query, limit, contacts, me, answer = true } = {},
  deps = {},
) {
  if (!engineEnabled()) return null;
  const url = searchUrl();
  const key = searchKey();
  if (!url || !key) return null;
  if (!Array.isArray(contacts) || contacts.length === 0) return null;

  const mapped = contacts.map(toContactIn).filter(Boolean);
  if (mapped.length === 0) return null;

  // NO PAYLOAD DUMP HERE. A debug console.log used to print three whole contact
  // objects — names and their personal facts — to stdout on every ranked query,
  // which put them in the deployment's log stream permanently. If this needs
  // instrumenting again, log counts only, never contents.

  const fetchFn = deps.fetch || globalThis.fetch;
  if (typeof fetchFn !== "function") return null;

  const nowDate = new Date();
  const tz = me && typeof me === "object" ? (me.timezone || null) : null;
  const payload = {
    query: query || undefined,
    limit: Number(limit) > 0 ? Number(limit) : 15,
    contacts: mapped,
    now: nowDate.toISOString(),
    now_local: buildNowLocal(nowDate, tz),
    // Stage 3 (answer synthesis) toggle. true is the engine's own default, so
    // sending it explicitly changes nothing for existing callers.
    answer: answer !== false,
  };
  if (me && typeof me === "object") payload.me = me;

  const timeoutMs =
    Number(process.env.TOGARI_SEARCH_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS;

  try {
    const res = await fetchFn(`${url}/v1/me/people-rank`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${key}`,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return null;
    const json = await res.json().catch(() => null);
    if (!json || !Array.isArray(json.people)) return null;
    return json;
  } catch {
    // Fail open: any network/timeout/parse error falls back to local ranking.
    return null;
  }
}

/**
 * Streaming twin of rankViaTogariSearch: POSTs the same payload to
 * /v1/me/people-rank/stream and yields the engine's SSE events as they arrive.
 *
 *   for await (const evt of streamViaTogariSearch({ query, limit, contacts, me })) {
 *     evt.type === "people" -> { query, count, people[] }   (ranked, pre-answer)
 *     evt.type === "token"  -> { text }                     (answer delta)
 *     evt.type === "done"   -> { answer, answer_status, citations, rank_order,
 *                                count, people }
 *   }
 *
 * Consumes the response body with the same getReader()/TextDecoder line-buffer
 * approach streamChat (src/routes/chat.js) uses for Anthropic SSE, extended to
 * track the `event:` line because this stream carries the type there rather
 * than inside the data JSON.
 *
 * FAIL-OPEN, exactly like rankViaTogariSearch: if the engine is off, not
 * configured, unreachable, or answers with a non-2xx, the generator simply
 * yields NOTHING and returns. A caller that has received no events can safely
 * fall back to the blocking path; one that has already relayed tokens should
 * finalize with what it has. Malformed frames are skipped, never thrown.
 */
export async function* streamViaTogariSearch(
  { query, limit, contacts, me } = {},
  deps = {},
) {
  if (!engineEnabled()) return;
  const url = searchUrl();
  const key = searchKey();
  if (!url || !key) return;
  if (!Array.isArray(contacts) || contacts.length === 0) return;

  const mapped = contacts.map(toContactIn).filter(Boolean);
  if (mapped.length === 0) return;

  const fetchFn = deps.fetch || globalThis.fetch;
  if (typeof fetchFn !== "function") return;

  const nowDate = new Date();
  const tz = me && typeof me === "object" ? (me.timezone || null) : null;
  const payload = {
    query: query || undefined,
    limit: Number(limit) > 0 ? Number(limit) : 15,
    contacts: mapped,
    now: nowDate.toISOString(),
    now_local: buildNowLocal(nowDate, tz),
  };
  if (me && typeof me === "object") payload.me = me;

  const timeoutMs =
    Number(process.env.TOGARI_SEARCH_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS;

  let res;
  try {
    res = await fetchFn(`${url}/v1/me/people-rank/stream`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${key}`,
        accept: "text/event-stream",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    return; // network / timeout — caller falls back
  }
  if (!res || !res.ok || !res.body) return;

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let eventType = null;
  let dataLines = [];

  // Flush one complete SSE frame (terminated by a blank line) into an event.
  const flush = () => {
    const type = eventType;
    const raw = dataLines.join("\n");
    eventType = null;
    dataLines = [];
    if (!type || !raw) return null;
    try {
      return { type, data: JSON.parse(raw) };
    } catch {
      return null; // a malformed frame is skipped, not fatal
    }
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl;
      while ((nl = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, nl).replace(/\r$/, "");
        buffer = buffer.slice(nl + 1);
        if (line === "") {
          const evt = flush();
          if (evt) yield evt;
          continue;
        }
        if (line.startsWith(":")) continue; // heartbeat / comment
        if (line.startsWith("event:")) {
          eventType = line.slice(6).trim();
        } else if (line.startsWith("data:")) {
          dataLines.push(line.slice(5).trim());
        }
      }
    }
    // A final frame with no trailing blank line still counts.
    const tail = flush();
    if (tail) yield tail;
  } catch {
    // Mid-stream failure: stop yielding. The caller keeps whatever it received.
  } finally {
    reader.cancel().catch(() => {});
  }
}

// asArray tolerates either an array or a { contacts } wrapper from the
// realness/dedup libs so this never breaks on a library refactor.
function asArray(v, fallback) {
  if (Array.isArray(v)) return v;
  if (v && Array.isArray(v.contacts)) return v.contacts;
  return fallback;
}

/**
 * Service-side, DID-scoped people-rank via togari-search. Loads the DID's own
 * contacts, cleans them, and ranks them through the live engine. HARD FAILS
 * (returns { ok:false, error }) instead of falling back to a local scorer —
 * the agent, the MCP, and the iOS app all want the real engine or a visible
 * error, never silently-worse local results.
 *
 *   rankDidViaTogari(did, { query, limit })
 *     -> { ok:true, result:{ query, count, people, answer, ... } }
 *     -> { ok:false, error:"engine_disabled"|"engine_not_configured"|
 *           "no_contacts"|"engine_unavailable" }
 */
export async function rankDidViaTogari(did, { query, limit } = {}, deps = {}) {
  if (!did) return { ok: false, error: "missing_did" };
  if (!engineEnabled()) return { ok: false, error: "engine_disabled" };
  if (!searchUrl() || !searchKey())
    return { ok: false, error: "engine_not_configured" };

  // Session subjects are not always the contacts.owner_id UUID: medha-id
  // sessions use a 32-hex person_id and legacy sessions use a Privy DID.
  // Resolve the verified subject before querying the owner-scoped address book.
  const resolveFn = deps.resolveAmberIdByPrivyDid || resolveAmberIdByPrivyDid;
  const amberId = await resolveFn(did).catch(() => null);
  if (!amberId) return { ok: false, error: "identity_not_found" };

  const listFn = deps.listContactsForRanking || listContactsForRanking;
  const raw = await listFn(amberId).catch(() => []);
  if (!Array.isArray(raw) || raw.length === 0)
    return { ok: false, error: "no_contacts" };

  const real = asArray(filterRealContacts(raw), raw);
  const contacts = asArray(dedupeContacts(real), real);

  // Owner profile -> `me` so the engine's warmth term (same-city / occupation
  // overlap) is live. Best-effort: a missing profile just means no warmth.
  const getProfileFn = deps.getProfile || getProfile;
  const profile = await getProfileFn(did).catch(() => null);
  const me = buildMe(profile);

  const result = await rankViaTogariSearch(
    { query, limit, contacts, me },
    deps,
  );
  if (!result) return { ok: false, error: "engine_unavailable" };
  return { ok: true, result };
}

export const __testing = {
  toContactIn,
  buildMe,
  engineEnabled,
  searchUrl,
  searchKey,
};
