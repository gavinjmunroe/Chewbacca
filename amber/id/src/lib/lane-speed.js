/**
 * HOW FAST EACH LANE ACTUALLY IS, MEASURED, IN PROCESS.
 *
 * A multi-part question is answered in pieces, and the pieces are handed back in
 * the order they can be got rather than the order they were asked. That requires
 * knowing which lane is fastest -- and the honest answer to that is not a
 * constant somebody typed once. It changes with the address book's size, with
 * Exa's mood, with whether the prepared payload is warm.
 *
 * So the order is not hardcoded: every lane reports how long it took, and the
 * next multi-part question is ordered by what the last few actually cost.
 *
 * WHY AN EWMA AND NOT AN AVERAGE. A mean over the life of the process is
 * dominated by the first cold call forever; a mean over the last N needs a
 * ring buffer per lane for no benefit. An exponentially weighted mean is one
 * number, one multiply, and it forgets at a sensible rate -- ALPHA 0.3 means
 * roughly the last half-dozen turns decide the order.
 *
 * WHY IN MEMORY AND NOT IN POSTGRES. This is a tie-breaker for the order of
 * three sections, not a metric anybody bills on. A read from the database to
 * decide it would cost more than the reordering saves, and a cold process
 * starting from the seeds below is already right about the order.
 *
 * THE SEEDS ARE THE OBSERVED SHAPE OF EACH LANE, and they are ordered for a
 * reason worth stating, because the wrong answer here has already been given
 * once out loud:
 *
 *   people       indexed local queries plus a ranking pass over rows the user
 *                already owns, with the payload cached per owner. It is the
 *                FASTEST lane. (I claimed the web would beat it. It does not,
 *                and nothing here should imply it again.)
 *   web_people   one Exa call restricted to linkedin.com/in and parsed by
 *                string splitting. One network hop, no model.
 *   web          one Exa call plus page text, which is more bytes than the
 *                LinkedIn pass moves.
 *   places       an Exa call AND a model pass to turn pages into cards. Two
 *                hops, and reliably the slowest of the four.
 */

const ALPHA = 0.3;

const SEEDS = Object.freeze({
  people: 2600,
  web_people: 3000,
  web: 3600,
  places: 9000,
});

// lane key -> current estimate in ms
const _est = new Map(Object.entries(SEEDS));

/** The current estimate for a lane, in ms. Unknown lanes sit between web and places. */
export function laneEstimateMs(key) {
  const v = _est.get(key);
  return Number.isFinite(v) ? v : 5000;
}

/**
 * Fold one observed duration into a lane's estimate.
 *
 * Absurd values are ignored rather than smoothed: a lane that took 90 seconds
 * because the whole turn hit its deadline says nothing about how fast that lane
 * is, and a zero means it was cached or never ran.
 */
export function recordLaneMs(key, ms) {
  const n = Number(ms);
  if (!key || !Number.isFinite(n) || n <= 0 || n > 60000) return laneEstimateMs(key);
  const prev = laneEstimateMs(key);
  const next = Math.round(prev * (1 - ALPHA) + n * ALPHA);
  _est.set(key, next);
  return next;
}

/** Fastest first. Stable for equal estimates, so the seed order breaks ties. */
export function orderLanesBySpeed(lanes) {
  return [...(lanes || [])]
    .map((lane, i) => ({ lane, i, est: laneEstimateMs(lane?.key) }))
    .sort((a, b) => (a.est === b.est ? a.i - b.i : a.est - b.est))
    .map((x) => x.lane);
}

/** Tests, and anything that wants to log the current picture. */
export function laneEstimates() {
  return Object.fromEntries(_est);
}

/** Tests only. */
export function _resetLaneSpeeds() {
  _est.clear();
  for (const [k, v] of Object.entries(SEEDS)) _est.set(k, v);
}
