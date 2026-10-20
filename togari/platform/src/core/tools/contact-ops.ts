/**
 * Patch L — Contact CRUD + linkage helpers for the universal entity graph.
 *
 * INVARIANT (enforced in upsertContact): every contact row must link to
 * at least one of {company_id, deal_ids[], capture_ids[]}. BigQuery does
 * not enforce FKs, so the helpers throw on insert/upsert if the invariant
 * is violated. See src/core/tools/company-ops.ts for the full rule set.
 */

import crypto from 'crypto';
import { BigQueryClient } from '../../bigquery/client';
import { createLogger } from '../../observability/logger';
import { resolveDataset } from '../../services/dataset-resolver';
import { generateId } from '../identity/togari-ids';
import { normalizePersonName, fuzzyScore } from '../identity/normalize';
import type { Contact } from '../types';

const logger = createLogger('core/contact-ops');

const PROJECT_ID = 'midyear-glazing-485303-u3';

function contactsTable(): string {
  return `\`${PROJECT_ID}.${resolveDataset()}.togari_associated_contacts\``;
}

// Patch L.1 — togari_structured_contacts is the master 42k-row contact
// universe (linkedinUrl, fullName, workEmail, currentTitle, etc.).
// togari_associated_contacts (this module's table) is the curated
// "active relationships" subset linked to deals + captures. When an
// associated contact also exists in the master universe, we store the
// master's row_id in `structured_contact_id` so callers can pull the
// richer master columns on demand via getMasterRecordForContact.
function structuredContactsTable(): string {
  return `\`${PROJECT_ID}.${resolveDataset()}.togari_structured_contacts\``;
}

function getBqClient(): BigQueryClient {
  return new BigQueryClient(
    PROJECT_ID,
    null,
    process.env.GCP_CREDENTIALS_BASE64 || process.env.GOOGLE_CREDENTIALS_BASE64 || null,
  );
}

function splitName(fullName: string): { first?: string; last?: string } {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length === 0) return {};
  if (parts.length === 1) return { first: parts[0] };
  return { first: parts[0], last: parts.slice(1).join(' ') };
}

function rowToContact(row: Record<string, unknown>): Contact {
  const dealIds = row.deal_ids as unknown;
  const captureIds = row.capture_ids as unknown;
  const sources = row.sources as unknown;
  return {
    contact_id: (row.contact_id as string) || '',
    client_id: (row.client_id as string) || undefined,
    full_name: (row.full_name as string) || '',
    first_name: (row.first_name as string) || undefined,
    last_name: (row.last_name as string) || undefined,
    email: (row.email as string) || undefined,
    linkedin_url: (row.linkedin_url as string) || undefined,
    title: (row.title as string) || undefined,
    company_id: (row.company_id as string) || undefined,
    company_raw: (row.company_raw as string) || undefined,
    deal_ids: Array.isArray(dealIds) ? (dealIds as string[]) : undefined,
    capture_ids: Array.isArray(captureIds) ? (captureIds as string[]) : undefined,
    first_seen_at: (row.first_seen_at as string) || undefined,
    last_seen_at: (row.last_seen_at as string) || undefined,
    sources: Array.isArray(sources) ? (sources as string[]) : undefined,
    notes: (row.notes as string) || undefined,
    structured_contact_id: (row.structured_contact_id as string) || undefined,
    created_at: (row.created_at as string) || undefined,
    updated_at: (row.updated_at as string) || undefined,
  };
}

export interface ContactInput {
  /** If provided, target this row directly. Otherwise dedup by email or (name + company_id). */
  id?: string;
  full_name: string;
  email?: string;
  linkedin_url?: string;
  title?: string;
  company_id?: string;
  company_raw?: string;
  deal_ids?: string[];
  capture_ids?: string[];
  sources?: string[];
  notes?: string;
  client_id?: string;
  /**
   * FK to togari_structured_contacts.row_id. When omitted AND email is
   * present, upsertContact auto-resolves via findStructuredContactByEmail.
   * Callers with an out-of-band linkage (e.g. enrichment runs) can
   * supply it directly to skip the lookup.
   */
  structured_contact_id?: string;
}

function ensureLinkage(input: ContactInput): void {
  const hasCompany = !!input.company_id;
  const hasDeals = Array.isArray(input.deal_ids) && input.deal_ids.length > 0;
  const hasCaptures = Array.isArray(input.capture_ids) && input.capture_ids.length > 0;
  if (!hasCompany && !hasDeals && !hasCaptures) {
    throw new Error(
      'upsertContact: linkage invariant violated — contact must link to at least one of {company_id, deal_ids[], capture_ids[]}.',
    );
  }
}

/**
 * Look up a master-database contact (togari_structured_contacts) by work
 * email. Used by upsertContact to auto-link an associated contact back
 * to the canonical master record when one exists. Returns the master
 * row's `row_id`, or null when no email-match exists.
 */
async function findStructuredContactByEmail(email: string): Promise<string | null> {
  if (!email) return null;
  const bq = getBqClient();
  const result = await bq.executeQuery(
    `SELECT row_id FROM ${structuredContactsTable()} WHERE LOWER(workEmail) = LOWER(@email) LIMIT 1`,
    { email },
  );
  return (result.rows[0]?.row_id as string) ?? null;
}

async function findStructuredContactByNameAndCompany(
  firstName: string,
  lastName: string,
  company: string,
): Promise<string | null> {
  if (!firstName || !lastName || !company) return null;
  const bq = getBqClient();
  const result = await bq.executeQuery(
    `SELECT row_id FROM ${structuredContactsTable()}
     WHERE LOWER(firstName) = LOWER(@first)
       AND LOWER(lastName) = LOWER(@last)
       AND LOWER(currentCompany) = LOWER(@company)
     LIMIT 1`,
    { first: firstName, last: lastName, company },
  );
  return (result.rows[0]?.row_id as string) ?? null;
}

export interface StructuredContactInput {
  fullName: string;
  firstName?: string;
  lastName?: string;
  workEmail?: string;
  currentTitle?: string;
  currentCompany?: string;
  companyDomain?: string;
  linkedinUrl?: string;
  phone?: string;
  /**
   * Provenance tag for the master row. Backfill writes 'togari_deal_backfill';
   * the live createDeal path writes 'togari_create_deal'. Lets us trace which
   * code path minted a row without scanning git history.
   */
  pullId?: string;
}

/**
 * Patch L.2 — upsert into togari_structured_contacts (the master DB).
 *
 * Dedup priority:
 *   1. workEmail (case-insensitive)
 *   2. (firstName + lastName + currentCompany) — all three required
 * Else INSERT a new row keyed on a UUID `row_id`.
 *
 * On the UPDATE path, only non-null incoming fields overwrite — preserves
 * enrichment we don't have a fresher signal for. Returns the row_id either
 * way so callers can FK an associated_contacts row at it.
 */
export async function upsertStructuredContact(input: StructuredContactInput): Promise<string> {
  if (!input.fullName || !input.fullName.trim()) {
    throw new Error('upsertStructuredContact: fullName is required');
  }
  const bq = getBqClient();

  // Derive first/last from fullName when caller didn't provide them — the
  // name-and-company dedup path and the inserted row both need them.
  let firstName = input.firstName;
  let lastName = input.lastName;
  if (!firstName || !lastName) {
    const split = splitName(input.fullName);
    firstName = firstName ?? split.first;
    lastName = lastName ?? split.last;
  }

  let existingRowId: string | null = null;
  if (input.workEmail) {
    existingRowId = await findStructuredContactByEmail(input.workEmail);
  }
  if (!existingRowId && firstName && lastName && input.currentCompany) {
    existingRowId = await findStructuredContactByNameAndCompany(
      firstName,
      lastName,
      input.currentCompany,
    );
  }

  if (existingRowId) {
    // Build SET clauses only for non-null/non-empty incoming fields. The
    // master table's column names are camelCase (linkedinUrl, workEmail,
    // currentTitle, ...) — that's the schema as it exists, not a style
    // choice for this module.
    const setClauses: string[] = [];
    const params: Record<string, unknown> = { row_id: existingRowId };

    const maybeSet = (column: string, value: string | undefined) => {
      if (value === undefined || value === null || value === '') return;
      setClauses.push(`${column} = @${column}`);
      params[column] = value;
    };
    maybeSet('fullName', input.fullName);
    maybeSet('firstName', firstName);
    maybeSet('lastName', lastName);
    maybeSet('workEmail', input.workEmail);
    maybeSet('currentTitle', input.currentTitle);
    maybeSet('currentCompany', input.currentCompany);
    maybeSet('companyDomain', input.companyDomain);
    maybeSet('linkedinUrl', input.linkedinUrl);
    maybeSet('phone', input.phone);

    if (setClauses.length > 0) {
      await bq.executeWrite(
        `UPDATE ${structuredContactsTable()} SET ${setClauses.join(', ')} WHERE row_id = @row_id`,
        params,
      );
      logger.info('Updated existing structured contact', { row_id: existingRowId });
    }
    return existingRowId;
  }

  // Insert. row_id is a UUID (the master table's PK is STRING; existing
  // rows use a mix of UUID + numeric ids, so a fresh UUID is safe).
  const rowId = crypto.randomUUID();
  const insertParams: Record<string, unknown> = {
    row_id: rowId,
    fullName: input.fullName,
  };
  if (firstName) insertParams.firstName = firstName;
  if (lastName) insertParams.lastName = lastName;
  if (input.workEmail) insertParams.workEmail = input.workEmail;
  if (input.currentTitle) insertParams.currentTitle = input.currentTitle;
  if (input.currentCompany) insertParams.currentCompany = input.currentCompany;
  if (input.companyDomain) insertParams.companyDomain = input.companyDomain;
  if (input.linkedinUrl) insertParams.linkedinUrl = input.linkedinUrl;
  if (input.phone) insertParams.phone = input.phone;
  if (input.pullId) insertParams.pull_id = input.pullId;

  const columns = Object.keys(insertParams).concat(['createdAt']);
  const values = Object.keys(insertParams).map((k) => `@${k}`).concat(['CURRENT_TIMESTAMP()']);

  await bq.executeWrite(
    `INSERT INTO ${structuredContactsTable()} (${columns.join(', ')}) VALUES (${values.join(', ')})`,
    insertParams,
  );
  logger.info('Inserted new structured contact', {
    row_id: rowId,
    fullName: input.fullName,
    workEmail: input.workEmail,
    pull_id: input.pullId,
  });
  return rowId;
}

async function findContactByEmail(email: string): Promise<Contact | null> {
  if (!email) return null;
  const bq = getBqClient();
  const result = await bq.executeQuery(
    `SELECT * FROM ${contactsTable()} WHERE LOWER(email) = LOWER(@email) LIMIT 1`,
    { email },
  );
  if (result.rows.length === 0) return null;
  return rowToContact(result.rows[0]);
}

async function findContactByNameAndCompany(
  fullName: string,
  companyId: string,
): Promise<Contact | null> {
  if (!fullName || !companyId) return null;
  const normalized = normalizePersonName(fullName);
  const bq = getBqClient();
  // Cheap exact-on-trimmed-lowercase first; fuzzy is handled by the
  // higher-level findContactByName entry point.
  const result = await bq.executeQuery(
    `SELECT * FROM ${contactsTable()}
     WHERE company_id = @companyId
       AND LOWER(TRIM(full_name)) = @normalized
     LIMIT 1`,
    { companyId, normalized },
  );
  if (result.rows.length === 0) return null;
  return rowToContact(result.rows[0]);
}

/**
 * Upsert a contact. Dedup priority:
 *   1. by email (case-insensitive)
 *   2. by (normalized full_name + company_id)
 *   3. by explicit input.id
 * Else inserts a new row with a UUID-based ID (tct_<uuid>).
 *
 * Throws if the linkage invariant is violated.
 */
export async function upsertContact(input: ContactInput): Promise<Contact> {
  if (!input.full_name || !input.full_name.trim()) {
    throw new Error('upsertContact: full_name is required');
  }
  ensureLinkage(input);
  const bq = getBqClient();

  // Find existing.
  let existing: Contact | null = null;
  if (input.id) {
    existing = await getContactById(input.id);
  }
  if (!existing && input.email) {
    existing = await findContactByEmail(input.email);
  }
  if (!existing && input.company_id) {
    existing = await findContactByNameAndCompany(input.full_name, input.company_id);
  }

  // Patch L.1 — auto-link to the master contact universe when we have an
  // email and the caller didn't pre-supply a structured_contact_id. Done
  // once up front so both the existing-row UPDATE and the new-row INSERT
  // pick up the value.
  let structuredContactId = input.structured_contact_id;
  if (!structuredContactId && input.email) {
    const found = await findStructuredContactByEmail(input.email);
    if (found) {
      structuredContactId = found;
      logger.info('Associated contact auto-linked to master', {
        email: input.email,
        structured_contact_id: structuredContactId,
      });
    }
  }

  // Patch L.2 — if we still don't have a master link AND we have enough
  // to identify a person (fullName + email OR company), mint a master
  // row. Wrapped in try/catch because failing to create the master row
  // shouldn't poison the associated-contacts write — the FK can stay
  // NULL and the next upsert will retry.
  if (!structuredContactId && input.full_name && (input.email || input.company_raw)) {
    try {
      structuredContactId = await upsertStructuredContact({
        fullName: input.full_name,
        workEmail: input.email,
        currentCompany: input.company_raw,
        currentTitle: input.title,
        linkedinUrl: input.linkedin_url,
        pullId: 'togari_upsert_contact',
      });
      logger.info('Associated contact materialized in master', {
        email: input.email,
        structured_contact_id: structuredContactId,
      });
    } catch (err) {
      logger.warn('upsertContact: structured-contact mint failed; proceeding without FK', {
        full_name: input.full_name,
        email: input.email,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (existing) {
    const { first, last } = splitName(input.full_name);
    const setClauses = ['updated_at = CURRENT_TIMESTAMP()', 'last_seen_at = CURRENT_TIMESTAMP()'];
    const params: Record<string, unknown> = { id: existing.contact_id };

    // Only overwrite when input provides a value — preserves existing
    // attributes we don't have a fresher signal for.
    if (input.full_name && input.full_name !== existing.full_name) {
      setClauses.push('full_name = @full_name');
      params.full_name = input.full_name;
      if (first) { setClauses.push('first_name = @first_name'); params.first_name = first; }
      if (last) { setClauses.push('last_name = @last_name'); params.last_name = last; }
    }
    if (input.email !== undefined && input.email !== existing.email) {
      setClauses.push('email = @email');
      params.email = input.email;
    }
    if (input.linkedin_url !== undefined) { setClauses.push('linkedin_url = @linkedin_url'); params.linkedin_url = input.linkedin_url; }
    if (input.title !== undefined) { setClauses.push('title = @title'); params.title = input.title; }
    if (input.company_id !== undefined && input.company_id !== existing.company_id) {
      setClauses.push('company_id = @company_id');
      params.company_id = input.company_id;
    }
    if (input.company_raw !== undefined) { setClauses.push('company_raw = @company_raw'); params.company_raw = input.company_raw; }
    if (input.client_id !== undefined) { setClauses.push('client_id = @client_id'); params.client_id = input.client_id; }
    // Only write structured_contact_id when we have a value AND the row
    // doesn't already have one — preserves a manually-set link if a
    // later upsert pass picks a different email match.
    if (structuredContactId && structuredContactId !== existing.structured_contact_id) {
      setClauses.push('structured_contact_id = @structured_contact_id');
      params.structured_contact_id = structuredContactId;
    }

    // Array unions — append-if-not-present semantics via ARRAY_CONCAT_AGG
    // would be expensive; do the merge in app code for simplicity.
    const mergeArrays = (key: 'deal_ids' | 'capture_ids' | 'sources', incoming: string[] | undefined) => {
      if (!incoming || incoming.length === 0) return;
      const merged = Array.from(new Set([...(existing![key] ?? []), ...incoming]));
      setClauses.push(`${key} = @${key}`);
      params[key] = merged;
    };
    mergeArrays('deal_ids', input.deal_ids);
    mergeArrays('capture_ids', input.capture_ids);
    mergeArrays('sources', input.sources);

    await bq.executeWrite(
      `UPDATE ${contactsTable()} SET ${setClauses.join(', ')} WHERE contact_id = @id`,
      params,
    );
    logger.info('Updated existing contact', { contact_id: existing.contact_id });
    return (await getContactById(existing.contact_id))!;
  }

  // Insert.
  const contact_id = input.id ?? generateId('contact');
  const { first, last } = splitName(input.full_name);
  const insertParams: Record<string, unknown> = {
    contact_id,
    full_name: input.full_name,
  };
  if (first) insertParams.first_name = first;
  if (last) insertParams.last_name = last;
  if (input.email !== undefined) insertParams.email = input.email;
  if (input.linkedin_url !== undefined) insertParams.linkedin_url = input.linkedin_url;
  if (input.title !== undefined) insertParams.title = input.title;
  if (input.company_id !== undefined) insertParams.company_id = input.company_id;
  if (input.company_raw !== undefined) insertParams.company_raw = input.company_raw;
  if (input.client_id !== undefined) insertParams.client_id = input.client_id;
  if (input.deal_ids && input.deal_ids.length > 0) insertParams.deal_ids = input.deal_ids;
  if (input.capture_ids && input.capture_ids.length > 0) insertParams.capture_ids = input.capture_ids;
  if (input.sources && input.sources.length > 0) insertParams.sources = input.sources;
  if (input.notes !== undefined) insertParams.notes = input.notes;
  if (structuredContactId) insertParams.structured_contact_id = structuredContactId;

  const columns = Object.keys(insertParams).concat(['first_seen_at', 'last_seen_at', 'created_at', 'updated_at']);
  const values = Object.keys(insertParams).map((k) => `@${k}`).concat([
    'CURRENT_TIMESTAMP()', 'CURRENT_TIMESTAMP()', 'CURRENT_TIMESTAMP()', 'CURRENT_TIMESTAMP()',
  ]);

  await bq.executeWrite(
    `INSERT INTO ${contactsTable()} (${columns.join(', ')}) VALUES (${values.join(', ')})`,
    insertParams,
  );
  logger.info('Inserted new contact', { contact_id, full_name: input.full_name });

  return (await getContactById(contact_id))!;
}

/**
 * Find a contact by name. If companyId is supplied, scope the search to
 * that company; otherwise search globally. Exact-match on normalized
 * full_name first, then fuzzy fallback over a candidate window.
 */
export async function findContactByName(
  name: string,
  companyId?: string,
): Promise<Contact | null> {
  if (!name || !name.trim()) return null;
  const normalized = normalizePersonName(name);
  if (!normalized) return null;

  const bq = getBqClient();
  if (companyId) {
    const direct = await findContactByNameAndCompany(name, companyId);
    if (direct) return direct;
  }

  // Fuzzy fallback. Limit candidate window to most-recently-touched rows.
  const where = companyId ? 'WHERE company_id = @companyId' : '';
  const result = await bq.executeQuery(
    `SELECT * FROM ${contactsTable()} ${where} ORDER BY updated_at DESC LIMIT 500`,
    companyId ? { companyId } : {},
  );
  let best: { row: Record<string, unknown>; score: number } | null = null;
  for (const row of result.rows) {
    const candidate = (row.full_name as string) ?? '';
    if (!candidate) continue;
    const score = fuzzyScore(name, candidate, { normalizer: normalizePersonName });
    if (score > (best?.score ?? 0)) {
      best = { row, score };
    }
  }
  if (best && best.score >= 0.5) {
    logger.info('findContactByName fuzzy fallback hit', {
      input: name,
      matched: best.row.full_name,
      score: best.score,
    });
    return rowToContact(best.row);
  }
  return null;
}

export async function getContactById(id: string): Promise<Contact | null> {
  if (!id) return null;
  const bq = getBqClient();
  const result = await bq.executeQuery(
    `SELECT * FROM ${contactsTable()} WHERE contact_id = @id LIMIT 1`,
    { id },
  );
  if (result.rows.length === 0) return null;
  return rowToContact(result.rows[0]);
}

/** Append dealId to contact.deal_ids (idempotent). Touches updated_at. */
export async function linkContactToDeal(contactId: string, dealId: string): Promise<void> {
  const existing = await getContactById(contactId);
  if (!existing) {
    logger.warn('linkContactToDeal: contact not found', { contactId, dealId });
    return;
  }
  const current = existing.deal_ids ?? [];
  if (current.includes(dealId)) return;
  const next = [...current, dealId];
  const bq = getBqClient();
  await bq.executeWrite(
    `UPDATE ${contactsTable()} SET deal_ids = @next, updated_at = CURRENT_TIMESTAMP() WHERE contact_id = @id`,
    { next, id: contactId },
  );
  logger.info('Linked contact to deal', { contactId, dealId });
}

/** Append captureId to contact.capture_ids (idempotent). */
export async function linkContactToCapture(contactId: string, captureId: string): Promise<void> {
  const existing = await getContactById(contactId);
  if (!existing) {
    logger.warn('linkContactToCapture: contact not found', { contactId, captureId });
    return;
  }
  const current = existing.capture_ids ?? [];
  if (current.includes(captureId)) return;
  const next = [...current, captureId];
  const bq = getBqClient();
  await bq.executeWrite(
    `UPDATE ${contactsTable()} SET capture_ids = @next, updated_at = CURRENT_TIMESTAMP() WHERE contact_id = @id`,
    { next, id: contactId },
  );
  logger.info('Linked contact to capture', { contactId, captureId });
}

/** Every contact tied to a given company, sorted by recency. */
export async function searchContactsByCompany(companyId: string): Promise<Contact[]> {
  if (!companyId) return [];
  const bq = getBqClient();
  const result = await bq.executeQuery(
    `SELECT * FROM ${contactsTable()} WHERE company_id = @companyId ORDER BY updated_at DESC LIMIT 200`,
    { companyId },
  );
  return result.rows.map(rowToContact);
}

/**
 * Resolve an associated contact to the master record's details. Returns
 * null if no link is set. Use when you need the master-DB columns
 * (linkedinUrl, phone, currentTitle, etc.) on an associated contact.
 *
 * The associated-contacts table holds the curated linkage (deals,
 * captures, ownership history); the master togari_structured_contacts
 * table holds the richer enrichment columns. Callers that need both
 * tiers run getContactById + this helper as a pair.
 */
export async function getMasterRecordForContact(contactId: string): Promise<Record<string, unknown> | null> {
  const contact = await getContactById(contactId);
  if (!contact?.structured_contact_id) return null;
  const bq = getBqClient();
  const result = await bq.executeQuery(
    `SELECT * FROM ${structuredContactsTable()} WHERE row_id = @id LIMIT 1`,
    { id: contact.structured_contact_id },
  );
  return result.rows[0] ?? null;
}
