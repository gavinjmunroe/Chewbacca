/**
 * Slack event deduplication.
 *
 * Slack retries event deliveries if it does not get a 200 within ~3s,
 * which means the same event_id can arrive 2-3 times. We track the
 * event ids we have already processed in an in-memory Map with a
 * 5-minute TTL. Same pattern as Togari's
 * togari-platform/src/transports/slack/index.ts.
 *
 * Single-process only — if Medha ever scales horizontally for the
 * Slack route we will need to back this with Redis. For now Railway
 * runs one replica so a process-local Map is correct and free.
 */

const DEDUP_TTL_MS = 5 * 60 * 1000;
const processedEvents = new Map(); // event_id -> firstSeenAtMs

function purgeStale(now) {
  for (const [id, ts] of processedEvents) {
    if (now - ts > DEDUP_TTL_MS) {
      processedEvents.delete(id);
    }
  }
}

/**
 * Returns true if the event was already processed inside the TTL window.
 * Does NOT mark — call markProcessed for that.
 */
export function wasProcessed(eventId) {
  if (!eventId) return false;
  purgeStale(Date.now());
  return processedEvents.has(eventId);
}

/**
 * Record that we have started processing this event. Returns true if
 * the event was newly recorded, false if it was already seen (callers
 * should treat false as "skip this retry").
 */
export function markProcessed(eventId) {
  if (!eventId) return true; // no id to dedupe on, let it through
  const now = Date.now();
  purgeStale(now);
  if (processedEvents.has(eventId)) {
    return false;
  }
  processedEvents.set(eventId, now);
  return true;
}

/** Test-only — clear the dedup map. Not used in production. */
export function _resetDedup() {
  processedEvents.clear();
}
