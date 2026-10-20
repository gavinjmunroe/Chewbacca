/**
 * Phase 1.5a bootstrap — create togari_data_lake.users and
 * reminders_migration_staging, then seed the users table with the 7
 * BMA team members.
 *
 * Usage:
 *   npx tsx src/scripts/bootstrap-1.5a.ts
 *
 * Requires GCP_CREDENTIALS_BASE64 or GOOGLE_CREDENTIALS_BASE64 in the
 * environment. Idempotent — safe to re-run.
 *
 * We bypass BigQueryClient here because:
 *   - CREATE TABLE IF NOT EXISTS is DDL and BigQueryClient.executeQuery
 *     only allows SELECT/WITH.
 *   - This is a schema bootstrap, not a tool call — no tenant context
 *     applies and no audit trail is required.
 */

import fs from 'fs';
import path from 'path';
import { BigQuery } from '@google-cloud/bigquery';

const PROJECT_ID = 'midyear-glazing-485303-u3';
const SQL_DIR = path.join(__dirname, '..', '..', 'sql');

function getRawBigQuery(): BigQuery {
  const creds =
    process.env.GCP_CREDENTIALS_BASE64 || process.env.GOOGLE_CREDENTIALS_BASE64 || null;
  if (creds) {
    const decoded = Buffer.from(creds, 'base64').toString('utf-8');
    return new BigQuery({ projectId: PROJECT_ID, credentials: JSON.parse(decoded) });
  }
  // Falls back to ADC (application default credentials).
  return new BigQuery({ projectId: PROJECT_ID });
}

async function runStatement(bq: BigQuery, label: string, sql: string): Promise<void> {
  console.log(`\n▶ ${label}`);
  const [job] = await bq.createQueryJob({ query: sql, useLegacySql: false });
  await job.getQueryResults();
  console.log(`  ✓ ${label} complete (job ${job.id})`);
}

async function main(): Promise<void> {
  const bq = getRawBigQuery();

  const ddl = fs.readFileSync(path.join(SQL_DIR, 'phase15a_create_tables.sql'), 'utf-8');
  const seed = fs.readFileSync(path.join(SQL_DIR, 'phase15a_seed_users.sql'), 'utf-8');

  // Execute DDL statements one-by-one so each one returns its own job.
  // BigQuery's client accepts a multi-statement script too, but running
  // them separately gives clearer error messages.
  const ddlStatements = ddl
    .split(/;\s*\n/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !s.startsWith('--'));

  for (let i = 0; i < ddlStatements.length; i++) {
    const stmt = ddlStatements[i];
    // First non-comment line gives a label
    const firstLine = stmt.split('\n').find((l) => !l.trim().startsWith('--')) ?? 'DDL';
    await runStatement(bq, `DDL ${i + 1}/${ddlStatements.length}: ${firstLine.slice(0, 80)}`, stmt);
  }

  await runStatement(bq, 'Seed togari_data_lake.users', seed);

  // Verify the seeded rows
  const [rows] = await bq.query({
    query: `SELECT user_id, tenant_id, email, first_name, last_name, slack_user_id
            FROM \`${PROJECT_ID}.togari_data_lake.users\`
            WHERE tenant_id = @tenantId
            ORDER BY first_name`,
    params: { tenantId: 'bma' },
    useLegacySql: false,
  });
  console.log(`\nSeeded ${rows.length} users for tenant=bma:`);
  for (const r of rows) {
    console.log(`  ${r.user_id} | ${r.first_name} ${r.last_name ?? ''} | slack=${r.slack_user_id ?? 'null'} | ${r.email}`);
  }

  console.log('\n✓ Bootstrap complete.');
}

main().catch((err) => {
  console.error('✗ Bootstrap failed:', err);
  process.exit(1);
});
