/**
 * Patch L.1 — Rename togari_contacts → togari_associated_contacts and
 * add `structured_contact_id` (FK to togari_structured_contacts.row_id).
 *
 * Why a rename: the existing togari_contacts created in Patch L is the
 * "associated contacts" tier — active relationships linked to deals /
 * captures. togari_structured_contacts is the master 42k-row universe.
 * Naming them togari_(contacts / structured_contacts) made the tiers
 * indistinguishable in SQL audits.
 *
 * Usage:
 *   pnpm tsx scripts/rename-contacts-table.ts            (dry run — default)
 *   pnpm tsx scripts/rename-contacts-table.ts --apply    (DROP + CREATE)
 *
 * Requires GCP_CREDENTIALS_BASE64 or GOOGLE_CREDENTIALS_BASE64 in env.
 *
 * Safety: refuses to run if togari_contacts contains any rows. The Patch L
 * table is currently empty (0 rows in BMA); if that's no longer true,
 * a real data-migration script is needed before this rename can land.
 *
 * Idempotent on a second run: if togari_contacts is already absent and
 * togari_associated_contacts already exists, both operations no-op.
 */
/* eslint-disable no-console */

import { BigQuery } from '@google-cloud/bigquery';

const PROJECT_ID = process.env.GCP_PROJECT_ID || 'midyear-glazing-485303-u3';
const DATASET = process.env.BACKFILL_DATASET || 'togari_data_lake';

function getCredentials(): Record<string, unknown> | undefined {
  const b64 = process.env.GCP_CREDENTIALS_BASE64 || process.env.GOOGLE_CREDENTIALS_BASE64;
  if (!b64) return undefined;
  return JSON.parse(Buffer.from(b64, 'base64').toString('utf-8'));
}

function fqn(table: string): string {
  return `\`${PROJECT_ID}.${DATASET}.${table}\``;
}

// New-table DDL. Same column set as the original togari_contacts plus
// structured_contact_id — the FK back to togari_structured_contacts.row_id.
// Mirror this in scripts/create-entity-graph-tables.ts so a from-scratch
// dataset bootstraps to the same shape.
const ASSOCIATED_CONTACTS_DDL = `
CREATE TABLE IF NOT EXISTS ${fqn('togari_associated_contacts')} (
  contact_id STRING NOT NULL,
  client_id STRING,
  full_name STRING NOT NULL,
  first_name STRING,
  last_name STRING,
  email STRING,
  linkedin_url STRING,
  title STRING,
  company_id STRING,
  company_raw STRING,
  deal_ids ARRAY<STRING>,
  capture_ids ARRAY<STRING>,
  first_seen_at TIMESTAMP,
  last_seen_at TIMESTAMP,
  sources ARRAY<STRING>,
  notes STRING,
  structured_contact_id STRING,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP(),
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP()
)
`.trim();

async function tableExists(bq: BigQuery, table: string): Promise<boolean> {
  const [rows] = await bq.query({
    query: `SELECT 1 AS one FROM \`${PROJECT_ID}.${DATASET}.INFORMATION_SCHEMA.TABLES\` WHERE table_name = @table`,
    params: { table },
    useLegacySql: false,
  });
  return (rows as unknown[]).length > 0;
}

async function rowCount(bq: BigQuery, table: string): Promise<number> {
  const [rows] = await bq.query({
    query: `SELECT COUNT(*) AS n FROM ${fqn(table)}`,
    useLegacySql: false,
  });
  const first = (rows as Array<{ n: number | string }>)[0];
  return Number(first?.n ?? 0);
}

async function runStatement(bq: BigQuery, label: string, sql: string): Promise<void> {
  console.log(`[rename-contacts] running: ${label}`);
  console.log(sql);
  await bq.query({ query: sql, useLegacySql: false });
  console.log(`[rename-contacts] ${label} complete.`);
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const bq = new BigQuery({ projectId: PROJECT_ID, credentials: getCredentials() });

  console.log(`[rename-contacts] mode=${apply ? 'APPLY' : 'DRY_RUN'}  project=${PROJECT_ID}  dataset=${DATASET}`);

  const oldExists = await tableExists(bq, 'togari_contacts');
  const newExists = await tableExists(bq, 'togari_associated_contacts');

  console.log(`[rename-contacts] togari_contacts exists=${oldExists}  togari_associated_contacts exists=${newExists}`);

  // Safety: if the old table still has rows we refuse to drop it. A
  // real data-migration script (copy rows into the new table) is
  // required before a rename like this is safe.
  if (oldExists) {
    const count = await rowCount(bq, 'togari_contacts');
    console.log(`[rename-contacts] togari_contacts row count = ${count}`);
    if (count > 0) {
      throw new Error(
        `Refusing to rename: togari_contacts has ${count} rows. ` +
          `Write a data-migration script first; this DROP would lose data.`,
      );
    }
  }

  if (!apply) {
    console.log(`[rename-contacts] would: DROP TABLE IF EXISTS ${fqn('togari_contacts')}`);
    console.log(`[rename-contacts] would run:\n${ASSOCIATED_CONTACTS_DDL}`);
    console.log('[rename-contacts] re-run with --apply to execute.');
    return;
  }

  // Step 1 — drop the old empty table. IF EXISTS makes a second run a no-op.
  await runStatement(
    bq,
    'DROP togari_contacts',
    `DROP TABLE IF EXISTS ${fqn('togari_contacts')}`,
  );

  // Step 2 — create the new table. IF NOT EXISTS makes a second run a no-op.
  await runStatement(bq, 'CREATE togari_associated_contacts', ASSOCIATED_CONTACTS_DDL);

  // Step 3 — verification.
  const finalCount = await rowCount(bq, 'togari_associated_contacts');
  console.log(`[rename-contacts] togari_associated_contacts row count = ${finalCount} (expected 0)`);
}

main().catch((err) => {
  console.error('[rename-contacts] fatal:', err instanceof Error ? err.stack : err);
  process.exit(1);
});
