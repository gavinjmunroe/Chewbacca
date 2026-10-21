/**
 * session-denylist — immediate revocation for access tokens.
 *
 * THE TRADE-OFF THIS RESOLVES
 * Access tokens are stateless JWTs, so "sign out" cannot invalidate one by
 * deleting a row. Two ways out:
 *   1. Check the session table on every authenticated request. Correct, but it
 *      adds a DB round-trip to every single call — and the audit already flags
 *      one uncached users lookup per request as a scale problem.
 *   2. Keep access tokens short (15 min) so a revoked token dies on its own,
 *      and hold a small in-process denylist so the revoke is immediate on the
 *      replica that served it.
 *
 * We take (2), which is what large consumer apps do. The worst case is that a
 * revoked access token keeps working on OTHER replicas for the remainder of its
 * TTL — bounded by ACCESS_TTL_SECONDS, and the refresh token is already dead in
 * the database, so the session cannot be extended past that.
 *
 * Entries self-expire, so this never grows unbounded: a sid is only worth
 * remembering until any access token bearing it would have expired anyway.
 *
 * WHEN TO REPLACE THIS: the moment there is a shared cache (Memorystore/Redis)
 * in the stack, move `revoked` into it with the same TTL semantics and the
 * cross-replica gap closes. The interface here is deliberately tiny so that
 * swap is a one-file change.
 */

// sid -> unix-ms after which the entry can be dropped.
const revoked = new Map();

let lastSweep = 0;
const SWEEP_INTERVAL_MS = 60 * 1000;

function sweep(now) {
  if (now - lastSweep < SWEEP_INTERVAL_MS) return;
  lastSweep = now;
  for (const [sid, until] of revoked) {
    if (until <= now) revoked.delete(sid);
  }
}

/**
 * Mark a session id as revoked for `ttlSeconds` (should be >= the access-token
 * TTL, so the entry outlives any token that could still be presented).
 */
export function denySession(sid, ttlSeconds) {
  if (!sid) return;
  const now = Date.now();
  sweep(now);
  revoked.set(String(sid), now + Math.max(1, ttlSeconds) * 1000);
}

export function denyMany(sids, ttlSeconds) {
  for (const sid of sids || []) denySession(sid, ttlSeconds);
}

/** True when this session was revoked on this replica and the entry is live. */
export function isSessionDenied(sid) {
  if (!sid) return false;
  const now = Date.now();
  const until = revoked.get(String(sid));
  if (until == null) return false;
  if (until <= now) {
    revoked.delete(String(sid));
    return false;
  }
  return true;
}

/** Test helper. */
export function _resetDenylist() {
  revoked.clear();
  lastSweep = 0;
}

export function _size() {
  return revoked.size;
}
