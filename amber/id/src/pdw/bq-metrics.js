/**
 * FLEET METRICS -> BIGQUERY. The warehouse half of the analytics.
 *
 * ── WHY A SNAPSHOT EXPORT AND NOT CDC (FOR NOW) ─────────────────────────────
 *
 * Datastream replicating Cloud SQL into BigQuery is the eventual answer, and it
 * needs logical decoding turned on (a flag change and an instance restart) and
 * bills continuously whether four people or four thousand are using the app.
 *
 * The analytics layer is IDENTICAL either way: db/analytics.js computes the
 * numbers, and this only moves them. When volume justifies CDC, the raw tables
 * arrive alongside these and nothing downstream changes -- the charts keep
 * reading amber_metrics.
 *
 * ── LONG FORMAT, ON PURPOSE ─────────────────────────────────────────────────
 *
 * One row per (captured_at, metric, key, value) rather than a wide row per
 * snapshot. A wide table needs a schema migration every time a metric is added,
 * and BigQuery schema changes against a live dashboard are exactly the sort of
 * chore that stops anybody adding metrics. Long format grows by inserting.
 *
 * ── WHAT IS ALLOWED TO LEAVE ────────────────────────────────────────────────
 *
 * Only what db/analytics.js's FLEET functions return: counts, percentages,
 * distributions. No fact bodies, no names, no hashes, no owner ids -- there is
 * no code path from this file to a row of anybody's private data, and the
 * assertion suite checks that rather than trusting it.
 *
 * A metric whose value is null is DROPPED rather than exported as zero. The
 * k-anonymity floor in analytics.js returns null for a cohort too small to
 * publish, and writing that as 0 would turn "we will not say" into "there were
 * none", which is a different and false claim.
 */

import { insertRow, isReady, tenantId } from "./bq-client.js";
import * as A from "../db/analytics.js";

export const METRICS_TABLE = process.env.AMBER_METRICS_TABLE || "amber_metrics";

/**
 * Run this once before the first export. Deliberately printed rather than
 * executed: creating a table in a warehouse is not something a job should do to
 * itself at 3am, and seeing the DDL is how you know what is being collected.
 */
export const METRICS_DDL = `
CREATE TABLE IF NOT EXISTS \`${process.env.GCP_PROJECT_ID || "PROJECT"}.${process.env.MEDHA_PDW_DATASET || "medha_pdw"}.${METRICS_TABLE}\` (
  captured_at TIMESTAMP NOT NULL,
  tenant_id   STRING    NOT NULL,
  scope       STRING    NOT NULL,   -- 'fleet' today; 'owner' would need a different contract
  metric      STRING    NOT NULL,   -- e.g. 'classification.coverage_pct'
  key         STRING,               -- the dimension code, the source, the day
  value       FLOAT64   NOT NULL
)
PARTITION BY DATE(captured_at)
CLUSTER BY metric, key;`;

/** Flatten a snapshot into metric rows. Pure -- takes numbers, returns rows. */
export function snapshotToRows(snapshot, { capturedAt = new Date() } = {}) {
  const at = capturedAt.toISOString();
  const tenant = tenantId();
  const rows = [];
  const push = (metric, value, key = null) => {
    // null means "suppressed" or "not applicable", and neither is a zero.
    if (value === null || value === undefined || !Number.isFinite(Number(value))) return;
    rows.push({ captured_at: at, tenant_id: tenant, scope: "fleet", metric, key, value: Number(value) });
  };

  const h = snapshot.health;
  push("observations.total", h.observations);
  push("observations.last_24h", h.observations24h);

  push("classification.queue", h.classification.queue);
  push("classification.gave_up", h.classification.gaveUp);
  push("classification.coverage_pct", h.classification.coveragePct);
  push("classification.lexicon_share_pct", h.classification.lexiconSharePct);
  push("classification.by_lexicon", h.classification.byLexicon);
  push("classification.by_model", h.classification.byModel);
  push("classification.by_human", h.classification.byHuman);
  push("classification.no_dimension", h.classification.noDimension);

  push("embedding.queue", h.embedding.queue);
  push("embedding.gave_up", h.embedding.gaveUp);
  push("embedding.coverage_pct", h.embedding.coveragePct);

  push("rollup.stale_owners", h.rollup.staleOwners);
  push("rollup.dimension_state_rows", h.rollup.dimensionStateRows);
  // The contact rollup as a trend rather than a reading. A single snapshot
  // cannot tell "nobody has interacted yet" from "the job stopped three days
  // ago"; score_coverage_pct plotted over days can, which is the whole reason
  // these go to the warehouse instead of only to pipeline-status.
  push("rollup.score_rows", h.rollup.scoreRows);
  push("rollup.score_coverage_pct", h.rollup.scoreCoveragePct);
  push("rollup.interaction_rows", h.rollup.interactionRows);
  push("rollup.warm_contacts", h.rollup.warmContacts);

  push("identity.contacts", h.identity.contacts);
  push("identity.key_coverage_pct", h.identity.keyCoveragePct);
  push("identity.discovery_keys", h.identity.discoveryKeys);
  push("identity.linked_to_accounts", h.identity.linkedToAccounts);

  for (const d of snapshot.dimensions ?? []) {
    push("dimension.observations", d.observations, d.code);
    push("dimension.avg_confidence", d.avg_confidence, d.code);
    push("dimension.avg_weight", d.avg_weight, d.code);
    push("dimension.suppressed", d.suppressed, d.code);
    push("dimension.human_assigned", d.human_assigned, d.code);
  }
  for (const r of snapshot.corrections ?? []) {
    push("correction.overridden", r.overridden, r.code);
    push("correction.human_added", r.human_added, r.code);
    push("correction.override_rate_pct", r.overrideRatePct, r.code);
  }
  for (const s of snapshot.sources ?? []) {
    push("source.observations", s.observations, s.source);
    push("source.no_dimension", s.no_dimension, s.source);
    push("source.needed_model", s.needed_model, s.source);
    push("source.avg_salience", s.avg_salience, s.source);
  }
  if (snapshot.today) {
    const day = new Date(snapshot.today.day).toISOString().slice(0, 10);
    push("daily.observations", snapshot.today.observations, day);
    push("daily.classified", snapshot.today.classified, day);
    push("daily.embedded", snapshot.today.embedded, day);
    push("daily.active_owners", snapshot.today.active_owners, day);
  }
  return rows;
}

/**
 * Take a snapshot and ship it. Returns what it did.
 *
 * `write` is injectable so the export is testable without a warehouse, which is
 * the same reason every other network call in this codebase sits behind one.
 *
 * FIRE AND FORGET IS THE HOUSE STYLE HERE (see bq-client): a BigQuery failure
 * must never affect the application, and failed writes go to the dead-letter
 * queue for replay-dlq. What is different is that this job REPORTS the failure
 * count -- a metrics pipeline that silently stops is a dashboard that goes flat
 * and looks like a quiet week.
 */
export async function exportFleetSnapshot({ write = insertRow, table = METRICS_TABLE } = {}) {
  if (!isReady()) {
    return { skipped: true, reason: "BigQuery not configured (GCP_PROJECT_ID)", written: 0 };
  }
  const snapshot = await A.fleetSnapshot();
  const rows = snapshotToRows(snapshot);
  let written = 0;
  let failed = 0;
  for (const row of rows) {
    // eslint-disable-next-line no-await-in-loop
    const okRow = await write(table, row);
    if (okRow) written += 1;
    else failed += 1;
  }
  return { skipped: false, rows: rows.length, written, failed, capturedAt: snapshot.capturedAt };
}
