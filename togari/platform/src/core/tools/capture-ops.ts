/**
 * Patch L — Capture CRUD + promotion helper for the universal entity graph.
 *
 * Captures are pre-deal signals (Fireflies transcripts, Gmail threads,
 * Exa enrichment, manual paste). They sit "below" deals: a capture may
 * exist without a deal for weeks before someone promotes it.
 *
 * INVARIANT (enforced in insertCapture): every capture row must link to
 * at least one of {company_id, contact_ids[], deal_id}. BigQuery does
 * not enforce FKs, so the helpers throw if the invariant is violated.
 * See src/core/tools/company-ops.ts for the full rule set.
 */

import { BigQueryClient } from '../../bigquery/client';
import { createLogger } from '../../observability/logger';
import { resolveDataset } from '../../services/dataset-resolver';
import { generateId } from '../identity/togari-ids';
import { findCompanyByName } from './company-ops';
import type { Capture } from '../types';
import type { ClientBrand } from '../config/brand-pipelines';

const logger = createLogger('core/capture-ops');

const PROJECT_ID = 'midyear-glazing-485303-u3';

function capturesTable(): string {
  return `\`${PROJECT_ID}.${resolveDataset()}.togari_captures\``;
}

function getBqClient(): BigQueryClient {
  return new BigQueryClient(
    PROJECT_ID,
    null,
    process.env.GCP_CREDENTIALS_BASE64 || process.env.GOOGLE_CREDENTIALS_BASE64 || null,
  );
}

function rowToCapture(row: Record<string, unknown>): Capture {
  const contactIds = row.contact_ids as unknown;
  const attendees = row.attendees as unknown;
  const internalAttendees = row.internal_attendees as unknown;
  const metadataRaw = row.metadata as unknown;
  let metadata: Record<string, unknown> | undefined;
  if (typeof metadataRaw === 'string') {
    try { metadata = JSON.parse(metadataRaw); } catch { metadata = undefined; }
  } else if (metadataRaw && typeof metadataRaw === 'object') {
    metadata = metadataRaw as Record<string, unknown>;
  }
  return {
    capture_id: (row.capture_id as string) || '',
    client_id: (row.client_id as string) || undefined,
    source: (row.source as string) || '',
    source_id: (row.source_id as string) || undefined,
    captured_at: (row.captured_at as string) || '',
    ingested_at: (row.ingested_at as string) || '',
    company_id: (row.company_id as string) || undefined,
    company_raw: (row.company_raw as string) || undefined,
    contact_ids: Array.isArray(contactIds) ? (contactIds as string[]) : undefined,
    deal_id: (row.deal_id as string) || undefined,
    attendees: Array.isArray(attendees) ? (attendees as string[]) : undefined,
    internal_attendees: Array.isArray(internalAttendees) ? (internalAttendees as string[]) : undefined,
    title: (row.title as string) || undefined,
    raw_blob: (row.raw_blob as string) || undefined,
    metadata,
    promoted_to_deal_id: (row.promoted_to_deal_id as string) || undefined,
    client_brand: (row.client_brand as ClientBrand) || undefined,
    created_at: (row.created_at as string) || undefined,
    updated_at: (row.updated_at as string) || undefined,
  };
}

export interface CaptureInput {
  source: string;
  source_id?: string;
  captured_at: Date | string;
  company_id?: string;
  company_raw?: string;
  contact_ids?: string[];
  deal_id?: string;
  attendees?: string[];
  internal_attendees?: string[];
  title?: string;
  raw_blob?: string;
  metadata?: Record<string, unknown>;
  client_brand?: ClientBrand;
  client_id?: string;
}

function ensureLinkage(input: CaptureInput): void {
  const hasCompany = !!input.company_id;
  const hasContacts = Array.isArray(input.contact_ids) && input.contact_ids.length > 0;
  const hasDeal = !!input.deal_id;
  if (!hasCompany && !hasContacts && !hasDeal) {
    throw new Error(
      'insertCapture: linkage invariant violated — capture must link to at least one of {company_id, contact_ids[], deal_id}.',
    );
  }
}

function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

/**
 * Insert a new capture row. Idempotency is the CALLER's responsibility —
 * use findBySource(source, source_id) first if the upstream system has
 * an ID. This helper does no dedup.
 *
 * Throws on invariant violation.
 */
export async function insertCapture(input: CaptureInput): Promise<Capture> {
  if (!input.source || !input.source.trim()) {
    throw new Error('insertCapture: source is required');
  }
  if (!input.captured_at) {
    throw new Error('insertCapture: captured_at is required');
  }
  ensureLinkage(input);
  const bq = getBqClient();

  const capture_id = generateId('capture');
  const captured_at = toIsoString(input.captured_at);

  const insertParams: Record<string, unknown> = {
    capture_id,
    source: input.source,
    captured_at,
  };
  if (input.source_id !== undefined) insertParams.source_id = input.source_id;
  if (input.company_id !== undefined) insertParams.company_id = input.company_id;
  if (input.company_raw !== undefined) insertParams.company_raw = input.company_raw;
  if (input.contact_ids && input.contact_ids.length > 0) insertParams.contact_ids = input.contact_ids;
  if (input.deal_id !== undefined) insertParams.deal_id = input.deal_id;
  if (input.attendees && input.attendees.length > 0) insertParams.attendees = input.attendees;
  if (input.internal_attendees && input.internal_attendees.length > 0) insertParams.internal_attendees = input.internal_attendees;
  if (input.title !== undefined) insertParams.title = input.title;
  if (input.raw_blob !== undefined) insertParams.raw_blob = input.raw_blob;
  if (input.client_brand !== undefined) insertParams.client_brand = input.client_brand;
  if (input.client_id !== undefined) insertParams.client_id = input.client_id;

  // JSON column needs the serialized payload as a literal — BQ
  // parameter binding for JSON columns is finicky. We embed via
  // PARSE_JSON(@metadata_json) so the planner treats it as JSON.
  const columns = Object.keys(insertParams).concat(
    input.metadata !== undefined ? ['metadata'] : [],
  ).concat(['ingested_at', 'created_at', 'updated_at']);
  const values = Object.keys(insertParams).map((k) => `@${k}`).concat(
    input.metadata !== undefined ? ['PARSE_JSON(@metadata_json)'] : [],
  ).concat(['CURRENT_TIMESTAMP()', 'CURRENT_TIMESTAMP()', 'CURRENT_TIMESTAMP()']);

  const finalParams: Record<string, unknown> = { ...insertParams };
  if (input.metadata !== undefined) {
    finalParams.metadata_json = JSON.stringify(input.metadata);
  }

  await bq.executeWrite(
    `INSERT INTO ${capturesTable()} (${columns.join(', ')}) VALUES (${values.join(', ')})`,
    finalParams,
  );
  logger.info('Inserted capture', { capture_id, source: input.source, source_id: input.source_id });

  return (await getCaptureById(capture_id))!;
}

export async function getCaptureById(id: string): Promise<Capture | null> {
  if (!id) return null;
  const bq = getBqClient();
  const result = await bq.executeQuery(
    `SELECT * FROM ${capturesTable()} WHERE capture_id = @id LIMIT 1`,
    { id },
  );
  if (result.rows.length === 0) return null;
  return rowToCapture(result.rows[0]);
}

/**
 * Look up by (source, source_id). Used for idempotency in the Fireflies
 * webhook handler and the backfill script.
 */
export async function findBySource(source: string, sourceId: string): Promise<Capture | null> {
  if (!source || !sourceId) return null;
  const bq = getBqClient();
  const result = await bq.executeQuery(
    `SELECT * FROM ${capturesTable()} WHERE source = @source AND source_id = @sourceId LIMIT 1`,
    { source, sourceId },
  );
  if (result.rows.length === 0) return null;
  return rowToCapture(result.rows[0]);
}

export async function searchCapturesByCompany(
  companyId: string,
  limit: number = 50,
): Promise<Capture[]> {
  if (!companyId) return [];
  const bq = getBqClient();
  const result = await bq.executeQuery(
    `SELECT * FROM ${capturesTable()} WHERE company_id = @companyId ORDER BY captured_at DESC LIMIT @limit`,
    { companyId, limit },
  );
  return result.rows.map(rowToCapture);
}

/** Resolve a company name → company_id, then query captures. */
export async function searchCapturesByCompanyName(
  name: string,
  limit: number = 50,
): Promise<Capture[]> {
  const company = await findCompanyByName(name);
  if (!company) return [];
  return searchCapturesByCompany(company.company_id, limit);
}

export async function getCapturesForDeal(dealId: string): Promise<Capture[]> {
  if (!dealId) return [];
  const bq = getBqClient();
  const result = await bq.executeQuery(
    `SELECT * FROM ${capturesTable()} WHERE deal_id = @dealId OR promoted_to_deal_id = @dealId ORDER BY captured_at DESC LIMIT 100`,
    { dealId },
  );
  return result.rows.map(rowToCapture);
}

/**
 * Mark a capture as promoted to a deal. Sets promoted_to_deal_id and
 * also sets deal_id (so future queries by deal find the capture).
 */
export async function markCapturePromoted(captureId: string, dealId: string): Promise<void> {
  if (!captureId || !dealId) return;
  const bq = getBqClient();
  await bq.executeWrite(
    `UPDATE ${capturesTable()}
     SET promoted_to_deal_id = @dealId, deal_id = @dealId, updated_at = CURRENT_TIMESTAMP()
     WHERE capture_id = @captureId`,
    { captureId, dealId },
  );
  logger.info('Marked capture as promoted', { captureId, dealId });
}
