/**
 * Patch H.1 — Add the `client_brand` column to togari_structured_deals
 * and backfill existing rows with 'bma' as a safe default.
 *
 * Usage:
 *   pnpm tsx scripts/add-client-brand-column.ts            (dry run — default)
 *   pnpm tsx scripts/add-client-brand-column.ts --apply    (write the ALTER + UPDATE)
 *
 * Requires GCP_CREDENTIALS_BASE64 or GOOGLE_CREDENTIALS_BASE64 in env.
 *
 * Idempotent — running it twice does not error (uses ADD COLUMN IF NOT
 * EXISTS and a WHERE-IS-NULL guard on the backfill UPDATE).
 *
 * After this lands and the END-OF-DAY reclassification pass through Slack
 * (each "update X to <brand>" → update_deal action) is complete, Karthik
 * can run a follow-up to ALTER the column to NOT NULL. No separate
 * backfill script is needed for the brand assignments themselves —
 * those go through update_deal as regular Slack-driven actions.
 */
/* eslint-disable no-console */

import { BigQuery } from '@google-cloud/bigquery';

const PROJECT_ID = process.env.GCP_PROJECT_ID || 'midyear-glazing-485303-u3';
// BMA-specific. When this script becomes per-tenant, swap for a
// resolver lookup that reads the per-tenant dataset.
const DATASET = process.env.BACKFILL_DATASET || 'togari_data_lake';
const TABLE = 'togari_structured_deals';
const DEFAULT_BRAND = 'bma';

function getCredentials(): Record<string, unknown> | undefined {
  const b64 = process.env.GCP_CREDENTIALS_BASE64 || process.env.GOOGLE_CREDENTIALS_BASE64;
  if (!b64) return undefined;
  return JSON.parse(Buffer.from(b64, 'base64').toString('utf-8'));
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const bq = new BigQuery({ projectId: PROJECT_ID, credentials: getCredentials() });
  const fqn = `\`${PROJECT_ID}.${DATASET}.${TABLE}\``;

  console.log(`[brand-migration] mode=${apply ? 'APPLY' : 'DRY_RUN'}  project=${PROJECT_ID}  dataset=${DATASET}  table=${TABLE}`);

  if (!apply) {
    console.log('[brand-migration] would ALTER TABLE ... ADD COLUMN IF NOT EXISTS client_brand STRING');
    console.log(`[brand-migration] would UPDATE ${fqn} SET client_brand = '${DEFAULT_BRAND}' WHERE client_brand IS NULL`);
    console.log('[brand-migration] re-run with --apply to execute.');
    return;
  }

  // Step 1 — ALTER TABLE. BigQuery's "ADD COLUMN IF NOT EXISTS" is the
  // idempotency hatch; the statement is a no-op the second time.
  const alterSql = `ALTER TABLE ${fqn} ADD COLUMN IF NOT EXISTS client_brand STRING`;
  console.log('[brand-migration] running:', alterSql);
  await bq.query({ query: alterSql, useLegacySql: false });
  console.log('[brand-migration] ALTER complete (column exists).');

  // Step 2 — backfill. Idempotent: WHERE IS NULL means the second run
  // updates zero rows. We rely on numDmlAffectedRows from the job
  // metadata for the count, since BQ doesn't return a row count from
  // the result iterator on a pure UPDATE.
  const updateSql = `UPDATE ${fqn} SET client_brand = @brand WHERE client_brand IS NULL`;
  console.log('[brand-migration] running:', updateSql, `(@brand = '${DEFAULT_BRAND}')`);
  const [updateJob] = await bq.createQueryJob({
    query: updateSql,
    params: { brand: DEFAULT_BRAND },
    useLegacySql: false,
  });
  await updateJob.getQueryResults();
  const dml = updateJob.metadata?.statistics?.query?.numDmlAffectedRows ?? '0';
  console.log(`[brand-migration] backfill complete — ${dml} rows updated.`);

  // Step 3 — verification. Always log the final brand histogram so it's
  // easy to confirm in the script output.
  const verifySql = `SELECT IFNULL(client_brand, '<null>') AS client_brand, COUNT(*) AS deals FROM ${fqn} GROUP BY client_brand ORDER BY deals DESC`;
  console.log('[brand-migration] verification:', verifySql);
  const [rows] = await bq.query({ query: verifySql, useLegacySql: false });
  console.log('[brand-migration] final brand histogram:');
  for (const row of rows as Array<{ client_brand: string; deals: number | string }>) {
    console.log(`[brand-migration]   ${row.client_brand}: ${row.deals}`);
  }
}

main().catch((err) => {
  console.error('[brand-migration] fatal:', err instanceof Error ? err.stack : err);
  process.exit(1);
});
