/**
 * Website ICP list funnel bootstrap — create togari_core.icp_list_jobs
 * and togari_core.website_contact_messages, and add source_tag / lead_score /
 * lead_score_detail to togari_structured_contacts.
 *
 * Usage:
 *   npx tsx src/scripts/bootstrap-icp.ts
 *
 * Requires GCP_CREDENTIALS_BASE64 or GOOGLE_CREDENTIALS_BASE64 in the
 * environment. Idempotent — safe to re-run.
 *
 * We bypass BigQueryClient here (same as bootstrap-1.5a.ts) because CREATE
 * TABLE / ALTER TABLE are DDL, which executeWrite deliberately refuses.
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

  const ddl = fs.readFileSync(path.join(SQL_DIR, 'icp_create_tables.sql'), 'utf-8');

  // Drop whole-line comments rather than whole statements: most statements
  // here open with an explanatory comment, and filtering on startsWith('--')
  // silently skipped them.
  const ddlStatements = ddl
    .split(/;\s*\n/)
    .map((s) =>
      s
        .split('\n')
        .filter((line) => !line.trim().startsWith('--'))
        .join('\n')
        .trim(),
    )
    .filter((s) => s.length > 0);

  for (let i = 0; i < ddlStatements.length; i++) {
    const stmt = ddlStatements[i];
    const firstLine = stmt.split('\n').find((l) => !l.trim().startsWith('--')) ?? 'DDL';
    await runStatement(bq, `DDL ${i + 1}/${ddlStatements.length}: ${firstLine.slice(0, 80)}`, stmt);
  }

  console.log('\nICP funnel tables ready.');
}

main().catch((err) => {
  console.error('bootstrap-icp failed:', err);
  process.exit(1);
});
