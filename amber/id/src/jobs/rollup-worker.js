/**
 * ROLLUP WORKER -- the loop that keeps scores current without a human.
 *
 * Every score in Amber is derived, not written at capture time: an observation
 * is classified into dimensions, dimensions roll up into contact_dimension_state,
 * and interactions roll up into contact_interaction_stats and contact_scores.
 * All three of those functions existed and worked. NOTHING CALLED THEM. The last
 * time contact_dimension_state moved was whenever somebody last ran a script by
 * hand -- so a contact's health dimensions could sit six days stale while the app
 * happily accepted new voice notes about that same person.
 *
 * This worker is the missing caller. It owns no scoring logic of its own; every
 * stage below is an existing function, invoked on a timer.
 *
 * COST. A tick is three SELECTs. The only stage that can spend model credits is
 * dimension classification, and it is gated on pendingCount() > 0 -- an idle
 * instance never reaches a model no matter how often it wakes. Both rollup
 * stages are pure SQL. Spend tracks how much users say to Amber, not the clock.
 *
 * STALENESS IS NOT ONE QUESTION. ownersNeedingRollup (retrieval.js) compares the
 * newest observation against contact_dimension_state.computed_at;
 * ownersNeedingRefresh (contact-rollup.js) asks the same of stats and scores.
 * Different predicates over different tables. Collapsing them into one would
 * skip owners whose warmth changed but whose dimensions did not, invisibly. Each
 * stage uses its own and neither is reimplemented here.
 *
 * ORDER IS LOAD-BEARING. Dimensions must land before the dimension rollup reads
 * them, or an observation classified this tick is not reflected until the next.
 * refreshOwner() internally does stats before scores for the same reason.
 *
 * SINGLE FLIGHT. A pass slower than the interval must never overlap itself --
 * two concurrent refreshOwner() calls for one owner race on the same rows. A
 * skipped tick costs nothing: the next one picks up the identical backlog.
 *
 * IT NEVER THROWS. An unhandled rejection inside setInterval kills the process,
 * which on Railway takes the API with it. Every stage is wrapped; a failure
 * degrades to "that stage did nothing this tick." Consecutive failures back off
 * instead of hammering a database that is already unhappy.
 *
 * ON BY DEFAULT, opt out with ENABLE_ROLLUP_WORKER=0. The failure this worker
 * exists to prevent is silence, so a flag that must be remembered to turn it on
 * would reproduce the exact bug.
 */
import { runDimensionPass, pendingCount } from "../db/dimension-queue.js";
import { runRollupPass } from "../db/retrieval.js";
import { refreshOwner, ownersNeedingRefresh } from "../db/contact-rollup.js";

const DEFAULT_TICK_MS = 30_000;
const DIMENSION_BATCH = 25;   // one model batch per tick, bounded on purpose
const ROLLUP_BATCH = 50;
const REFRESH_BATCH = 50;
const MAX_BACKOFF_TICKS = 10;

let timer = null;
let running = false;
let failures = 0;
let skip = 0;

function config() {
  return {
    tickMs: Number(process.env.ROLLUP_TICK_MS) || DEFAULT_TICK_MS,
    enabled:
      process.env.ENABLE_ROLLUP_WORKER !== "0" && process.env.NODE_ENV !== "test",
  };
}

/** Run one stage. A thrown error becomes null and never escapes the tick. */
async function stage(name, fn, log) {
  try {
    return await fn();
  } catch (err) {
    log.warn?.(`[rollup] ${name} failed: ${(err?.message || String(err)).slice(0, 200)}`);
    return null;
  }
}

/**
 * One full pass. Exported so it can be run once from a script or a test without
 * starting a timer -- the same code path the worker uses, not a parallel copy.
 */
export async function runRollupTick({ log = console } = {}) {
  const out = { classified: 0, dimensionOwners: 0, refreshed: 0, failed: 0 };

  // 1. Classify. Gated so an empty queue costs zero model credits.
  const pending = await stage("pendingCount", () => pendingCount(), log);
  if (Number(pending) > 0) {
    const res = await stage(
      "runDimensionPass",
      () => runDimensionPass({ limit: DIMENSION_BATCH }),
      log,
    );
    if (res == null) out.failed += 1;
    else out.classified = Number(res?.classified ?? res?.settled ?? res?.count ?? 0);
  }

  // 2. Dimension state, for owners whose observations are newer than their state.
  const roll = await stage("runRollupPass", () => runRollupPass({ limit: ROLLUP_BATCH }), log);
  if (roll == null) out.failed += 1;
  else out.dimensionOwners = Number(roll?.owners ?? 0);

  // 3. Interaction stats + contact scores, on their own staleness predicate.
  const owners = (await stage(
    "ownersNeedingRefresh",
    () => ownersNeedingRefresh(REFRESH_BATCH),
    log,
  )) ?? [];
  for (const owner of owners) {
    const ok = await stage(`refreshOwner(${owner})`, () => refreshOwner(owner), log);
    if (ok == null) out.failed += 1;
    else out.refreshed += 1;
  }

  return out;
}

async function tick(log) {
  if (running) return;            // single flight
  if (skip > 0) { skip -= 1; return; }
  running = true;
  try {
    const out = await runRollupTick({ log });
    if (out.failed > 0) {
      failures += 1;
      skip = Math.min(2 ** failures, MAX_BACKOFF_TICKS);
      log.warn?.(`[rollup] ${out.failed} stage failure(s); backing off ${skip} tick(s)`);
    } else {
      failures = 0;
    }
    // Silent when idle. Logged only when it actually moved something, so the
    // log stays a record of work rather than a heartbeat nobody reads.
    if (out.classified || out.dimensionOwners || out.refreshed) {
      log.info?.(
        `[rollup] classified=${out.classified} dimension_owners=${out.dimensionOwners} refreshed=${out.refreshed}`,
      );
    }
  } finally {
    running = false;
  }
}

export function startRollupWorker({ log = console } = {}) {
  const { tickMs, enabled } = config();
  if (!enabled) {
    log.info?.("[rollup] worker disabled (ENABLE_ROLLUP_WORKER=0 or NODE_ENV=test)");
    return null;
  }
  if (timer) return timer;
  timer = setInterval(() => { tick(log).catch(() => {}); }, tickMs);
  timer.unref?.();               // never hold the process open on its own
  log.info?.(`[rollup] worker started -- every ${Math.round(tickMs / 1000)}s`);
  return timer;
}

export function stopRollupWorker() {
  if (timer) { clearInterval(timer); timer = null; }
  running = false; failures = 0; skip = 0;
}
