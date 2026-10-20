/**
 * Patch L — Universal entity-graph migration.
 *
 * Creates togari_companies, togari_associated_contacts, togari_captures
 * and adds company_id + promoted_from_capture_id columns to
 * togari_structured_deals. (Patch L.1 renamed the contacts table from
 * togari_contacts → togari_associated_contacts to distinguish the
 * active-relationship subset from the master togari_structured_contacts
 * universe, and added a structured_contact_id FK linking the two.)
 *
 * Usage:
 *   pnpm tsx scripts/create-entity-graph-tables.ts            (dry run — default)
 *   pnpm tsx scripts/create-entity-graph-tables.ts --apply    (execute DDL)
 *
 * Requires GCP_CREDENTIALS_BASE64 or GOOGLE_CREDENTIALS_BASE64 in env.
 *
 * Idempotent. Uses `CREATE TABLE IF NOT EXISTS` and
 * `ADD COLUMN IF NOT EXISTS` so re-runs are no-ops. After this lands,
 * run scripts/backfill-deal-companies.ts to populate company_id on
 * existing deal rows.
 */
/* eslint-disable no-console */

import { BigQuery } from '@google-cloud/bigquery';

const PROJECT_ID = process.env.GCP_PROJECT_ID || 'midyear-glazing-485303-u3';
// BMA-specific; when this script becomes per-tenant, swap for a
// dataset-resolver call. Matches scripts/add-client-brand-column.ts.
const DATASET = process.env.BACKFILL_DATASET || 'togari_data_lake';

function getCredentials(): Record<string, unknown> | undefined {
  const b64 = process.env.GCP_CREDENTIALS_BASE64 || process.env.GOOGLE_CREDENTIALS_BASE64;
  if (!b64) return undefined;
  return JSON.parse(Buffer.from(b64, 'base64').toString('utf-8'));
}

function fqn(table: string): string {
  return `\`${PROJECT_ID}.${DATASET}.${table}\``;
}

const COMPANIES_DDL = `
CREATE TABLE IF NOT EXISTS ${fqn('togari_companies')} (
  company_id STRING NOT NULL,
  client_id STRING,
  name STRING NOT NULL,
  name_normalized STRING,
  aliases ARRAY<STRING>,
  domain STRING,
  linkedin_url STRING,
  notes STRING,
  first_seen_at TIMESTAMP,
  last_seen_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP(),
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP()
)
`.trim();

const CONTACTS_DDL = `
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

const CAPTURES_DDL = `
CREATE TABLE IF NOT EXISTS ${fqn('togari_captures')} (
  capture_id STRING NOT NULL,
  client_id STRING,
  source STRING NOT NULL,
  source_id STRING,
  captured_at TIMESTAMP NOT NULL,
  ingested_at TIMESTAMP NOT NULL,
  company_id STRING,
  company_raw STRING,
  contact_ids ARRAY<STRING>,
  deal_id STRING,
  attendees ARRAY<STRING>,
  internal_attendees ARRAY<STRING>,
  title STRING,
  raw_blob STRING,
  metadata JSON,
  promoted_to_deal_id STRING,
  client_brand STRING,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP(),
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP()
)
`.trim();

const ADD_COMPANY_ID_DDL = `ALTER TABLE ${fqn('togari_structured_deals')} ADD COLUMN IF NOT EXISTS company_id STRING`;
const ADD_PROMOTED_FROM_DDL = `ALTER TABLE ${fqn('togari_structured_deals')} ADD COLUMN IF NOT EXISTS promoted_from_capture_id STRING`;

async function runStatement(bq: BigQuery, label: string, sql: string): Promise<void> {
  console.log(`[entity-graph] running: ${label}`);
  console.log(sql);
  await bq.query({ query: sql, useLegacySql: false });
  console.log(`[entity-graph] ${label} complete.`);
}

async function rowCount(bq: BigQuery, table: string): Promise<string> {
  const [rows] = await bq.query({
    query: `SELECT COUNT(*) AS n FROM ${fqn(table)}`,
    useLegacySql: false,
  });
  const first = (rows as Array<{ n: number | string }>)[0];
  return String(first?.n ?? '0');
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const bq = new BigQuery({ projectId: PROJECT_ID, credentials: getCredentials() });

  console.log(`[entity-graph] mode=${apply ? 'APPLY' : 'DRY_RUN'}  project=${PROJECT_ID}  dataset=${DATASET}`);

  if (!apply) {
    console.log('[entity-graph] would run:');
    console.log(COMPANIES_DDL);
    console.log(CONTACTS_DDL);
    console.log(CAPTURES_DDL);
    console.log(ADD_COMPANY_ID_DDL);
    console.log(ADD_PROMOTED_FROM_DDL);
    console.log('[entity-graph] re-run with --apply to execute.');
    return;
  }

  await runStatement(bq, 'CREATE togari_companies', COMPANIES_DDL);
  await runStatement(bq, 'CREATE togari_associated_contacts', CONTACTS_DDL);
  await runStatement(bq, 'CREATE togari_captures', CAPTURES_DDL);
  await runStatement(bq, 'ADD company_id', ADD_COMPANY_ID_DDL);
  await runStatement(bq, 'ADD promoted_from_capture_id', ADD_PROMOTED_FROM_DDL);

  const [companies, contacts, captures, deals] = await Promise.all([
    rowCount(bq, 'togari_companies'),
    rowCount(bq, 'togari_associated_contacts'),
    rowCount(bq, 'togari_captures'),
    rowCount(bq, 'togari_structured_deals'),
  ]);

  console.log('[entity-graph] post-migration row counts:');
  console.log(`[entity-graph]   togari_companies:           ${companies}`);
  console.log(`[entity-graph]   togari_associated_contacts: ${contacts}`);
  console.log(`[entity-graph]   togari_captures:            ${captures}`);
  console.log(`[entity-graph]   togari_structured_deals:    ${deals} (company_id + promoted_from_capture_id columns now exist)`);
}

main().catch((err) => {
  console.error('[entity-graph] fatal:', err instanceof Error ? err.stack : err);
  process.exit(1);
});
