/**
 * Patch L — Backfill togari_companies from existing togari_structured_deals
 * and populate the new company_id FK column on each deal row.
 *
 * Usage:
 *   pnpm tsx scripts/backfill-deal-companies.ts            (dry run — default)
 *   pnpm tsx scripts/backfill-deal-companies.ts --apply    (execute writes)
 *
 * Requires GCP_CREDENTIALS_BASE64 or GOOGLE_CREDENTIALS_BASE64 in env.
 * Prereq: scripts/create-entity-graph-tables.ts must have run first
 * (creates togari_companies + adds company_id column).
 *
 * Dedup rule: groups existing deals by normalizeCompanyName(company) so
 * "TestRytual Corp" and "testrytual corp" collapse to one row. Generates
 * a slug-based company_id ("tco_<slug>") per group and INSERTs the
 * togari_companies row, then UPDATEs every deal in that group to point
 * at the new id.
 *
 * Idempotent: only touches deals where company_id IS NULL.
 */
/* eslint-disable no-console */

import { BigQuery } from '@google-cloud/bigquery';
import { normalizeCompanyName } from '../src/core/identity/normalize';
import { generateId } from '../src/core/identity/togari-ids';

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

interface DealRow {
  deal_id: string;
  company: string;
  created_at: string | { value: string } | null;
  updated_at: string | { value: string } | null;
}

function asString(v: unknown): string | null {
  if (typeof v === 'string') return v;
  if (v && typeof v === 'object' && 'value' in (v as Record<string, unknown>)) {
    const inner = (v as Record<string, unknown>).value;
    return typeof inner === 'string' ? inner : null;
  }
  return null;
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const bq = new BigQuery({ projectId: PROJECT_ID, credentials: getCredentials() });

  console.log(`[deal-company-backfill] mode=${apply ? 'APPLY' : 'DRY_RUN'}  project=${PROJECT_ID}  dataset=${DATASET}`);

  // Pull every deal that still has NULL company_id. The dataset is
  // small (~23 rows today), so we materialize and group in memory.
  const selectSql = `
    SELECT deal_id, company, created_at, updated_at
    FROM ${fqn('togari_structured_deals')}
    WHERE company_id IS NULL AND company IS NOT NULL AND TRIM(company) != ''
  `;
  console.log('[deal-company-backfill] reading deals with NULL company_id...');
  const [rows] = await bq.query({ query: selectSql, useLegacySql: false });
  const deals = rows as DealRow[];
  console.log(`[deal-company-backfill] ${deals.length} deals need linking.`);

  if (deals.length === 0) {
    console.log('[deal-company-backfill] nothing to do.');
    return;
  }

  // Group by normalized company name. Track the raw display name (first
  // seen wins) plus min/max timestamps so the togari_companies row gets
  // accurate first_seen_at / last_seen_at.
  interface Group {
    company_id: string;
    displayName: string;
    normalized: string;
    dealIds: string[];
    firstSeen: string | null;
    lastSeen: string | null;
  }
  const groups = new Map<string, Group>();

  for (const deal of deals) {
    const normalized = normalizeCompanyName(deal.company);
    if (!normalized) continue;  // shouldn't happen given the WHERE clause

    const created = asString(deal.created_at);
    const updated = asString(deal.updated_at);

    let g = groups.get(normalized);
    if (!g) {
      g = {
        company_id: generateId('company', deal.company),
        displayName: deal.company,
        normalized,
        dealIds: [],
        firstSeen: created,
        lastSeen: updated ?? created,
      };
      groups.set(normalized, g);
    }
    g.dealIds.push(deal.deal_id);
    if (created && (!g.firstSeen || created < g.firstSeen)) g.firstSeen = created;
    if (updated && (!g.lastSeen || updated > g.lastSeen)) g.lastSeen = updated;
  }

  const companiesToCreate = Array.from(groups.values());
  const totalDeals = companiesToCreate.reduce((sum, g) => sum + g.dealIds.length, 0);
  console.log(`[deal-company-backfill] Would create ${companiesToCreate.length} companies, link ${totalDeals} deals.`);

  if (!apply) {
    for (const g of companiesToCreate.slice(0, 20)) {
      console.log(`[deal-company-backfill]   ${g.company_id}  "${g.displayName}"  (${g.dealIds.length} deal${g.dealIds.length === 1 ? '' : 's'})`);
    }
    if (companiesToCreate.length > 20) {
      console.log(`[deal-company-backfill]   ... and ${companiesToCreate.length - 20} more`);
    }
    console.log('[deal-company-backfill] re-run with --apply to execute.');
    return;
  }

  // Apply phase. We do INSERTs and UPDATEs sequentially per company so
  // an error mid-loop leaves the warehouse in a consistent partial state
  // (each company is independently re-runnable since we filter on
  // company_id IS NULL).
  let companiesCreated = 0;
  let dealsLinked = 0;

  for (const g of companiesToCreate) {
    // Skip if a togari_companies row already exists for this normalized
    // name (e.g. a prior partial run, or manually created). We reuse its
    // id rather than inserting a duplicate.
    const [existingRows] = await bq.query({
      query: `SELECT company_id FROM ${fqn('togari_companies')} WHERE name_normalized = @n LIMIT 1`,
      params: { n: g.normalized },
      useLegacySql: false,
    });
    let companyId = g.company_id;
    const existing = existingRows as Array<{ company_id: string }>;
    if (existing.length > 0) {
      companyId = existing[0].company_id;
      console.log(`[deal-company-backfill]   reusing existing company ${companyId} for "${g.displayName}"`);
    } else {
      const insertSql = `
        INSERT INTO ${fqn('togari_companies')}
          (company_id, name, name_normalized, first_seen_at, last_seen_at, created_at, updated_at)
        VALUES (@company_id, @name, @name_normalized, @first_seen_at, @last_seen_at, CURRENT_TIMESTAMP(), CURRENT_TIMESTAMP())
      `;
      await bq.query({
        query: insertSql,
        params: {
          company_id: companyId,
          name: g.displayName,
          name_normalized: g.normalized,
          first_seen_at: g.firstSeen,
          last_seen_at: g.lastSeen,
        },
        types: {
          first_seen_at: 'TIMESTAMP',
          last_seen_at: 'TIMESTAMP',
        },
        useLegacySql: false,
      });
      companiesCreated++;
      console.log(`[deal-company-backfill]   created ${companyId} for "${g.displayName}"`);
    }

    // Link all deals in the group.
    const updateSql = `
      UPDATE ${fqn('togari_structured_deals')}
      SET company_id = @company_id, updated_at = CURRENT_TIMESTAMP()
      WHERE deal_id IN UNNEST(@deal_ids) AND company_id IS NULL
    `;
    const [updateJob] = await bq.createQueryJob({
      query: updateSql,
      params: { company_id: companyId, deal_ids: g.dealIds },
      useLegacySql: false,
    });
    await updateJob.getQueryResults();
    // job.metadata is the snapshot taken at job submission and does not
    // contain DML statistics; refetch from the server to read the actual
    // numDmlAffectedRows once the job has finished.
    const [jobMeta] = await updateJob.getMetadata();
    const affected = parseInt(jobMeta?.statistics?.query?.numDmlAffectedRows ?? '0', 10);
    console.log(`[deal-company-backfill]   linked ${affected} deal${affected === 1 ? '' : 's'} to ${companyId} for "${g.displayName}"`);
    dealsLinked += affected;
  }

  console.log('[deal-company-backfill] complete.');
  console.log(`[deal-company-backfill]   companies created: ${companiesCreated}`);
  console.log(`[deal-company-backfill]   deals linked:      ${dealsLinked}`);
}

main().catch((err) => {
  console.error('[deal-company-backfill] fatal:', err instanceof Error ? err.stack : err);
  process.exit(1);
});
