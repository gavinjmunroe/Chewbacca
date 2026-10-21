/**
 * THE CLASSIFICATION QUEUE — the second half of "heuristic first, model on the
 * ones it is unsure about".
 *
 * The lexicon runs inside every insert (see observations-store.insertObservation)
 * and marks what it could not settle as `dimension_status = 'pending'`. This
 * drains that queue.
 *
 * WHY A QUEUE AND NOT A TRIGGER. A trigger would run the model inside the
 * inserting transaction, holding a Cloud SQL connection open across an HTTP call
 * to a third party -- one slow API and the pool is gone. It also could not
 * retry, could not rate-limit, and could not be turned off without a migration.
 *
 * WHY A CLAIM AND NOT A PLAIN SELECT. Two workers, or one worker restarted
 * mid-batch, would otherwise both process the same rows and both pay for the
 * same tokens. `FOR UPDATE SKIP LOCKED` inside the claiming transaction gives
 * each worker a disjoint batch with no coordination and no lock contention.
 *
 * WHAT HAPPENS WHEN THE MODEL IS DOWN: nothing bad. The row keeps the lexicon's
 * guess, its attempt counter goes up, and it is retried on a later run until
 * MAX_ATTEMPTS. Only then does it settle for what the lexicon said. Facts are
 * never left unclassified and the bill is never unbounded.
 */

import { query, withTransaction } from "./sql.js";
import { classifyBatchByModel } from "../lib/observation-dimensions.js";

const MAX_ATTEMPTS = 3;

/**
 * Take up to `limit` pending observations for this worker. Rows are claimed by
 * bumping their attempt count, so a worker that dies mid-batch loses one attempt
 * per row rather than blocking the queue forever.
 */
export async function claimPending(limit = 25) {
  const n = Math.min(Math.max(Number(limit) || 25, 1), 200);
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `SELECT observation_id, body
         FROM observations
        WHERE dimension_status = 'pending'
          AND deleted_at IS NULL
          AND dimension_attempts < $2
        ORDER BY created_at
        LIMIT $1
        FOR UPDATE SKIP LOCKED`,
      [n, MAX_ATTEMPTS],
    );
    if (rows.length === 0) return [];
    await client.query(
      `UPDATE observations
          SET dimension_attempts = dimension_attempts + 1
        WHERE observation_id = ANY($1::uuid[])`,
      [rows.map((r) => r.observation_id)],
    );
    return rows;
  });
}

/**
 * Write a model's answer over the lexicon's guess.
 *
 * REPLACES rather than merges: the model saw the whole sentence and the lexicon
 * saw keywords, so keeping the lexicon's extra dimension alongside would leave a
 * fact tagged with something the better classifier explicitly did not choose.
 * Human assignments survive both -- the DELETE and the INSERT both exclude them,
 * which is the same promise assigned_by makes everywhere else.
 */
export async function applyModelDimensions(observationId, dimensions) {
  return withTransaction(async (client) => {
    const { rows: humanRows } = await client.query(
      `SELECT 1 FROM observation_dimensions
        WHERE observation_id = $1 AND assigned_by = 'human' LIMIT 1`,
      [observationId],
    );
    if (humanRows.length) {
      // Somebody corrected this row while it sat in the queue. Their answer
      // stands and the row leaves the queue.
      await client.query(
        `UPDATE observations SET dimension_status = 'human' WHERE observation_id = $1`,
        [observationId],
      );
      return 0;
    }
    await client.query(
      `DELETE FROM observation_dimensions
        WHERE observation_id = $1 AND assigned_by <> 'human'`,
      [observationId],
    );
    for (const d of dimensions) {
      if (!Number.isInteger(d?.dimensionId)) continue;
      await client.query(
        `INSERT INTO observation_dimensions
           (observation_id, dimension_id, confidence, weight, assigned_by)
         VALUES ($1,$2,$3,$4,'model')
         ON CONFLICT (observation_id, dimension_id) DO UPDATE
           SET confidence = EXCLUDED.confidence, weight = EXCLUDED.weight`,
        [observationId, d.dimensionId, d.confidence, d.weight],
      );
    }
    await client.query(
      `UPDATE observations
          SET dimension_status = $2
        WHERE observation_id = $1`,
      [observationId, dimensions.length ? "llm" : "none"],
    );
    return dimensions.length;
  });
}

/**
 * A row the model would not answer for: settle for the lexicon, but ONLY once
 * the attempts are spent. The guard is the whole point -- without it a single
 * transient timeout would permanently downgrade a row to its keyword guess, and
 * the queue would drain itself on the first bad afternoon the API had.
 */
export async function settleForLexicon(observationId) {
  const { rowCount } = await query(
    `UPDATE observations
        SET dimension_status = CASE
              WHEN EXISTS (SELECT 1 FROM observation_dimensions
                            WHERE observation_id = $1 AND suppressed = false)
              THEN 'lexicon' ELSE 'none' END
      WHERE observation_id = $1
        AND dimension_status = 'pending'
        AND dimension_attempts >= $2`,
    [observationId, MAX_ATTEMPTS],
  );
  return rowCount;
}

/**
 * One pass. Returns what it did, so a cron can log a line that means something.
 *
 * `classify` is injectable so the pass can be tested without a network or an API
 * key -- the whole point of keeping the model call behind a function.
 */
export async function runDimensionPass({ limit = 25, classify = classifyBatchByModel } = {}) {
  const claimed = await claimPending(limit);
  const out = { claimed: claimed.length, classified: 0, unclassified: 0, deferred: 0 };
  if (claimed.length === 0) return out;

  // ONE REQUEST FOR THE WHOLE BATCH. It used to be one per row, which resent the
  // 151-token instruction preamble with every 30-token fact -- two thirds of the
  // spend was the same paragraph, over and over -- and made a 1,034-row backlog
  // take forty-eight minutes instead of two.
  const answers = await classify(claimed.map((r) => r.body));

  for (let i = 0; i < claimed.length; i++) {
    const row = claimed[i];
    const result = answers[i];
    if (!result) {
      // The model did not answer for THIS row -- the whole call failed, or it
      // omitted this key. Either way the lexicon's guess stays and the row stays
      // pending for another run, unless it has now used its last attempt. A
      // partial answer keeps the rows it did cover; one bad row does not discard
      // twenty-four good ones.
      const settled = await settleForLexicon(row.observation_id);
      if (settled) out.unclassified += 1;
      else out.deferred += 1;
      continue;
    }
    await applyModelDimensions(row.observation_id, result.dimensions);
    out.classified += 1;
  }
  return out;
}

/**
 * PUT ROWS BACK IN THE QUEUE. The undo for a bad run.
 *
 * A row that used its three attempts settles for the lexicon's guess and is never
 * asked again -- correct when the model genuinely had no answer, wrong when the
 * model was never reachable. Without this, a misconfigured run is permanent: the
 * only record that a fact was mis-settled is a dimension_status of 'lexicon' or
 * 'none' that looks exactly like a real answer.
 *
 * Only rows the MODEL never successfully answered are eligible. 'llm' and 'human'
 * are left alone -- re-asking about a fact a person corrected by hand would undo
 * their correction.
 */
export async function resetAttempts({ ownerId = null, includeModel = false } = {}) {
  const params = [];
  let scope = "";
  if (ownerId) { params.push(ownerId); scope = `AND owner_id = $1::uuid`; }

  // WHY 'llm' IS EXCLUDED BY DEFAULT, and why it has to be includable.
  //
  // Normally a row the model already answered should be left alone: re-asking
  // costs money and produces the same answer. That is right for draining a
  // backlog and WRONG after a prompt change, which is exactly when the existing
  // model answers are the ones you no longer trust. Without this flag, fixing
  // the prompt improved only the rows that had never been labeled, and every
  // mislabelled row stayed mislabelled -- "hates Greek food" kept
  // physical:0.94 and intellectual:0.18 through a prompt rewrite specifically
  // aimed at both.
  //
  // 'human' is NEVER included, on either path. A person's correction outranks
  // any prompt, and applyModelDimensions independently refuses to overwrite a
  // human row even if one slipped into the queue.
  const statuses = includeModel
    ? "('lexicon', 'none', 'pending', 'llm')"
    : "('lexicon', 'none', 'pending')";

  const { rowCount } = await query(
    `UPDATE observations
        SET dimension_attempts = 0, dimension_status = 'pending'
      WHERE deleted_at IS NULL
        AND dimension_status IN ${statuses}
        AND dimension_attempts > 0
        ${scope}`,
    params,
  );
  return rowCount ?? 0;
}

/** Queue depth, for a health check that can actually tell you it is backing up. */
export async function pendingCount() {
  const { rows } = await query(
    `SELECT count(*)::int AS n FROM observations
      WHERE dimension_status = 'pending' AND deleted_at IS NULL
        AND dimension_attempts < $1`,
    [MAX_ATTEMPTS],
  );
  return rows[0]?.n ?? 0;
}
