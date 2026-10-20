/**
 * Patch L — Company CRUD for the universal entity graph.
 *
 * Companies are the root entity: every contact / deal / capture FKs
 * back to one of these. Dedup happens via name_normalized
 * (see src/core/identity/normalize.ts::normalizeCompanyName) — different
 * casings or corporate-suffix variants of the same name collapse to a
 * single row.
 *
 * Universal linkage invariant (from Patch L):
 *   companies: root entity, no required outbound link
 *   contacts:  must link to ≥1 of {company_id, deal_ids[], capture_ids[]}
 *   captures:  must link to ≥1 of {company_id, contact_ids[], deal_id}
 *   deals:     must link to company_id (REQUIRED)
 *
 * BigQuery doesn't enforce FKs, so the invariants are enforced in the
 * insert/upsert helpers in this file and its siblings (contact-ops,
 * capture-ops).
 */

import { BigQueryClient } from '../../bigquery/client';
import { createLogger } from '../../observability/logger';
import { resolveDataset } from '../../services/dataset-resolver';
import { generateId } from '../identity/togari-ids';
import { normalizeCompanyName, fuzzyScore } from '../identity/normalize';
import type { Company } from '../types';

const logger = createLogger('core/company-ops');

const PROJECT_ID = 'midyear-glazing-485303-u3';

function companiesTable(): string {
  return `\`${PROJECT_ID}.${resolveDataset()}.togari_companies\``;
}

function getBqClient(): BigQueryClient {
  return new BigQueryClient(
    PROJECT_ID,
    null,
    process.env.GCP_CREDENTIALS_BASE64 || process.env.GOOGLE_CREDENTIALS_BASE64 || null,
  );
}

function rowToCompany(row: Record<string, unknown>): Company {
  const aliases = row.aliases as unknown;
  return {
    company_id: (row.company_id as string) || '',
    client_id: (row.client_id as string) || undefined,
    name: (row.name as string) || '',
    name_normalized: (row.name_normalized as string) || undefined,
    aliases: Array.isArray(aliases) ? (aliases as string[]) : undefined,
    domain: (row.domain as string) || undefined,
    linkedin_url: (row.linkedin_url as string) || undefined,
    notes: (row.notes as string) || undefined,
    first_seen_at: (row.first_seen_at as string) || undefined,
    last_seen_at: (row.last_seen_at as string) || undefined,
    created_at: (row.created_at as string) || undefined,
    updated_at: (row.updated_at as string) || undefined,
  };
}

export interface CompanyInput {
  /** If provided, upsert mode — update the existing row. */
  id?: string;
  name: string;
  client_id?: string;
  aliases?: string[];
  domain?: string;
  linkedin_url?: string;
  notes?: string;
}

/**
 * Upsert a company. If `input.id` is given, updates that row; otherwise
 * looks up by name_normalized and either updates the existing row or
 * inserts a new one with a slug-based ID (tco_<slug>).
 */
export async function upsertCompany(input: CompanyInput): Promise<Company> {
  if (!input.name || !input.name.trim()) {
    throw new Error('upsertCompany: name is required');
  }
  const bq = getBqClient();
  const normalized = normalizeCompanyName(input.name);

  // If caller supplied an id, target it directly.
  if (input.id) {
    const existing = await getCompanyById(input.id);
    if (existing) {
      const setClauses = ['name = @name', 'name_normalized = @name_normalized', 'updated_at = CURRENT_TIMESTAMP()', 'last_seen_at = CURRENT_TIMESTAMP()'];
      const params: Record<string, unknown> = {
        id: input.id,
        name: input.name,
        name_normalized: normalized,
      };
      if (input.client_id !== undefined) { setClauses.push('client_id = @client_id'); params.client_id = input.client_id; }
      if (input.domain !== undefined) { setClauses.push('domain = @domain'); params.domain = input.domain; }
      if (input.linkedin_url !== undefined) { setClauses.push('linkedin_url = @linkedin_url'); params.linkedin_url = input.linkedin_url; }
      if (input.notes !== undefined) { setClauses.push('notes = @notes'); params.notes = input.notes; }
      await bq.executeWrite(
        `UPDATE ${companiesTable()} SET ${setClauses.join(', ')} WHERE company_id = @id`,
        params,
      );
      logger.info('Updated company by id', { company_id: input.id, name: input.name });
      return (await getCompanyById(input.id))!;
    }
    // Caller supplied an id that doesn't exist — fall through to insert
    // with that exact id. Lets the backfill scripts seed pre-computed IDs.
  }

  // Dedup by name_normalized.
  const existingByName = await findCompanyByNormalized(normalized);
  if (existingByName) {
    logger.info('Company already exists by name_normalized', {
      company_id: existingByName.company_id,
      name: existingByName.name,
    });
    // Touch last_seen_at so the row reflects continued activity.
    await bq.executeWrite(
      `UPDATE ${companiesTable()} SET last_seen_at = CURRENT_TIMESTAMP(), updated_at = CURRENT_TIMESTAMP() WHERE company_id = @id`,
      { id: existingByName.company_id },
    );
    return existingByName;
  }

  const company_id = input.id ?? generateId('company', input.name);
  const insertParams: Record<string, unknown> = {
    company_id,
    name: input.name,
    name_normalized: normalized,
  };
  if (input.client_id !== undefined) insertParams.client_id = input.client_id;
  if (input.domain !== undefined) insertParams.domain = input.domain;
  if (input.linkedin_url !== undefined) insertParams.linkedin_url = input.linkedin_url;
  if (input.notes !== undefined) insertParams.notes = input.notes;

  const columns = Object.keys(insertParams).concat(['first_seen_at', 'last_seen_at', 'created_at', 'updated_at']);
  const values = Object.keys(insertParams).map((k) => `@${k}`).concat([
    'CURRENT_TIMESTAMP()', 'CURRENT_TIMESTAMP()', 'CURRENT_TIMESTAMP()', 'CURRENT_TIMESTAMP()',
  ]);

  await bq.executeWrite(
    `INSERT INTO ${companiesTable()} (${columns.join(', ')}) VALUES (${values.join(', ')})`,
    insertParams,
  );
  logger.info('Inserted new company', { company_id, name: input.name });

  return (await getCompanyById(company_id))!;
}

async function findCompanyByNormalized(normalized: string): Promise<Company | null> {
  if (!normalized) return null;
  const bq = getBqClient();
  const result = await bq.executeQuery(
    `SELECT * FROM ${companiesTable()} WHERE name_normalized = @n LIMIT 1`,
    { n: normalized },
  );
  if (result.rows.length === 0) return null;
  return rowToCompany(result.rows[0]);
}

/**
 * Find a company by name. First tries an exact match on the normalized
 * form; if that misses, falls back to fuzzy matching over a candidate
 * window (recent 500 rows by updated_at). Returns null if nothing
 * scores above 0.5.
 */
export async function findCompanyByName(name: string): Promise<Company | null> {
  if (!name || !name.trim()) return null;
  const normalized = normalizeCompanyName(name);

  const exact = await findCompanyByNormalized(normalized);
  if (exact) return exact;

  // Fuzzy fallback. Same pattern as searchDeal in deal-ops.ts.
  if (normalized.length < 3) return null;
  const bq = getBqClient();
  const candidates = await bq.executeQuery(
    `SELECT * FROM ${companiesTable()} WHERE name IS NOT NULL ORDER BY updated_at DESC LIMIT 500`,
  );
  let best: { row: Record<string, unknown>; score: number } | null = null;
  for (const row of candidates.rows) {
    const candidateName = (row.name as string) ?? '';
    if (!candidateName) continue;
    const score = fuzzyScore(name, candidateName);
    if (score > (best?.score ?? 0)) {
      best = { row, score };
    }
  }
  if (best && best.score >= 0.5) {
    logger.info('findCompanyByName fuzzy fallback hit', {
      input: name,
      matched: best.row.name,
      score: best.score,
    });
    return rowToCompany(best.row);
  }
  return null;
}

/** Direct lookup by company_id. */
export async function getCompanyById(id: string): Promise<Company | null> {
  if (!id) return null;
  const bq = getBqClient();
  const result = await bq.executeQuery(
    `SELECT * FROM ${companiesTable()} WHERE company_id = @id LIMIT 1`,
    { id },
  );
  if (result.rows.length === 0) return null;
  return rowToCompany(result.rows[0]);
}
