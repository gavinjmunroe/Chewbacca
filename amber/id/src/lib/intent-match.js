/**
 * WHEN DO TWO STATEMENTS FIT? Decided in code, not by a model.
 *
 * "These should be coded fully, not LLM logic. Can we do the scans fully with
 *  code alone in Postgres?"
 *
 * Almost. Here is the honest split, because it decides what the daily scan
 * costs forever.
 *
 *   KEYWORDS CANNOT DO IT. "I really need to focus on exercising more" and
 *   "starting a run club" share not one word. Any amount of stemming, trigram
 *   or full-text work on those two sentences returns nothing. The demo does not
 *   work without semantic similarity, so the question is not whether to use a
 *   model but WHEN.
 *
 *   ONE EMBEDDING PER INTENT, AT WRITE TIME. Not per scan, not per match --
 *   once, when somebody shares something. From then on the intent is a vector
 *   sitting in Postgres and every scan is `ORDER BY embedding <=> $1` against
 *   an HNSW index. A daily pass over ten thousand live intents is one indexed
 *   vector query per query intent and zero model calls.
 *
 *   THE MODEL WRITES THE MESSAGE, AND ONLY THAT. "Love that you're thinking
 *   about your health more, lucky for you, Sarah is starting a run club" is one
 *   call, made on a match the database already found, for a proposal somebody
 *   is about to see. Bounded by matches rather than by candidates, which is the
 *   difference between a fixed cost and an unbounded one.
 *
 * So: the SCAN is pure SQL. This file is the rest of it -- the rules that say
 * which candidates a scan should even consider and how to rank what comes back,
 * all of it arithmetic over columns, all of it testable without a database and
 * without a model.
 *
 * PURE. Rows in, a score out.
 */

/** Cosine distance above which two statements are simply about different things. */
export const MAX_DISTANCE = 0.55;

/** Below this final score nothing is worth interrupting somebody for. */
export const MIN_SCORE = 0.35;

/**
 * WHICH SHAPES FIT WHICH.
 *
 * Sarah does not have to ask for anything -- "if she shares it to her network
 * and just states 'starting a run club'" it should still match. So an `offer`
 * fits a `seeking`, which is the run-club case, and a `doing` fits almost
 * anything because a fact about somebody is actionable by whoever needs it.
 *
 * Two `seeking`s also fit: both want the same thing and neither has it, which
 * is two people who should start it together. Two `offer`s do not -- two people
 * each running a club is not an introduction, it is a coincidence.
 */
const KIND_FIT = {
  "seeking|offer": 1,
  "offer|seeking": 1,
  "seeking|seeking": 0.8,
  "seeking|doing": 0.7,
  "doing|seeking": 0.7,
  "offer|doing": 0.6,
  "doing|offer": 0.6,
  "doing|doing": 0.5,
  "offer|offer": 0,
};

export function kindFit(a, b) {
  return KIND_FIT[`${a}|${b}`] ?? 0;
}

/**
 * HOW MUCH A DEGREE IS WORTH.
 *
 * A direct contact is the whole point; a third-degree stranger is a lead.
 *
 * TUNED AGAINST THE THRESHOLD, not chosen by feel. At the first weighting a
 * third-degree match needed a similarity above 1.0 to clear MIN_SCORE, which
 * meant the third hop was implemented, tested, and could never once produce a
 * proposal. These values leave a strong third-degree match reachable -- it
 * needs a cosine distance under about 0.14, a genuinely tight fit -- while an
 * ordinary one still loses to anything nearer.
 */
export function degreeWeight(degree) {
  const d = Number(degree);
  if (d === 1) return 1;
  if (d === 2) return 0.75;
  if (d === 3) return 0.5;
  return 0;
}

/** Distance (0 identical, 2 opposite) to a 0-1 similarity. */
export function similarityFromDistance(distance) {
  const d = Number(distance);
  if (!Number.isFinite(d)) return 0;
  return Math.max(0, Math.min(1, 1 - d / MAX_DISTANCE));
}

/**
 * A FRESH THOUGHT BEATS AN OLD ONE.
 *
 * Sarah's run club was three days old and still live; the same note a year on
 * is somebody's abandoned new year resolution. Halves every 30 days, floored so
 * an old-but-unexpired intent is ranked down rather than erased.
 */
export function freshness(createdAt, now = Date.now()) {
  const t = Date.parse(createdAt ?? "");
  if (!Number.isFinite(t)) return 0.5;
  const days = Math.max(0, (now - t) / 86_400_000);
  return Math.max(0.25, Math.pow(0.5, days / 30));
}

/**
 * The score a proposal is ranked and thresholded on.
 *
 * Semantic similarity leads because it is the only term that knows what the two
 * statements are ABOUT. Everything else is a multiplier on it: a perfect shape
 * match between two unrelated topics is still nothing, which is the behavior a
 * sum would get wrong and a product gets right.
 */
export function scoreMatch(
  { distance, kindA, kindB, degree, createdAt, relationshipStrength = null } = {},
  { now = Date.now() } = {},
) {
  const similarity = similarityFromDistance(distance);
  if (similarity <= 0) return 0;

  const fit = kindFit(kindA, kindB);
  if (fit <= 0) return 0;

  const reach = degreeWeight(degree);
  if (reach <= 0) return 0;

  // How close they already are, when known. A nudge rather than a gate: the
  // point of the product is partly to surface people you have NOT been talking
  // to, so a dormant contact must not be scored out of existence.
  const known =
    relationshipStrength == null
      ? 1
      : 0.8 + 0.2 * Math.max(0, Math.min(1, Number(relationshipStrength)));

  return similarity * fit * reach * freshness(createdAt, now) * known;
}

export function isWorthSurfacing(score) {
  return Number(score) >= MIN_SCORE;
}

/**
 * Rank candidates and keep the best few per person.
 *
 * A LIMIT IS PART OF THE PRODUCT, not a performance concession. Six plausible
 * introductions in one sitting is a chore, and the failure mode of a matcher
 * that surfaces everything is that people stop reading it -- at which point the
 * good match is lost with the mediocre ones.
 */
export const MAX_PER_SCAN = 3;

export function rankMatches(candidates, { now = Date.now(), limit = MAX_PER_SCAN } = {}) {
  return (candidates ?? [])
    .map((c) => ({ ...c, score: scoreMatch(c, { now }) }))
    .filter((c) => isWorthSurfacing(c.score))
    // One proposal per counterparty: two of Sarah's intents both matching is
    // still one conversation to have with Sarah.
    .sort((a, b) => b.score - a.score)
    .filter((c, i, all) => all.findIndex((x) => x.ownerId === c.ownerId) === i)
    .slice(0, limit);
}
