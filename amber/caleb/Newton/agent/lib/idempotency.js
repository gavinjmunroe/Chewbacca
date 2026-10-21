/**
 * In-memory idempotency tracker for webhook redelivery and outbound
 * Loop sends.
 *
 * Webhooks can be redelivered (Loop and Twilio both retry on non-2xx
 * or timeout). Without dedupe, a slow agent reply causes the same
 * inbound to be processed twice and the user sees Amber send the same
 * thing back-to-back. This module provides:
 *
 *   markSeen(key, ttlMs)   - mark a key as in-flight/processed; returns
 *                            true if key was newly added, false if it
 *                            was already present.
 *   wasSeen(key)           - cheap check without mutation.
 *   clearKey(key)          - explicit removal (for test paths).
 *
 * Storage is a bounded Map; once `MAX_ENTRIES` is reached the oldest
 * entries are evicted regardless of TTL. This is intentionally simple —
 * idempotency that survives a process restart belongs in amber-id, not
 * here. The job of this module is to absorb retries within a single
 * Railway instance's lifetime.
 */

const DEFAULT_TTL_MS = 10 * 60 * 1000; // 10 min — covers Loop retry windows
const MAX_ENTRIES = 5000;

const seen = new Map(); // key -> expiresAt (ms)

function evictExpired(now) {
  // Cheap sweep when we cross the high-water mark.
  for (const [k, exp] of seen) {
    if (exp <= now) seen.delete(k);
    if (seen.size <= MAX_ENTRIES * 0.8) break;
  }
  // Hard cap: evict in insertion order if still oversize.
  while (seen.size > MAX_ENTRIES) {
    const oldest = seen.keys().next().value;
    if (!oldest) break;
    seen.delete(oldest);
  }
}

/**
 * Mark a key as seen. Returns true if this is the first time we've seen
 * it (caller should proceed), false if it was already in the table
 * (caller should skip — this is a duplicate).
 */
export function markSeen(key, ttlMs = DEFAULT_TTL_MS) {
  if (!key) return true; // nothing to dedupe on
  const now = Date.now();
  const existing = seen.get(key);
  if (existing && existing > now) return false;
  seen.set(key, now + ttlMs);
  if (seen.size > MAX_ENTRIES) evictExpired(now);
  return true;
}

export function wasSeen(key) {
  if (!key) return false;
  const exp = seen.get(key);
  if (!exp) return false;
  if (exp <= Date.now()) {
    seen.delete(key);
    return false;
  }
  return true;
}

export function clearKey(key) {
  seen.delete(key);
}

export function _sizeForTests() {
  return seen.size;
}

/**
 * Build a dedupe key for an inbound Loop webhook. Prefers the durable
 * message_id; falls back to a composite of (sender, contact, text-hash)
 * so retries without a stable message_id still dedupe.
 */
export function inboundDedupeKey(payload) {
  if (!payload) return null;
  if (payload.message_id) return `loop:msg:${payload.message_id}`;
  const sender = payload.sender || payload.sender_name || "?";
  const from = payload.contact || payload.from || "?";
  const text = (payload.text || payload.speech?.text || "").slice(0, 200);
  // Cheap non-cryptographic hash — collisions are tolerable here, the
  // window is bounded by TTL and the impact is "we drop a duplicate".
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = (hash * 31 + text.charCodeAt(i)) | 0;
  }
  return `loop:composite:${sender}:${from}:${hash}`;
}
