import { query } from "./sql.js";
import { DIMENSIONS } from "../lib/dimensions.js";

/**
 * HOW WELL DOES AMBER KNOW YOU, DIMENSION BY DIMENSION?
 *
 * WHAT THIS IS NOT, and it matters more than what it is: it is NOT a wellbeing
 * score. The data underneath is what somebody happened to mention to an app, so
 * a low spiritual number means Amber has heard nothing about that part of their
 * life -- not that the part is missing. Presenting it as a health verdict would
 * be inventing an assessment out of note-taking, and somebody who never mentions
 * faith would be shown a judgment about themselves that the app has no standing
 * to make. Every label this feeds says KNOWN, never GOOD.
 *
 * That framing is also what makes it useful: a thin dimension is an honest
 * invitation to tell Amber more, and the number goes up because you used the
 * app rather than because your life changed.
 *
 * THREE SOURCES, IN DESCENDING ORDER OF HOW MUCH THEY COUNT.
 *
 *   1. SELF-OBSERVATIONS -- things you said about yourself. fact-capture routes
 *      these as `self_fact` and they land as observations with no contact and no
 *      circle. Every observation is dimension-tagged on insert by the lexicon,
 *      synchronously, with a worker re-reading the uncertain ones. Full weight.
 *
 *   2. QUESTIONS -- what you asked Amber about, from query_dimensions. Weighted
 *      down hard by QUESTION_WEIGHT: curiosity is real evidence and much weaker
 *      than a statement.
 *
 * THE TRAP THAT IS ALREADY IN THE CODEBASE, and the reason this is not a
 * one-line query over getUserFacts: `contact_id IS NULL AND circle_id IS NULL`
 * does NOT mean "about me". It also matches every observation about a person
 * Amber could not resolve to a contact card -- the unfiled ones, which carry the
 * spoken name in `raw_name`. Score those as the owner's own and "Marcus got laid
 * off" becomes the OWNER's financial dimension. The discriminator is
 * `raw_name IS NULL`, and it is the difference between a self score and a
 * nonsense score.
 *
 * DECAY COMES FROM THE DIMENSIONS TABLE, not from a constant in this file. Each
 * dimension already carries `half_life_days` -- spiritual 730, emotional 90 --
 * because how long a fact stays true differs by what the fact is about. Nothing
 * here invents a number that the ontology already owns.
 */

/**
 * How much a question counts against a stated fact.
 *
 * A fifth. Chosen so that five questions about a dimension are worth about one
 * thing you actually said about it, which is roughly the ratio at which asking
 * repeatedly starts to mean something. It is a knob, and it is here where it can
 * be found rather than buried in the SQL.
 */
export const QUESTION_WEIGHT = 0.2;

/**
 * The evidence at which a dimension counts as KNOWN.
 *
 * One confident, fully-weighted, undecayed self-observation scores 1.0, so the
 * bar is "Amber has heard about this part of your life more than once, or once
 * and recently". Below it the dimension is drawn as thin rather than empty --
 * there is a difference between nothing and a little, and the drawing says so.
 */
export const KNOWN_AT = 2;

/**
 * Per-dimension coverage for one owner.
 *
 * Returns every dimension, always, in ontology order -- including the ones with
 * nothing in them. A radar that renders only the dimensions with data would
 * change shape as it filled in, and the empty ones are the interesting part.
 *
 * `score` is 0..1 (evidence, capped at KNOWN_AT). `evidence` is the raw decayed
 * sum, uncapped, so a caller can tell "just crossed the line" from "knows a
 * great deal", and so a wrong-looking score can be read back to its inputs.
 */
export async function getSelfDimensionCoverage(ownerId, { now = null } = {}) {
  const empty = () =>
    DIMENSIONS.map((code, i) => ({
      code,
      dimensionId: i + 1,
      label: code.charAt(0).toUpperCase() + code.slice(1),
      score: 0,
      evidence: 0,
      fromFacts: 0,
      fromQuestions: 0,
      facts: 0,
      questions: 0,
    }));

  if (!ownerId) return empty();

  /**
   * ONE QUERY, TWO SOURCES, DECAY APPLIED IN SQL.
   *
   * exp(-ln(2) * age_days / half_life_days) is the half-life the `dimensions`
   * table already declares. Doing it in SQL rather than in JS keeps 200
   * observations from crossing the wire to be summed here, and means the
   * weighting is visible in one place next to the numbers it applies to.
   */
  const sql = `
    WITH ref AS (SELECT coalesce($2::timestamptz, now()) AS t),
    dims AS (
      SELECT dimension_id, code, label, greatest(half_life_days, 1) AS half_life_days
        FROM dimensions
    ),
    self_obs AS (
      SELECT od.dimension_id,
             od.confidence * od.weight
               * exp(-ln(2) * (EXTRACT(EPOCH FROM ((SELECT t FROM ref) - o.observed_at)) / 86400.0)
                     / d.half_life_days) AS ev
        FROM observations o
        JOIN observation_dimensions od ON od.observation_id = o.observation_id
        JOIN dims d ON d.dimension_id = od.dimension_id
       WHERE o.owner_id = $1
         AND o.contact_id IS NULL
         AND o.circle_id IS NULL
         -- THE DISCRIMINATOR. Without it, every unresolved fact about somebody
         -- else is scored as a fact about the owner.
         AND o.raw_name IS NULL
         AND o.status = 'resolved'
         AND o.deleted_at IS NULL
         AND od.suppressed = false
    ),
    asked AS (
      SELECT q.dimension_id,
             q.score
               * exp(-ln(2) * (EXTRACT(EPOCH FROM ((SELECT t FROM ref) - q.asked_at)) / 86400.0)
                     / d.half_life_days) AS ev
        FROM query_dimensions q
        JOIN dims d ON d.dimension_id = q.dimension_id
       WHERE q.owner_id = $1
    )
    SELECT d.dimension_id,
           d.code,
           d.label,
           coalesce((SELECT sum(ev) FROM self_obs s WHERE s.dimension_id = d.dimension_id), 0) AS from_facts,
           coalesce((SELECT sum(ev) FROM asked a WHERE a.dimension_id = d.dimension_id), 0) AS from_questions,
           (SELECT count(*) FROM self_obs s WHERE s.dimension_id = d.dimension_id) AS facts,
           (SELECT count(*) FROM asked a WHERE a.dimension_id = d.dimension_id) AS questions
      FROM dims d
     ORDER BY d.dimension_id`;

  let rows;
  try {
    ({ rows } = await query(sql, [ownerId, now]));
  } catch (e) {
    // A MISSING TABLE IS NOT A BROKEN PROFILE. query_dimensions arrives in a
    // migration, and an instance that has not run it yet must still render the
    // card from observations rather than 500 the whole screen.
    console.error(`SELF_DIMENSIONS_ERR ${e?.message || e}`);
    return empty();
  }

  return rows.map((r) => {
    const fromFacts = Number(r.from_facts) || 0;
    const fromQuestions = Number(r.from_questions) || 0;
    const evidence = fromFacts + fromQuestions * QUESTION_WEIGHT;
    return {
      code: String(r.code),
      dimensionId: Number(r.dimension_id),
      label: String(r.label),
      score: Math.max(0, Math.min(1, evidence / KNOWN_AT)),
      evidence,
      fromFacts,
      fromQuestions,
      facts: Number(r.facts) || 0,
      questions: Number(r.questions) || 0,
    };
  });
}

/**
 * The one-line summary, and it counts dimensions rather than averaging them.
 *
 * AN AVERAGE WOULD LIE IN BOTH DIRECTIONS. Somebody Amber knows deeply on two
 * dimensions and not at all on four averages to the same number as somebody it
 * knows a little about across all six, and those are completely different
 * states -- the first needs a nudge about the four, the second is simply new.
 * "Knows you across 4 of 6" is a true sentence; "63%" is a number that cannot
 * be wrong because it does not say anything.
 */
export function coverageSummary(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const known = list.filter((r) => (r?.score ?? 0) >= 1).length;
  const some = list.filter((r) => (r?.score ?? 0) > 0 && (r?.score ?? 0) < 1).length;
  const total = list.length || DIMENSIONS.length;
  return { known, some, empty: total - known - some, total };
}

/**
 * Keep what an owner asked about. Fire and forget.
 *
 * NEVER ON THE CRITICAL PATH AND NEVER ABLE TO BREAK AN ANSWER. Called without
 * await from the retrieval path, and it swallows its own failures: a question
 * that fails to record is a slightly staler score, while a question that fails
 * to ANSWER because the score-keeping threw is a broken app. That trade only
 * goes one way.
 *
 * `weights` is whatever the classifier returned -- a map of dimension code to
 * 0..1. Codes it does not recognize are dropped rather than guessed at, and a
 * zero is not written: a dimension the question did not touch should leave no
 * row, or the floor the classifier gives every dimension for retrieval would
 * quietly become evidence about somebody's life.
 */
export async function recordQueryDimensions(ownerId, weights, { minScore = 0.15 } = {}) {
  if (!ownerId || !weights || typeof weights !== "object") return 0;
  const ids = [];
  const scores = [];
  for (const [code, raw] of Object.entries(weights)) {
    const idx = DIMENSIONS.indexOf(String(code));
    if (idx < 0) continue;
    const s = Number(raw);
    if (!Number.isFinite(s) || s < minScore) continue;
    ids.push(idx + 1);
    scores.push(Math.max(0, Math.min(1, s)));
  }
  if (ids.length === 0) return 0;
  try {
    await query(
      `INSERT INTO query_dimensions (owner_id, dimension_id, score)
       SELECT $1, d, s FROM unnest($2::smallint[], $3::real[]) AS t(d, s)`,
      [ownerId, ids, scores],
    );
    return ids.length;
  } catch (e) {
    console.error(`RECORD_QUERY_DIMENSIONS_ERR ${e?.message || e}`);
    return 0;
  }
}
