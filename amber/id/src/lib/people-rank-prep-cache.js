/**
 * THE PREPARED PAYLOAD, CACHED PER OWNER FOR A MINUTE.
 *
 * Every people question rebuilds the same thing before it can rank anything:
 * the whole address book, the facts attached to it, and the owner's own priors.
 * That is identical for every question asked in the same minute -- "who do I
 * know in New York", then "which of them is free", then "what should I say" --
 * and it was being rebuilt from Postgres each time, on the critical path,
 * before a single token could be generated.
 *
 * WHY NOT THE EXISTING RANK CACHE. people-rank-cache.js caches the SCORED
 * RESULT keyed by the query, so it only helps a repeat of the identical
 * question (and paging through it). This caches the INPUT, which is the part
 * that does not depend on the question at all -- so it helps every question
 * after the first.
 *
 * IT IS A LATENCY CACHE, NOT A SOURCE OF TRUTH, and the staleness window is
 * chosen to match what it holds: contacts and facts change when the user
 * captures something or syncs their address book, and both of those invalidate
 * it explicitly. A minute of staleness on top of that means, at worst, a fact
 * recorded seconds ago is not in the payload of a question asked immediately
 * afterwards -- which is why the capture path calls invalidate.
 *
 * In-process and per-owner, so a cold container simply rebuilds, and one
 * tenant's invalidation can never drop another's entry. No contact data leaves
 * this module.
 */

const DEFAULT_TTL_MS = Number(process.env.PEOPLERANK_PREP_CACHE_TTL_MS || 60_000);
/** Owners held at once. Bounded so a busy fleet cannot grow this unbounded. */
const MAX_OWNERS = Number(process.env.PEOPLERANK_PREP_CACHE_MAX || 200);

// ownerKey -> { at, prepared }
const _cache = new Map();

/** Cached prepared input for this owner, or null on miss / expiry. */
export function getPreparedInput(key, { nowMs = Date.now(), ttlMs = DEFAULT_TTL_MS } = {}) {
  if (!key) return null;
  const hit = _cache.get(key);
  if (!hit) return null;
  if (nowMs - hit.at > ttlMs) {
    _cache.delete(key);
    return null;
  }
  return hit.prepared;
}

/** Store one owner's prepared input. Oldest entry evicts when full. */
export function setPreparedInput(key, prepared, { nowMs = Date.now() } = {}) {
  if (!key || !prepared) return;
  if (!_cache.has(key) && _cache.size >= MAX_OWNERS) {
    // Map preserves insertion order, so the first key is the oldest write.
    const oldest = _cache.keys().next().value;
    if (oldest !== undefined) _cache.delete(oldest);
  }
  _cache.set(key, { at: nowMs, prepared });
}

/**
 * Drop one owner's entry. Called the moment something they said is written --
 * a capture changes the facts the next answer should be built from, and a
 * minute of not knowing that is the one staleness this cache must not have.
 */
export function invalidatePreparedInput(key) {
  if (!key) return;
  _cache.delete(key);
}

/** Tests only. */
export function _clearPreparedInputCache() {
  _cache.clear();
}
