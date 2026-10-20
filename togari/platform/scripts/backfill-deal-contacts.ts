/**
 * Patch L.2 — Backfill contact rows from existing togari_structured_deals.
 *
 * For every deal that has a contact_full_name, ensure the person exists
 * in BOTH:
 *   - togari_structured_contacts (master DB row, dedup by workEmail OR
 *     firstName+lastName+currentCompany)
 *   - togari_associated_contacts (linked to the deal + the master row)
 *
 * Mirrors the live wiring in createDeal added in the same patch, so the
 * backfill and the live path stay byte-identical in their handling.
 *
 * Usage:
 *   pnpm tsx scripts/backfill-deal-contacts.ts            (dry run — default)
 *   pnpm tsx scripts/backfill-deal-contacts.ts --apply    (execute writes)
 *
 * Requires:
 *   - GCP_CREDENTIALS_BASE64 (or GOOGLE_CREDENTIALS_BASE64)
 *   - TENANT_ID (defaults to 'bma' — matches createDeal's writes)
 *
 * Idempotent: dedup happens inside upsertStructuredContact / upsertContact,
 * so a second run touches no new rows. Per-deal classification (created vs
 * updated) is computed from a pre-check SELECT against each table.
 */
/* eslint-disable no-console */

import 'dotenv/config';

import { BigQuery } from '@google-cloud/bigquery';
import { tenantStorage } from '../src/tenant/context';
import { resolveDatasetFor } from '../src/services/dataset-resolver';
import { upsertContact, upsertStructuredContact } from '../src/core/tools/contact-ops';

const PROJECT_ID = process.env.GCP_PROJECT_ID || 'midyear-glazing-485303-u3';
const TENANT_ID = process.env.TENANT_ID || 'bma';

function getCredentials(): Record<string, unknown> | undefined {
  const b64 = process.env.GCP_CREDENTIALS_BASE64 || process.env.GOOGLE_CREDENTIALS_BASE64;
  if (!b64) return undefined;
  return JSON.parse(Buffer.from(b64, 'base64').toString('utf-8'));
}

function fqn(table: string, dataset: string): string {
  return `\`${PROJECT_ID}.${dataset}.${table}\``;
}

interface DealRow {
  deal_id: string;
  company: string | null;
  company_id: string | null;
  contact_full_name: string;
  contact_email: string | null;
}

function splitName(fullName: string): { first: string | null; last: string | null } {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length === 0 || parts[0] === '') return { first: null, last: null };
  if (parts.length === 1) return { first: parts[0], last: null };
  return { first: parts[0], last: parts.slice(1).join(' ') };
}

async function structuredExists(
  bq: BigQuery,
  dataset: string,
  deal: DealRow,
): Promise<boolean> {
  // Mirrors the dedup rules in upsertStructuredContact: workEmail first,
  // then (firstName + lastName + currentCompany). If the upsert would
  // hit an existing row, this returns true.
  if (deal.contact_email) {
    const [rows] = await bq.query({
      query: `SELECT row_id FROM ${fqn('togari_structured_contacts', dataset)}
              WHERE LOWER(workEmail) = LOWER(@email) LIMIT 1`,
      params: { email: deal.contact_email },
      useLegacySql: false,
    });
    if ((rows as unknown[]).length > 0) return true;
  }
  const { first, last } = splitName(deal.contact_full_name);
  if (first && last && deal.company) {
    const [rows] = await bq.query({
      query: `SELECT row_id FROM ${fqn('togari_structured_contacts', dataset)}
              WHERE LOWER(firstName) = LOWER(@first)
                AND LOWER(lastName) = LOWER(@last)
                AND LOWER(currentCompany) = LOWER(@company)
              LIMIT 1`,
      params: { first, last, company: deal.company },
      useLegacySql: false,
    });
    if ((rows as unknown[]).length > 0) return true;
  }
  return false;
}

async function associatedExists(
  bq: BigQuery,
  dataset: string,
  deal: DealRow,
): Promise<boolean> {
  // Mirrors upsertContact's dedup priority: email, then (name + company_id).
  if (deal.contact_email) {
    const [rows] = await bq.query({
      query: `SELECT contact_id FROM ${fqn('togari_associated_contacts', dataset)}
              WHERE LOWER(email) = LOWER(@email) LIMIT 1`,
      params: { email: deal.contact_email },
      useLegacySql: false,
    });
    if ((rows as unknown[]).length > 0) return true;
  }
  if (deal.company_id) {
    const normalized = deal.contact_full_name.trim().toLowerCase();
    const [rows] = await bq.query({
      query: `SELECT contact_id FROM ${fqn('togari_associated_contacts', dataset)}
              WHERE company_id = @company_id
                AND LOWER(TRIM(full_name)) = @normalized
              LIMIT 1`,
      params: { company_id: deal.company_id, normalized },
      useLegacySql: false,
    });
    if ((rows as unknown[]).length > 0) return true;
  }
  return false;
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const dataset = resolveDatasetFor(TENANT_ID);
  const bq = new BigQuery({ projectId: PROJECT_ID, credentials: getCredentials() });

  console.log(
    `[deal-contact-backfill] mode=${apply ? 'APPLY' : 'DRY_RUN'}  project=${PROJECT_ID}  dataset=${dataset}  tenant=${TENANT_ID}`,
  );

  const selectSql = `
    SELECT deal_id, company, company_id, contact_full_name, contact_email
    FROM ${fqn('togari_structured_deals', dataset)}
    WHERE contact_full_name IS NOT NULL AND TRIM(contact_full_name) != ''
  `;
  console.log('[deal-contact-backfill] reading deals with contacts...');
  const [rows] = await bq.query({ query: selectSql, useLegacySql: false });
  const deals = rows as DealRow[];
  console.log(`[deal-contact-backfill] ${deals.length} deals have contact_full_name.`);

  if (deals.length === 0) {
    console.log('[deal-contact-backfill] nothing to do.');
    return;
  }

  let structuredCreated = 0;
  let structuredUpdated = 0;
  let associatedCreated = 0;
  let associatedUpdated = 0;
  let failed = 0;

  for (const deal of deals) {
    // Pre-check classifies the upsert outcome. We compute this in both
    // dry-run and apply modes so the summary stays comparable across runs.
    const structuredAlready = await structuredExists(bq, dataset, deal);
    const associatedAlready = await associatedExists(bq, dataset, deal);

    if (!apply) {
      console.log(
        `[deal-contact-backfill]   ${deal.deal_id}  "${deal.contact_full_name}"  ` +
          `structured=${structuredAlready ? 'update' : 'create'}  ` +
          `associated=${associatedAlready ? 'update' : 'create'}`,
      );
      if (structuredAlready) structuredUpdated++;
      else structuredCreated++;
      if (associatedAlready) associatedUpdated++;
      else associatedCreated++;
      continue;
    }

    try {
      const structuredId = await upsertStructuredContact({
        fullName: deal.contact_full_name,
        workEmail: deal.contact_email ?? undefined,
        currentCompany: deal.company ?? undefined,
        pullId: 'togari_deal_backfill',
      });
      if (structuredAlready) structuredUpdated++;
      else structuredCreated++;

      await upsertContact({
        full_name: deal.contact_full_name,
        email: deal.contact_email ?? undefined,
        company_id: deal.company_id ?? undefined,
        company_raw: deal.company ?? undefined,
        deal_ids: [deal.deal_id],
        sources: ['deal_backfill'],
        structured_contact_id: structuredId,
      });
      if (associatedAlready) associatedUpdated++;
      else associatedCreated++;
    } catch (err) {
      failed++;
      console.error(
        `[deal-contact-backfill]   FAILED ${deal.deal_id} (${deal.contact_full_name}):`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  const verb = apply ? 'Processed' : 'Would process';
  console.log('[deal-contact-backfill] complete.');
  console.log(
    `[deal-contact-backfill] ${verb} ${deals.length} deals, ` +
      `${structuredCreated + structuredUpdated} structured contacts ` +
      `(${structuredCreated} created, ${structuredUpdated} updated), ` +
      `${associatedCreated + associatedUpdated} associated contacts ` +
      `(${associatedCreated} created, ${associatedUpdated} updated).`,
  );
  if (failed > 0) {
    console.log(`[deal-contact-backfill]   failed: ${failed}`);
  }
  if (!apply) {
    console.log('[deal-contact-backfill] re-run with --apply to execute.');
  }
}

// Wrap main() in tenantStorage.run() so getCurrentTenant() resolves inside
// upsertContact / upsertStructuredContact (both go through resolveDataset).
tenantStorage
  .run(
    {
      tenantId: TENANT_ID,
      tier: 'enterprise',
    },
    () => main(),
  )
  .catch((err) => {
    console.error('[deal-contact-backfill] fatal:', err instanceof Error ? err.stack : err);
    process.exit(1);
  });
