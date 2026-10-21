/**
 * Per-DID computed-rank cache for PeopleRank (spec items 164 + 155).
 *
 * Scoring the whole address book (warmth + recency + dedup + realness) is cheap
 * per row but adds up at 2,000 contacts, and pagination re-runs it for every
 * page. This cache stores the FULL sorted, scored list per (DID, query, weights,
 * flags) so:
 *   - page 2..N of the same query are served from memory (item 155), and
 *   - a repeat identical query within the TTL skips re-scoring entirely.
 *
 * Explicit invalidation (item 164): the moment the user records feedback
 * (tap/confirm/dismiss/open) the cached order is stale, so the feedback route
 * calls invalidate(did) and the next rank recomputes with the new engagement.
 *
 * In-process only and bounded by a short TTL, this is a request-path latency
 * cache, not a source of truth. A cold process simply recomputes. Per-DID
 * buckets so one tenant's invalidation never drops another's entries.
 */

const DEFAULT_TTL_MS = Number(
  process.env.PEOPLERANK_RANK_CACHE_TTL_MS || 60 * 1000,
);
// Cap entries per DID so a user firing many distinct queries can't grow the
// bucket without bound. Oldest entries evict first.
const MAX_ENTRIES_PER_DID = Number(process.env.PEOPLERANK_RANK_CACHE_MAX || 12);

// did -> Map<cacheKey, { at, people }>
const _cache = new Map();

/**
 * Stable cache key for a ranking request. Weights are serialized in a fixed
 * order so {warmth, recency} and {recency, warmth} hash identically.
 */
export function rankCacheKey({ query, weights, flags } = {}) {
  const q = (query || "").trim().toLowerCase();
  const w = weights || {};
  const weightStr = ["warmth", "centrality", "recency", "relevance"]
    .map((k) => `${k}:${Number(w[k]) || 0}`)
    .join(",");
  const flagStr = Object.keys(flags || {})
    .sort()
    .map((k) => `${k}:${flags[k] ? 1 : 0}`)
    .join(",");
  return `q=${q}|w=${weightStr}|f=${flagStr}`;
}

/** Read a cached scored list, or null on miss/expiry. */
export function getCachedRank(
  did,
  key,
  { nowMs = Date.now(), ttlMs = DEFAULT_TTL_MS } = {},
) {
  if (!did) return null;
  const bucket = _cache.get(did);
  if (!bucket) return null;
  const hit = bucket.get(key);
  if (!hit) return null;
  if (nowMs - hit.at > ttlMs) {
    bucket.delete(key);
    return null;
  }
  return hit.people;
}

/** Store a scored list for (did, key). Evicts oldest when the bucket is full. */
export function setCachedRank(did, key, people, { nowMs = Date.now() } = {}) {
  if (!did) return;
  let bucket = _cache.get(did);
  if (!bucket) {
    bucket = new Map();
    _cache.set(did, bucket);
  }
  bucket.set(key, { at: nowMs, people });
  if (bucket.size > MAX_ENTRIES_PER_DID) {
    // Map iteration is insertion-ordered: the first key is the oldest.
    const oldest = bucket.keys().next().value;
    if (oldest !== undefined) bucket.delete(oldest);
  }
}

/**
 * Drop every cached ranking for a DID. Called when new feedback lands so the
 * next rank reflects it. No-op when the DID has nothing cached.
 */
export function invalidateRank(did) {
  if (!did) return;
  _cache.delete(did);
}

/** Test/maintenance hook: clear the entire cache. */
export function _clearRankCache() {
  _cache.clear();
}

export const RANK_CACHE_DEFAULT_TTL_MS = DEFAULT_TTL_MS;
