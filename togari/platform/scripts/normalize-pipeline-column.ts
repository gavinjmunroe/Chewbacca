/**
 * Patch H follow-up — Normalize the `pipeline` column on
 * togari_structured_deals onto the canonical singular vocabulary.
 *
 * Today's row state has 14 rows on the legacy "partnerships" plural plus
 * an unknown number of NULL / empty pipelines from pre-Patch-H writes.
 * The classifier emits singular now, the BRAND_PIPELINES validator
 * rejects the plural, and updates were starting to fail on rows that
 * were never normalized. This script fixes the legacy data so the
 * validator's word-for-word check matches what's actually in BQ.
 *
 * Usage:
 *   pnpm tsx scripts/normalize-pipeline-column.ts            (dry run — default)
 *   pnpm tsx scripts/normalize-pipeline-column.ts --apply    (write the UPDATEs)
 *
 * Requires GCP_CREDENTIALS_BASE64 or GOOGLE_CREDENTIALS_BASE64 in env.
 *
 * Idempotent — the WHERE clauses target only the legacy values, so a
 * second run touches zero rows.
 */
/* eslint-disable no-console */

import { BigQuery } from '@google-cloud/bigquery';

const PROJECT_ID = process.env.GCP_PROJECT_ID || 'midyear-glazing-485303-u3';
// BMA-specific. When this script becomes per-tenant, swap for a
// resolver lookup that reads the per-tenant dataset.
const DATASET = process.env.BACKFILL_DATASET || 'togari_data_lake';
const TABLE = 'togari_structured_deals';
const DEFAULT_PIPELINE = 'inbound';

function getCredentials(): Record<string, unknown> | undefined {
  const b64 = process.env.GCP_CREDENTIALS_BASE64 || process.env.GOOGLE_CREDENTIALS_BASE64;
  if (!b64) return undefined;
  return JSON.parse(Buffer.from(b64, 'base64').toString('utf-8'));
}

async function histogram(
  bq: BigQuery,
  fqn: string,
  label: string,
): Promise<void> {
  const sql = `SELECT IFNULL(NULLIF(pipeline, ''), '<empty>') AS pipeline, COUNT(*) AS deals FROM ${fqn} GROUP BY pipeline ORDER BY deals DESC`;
  const [rows] = await bq.query({ query: sql, useLegacySql: false });
  console.log(`[pipeline-normalize] ${label} pipeline histogram:`);
  for (const row of rows as Array<{ pipeline: string; deals: number | string }>) {
    console.log(`[pipeline-normalize]   ${row.pipeline}: ${row.deals}`);
  }
}

async function runUpdate(
  bq: BigQuery,
  sql: string,
  params: Record<string, unknown>,
  description: string,
): Promise<string> {
  console.log(`[pipeline-normalize] running: ${description}`);
  const [job] = await bq.createQueryJob({ query: sql, params, useLegacySql: false });
  await job.getQueryResults();
  const dml = job.metadata?.statistics?.query?.numDmlAffectedRows ?? '0';
  console.log(`[pipeline-normalize] ${description} — ${dml} rows updated.`);
  return String(dml);
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const bq = new BigQuery({ projectId: PROJECT_ID, credentials: getCredentials() });
  const fqn = `\`${PROJECT_ID}.${DATASET}.${TABLE}\``;

  console.log(`[pipeline-normalize] mode=${apply ? 'APPLY' : 'DRY_RUN'}  project=${PROJECT_ID}  dataset=${DATASET}  table=${TABLE}`);

  // Step 1 — before-state histogram. Always runs.
  await histogram(bq, fqn, 'before');

  if (!apply) {
    console.log(`[pipeline-normalize] would UPDATE ${fqn} SET pipeline = 'partnership' WHERE pipeline = 'partnerships'`);
    console.log(`[pipeline-normalize] would UPDATE ${fqn} SET pipeline = '${DEFAULT_PIPELINE}' WHERE pipeline IS NULL OR pipeline = ''`);
    console.log('[pipeline-normalize] re-run with --apply to execute.');
    return;
  }

  // Step 2 — singularize the legacy plural. Idempotent: WHERE
  // pipeline = 'partnerships' means a second run updates zero rows.
  await runUpdate(
    bq,
    `UPDATE ${fqn} SET pipeline = 'partnership' WHERE pipeline = 'partnerships'`,
    {},
    "singularize 'partnerships' → 'partnership'",
  );

  // Step 3 — default NULL / empty pipelines to inbound. The classifier
  // can't fill these (the row predates it); validation needs a value.
  await runUpdate(
    bq,
    `UPDATE ${fqn} SET pipeline = @default_pipeline WHERE pipeline IS NULL OR pipeline = ''`,
    { default_pipeline: DEFAULT_PIPELINE },
    `default NULL / empty pipeline → '${DEFAULT_PIPELINE}'`,
  );

  // Step 4 — after-state histogram.
  await histogram(bq, fqn, 'after');
}

main().catch((err) => {
  console.error('[pipeline-normalize] fatal:', err instanceof Error ? err.stack : err);
  process.exit(1);
});
