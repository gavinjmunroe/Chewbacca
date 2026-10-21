/**
 * PIPELINE ANALYTICS — is the data stream actually working?
 *
 * All session I have answered that question by hand, one SELECT at a time. This
 * is that, written down, and it is the layer everything else reads from: the
 * operational view, the training signal, and (aggregated) the client-facing one.
 *
 * ── THE PRIVACY BOUNDARY IS IN THE FUNCTION NAMES ───────────────────────────
 *
 * Every export here returns COUNTS AND DISTRIBUTIONS. Not one of them returns an
 * observation body, a contact name, a phone hash, or anything else a person
 * said. That is deliberate and it is the whole reason this file exists rather
 * than the dashboard querying observations directly:
 *
 *   ownerScoped*   numbers about ONE account, for that account's own screens
 *   fleet*         numbers across all accounts, already aggregated. Safe to
 *                  export to BigQuery, safe for a client-facing chart, and
 *                  incapable of identifying anybody because there is nothing
 *                  in the result set to identify them WITH.
 *
 * If a future caller needs the text of a fact, it does not belong here. Adding
 * "just the body, for debugging" to a fleet query is how an analytics warehouse
 * becomes a copy of everybody's private relationship data.
 *
 * A SMALL COHORT IS ALSO IDENTIFYING. "One user in this cohort, average
 * emotional score 0.9" is a fact about a named person to anybody who knows who
 * the user is. Fleet queries suppress buckets below MIN_COHORT.
 */

import { query } from "./sql.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const asUuid = (v) =>
  typeof v === "string" && UUID_RE.test(v.trim()) ? v.trim().toLowerCase() : null;

// Below this, a bucket is a person rather than a statistic. k-anonymity's
// cheapest useful form; the number is deliberately conservative for a product
// with a handful of users.
export const MIN_COHORT = 5;

/**
 * THE ONE THAT ANSWERS "IS IT WORKING". Every stage of the pipeline, with the
 * number that tells you whether it is keeping up.
 *
 * A stage is HEALTHY when its backlog is draining and its coverage is climbing.
 * Both are reported rather than reduced to a traffic light, because "83% of
 * facts are classified" and "17% failed three times" are the same number and
 * mean completely different things.
 */
export async function pipelineHealth() {
  const { rows } = await query(`
    SELECT
      (SELECT count(*)::int FROM observations WHERE deleted_at IS NULL) AS observations,
      (SELECT count(*)::int FROM observations
        WHERE deleted_at IS NULL AND created_at > now() - interval '24 hours') AS observations_24h,

      -- CLASSIFICATION. pending is the queue; the rest is how it was settled.
      (SELECT count(*)::int FROM observations
        WHERE deleted_at IS NULL AND dimension_status = 'pending'
          AND dimension_attempts < 3) AS dim_queue,
      (SELECT count(*)::int FROM observations
        WHERE deleted_at IS NULL AND dimension_status = 'pending'
          AND dimension_attempts >= 3) AS dim_gave_up,
      (SELECT count(*)::int FROM observations
        WHERE deleted_at IS NULL AND dimension_status = 'lexicon') AS dim_lexicon,
      (SELECT count(*)::int FROM observations
        WHERE deleted_at IS NULL AND dimension_status = 'llm') AS dim_llm,
      (SELECT count(*)::int FROM observations
        WHERE deleted_at IS NULL AND dimension_status = 'human') AS dim_human,
      (SELECT count(*)::int FROM observations
        WHERE deleted_at IS NULL AND dimension_status = 'none') AS dim_none,

      -- EMBEDDING. Same shape: a queue, a coverage, and a give-up count that
      -- would otherwise hide inside "not yet done" forever.
      (SELECT count(*)::int FROM observations
        WHERE deleted_at IS NULL AND embedding IS NULL AND embedding_attempts < 3) AS embed_queue,
      (SELECT count(*)::int FROM observations
        WHERE deleted_at IS NULL AND embedding IS NULL AND embedding_attempts >= 3) AS embed_gave_up,
      (SELECT count(*)::int FROM observations
        WHERE deleted_at IS NULL AND embedding IS NOT NULL) AS embedded,

      -- THE ROLLUP. Owners whose newest fact is newer than their oldest score.
      (SELECT count(*)::int FROM (
         SELECT o.owner_id FROM observations o
           LEFT JOIN contact_dimension_state s ON s.owner_id = o.owner_id
          WHERE o.deleted_at IS NULL
          GROUP BY o.owner_id
         HAVING max(o.created_at) > COALESCE(min(s.computed_at), 'epoch'::timestamptz)
       ) t) AS rollup_stale_owners,
      (SELECT count(*)::int FROM contact_dimension_state) AS dimension_state_rows,
      -- THE CONTACT ROLLUP, counted separately, because it is a different job on
      -- a different schedule and one number called "the rollup" is how the fact
      -- that this one had never run at all stayed invisible. score_rows against
      -- live contacts is the coverage that matters: a contact with no score row
      -- cannot appear in the shortlist index however warm the relationship is.
      (SELECT count(*)::int FROM contact_scores)            AS score_rows,
      (SELECT count(*)::int FROM contact_interaction_stats) AS interaction_rows,
      (SELECT count(*)::int FROM contact_scores WHERE warmth > 0) AS warm_rows,

      -- IDENTITY. A contact with no key rows cannot be deduped or linked at
      -- signup, so this is the coverage that makes discovery work at all.
      (SELECT count(*)::int FROM contacts WHERE deleted_at IS NULL) AS contacts,
      (SELECT count(DISTINCT (owner_id, contact_id))::int
         FROM contact_identity_keys) AS contacts_with_keys,
      (SELECT count(*)::int FROM discovery_keys) AS discovery_keys,
      (SELECT count(*)::int FROM contacts
        WHERE deleted_at IS NULL AND linked_amber_id IS NOT NULL) AS contacts_linked
  `);
  const r = rows[0];
  const pct = (n, d) => (d > 0 ? Number(((n / d) * 100).toFixed(1)) : null);
  const classified = r.dim_lexicon + r.dim_llm + r.dim_human + r.dim_none;

  return {
    observations: r.observations,
    observations24h: r.observations_24h,
    classification: {
      queue: r.dim_queue,
      gaveUp: r.dim_gave_up,
      byLexicon: r.dim_lexicon,
      byModel: r.dim_llm,
      byHuman: r.dim_human,
      noDimension: r.dim_none,
      coveragePct: pct(classified, r.observations),
      // What fraction the lexicon settled on its own. If this collapses, the
      // model bill is about to climb; if it hits 100%, the lexicon has probably
      // become over-confident rather than better.
      lexiconSharePct: pct(r.dim_lexicon, classified),
    },
    embedding: {
      queue: r.embed_queue,
      gaveUp: r.embed_gave_up,
      embedded: r.embedded,
      coveragePct: pct(r.embedded, r.observations),
    },
    rollup: {
      staleOwners: r.rollup_stale_owners,
      dimensionStateRows: r.dimension_state_rows,
      scoreRows: r.score_rows,
      interactionRows: r.interaction_rows,
      warmContacts: r.warm_rows,
      // Against live contacts, not against each other. 0% here with a healthy
      // fact count means the contact rollup is not running.
      scoreCoveragePct: pct(r.score_rows, r.contacts),
    },
    identity: {
      contacts: r.contacts,
      withKeys: r.contacts_with_keys,
      keyCoveragePct: pct(r.contacts_with_keys, r.contacts),
      discoveryKeys: r.discovery_keys,
      linkedToAccounts: r.contacts_linked,
    },
  };
}

/**
 * WHICH DIMENSIONS ACTUALLY FIRE, fleet-wide. The single most useful number for
 * tuning the lexicon: a dimension that never fires has a vocabulary problem, and
 * one that fires on everything has a precision problem.
 *
 * avg_confidence separates those two cases. Lots of low-confidence hits means
 * the terms are too loose; few high-confidence ones means they are too narrow.
 */
export async function fleetDimensionDistribution() {
  const { rows } = await query(`
    -- LEFT JOIN FROM dimensions, not from the assignments. An inner join drops
    -- any dimension that has never fired, which is precisely the row worth
    -- seeing: a dimension at zero is a vocabulary gap, and it is invisible in a
    -- report that only lists dimensions with hits.
    SELECT d.code, d.label,
           count(od.dimension_id)::int AS assignments,
           count(DISTINCT od.observation_id)::int AS observations,
           round(avg(od.confidence)::numeric, 3)::float8 AS avg_confidence,
           round(avg(od.weight)::numeric, 3)::float8 AS avg_weight,
           count(*) FILTER (WHERE od.assigned_by = 'human')::int AS human_assigned,
           count(*) FILTER (WHERE od.suppressed)::int AS suppressed
      FROM dimensions d
      LEFT JOIN observation_dimensions od USING (dimension_id)
      LEFT JOIN observations o ON o.observation_id = od.observation_id
                              AND o.deleted_at IS NULL
     GROUP BY d.code, d.label, d.sort_order
     ORDER BY d.sort_order`);
  return rows;
}

/**
 * THE CORRECTION RATE, per dimension. A human overriding the model is the only
 * ground truth this system gets, and it is the training signal for
 * user_dimension_weights and for the lexicon itself.
 *
 * Suppressions and human assignments are counted separately because they mean
 * different things: suppressed is "you were wrong", human-assigned is "you
 * missed one".
 */
export async function fleetCorrectionRate({ sinceDays = 30 } = {}) {
  const { rows } = await query(
    `SELECT d.code,
            count(*) FILTER (WHERE od.assigned_by = 'model')::int AS model_assigned,
            count(*) FILTER (WHERE od.suppressed)::int AS overridden,
            count(*) FILTER (WHERE od.assigned_by = 'human')::int AS human_added
       FROM observation_dimensions od
       JOIN dimensions d USING (dimension_id)
       JOIN observations o ON o.observation_id = od.observation_id
                          AND o.deleted_at IS NULL
                          AND o.created_at > now() - ($1 || ' days')::interval
      GROUP BY d.code, d.sort_order
      ORDER BY d.sort_order`,
    [String(Math.max(1, Number(sinceDays) || 30))],
  );
  return rows.map((r) => ({
    ...r,
    // Guarded: a dimension with three assignments and one override is not
    // "33% wrong", it is three assignments. Reported as null rather than as a
    // number somebody will put on a chart.
    overrideRatePct:
      r.model_assigned >= MIN_COHORT
        ? Number(((r.overridden / r.model_assigned) * 100).toFixed(1))
        : null,
  }));
}

/**
 * Where facts come from, fleet-wide, with how much of each source survives to
 * be classified. A source whose facts are disproportionately unclassifiable is
 * a source producing text the lexicon was not built for -- worth knowing before
 * the model bill says so.
 */
export async function fleetSourceMix({ sinceDays = 30 } = {}) {
  const { rows } = await query(
    `SELECT o.source,
            count(*)::int AS observations,
            count(*) FILTER (WHERE o.dimension_status = 'none')::int AS no_dimension,
            count(*) FILTER (WHERE o.dimension_status = 'llm')::int AS needed_model,
            round(avg(COALESCE(o.salience, 0.5))::numeric, 3)::float8 AS avg_salience
       FROM observations o
      WHERE o.deleted_at IS NULL
        AND o.created_at > now() - ($1 || ' days')::interval
      GROUP BY o.source
      ORDER BY observations DESC`,
    [String(Math.max(1, Number(sinceDays) || 30))],
  );
  return rows;
}

/**
 * Daily counts, for the growth chart and for noticing the day capture stopped
 * working. Deliberately COUNTS ONLY -- this is the series most likely to end up
 * on a client-facing dashboard, and it carries nothing about anybody.
 */
export async function fleetDailyVolume({ days = 30 } = {}) {
  const { rows } = await query(
    `SELECT date_trunc('day', o.created_at)::date AS day,
            count(*)::int AS observations,
            count(DISTINCT o.owner_id)::int AS active_owners,
            count(*) FILTER (WHERE o.dimension_status IN ('lexicon','llm','human'))::int AS classified,
            count(*) FILTER (WHERE o.embedding IS NOT NULL)::int AS embedded
       FROM observations o
      WHERE o.deleted_at IS NULL
        AND o.created_at > now() - ($1 || ' days')::interval
      GROUP BY 1
      ORDER BY 1`,
    [String(Math.max(1, Number(days) || 30))],
  );
  // Suppress owner counts in buckets too small to be a statistic; the
  // observation count stays, because it names nobody.
  return rows.map((r) => ({
    ...r,
    active_owners: r.active_owners >= MIN_COHORT ? r.active_owners : null,
  }));
}

/**
 * ONE ACCOUNT'S OWN NUMBERS, for that account's own screen. Owner-scoped, so
 * this is the only function here that may return something specific -- and even
 * then it is counts and scores, never text.
 */
export async function ownerScopedSummary(ownerId) {
  const owner = asUuid(ownerId);
  if (!owner) return null;
  const { rows } = await query(
    `SELECT
       (SELECT count(*)::int FROM contacts
         WHERE owner_id = $1 AND deleted_at IS NULL) AS contacts,
       (SELECT count(*)::int FROM observations
         WHERE owner_id = $1 AND deleted_at IS NULL) AS observations,
       (SELECT count(*)::int FROM observations
         WHERE owner_id = $1 AND deleted_at IS NULL
           AND created_at > now() - interval '7 days') AS observations_7d,
       (SELECT count(*)::int FROM conversations
         WHERE owner_id = $1 AND deleted_at IS NULL) AS conversations,
       (SELECT max(observed_at) FROM observations
         WHERE owner_id = $1 AND deleted_at IS NULL) AS last_signal_at`,
    [owner],
  );
  const { rows: dims } = await query(
    `SELECT d.code,
            count(*)::int AS contacts_scored,
            round(avg(s.score)::numeric, 3)::float8 AS avg_score,
            round(max(s.score)::numeric, 3)::float8 AS top_score
       FROM contact_dimension_state s
       JOIN dimensions d USING (dimension_id)
      WHERE s.owner_id = $1
      GROUP BY d.code, d.sort_order
      ORDER BY d.sort_order`,
    [owner],
  );
  return { ...rows[0], dimensions: dims };
}

/**
 * The rows a warehouse export sends. One object, already aggregated, with a
 * stamp -- so a daily snapshot is a row and a chart is a scan of those rows.
 *
 * Nothing in here is owner-scoped. That is the contract: what goes to BigQuery
 * is what could be printed on a slide.
 */
export async function fleetSnapshot() {
  const [health, dimensions, corrections, sources, daily] = await Promise.all([
    pipelineHealth(),
    fleetDimensionDistribution(),
    fleetCorrectionRate({ sinceDays: 30 }),
    fleetSourceMix({ sinceDays: 30 }),
    fleetDailyVolume({ days: 1 }),
  ]);
  return {
    capturedAt: new Date().toISOString(),
    health,
    dimensions,
    corrections,
    sources,
    today: daily[daily.length - 1] ?? null,
  };
}
