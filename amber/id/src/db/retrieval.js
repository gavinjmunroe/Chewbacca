/**
 * DIMENSION-WEIGHTED RETRIEVAL — the read side of the six dimensions.
 *
 * Until this file existed, observation_dimensions was written on every insert
 * and read by nothing but the delete paths. The tags were real and inert.
 *
 * THE SCORE, AND WHY EACH TERM IS THERE. Every factor below is a row in a table
 * you can open and change, not a constant in code -- that was the whole point of
 * migration 006:
 *
 *   dimension match   Σ over the dimensions a fact carries of
 *                       query_weight(d)          how much the QUESTION is about d
 *                     × od.weight                how strongly the FACT bears on d
 *                     × od.confidence            how sure the classifier was
 *                     × dimensions.base_weight   the global dial
 *                     × user_dimension_weights   this person's learned dial
 *                     A fact with no dimensions still scores, at NEUTRAL_MATCH:
 *                     "her flight lands at 4" is not about a dimension and must
 *                     not therefore be unfindable.
 *
 *   temporal          amber_temporal_multiplier(). A window that closed is worth
 *                     window_residual, not zero -- "she was in SF last spring" is
 *                     real knowledge. Decay is by the dimension's own half-life,
 *                     because a physical fact goes stale far faster than a
 *                     spiritual one.
 *
 *   source trust      scoring_params.source_*. They told you directly (1.0)
 *                     outranks something scraped off the web (0.4).
 *
 *   salience          how much the fact matters at all, independent of topic.
 *
 * WHY IT IS ONE QUERY. The obvious shape is: fetch the facts, fetch their
 * dimensions, fetch the weights, multiply in JavaScript. That is three round
 * trips per contact and it cannot be ordered or limited in the database, so it
 * pulls the whole corpus back to rank fifty rows. All of it is arithmetic
 * Postgres can do while it walks the index.
 *
 * SUPPRESSED DIMENSIONS ARE EXCLUDED, not down-weighted. A suppressed tag is
 * somebody saying "this is not what that fact is about", and a wrong tag with a
 * small weight is still wrong.
 *
 * ── TWO SIGNALS FOR "IS THIS ABOUT WHAT WAS ASKED" ──────────────────────────
 *
 * Dimension matching alone cannot separate forty emotional facts from each
 * other, and vector similarity alone does not know that this user has told us
 * financial things matter less to them. So topical relevance is a blend:
 *
 *   relevance = alpha * cosine_similarity + (1 - alpha) * dimension_match
 *
 * with alpha in scoring_params, tunable without a deploy. Everything else --
 * recency, who told you, salience, confidence -- multiplies whatever those two
 * agree on, because those are questions about the fact's QUALITY rather than
 * its topic.
 *
 * A row with no vector scores similarity 0 and falls back to dimensions alone,
 * so retrieval works correctly while the embedding queue is still draining
 * rather than returning nothing until it finishes.
 *
 * WHEN A QUERY VECTOR IS SUPPLIED, THE CANDIDATE SET COMES FROM THE HNSW INDEX
 * rather than from every row the owner has. Scoring the whole corpus is fine at
 * ten thousand facts and is a sequential scan at ten million; the index is the
 * only part of this that scales, so it picks the candidates and the blend ranks
 * them. Dimension-only recall is served by shortlistByDimension off the rollup,
 * which is also indexed. Neither path scans.
 *
 * ── FILTERED VECTOR SEARCH, WHICH IS NOT THE SAME AS VECTOR SEARCH ──────────
 *
 * An HNSW scan walks the graph toward the query vector and stops after ef_search
 * candidates. It knows nothing about `owner_id`. So `ORDER BY embedding <=> $v
 * LIMIT 50` with `WHERE owner_id = $1` finds the fifty nearest rows IN THE WHOLE
 * TABLE and then throws away everyone else's -- and at any real number of
 * accounts, that leaves close to nothing. The query returns too few rows, or
 * none, and it does it silently: the results it does return are correct, just
 * radically incomplete.
 *
 * pgvector 0.8 answers this with `hnsw.iterative_scan`, which keeps walking
 * until enough rows survive the filter. It is set per transaction below.
 * `relaxed_order` rather than `strict_order` because the blend re-ranks these
 * candidates anyway -- paying for exact distance ordering of a set we are about
 * to reorder would be paying for nothing.
 *
 * I had this wrong until a test on 128 rows stopped choosing the index and made
 * me look. At four rows everything works; the shape of the bug is that it keeps
 * working, wrongly, for as long as one account dominates the table.
 */

import { query, withTransaction } from "./sql.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const asUuid = (v) =>
  typeof v === "string" && UUID_RE.test(v.trim()) ? v.trim().toLowerCase() : null;

export const DIMENSION_ID = Object.freeze({
  spiritual: 1, emotional: 2, physical: 3, intellectual: 4, social: 5, financial: 6,
});

// What an untagged fact is worth against any question. Not zero: a fact the
// classifier could not place is still a fact, and a retrieval that can only
// return tagged rows is worse than one with no tags at all.
const NEUTRAL_MATCH = 0.35;

/**
 * The query's weights as a 6-row VALUES list. classifyDimensions returns a
 * distribution keyed by code; anything missing or malformed becomes flat, which
 * degrades to "rank by recency and trust" rather than to an empty result.
 */
function weightRows(dimensionWeights) {
  const flat = 1 / 6;
  const out = [];
  for (const [code, id] of Object.entries(DIMENSION_ID)) {
    const raw = Number(dimensionWeights?.[code]);
    out.push([id, Number.isFinite(raw) && raw >= 0 ? raw : flat]);
  }
  return out;
}

// Bound to $2 (ids) and $3 (weights) wherever it appears.
const QUERY_WEIGHTS_CTE = `
  query_weights AS (
    SELECT * FROM unnest($2::smallint[], $3::real[]) AS qw(dimension_id, w)
  )`;

/** pgvector takes a '[0.1,...]' literal. Same shape the write side uses. */
const toVectorLiteral = (v) =>
  Array.isArray(v) && v.length ? `[${v.join(",")}]` : null;

/**
 * The per-observation score, as a scalar subquery. Expects `o` in scope.
 *
 * $1 owner. The multiplier reads its half-life from the observation when it has
 * one and from the dimension otherwise, which is what makes "moving to SF for
 * three months" and "started meditating" decay at different rates without the
 * caller having to know either number.
 */
const SCORE_SQL = `
  (
    SELECT
      GREATEST(
        COALESCE(MAX(qw.w * od.weight * od.confidence * d.base_weight
                     * COALESCE(udw.weight, 1.0)), 0),
        ${NEUTRAL_MATCH} * (CASE WHEN COUNT(od.dimension_id) = 0 THEN 1 ELSE 0 END)
      )
      * amber_temporal_multiplier(
          o.temporal_shape, o.observed_at, o.valid_from, o.valid_until,
          COALESCE(o.decay_half_life_days, MAX(d.half_life_days), 180),
          now(),
          (SELECT value FROM scoring_params WHERE key = 'window_residual'))
      * COALESCE((SELECT value FROM scoring_params
                   WHERE key = 'source_' || o.source), 0.5)
      * COALESCE(o.salience, 0.5)
      * o.confidence
    FROM observation_dimensions od
      JOIN dimensions d USING (dimension_id)
      JOIN query_weights qw USING (dimension_id)
      LEFT JOIN user_dimension_weights udw
        ON udw.dimension_id = od.dimension_id AND udw.amber_id = $1
    WHERE od.observation_id = o.observation_id AND od.suppressed = false
  )`;

// A LEFT JOIN would be the natural way to keep untagged observations, but the
// aggregate above lives in a scalar subquery, and a subquery over zero rows
// returns NULL rather than the neutral floor. COALESCE at the call site handles
// it, and the untagged case is written out here so the 0.35 is not a mystery.
const SCORE = `COALESCE(${SCORE_SQL}, ${NEUTRAL_MATCH}
    * amber_temporal_multiplier(o.temporal_shape, o.observed_at, o.valid_from,
        o.valid_until, COALESCE(o.decay_half_life_days, 180), now(),
        (SELECT value FROM scoring_params WHERE key = 'window_residual'))
    * COALESCE((SELECT value FROM scoring_params WHERE key = 'source_' || o.source), 0.5)
    * COALESCE(o.salience, 0.5) * o.confidence)`;

/**
 * The facts most worth reading for this question, newest-and-most-relevant
 * first. `contactIds` narrows to a shortlist; omitting it searches the whole
 * address book.
 *
 * Returns [{ observationId, contactId, body, kind, observedAt, score,
 *            dimensions: [{code, weight, confidence}], sourceConversationId }].
 */
export async function retrieveObservations({
  ownerId,
  dimensionWeights = null,
  contactIds = null,
  q = null,
  limit = 40,
  minScore = 0.01,
} = {}) {
  const owner = asUuid(ownerId);
  if (!owner) return [];
  const rows = weightRows(dimensionWeights);
  const params = [owner, rows.map((r) => r[0]), rows.map((r) => r[1])];

  let scope = "";
  const ids = (contactIds || []).map(asUuid).filter(Boolean);
  if (ids.length) {
    params.push(ids);
    scope = `AND o.contact_id = ANY($${params.length}::uuid[])`;
  }
  let text = "";
  if (typeof q === "string" && q.trim()) {
    params.push(`%${q.trim()}%`);
    // ILIKE rather than the tsvector, deliberately: this is a filter on top of a
    // ranked set, not the ranking itself, and a substring is what a caller
    // passing `q` means. obs_tsv_idx is for full-text search, a different job.
    text = `AND o.body ILIKE $${params.length}`;
  }
  params.push(Math.min(Math.max(Number(limit) || 40, 1), 200));
  const limParam = `$${params.length}`;
  params.push(Number(minScore) || 0);
  const minParam = `$${params.length}`;

  const { rows: out } = await query(
    `WITH ${QUERY_WEIGHTS_CTE}
     SELECT o.observation_id, o.contact_id, o.body, o.kind, o.observed_at,
            o.source, o.source_conversation_id, o.modality,
            ${SCORE} AS score,
            COALESCE((
              SELECT jsonb_agg(jsonb_build_object(
                       'code', d2.code, 'weight', od2.weight,
                       'confidence', od2.confidence) ORDER BY od2.weight DESC)
                FROM observation_dimensions od2
                JOIN dimensions d2 USING (dimension_id)
               WHERE od2.observation_id = o.observation_id
                 AND od2.suppressed = false), '[]'::jsonb) AS dimensions
       FROM observations o
      WHERE o.owner_id = $1
        AND o.deleted_at IS NULL
        AND o.status <> 'pending'
        ${scope}
        ${text}
        AND ${SCORE} >= ${minParam}
      ORDER BY score DESC, o.observed_at DESC
      LIMIT ${limParam}`,
    params,
  );

  return out.map((r) => ({
    observationId: r.observation_id,
    contactId: r.contact_id,
    body: r.body,
    kind: r.kind,
    modality: r.modality,
    source: r.source,
    sourceConversationId: r.source_conversation_id,
    observedAt: r.observed_at,
    score: Number(r.score) || 0,
    dimensions: r.dimensions ?? [],
  }));
}

/**
 * WHO SHOULD I TALK TO ABOUT THIS. The people whose knowledge best matches the
 * question, with the facts that made the case.
 *
 * Saturating rather than summing: one contact with forty middling financial
 * facts should not outrank the person who just raised a round. saturation_k
 * lives in scoring_params, so how fast that flattens is a number you can change
 * without a deploy.
 */
export async function rankContactsByDimensions({
  ownerId,
  dimensionWeights = null,
  limit = 20,
  perContactCitations = 3,
} = {}) {
  const owner = asUuid(ownerId);
  if (!owner) return [];
  const rows = weightRows(dimensionWeights);
  const params = [
    owner,
    rows.map((r) => r[0]),
    rows.map((r) => r[1]),
    Math.min(Math.max(Number(limit) || 20, 1), 100),
    Math.min(Math.max(Number(perContactCitations) || 3, 1), 10),
  ];

  const { rows: out } = await query(
    `WITH ${QUERY_WEIGHTS_CTE},
     scored AS (
       SELECT o.contact_id, o.observation_id, o.body, o.observed_at,
              ${SCORE} AS score
         FROM observations o
        WHERE o.owner_id = $1 AND o.deleted_at IS NULL
          AND o.contact_id IS NOT NULL AND o.status <> 'pending'
     ),
     per_contact AS (
       SELECT contact_id,
              -- 1 - exp(-k * Σ): more evidence always helps, and always helps
              -- less than the evidence before it.
              (1 - exp(-1 * (SELECT value FROM scoring_params WHERE key = 'saturation_k')
                          * sum(score)))::real AS score,
              count(*)::int AS observation_count,
              max(observed_at) AS last_signal_at
         FROM scored
        GROUP BY contact_id
     )
     SELECT pc.contact_id, pc.score, pc.observation_count, pc.last_signal_at,
            c.full_name, c.avatar_url, c.linked_amber_id,
            (SELECT jsonb_agg(jsonb_build_object(
                      'observationId', s.observation_id,
                      'body', s.body, 'score', s.score)
                    ORDER BY s.score DESC)
               FROM (SELECT * FROM scored s2
                      WHERE s2.contact_id = pc.contact_id
                      ORDER BY s2.score DESC LIMIT $5) s) AS citations
       FROM per_contact pc
       JOIN contacts c ON c.id = pc.contact_id AND c.owner_id = $1
                      AND c.deleted_at IS NULL
      ORDER BY pc.score DESC, pc.last_signal_at DESC NULLS LAST
      LIMIT $4`,
    params,
  );

  return out.map((r) => ({
    contactId: r.contact_id,
    name: r.full_name ?? null,
    avatarUrl: r.avatar_url ?? null,
    linkedAmberId: r.linked_amber_id ?? null,
    score: Number(r.score) || 0,
    observationCount: r.observation_count,
    lastSignalAt: r.last_signal_at,
    citations: r.citations ?? [],
  }));
}

/**
 * THE ROLLUP. Materialize contact_dimension_state -- "how much does this person
 * register on each dimension" -- which until now was a designed table with
 * nothing computing it.
 *
 * Per dimension, NOT per query, so there are no query weights here: this is the
 * standing picture the shortlist is drawn from, and a query re-weights it at
 * read time. Same saturation, same temporal multiplier, same source trust.
 *
 * A JOB AND NOT A TRIGGER. Recomputing on every fact write would mean a write
 * amplification of six rows per observation and a lock on a row every concurrent
 * insert for that contact also wants. This runs for one owner at a time and is
 * safe to run again.
 */
export async function refreshContactDimensionState(ownerId) {
  const owner = asUuid(ownerId);
  if (!owner) return 0;
  const { rowCount } = await query(
    `INSERT INTO contact_dimension_state
       (owner_id, contact_id, dimension_id, score, raw_sum, last_signal_at,
        observation_count, computed_at)
     SELECT $1, o.contact_id, od.dimension_id,
            (1 - exp(-1 * (SELECT value FROM scoring_params WHERE key = 'saturation_k')
                        * sum(contribution)))::real,
            sum(contribution)::real,
            max(o.observed_at),
            count(*)::int,
            now()
       FROM observations o
       JOIN LATERAL (
         SELECT od.dimension_id,
                od.weight * od.confidence * d.base_weight
                  * COALESCE(udw.weight, 1.0)
                  * amber_temporal_multiplier(
                      o.temporal_shape, o.observed_at, o.valid_from, o.valid_until,
                      COALESCE(o.decay_half_life_days, d.half_life_days), now(),
                      (SELECT value FROM scoring_params WHERE key = 'window_residual'))
                  * COALESCE((SELECT value FROM scoring_params
                               WHERE key = 'source_' || o.source), 0.5)
                  * COALESCE(o.salience, 0.5) * o.confidence AS contribution
           FROM observation_dimensions od
           JOIN dimensions d USING (dimension_id)
           LEFT JOIN user_dimension_weights udw
             ON udw.dimension_id = od.dimension_id AND udw.amber_id = $1
          WHERE od.observation_id = o.observation_id AND od.suppressed = false
       ) od ON true
      WHERE o.owner_id = $1 AND o.deleted_at IS NULL
        AND o.contact_id IS NOT NULL AND o.status <> 'pending'
      GROUP BY o.contact_id, od.dimension_id
     ON CONFLICT (owner_id, contact_id, dimension_id) DO UPDATE
       SET score = EXCLUDED.score, raw_sum = EXCLUDED.raw_sum,
           last_signal_at = EXCLUDED.last_signal_at,
           observation_count = EXCLUDED.observation_count,
           computed_at = now()`,
    [owner],
  );

  // A contact whose last fact in a dimension was deleted keeps a stale row
  // otherwise, and a stale score is worse than no score: it is confidently
  // wrong. Cleared in the same pass rather than left for a later sweep.
  await query(
    `DELETE FROM contact_dimension_state s
      WHERE s.owner_id = $1
        AND NOT EXISTS (
          SELECT 1 FROM observations o
            JOIN observation_dimensions od
              ON od.observation_id = o.observation_id AND od.suppressed = false
           WHERE o.owner_id = s.owner_id AND o.contact_id = s.contact_id
             AND od.dimension_id = s.dimension_id
             AND o.deleted_at IS NULL AND o.status <> 'pending')`,
    [owner],
  );
  return rowCount;
}

/**
 * The standing shortlist, straight off contact_dimension_state -- one indexed
 * read per dimension instead of scoring the corpus. This is what a screen that
 * says "your strongest financial relationships" should call; rankContacts is for
 * a question that has to be scored live.
 */
export async function shortlistByDimension(ownerId, dimensionCode, limit = 20) {
  const owner = asUuid(ownerId);
  const dim = DIMENSION_ID[dimensionCode];
  if (!owner || !dim) return [];
  const { rows } = await query(
    `SELECT s.contact_id, s.score, s.observation_count, s.last_signal_at,
            c.full_name, c.avatar_url
       FROM contact_dimension_state s
       JOIN contacts c ON c.id = s.contact_id AND c.owner_id = s.owner_id
                      AND c.deleted_at IS NULL
      WHERE s.owner_id = $1 AND s.dimension_id = $2
      ORDER BY s.score DESC
      LIMIT $3`,
    [owner, dim, Math.min(Math.max(Number(limit) || 20, 1), 100)],
  );
  return rows.map((r) => ({
    contactId: r.contact_id,
    name: r.full_name ?? null,
    avatarUrl: r.avatar_url ?? null,
    score: Number(r.score) || 0,
    observationCount: r.observation_count,
    lastSignalAt: r.last_signal_at,
  }));
}

/**
 * Which owners have facts newer than their rollup. The queue for the job.
 *
 * Comparing the newest observation against the OLDEST computed_at rather than
 * the newest: a partial refresh that covered some contacts and not others must
 * still count as stale, and min() is what says so.
 */
/**
 * Which owners have qualifying facts newer than their computed dimension state.
 *
 * THIS USED TO NEVER DRAIN, and `--watch` span on it forever:
 *
 *     rollup: 1 owner(s), 0 dimension rows recomputed     [repeated indefinitely]
 *
 * The predicate measured a DIFFERENT POPULATION than the refresh computes.
 * refreshContactDimensionState only produces a row for an observation that is
 * contact-linked, not soft-deleted, not `pending`, and carries at least one
 * unsuppressed dimension. This query asked only for `deleted_at IS NULL`. So an
 * owner whose newest observation was pending, or contactless, or never got a
 * dimension was reported stale, the refresh correctly wrote zero rows,
 * min(computed_at) therefore never advanced, and the owner was reported stale
 * again on the next tick. Forever. No error, no progress, and a real staleness
 * signal permanently masked by a fake one.
 *
 * The fix is to ask about exactly the rows the refresh can act on. A staleness
 * predicate that is broader than the work it triggers is not conservative, it is
 * a liveness bug: it cannot distinguish "there is work" from "there is nothing
 * here I am able to do".
 *
 * IT ALSO READS observation_dimensions.created_at, not only the observation's.
 * A re-classification rewrites the TAGS and leaves observations.created_at
 * untouched, so a full re-label of every fact in the database looked, to this
 * query, exactly like nothing happening -- and the scores stayed derived from
 * labels that had been deleted. applyModelDimensions deletes then re-inserts,
 * so the dimension row's created_at is a real "when was this last decided"
 * timestamp and needs no new column.
 *
 * min() rather than max() on computed_at is deliberate and still correct: a
 * successful refresh upserts every surviving row with computed_at = now() and
 * deletes the rows it no longer supports, so after a clean pass min == max. min
 * is the safer of the two if that ever stops holding, because it errs toward
 * recomputing rather than toward skipping.
 *
 * Still one bounded scan per call and NO new index -- the EXISTS is a
 * semi-join on observation_dimensions' existing primary key.
 */
export async function ownersNeedingRollup(limit = 50) {
  const { rows } = await query(
    `SELECT q.owner_id
       FROM (
         SELECT o.owner_id,
                max(GREATEST(
                  o.created_at,
                  (SELECT max(od.created_at) FROM observation_dimensions od
                    WHERE od.observation_id = o.observation_id
                      AND od.suppressed = false)
                )) AS newest
           FROM observations o
          WHERE o.deleted_at IS NULL
            AND o.contact_id IS NOT NULL
            AND o.status <> 'pending'
            AND EXISTS (SELECT 1 FROM observation_dimensions od
                         WHERE od.observation_id = o.observation_id
                           AND od.suppressed = false)
          GROUP BY o.owner_id
       ) q
      WHERE q.newest > COALESCE(
              (SELECT min(s.computed_at) FROM contact_dimension_state s
                WHERE s.owner_id = q.owner_id),
              'epoch'::timestamptz)
      ORDER BY q.newest DESC
      LIMIT $1`,
    [Math.min(Math.max(Number(limit) || 50, 1), 500)],
  );
  return rows.map((r) => r.owner_id);
}

/**
 * Every owner with facts the rollup can act on, staleness ignored.
 *
 * For the cases the staleness predicate structurally CANNOT see. Deleting 800
 * observations changes no surviving row's timestamp, so nothing looks newer than
 * the computed state and the rollup reports itself current while every score
 * derived from a deleted fact is still sitting there. Same for any bulk edit
 * that touches scoring_params or user_dimension_weights rather than
 * observations.
 *
 * This is why --force-rollup exists rather than a cleverer predicate: a
 * timestamp comparison can only notice things that got NEWER, and a deletion is
 * the opposite of that.
 */
export async function allOwnersWithFacts(limit = 500) {
  const { rows } = await query(
    `SELECT DISTINCT o.owner_id
       FROM observations o
      WHERE o.deleted_at IS NULL
        AND o.contact_id IS NOT NULL
        AND o.status <> 'pending'
      LIMIT $1`,
    [Math.min(Math.max(Number(limit) || 500, 1), 5000)],
  );
  return rows.map((r) => r.owner_id);
}

/** One rollup pass across every stale owner. Returns what it did. */
export async function runRollupPass({ limit = 50, force = false } = {}) {
  const owners = force
    ? await allOwnersWithFacts(limit)
    : await ownersNeedingRollup(limit);
  let rows = 0;
  for (const owner of owners) rows += await refreshContactDimensionState(owner);
  return { owners: owners.length, rows };
}

// ── Hybrid: the same score with a semantic term ──────────────────────────────

// The dimension half, on its own, so the blend can weigh it against similarity.
const DIMENSION_MATCH = `COALESCE((
    SELECT GREATEST(
             COALESCE(MAX(qw.w * od.weight * od.confidence * d.base_weight
                          * COALESCE(udw.weight, 1.0)), 0),
             ${NEUTRAL_MATCH} * (CASE WHEN COUNT(od.dimension_id) = 0 THEN 1 ELSE 0 END))
      FROM observation_dimensions od
      JOIN dimensions d USING (dimension_id)
      JOIN query_weights qw USING (dimension_id)
      LEFT JOIN user_dimension_weights udw
        ON udw.dimension_id = od.dimension_id AND udw.amber_id = $1
     WHERE od.observation_id = o.observation_id AND od.suppressed = false
  ), ${NEUTRAL_MATCH})`;

// The quality multipliers, which apply whatever the topic turns out to be.
const QUALITY = `amber_temporal_multiplier(
      o.temporal_shape, o.observed_at, o.valid_from, o.valid_until,
      COALESCE(o.decay_half_life_days,
               (SELECT MAX(d3.half_life_days) FROM observation_dimensions od3
                  JOIN dimensions d3 USING (dimension_id)
                 WHERE od3.observation_id = o.observation_id AND od3.suppressed = false),
               180),
      now(), (SELECT value FROM scoring_params WHERE key = 'window_residual'))
  * COALESCE((SELECT value FROM scoring_params WHERE key = 'source_' || o.source), 0.5)
  * COALESCE(o.salience, 0.5)
  * o.confidence`;

/**
 * SEMANTIC + DIMENSIONAL retrieval. Pass `queryVector` (1536 floats, same model
 * as the corpus -- see embedding-queue.embedQuery) to enable the semantic half.
 *
 * Without a vector this is exactly retrieveObservations, so a caller with no
 * OpenAI key, or one running while the embedding queue drains, degrades to
 * dimensional ranking rather than to nothing.
 *
 * `candidateK` is how many neighbors the HNSW index contributes before the
 * blend re-ranks them. Larger recovers more facts the vector ranked low and the
 * dimensions would have rescued; smaller is faster. It is a recall dial, and the
 * default is deliberately several times the requested limit.
 */
export async function retrieveHybrid({
  ownerId,
  queryVector = null,
  dimensionWeights = null,
  contactIds = null,
  limit = 40,
  candidateK = null,
} = {}) {
  const owner = asUuid(ownerId);
  if (!owner) return [];
  const vec = toVectorLiteral(queryVector);
  if (!vec) {
    return retrieveObservations({ ownerId, dimensionWeights, contactIds, limit });
  }

  const rows = weightRows(dimensionWeights);
  const lim = Math.min(Math.max(Number(limit) || 40, 1), 200);
  const k = Math.min(Math.max(Number(candidateK) || lim * 5, lim), 1000);
  const params = [owner, rows.map((r) => r[0]), rows.map((r) => r[1]), vec, k, lim];

  let scope = "";
  const ids = (contactIds || []).map(asUuid).filter(Boolean);
  if (ids.length) {
    params.push(ids);
    scope = `AND o.contact_id = ANY($${params.length}::uuid[])`;
  }

  // SET LOCAL, so it applies to this statement's transaction and nothing else.
  // A session-level SET would leak into every other query on that pooled
  // connection, which is how one feature's tuning becomes another feature's
  // mystery.
  const out = await withTransaction(async (client) => {
    await client.query(`SET LOCAL hnsw.iterative_scan = relaxed_order`);
    // How hard the graph walk tries before giving up. Raised from the default 40
    // because the filter throws candidates away: without headroom, a small
    // account's rows never survive a scan dominated by a large one.
    await client.query(`SET LOCAL hnsw.ef_search = ${Math.max(64, Math.min(k * 2, 1000))}`);
    const res = await client.query(
    `WITH ${QUERY_WEIGHTS_CTE},
     alpha AS (SELECT value AS a FROM scoring_params WHERE key = 'semantic_alpha'),
     -- THE INDEX PICKS THE CANDIDATES. This ORDER BY is the HNSW scan; every
     -- other term below is arithmetic over the few hundred rows it returns.
     candidates AS (
       SELECT o.observation_id,
              1 - (o.embedding <=> $4::halfvec) AS similarity
         FROM observations o
        WHERE o.owner_id = $1 AND o.deleted_at IS NULL
          AND o.embedding IS NOT NULL AND o.status <> 'pending'
        ORDER BY o.embedding <=> $4::halfvec
        LIMIT $5
     )
     SELECT o.observation_id, o.contact_id, o.body, o.kind, o.observed_at,
            o.source, o.source_conversation_id, o.modality,
            c.similarity::real AS similarity,
            ${DIMENSION_MATCH} AS dimension_match,
            ((SELECT a FROM alpha) * GREATEST(c.similarity, 0)
              + (1 - (SELECT a FROM alpha)) * ${DIMENSION_MATCH})
              * (${QUALITY}) AS score,
            COALESCE((
              SELECT jsonb_agg(jsonb_build_object(
                       'code', d2.code, 'weight', od2.weight,
                       'confidence', od2.confidence) ORDER BY od2.weight DESC)
                FROM observation_dimensions od2
                JOIN dimensions d2 USING (dimension_id)
               WHERE od2.observation_id = o.observation_id
                 AND od2.suppressed = false), '[]'::jsonb) AS dimensions
       FROM candidates c
       JOIN observations o USING (observation_id)
      WHERE TRUE ${scope}
      ORDER BY score DESC, o.observed_at DESC
      LIMIT $6`,
      params,
    );
    return res.rows;
  });

  return out.map((r) => ({
    observationId: r.observation_id,
    contactId: r.contact_id,
    body: r.body,
    kind: r.kind,
    modality: r.modality,
    source: r.source,
    sourceConversationId: r.source_conversation_id,
    observedAt: r.observed_at,
    score: Number(r.score) || 0,
    similarity: Number(r.similarity) || 0,
    dimensionMatch: Number(r.dimension_match) || 0,
    dimensions: r.dimensions ?? [],
  }));
}
