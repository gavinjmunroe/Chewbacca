/**
 * THE FACT SYNC RUNS AFTER THE ANSWER, NOT INSIDE IT.
 *
 * "It takes absolutely forever to create a circle... saving changes for circles
 *  takes forever too. Why are those pathways so slow? It's ridiculous. I've been
 *  sitting here for 10 minutes trying to make one change to one circle."
 *
 * Ten minutes is not an exaggeration and it is not the database being slow. It
 * is this, per member added:
 *
 *   one HTTP request (the client looped, one call per contact, sequentially)
 *     -> addCircleMember: 4 statements + an account link
 *     -> syncCircleFacts: soft-delete every circle fact, then re-insert ONE PER
 *        CURRENT MEMBER, serially, each its own transaction of ~6 statements
 *     -> a push notification, awaited
 *
 * The re-insert is a FULL RECONCILE, so adding the 20th member rewrites all
 * twenty facts. Adding twenty members one at a time is 210 observation
 * transactions -- about 1,500 round trips -- with a phone waiting on every one
 * of them. Quadratic work behind a sequential client loop.
 *
 * Two things fix it and they are separable. The client and the route now move a
 * whole membership list in ONE request (see setCircleMembers). And the fact
 * sync -- which nothing on screen reads, and which nobody is waiting to see --
 * stops being part of the request at all.
 *
 * WHY DEBOUNCED AND NOT JUST DETACHED. A detached sync per member still does
 * quadratic work, just off-screen, hammering the pool while the user keeps
 * tapping. Coalescing means a burst of changes to one circle produces exactly
 * one reconcile, after the burst settles.
 *
 * WHY IN-PROCESS AND NOT A JOB TABLE. The facts are derived data with a
 * deterministic rebuild: any later change re-runs the whole reconcile, and the
 * only cost of a lost run is that member cards carry a stale sentence until the
 * next edit. A durable queue for that is machinery without a payload. If a
 * restart ever needs to sweep them, `classified_fact` plus circle_members is
 * enough to rebuild from scratch.
 */

import { syncCircleFacts } from "./circle-enrichment.js";

/** How long to wait for a burst of edits to settle before reconciling. */
const DEBOUNCE_MS = 1500;

// "owner|circle" -> { timer, runs } . One entry per circle being edited.
const _pending = new Map();

/** Tests and shutdown: drop every scheduled sync without running it. */
export function _clearScheduledFactSyncs() {
  for (const entry of _pending.values()) clearTimeout(entry.timer);
  _pending.clear();
}

/** How many syncs are waiting. Tests only. */
export function _scheduledFactSyncCount() {
  return _pending.size;
}

/**
 * Reconcile this circle's member facts, soon, once.
 *
 * Returns immediately. Repeated calls for the same circle inside the debounce
 * window collapse into one run. Never throws, and never rejects: a caller that
 * forgets to catch it cannot take down a write that has already succeeded.
 *
 * @param {object} [deps] { syncImpl, delayMs } for tests.
 */
export function scheduleCircleFactSync(ownerId, circleId, deps = {}) {
  if (!ownerId || !circleId) return;
  const run = deps.syncImpl || syncCircleFacts;
  const delay = deps.delayMs ?? DEBOUNCE_MS;
  const key = `${ownerId}|${circleId}`;
  const existing = _pending.get(key);
  if (existing) {
    // Push the run out to cover the edit that just arrived. The timer is the
    // whole coalescing mechanism: twenty adds in five seconds is one reconcile.
    clearTimeout(existing.timer);
  }
  const timer = setTimeout(() => {
    _pending.delete(key);
    Promise.resolve()
      .then(() => run(ownerId, circleId))
      .catch((err) => {
        // Loud, because a silent failure here is a member card carrying the
        // wrong sentence with nothing anywhere to say why.
        console.error(
          `CIRCLE_FACT_SYNC_FAILED owner=${ownerId} circle=${circleId} ` +
            `${err?.code ? `${err.code} ` : ""}${err?.message || err}`,
        );
      });
  }, delay);
  // unref so a pending sync cannot hold a script or a test runner open. Guarded
  // because timers in some environments (a browser-ish global) have no unref.
  if (typeof timer.unref === "function") timer.unref();
  _pending.set(key, { timer });
}
