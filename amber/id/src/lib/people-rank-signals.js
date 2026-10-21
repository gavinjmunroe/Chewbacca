/**
 * Web-derived ranking signals for the SEARCH function (spec §1b).
 *
 * Given a contact, build a small bounded multi-query Search fan-out, dedupe
 * the results by URL, and DETERMINISTICALLY extract four signals (code as
 * gap-filler — no LLM here, that's ENRICH's job):
 *
 *   recency      — newest result date as epoch ms (or null)
 *   momentum     — count of distinct domains with a result in the last 90d
 *   social_links — { linkedin, twitter, github, website } pulled from URLs
 *   top_sources  — top N { title, url, date } (freshest first)
 *
 * These feed BOTH:
 *   1. the additive signal score component in people-rank-score.js, and
 *   2. the additive contact-card fields in me-people-rank.js (§1c).
 *
 * Everything degrades to a neutral empty-signals object when the Search key
 * or the flag is absent, so the base SEARCH path is unaffected. Results are
 * cached in-process with a TTL (default 24h) and the per-request contact
 * count is capped so a large address book can't fan out unbounded Search
 * calls on the request path.
 *
 * This module is retrieval-adjacent but pure-ish: the only side effect is the
 * module-level cache, and the network call is delegated to the injected
 * `searchImpl` (defaults to web-search.search, Exa-backed) so it is fully testable
 * with no network.
 */

import { search as defaultSearch } from "./web-search.js";

const NINETY_DAYS_MS = 90 * 86400000;
const DEFAULT_TTL_MS = Number(
  process.env.PEOPLERANK_SIGNALS_TTL_MS || 24 * 60 * 60 * 1000,
);
const DEFAULT_MAX_CONTACTS = Number(
  process.env.PEOPLERANK_SIGNALS_MAX_CONTACTS || 8,
);
const DEFAULT_TOP_SOURCES = 5;

/** A neutral, fully-shaped signals object. Used whenever we can't/shouldn't search. */
export function emptySignals() {
  return {
    recency: null,
    momentum: 0,
    social_links: {},
    top_sources: [],
    queried: false,
  };
}

/**
 * Build up to 5 Search query variants from a contact's identity. The variants
 * are intentionally diverse (company, role, linkedin, fresh news, social) so a
 * single multi-query request paints a broad picture. Returns [] when the
 * contact has no usable name (we never search on a blank identity).
 */
export function buildQueryVariants(contact, { year } = {}) {
  const name = (contact?.name || "").trim();
  if (!name) return [];
  const company = (contact?.company || "").trim();
  const title = (contact?.title || "").trim();
  const yr = year || new Date().getUTCFullYear();

  const variants = [];
  if (company) variants.push(`${name} ${company}`);
  if (title) variants.push(`${name} ${title}`);
  variants.push(`${name} linkedin`);
  variants.push(`${name} news ${yr}`);
  variants.push(`${name} x.com OR twitter`);

  // Dedupe (a missing company/title can collapse variants) and cap at 5.
  const seen = new Set();
  const out = [];
  for (const v of variants) {
    const key = v.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(v);
    if (out.length >= 5) break;
  }
  return out;
}

/**
 * Parse a Search result `date`/`last_updated` into epoch ms, or null. The
 * Search API returns ISO-ish strings; we tolerate anything Date.parse eats.
 */
function resultDateMs(result) {
  const raw = result?.date || result?.last_updated || null;
  if (!raw) return null;
  const t = Date.parse(raw);
  return Number.isNaN(t) ? null : t;
}

/** Hostname (lowercased, no leading www.) of a URL, or null. */
function domainOf(url) {
  if (typeof url !== "string") return null;
  try {
    const h = new URL(url).hostname.toLowerCase();
    return h.startsWith("www.") ? h.slice(4) : h;
  } catch {
    return null;
  }
}

/**
 * Classify a URL into a social-link slot by host. Returns a [type, url] pair
 * or null. First-match-wins per type at the call site.
 */
function classifySocial(url) {
  const host = domainOf(url);
  if (!host) return null;
  if (host.includes("linkedin.com")) return ["linkedin", url];
  if (host === "twitter.com" || host === "x.com" || host.endsWith(".x.com")) {
    return ["twitter", url];
  }
  if (host.includes("github.com")) return ["github", url];
  return null;
}

/**
 * Deterministically extract signals from a flat list of Search results.
 * Pure — no network, no clock beyond the injected `nowMs`. Exported for
 * direct unit testing.
 *
 *   extractSignals(results, { nowMs?, topN? }) -> signals
 */
export function extractSignals(results, { nowMs = Date.now(), topN = DEFAULT_TOP_SOURCES } = {}) {
  const list = Array.isArray(results) ? results : [];
  if (list.length === 0) return emptySignals();

  // Dedupe by URL, keeping the first occurrence (Search returns grouped per
  // query; earlier groups are the more identity-anchored variants).
  const byUrl = new Map();
  for (const r of list) {
    const url = typeof r?.url === "string" ? r.url : null;
    if (!url) continue;
    if (!byUrl.has(url)) byUrl.set(url, r);
  }
  const deduped = [...byUrl.values()];
  if (deduped.length === 0) return emptySignals();

  // recency: newest date across all results.
  let recency = null;
  for (const r of deduped) {
    const ms = resultDateMs(r);
    if (ms != null && (recency == null || ms > recency)) recency = ms;
  }

  // momentum: distinct domains with a result newer than 90 days.
  const freshDomains = new Set();
  for (const r of deduped) {
    const ms = resultDateMs(r);
    if (ms == null) continue;
    if (nowMs - ms <= NINETY_DAYS_MS) {
      const d = domainOf(r.url);
      if (d) freshDomains.add(d);
    }
  }
  const momentum = freshDomains.size;

  // social_links: first matching URL per platform.
  const social_links = {};
  for (const r of deduped) {
    const hit = classifySocial(r.url);
    if (hit && !social_links[hit[0]]) social_links[hit[0]] = hit[1];
  }

  // top_sources: freshest first (undated sink to the bottom), then by input
  // order for stability. Trim to topN.
  const ranked = deduped
    .map((r, i) => ({ r, i, ms: resultDateMs(r) }))
    .sort((a, b) => {
      const am = a.ms == null ? -Infinity : a.ms;
      const bm = b.ms == null ? -Infinity : b.ms;
      if (bm !== am) return bm - am;
      return a.i - b.i;
    })
    .slice(0, topN)
    .map(({ r }) => ({
      title: typeof r.title === "string" ? r.title : "",
      url: typeof r.url === "string" ? r.url : "",
      date: r.date || r.last_updated || null,
    }));

  return {
    recency,
    momentum,
    social_links,
    top_sources: ranked,
    queried: true,
  };
}

/**
 * Map the raw signals into the 0..1 component inputs the scorer consumes.
 * Pure + deterministic. Exported so both the scorer wiring and tests share
 * one definition of "how fresh / how hot".
 *
 *   recencyComponent : exponential-ish bucketed decay on age of newest result
 *   momentumComponent: saturating on distinct fresh domains (3+ -> ~1)
 */
export function signalScoreInputs(signals, { nowMs = Date.now() } = {}) {
  const s = signals || emptySignals();
  let recency = 0;
  if (typeof s.recency === "number") {
    const days = Math.max(0, (nowMs - s.recency) / 86400000);
    // half-life 30 days: a result from today ~1, ~0.5 at a month, ~0.25 at two.
    recency = clamp01(Math.pow(0.5, days / 30));
  }
  const momentum = clamp01((Number(s.momentum) || 0) / 3);
  return { recency, momentum };
}

// ── cache ────────────────────────────────────────────────────────────────────

// did -> Map<contactId, { at, signals }>. Per-DID so a forget/wipe could drop a
// single tenant's slice without touching others (not wired here — bounded TTL
// is sufficient for the request path).
const _cache = new Map();

function cacheGet(did, contactId, ttlMs, nowMs) {
  const tenant = _cache.get(did);
  if (!tenant) return null;
  const hit = tenant.get(contactId);
  if (!hit) return null;
  if (nowMs - hit.at > ttlMs) {
    tenant.delete(contactId);
    return null;
  }
  return hit.signals;
}

function cacheSet(did, contactId, signals, nowMs) {
  let tenant = _cache.get(did);
  if (!tenant) {
    tenant = new Map();
    _cache.set(did, tenant);
  }
  tenant.set(contactId, { at: nowMs, signals });
}

/** Test/maintenance hook: clear the whole in-process signal cache. */
export function _clearSignalCache() {
  _cache.clear();
}

/**
 * Fetch (or read from cache) web signals for ONE contact. Never throws.
 *
 *   getContactSignals(did, contact, { searchImpl?, apiKey?, nowMs?, ttlMs?,
 *                                     priorityIds? }) -> signals
 *
 * Returns emptySignals() (queried:false) when the contact has no name or the
 * Search call fails — the caller treats that as "no web boost", identical to
 * the flag-off path.
 */
export async function getContactSignals(
  did,
  contact,
  {
    searchImpl = defaultSearch,
    apiKey = process.env.EXA_API_KEY,
    nowMs = Date.now(),
    ttlMs = DEFAULT_TTL_MS,
  } = {},
) {
  if (!apiKey || !contact?.id) return emptySignals();
  const cached = cacheGet(did, contact.id, ttlMs, nowMs);
  if (cached) return cached;

  const variants = buildQueryVariants(contact, {
    year: new Date(nowMs).getUTCFullYear(),
  });
  if (variants.length === 0) return emptySignals();

  let resp;
  try {
    resp = await searchImpl({ query: variants, apiKey, maxResults: 5 });
  } catch {
    resp = null;
  }
  if (!resp || !Array.isArray(resp.results)) return emptySignals();

  const signals = extractSignals(resp.results, { nowMs });
  cacheSet(did, contact.id, signals, nowMs);
  return signals;
}

/**
 * Fetch signals for a SET of contacts, capped at `maxContacts` (the rest get
 * emptySignals so the shape is uniform). Runs the per-contact Search calls in
 * parallel; each call is independently bounded and never throws. Returns a
 * `{ [contactId]: signals }` map.
 *
 * The cap protects the request path: only the top-ranked slice (the caller
 * should pass an already-ranked, sliced list) gets a live Search call.
 */
export async function getSignalsForContacts(
  did,
  contacts,
  {
    searchImpl = defaultSearch,
    apiKey = process.env.EXA_API_KEY,
    nowMs = Date.now(),
    ttlMs = DEFAULT_TTL_MS,
    maxContacts = DEFAULT_MAX_CONTACTS,
  } = {},
) {
  const out = {};
  const list = Array.isArray(contacts) ? contacts : [];
  if (!apiKey) {
    for (const c of list) if (c?.id) out[c.id] = emptySignals();
    return out;
  }
  const eligible = list.slice(0, Math.max(0, maxContacts));
  const overflow = list.slice(Math.max(0, maxContacts));

  const results = await Promise.all(
    eligible.map((c) =>
      getContactSignals(did, c, { searchImpl, apiKey, nowMs, ttlMs }).then(
        (signals) => ({ id: c?.id, signals }),
      ),
    ),
  );
  for (const { id, signals } of results) {
    if (id) out[id] = signals;
  }
  for (const c of overflow) if (c?.id) out[c.id] = emptySignals();
  return out;
}

function clamp01(n) {
  const v = Number(n) || 0;
  return Math.max(0, Math.min(1, v));
}

export const SIGNALS_DEFAULT_TTL_MS = DEFAULT_TTL_MS;
export const SIGNALS_DEFAULT_MAX_CONTACTS = DEFAULT_MAX_CONTACTS;
