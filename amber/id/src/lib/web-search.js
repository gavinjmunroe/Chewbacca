/**
 * Web search primitive for the PeopleRank SEARCH and ENRICH paths, backed by
 * Exa.
 *
 * REPLACES src/lib/perplexity-search.js. It keeps that module's contract
 * EXACTLY -- `search({query, maxResults, apiKey, fetchImpl}) -> {results, id} |
 * null`, with each result carrying `url`, `title` and `date` -- because
 * people-rank-signals.extractSignals reads those three fields positionally off
 * whatever it is handed, and enrich-person passes the same results into
 * social-links.rankSources. Preserving the shape means the repoint is two
 * import lines and no logic changes anywhere downstream.
 *
 * WHY EXA. It was already live and keyed in this codebase (routes/chat.js,
 * lib/place-search.js, lib/web-profile.js), so this removes the last
 * PERPLEXITY_API_KEY dependency without adding a vendor.
 *
 * ONE REAL DIFFERENCE, and it is a cost difference, not a behavior one.
 * Perplexity's Search API accepted up to five queries in ONE priced request.
 * Exa takes a single query per request, so a five-variant fan-out is five
 * requests instead of one. Both callers are gated off today
 * (PEOPLERANK_ENRICHMENT / PEOPLERANK_SEARCH_SIGNALS), so nothing bills until
 * they are turned on -- but when they are, budget per query, not per call.
 * WEB_SEARCH_MAX_QUERIES caps the fan-out; the default of 5 preserves the old
 * behavior rather than quietly narrowing results to save money.
 *
 * Never throws. Every failure path (no key, network, timeout, non-2xx, bad
 * JSON) resolves to null or an empty result set, so ranking degrades to the
 * no-web path exactly as before.
 */

import { exaSearch } from "./exa-search.js";

const MAX_QUERIES = Math.max(
  1,
  Math.min(Number(process.env.WEB_SEARCH_MAX_QUERIES) || 5, 10),
);

/**
 * Normalize one Exa result into the shape the signal extractors expect.
 *
 * `publishedDate` -> `date` is the whole reason this function exists:
 * people-rank-signals.freshnessOf reads `result.date || result.last_updated`,
 * and an Exa result has neither, so without the rename every source would look
 * undated and the recency signal would be permanently zero -- a silent
 * ranking regression rather than an error.
 */
function normalizeResult(r) {
  if (!r || typeof r !== "object") return null;
  const url = typeof r.url === "string" ? r.url : null;
  if (!url) return null;
  const snippetSource = Array.isArray(r.highlights) && r.highlights.length > 0
    ? r.highlights.join(" ")
    : typeof r.text === "string"
      ? r.text
      : "";
  return {
    url,
    title: typeof r.title === "string" ? r.title : "",
    date: r.publishedDate || null,
    snippet: snippetSource ? String(snippetSource).slice(0, 1000) : "",
    author: typeof r.author === "string" ? r.author : null,
  };
}

function normalizeQueries(query) {
  const arr = Array.isArray(query) ? query : [query];
  const out = [];
  for (const q of arr) {
    if (typeof q === "string" && q.trim()) out.push(q.trim());
    if (out.length >= MAX_QUERIES) break;
  }
  return out;
}

function clampInt(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
}

/**
 * Run a search. Accepts a single query string or an array of queries (capped at
 * WEB_SEARCH_MAX_QUERIES). Returns `{ results, id }` on success or `null` on
 * total failure.
 *
 * Multi-query fans out in PARALLEL and merges, deduping by URL and keeping the
 * first occurrence -- which, because the variants are ordered most- to
 * least-specific by buildQueryVariants, means the most specific query's hit for
 * a given URL wins. A partial failure is not a failure: if two of five queries
 * come back, callers get those two rather than null, which is what the old
 * multi-query call did when the upstream dropped a sub-query.
 *
 * `apiKey` and `fetchImpl` stay injectable so the existing tests run with no
 * network and no env.
 */
export async function search({
  query,
  maxResults = 5,
  domains = null,
  fetchImpl = globalThis.fetch,
  apiKey = process.env.EXA_API_KEY,
  highlightQuery = null,
} = {}) {
  if (!apiKey) return null;
  const queries = normalizeQueries(query);
  if (queries.length === 0) return null;
  const n = clampInt(maxResults, 1, 25, 5);

  const settled = await Promise.all(
    queries.map((q) =>
      exaSearch({
        query: q,
        numResults: n,
        highlightQuery: highlightQuery || q,
        includeDomains: Array.isArray(domains) && domains.length > 0 ? domains : null,
        fetchImpl,
        apiKey,
      }).catch(() => null),
    ),
  );

  // Every sub-query threw or returned nothing usable -> null, matching the old
  // client's "no usable response" signal. An empty-but-real result set is
  // reported as an empty array, which is a different thing and callers rely on
  // the distinction.
  const usable = settled.filter((r) => Array.isArray(r));
  if (usable.length === 0) return null;

  const seen = new Set();
  const results = [];
  for (const batch of usable) {
    for (const raw of batch) {
      const row = normalizeResult(raw);
      if (!row || seen.has(row.url)) continue;
      seen.add(row.url);
      results.push(row);
    }
  }
  return { results, id: null };
}

/** True when a search call is even possible (key present). */
export function searchAvailable(apiKey = process.env.EXA_API_KEY) {
  return typeof apiKey === "string" && apiKey.trim().length > 0;
}

export const SEARCH_MAX_QUERIES = MAX_QUERIES;
