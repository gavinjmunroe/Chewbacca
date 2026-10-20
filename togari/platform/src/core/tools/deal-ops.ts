/**
 * @togari/core — Transport-agnostic deal operations
 *
 * BigQuery deal CRUD, activity logging, and natural language queries.
 * Extracted from slack-sync/deal-sync.ts and query-handler.ts.
 */

import crypto from 'crypto';
import { SONNET } from '../../config/models';
import { BigQueryClient } from '../../bigquery/client';
import { SqlGenerator } from '../../bigquery/sql-generator';
import { createLogger } from '../../observability/logger';
import { resolveDataset } from '../../services/dataset-resolver';
import { buildDateContext } from '../identity/date-context';
import { resolveReminderOwner } from '../identity/mention-resolver';
import {
  normalizeCompanyName,
  fuzzyScore,
} from '../identity/normalize';
import {
  ALL_BRANDS,
  ALL_PIPELINES,
  BRAND_PIPELINES,
  DEFAULT_BRAND,
  isValidBrand,
  isValidBrandPipelineCombo,
  normalizePipeline,
  type ClientBrand,
  type Pipeline,
} from '../config/brand-pipelines';
import {
  VALID_STAGES,
  normalizeStage,
} from '../config/stage-aliases';
import { isValidEntityId } from '../identity/togari-ids';
import { findCompanyByName, upsertCompany } from './company-ops';
import { upsertContact, upsertStructuredContact } from './contact-ops';
import type { Deal } from '../types';

const logger = createLogger('core/deal-ops');

const PROJECT_ID = 'midyear-glazing-485303-u3';

function dealsTable(): string {
  return `\`${PROJECT_ID}.${resolveDataset()}.togari_structured_deals\``;
}

function activitiesTable(): string {
  return `\`${PROJECT_ID}.${resolveDataset()}.activities\``;
}

function getBqClient(): BigQueryClient {
  return new BigQueryClient(
    PROJECT_ID,
    null,
    process.env.GCP_CREDENTIALS_BASE64 || process.env.GOOGLE_CREDENTIALS_BASE64 || null,
  );
}

function toSnakeCase(str: string): string {
  return str.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
}

function getDateStamp(): string {
  const now = new Date();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const yyyy = now.getFullYear();
  return `${mm}${dd}${yyyy}`;
}

function splitName(fullName: string | null): { first: string | null; last: string | null } {
  if (!fullName) return { first: null, last: null };
  const parts = fullName.trim().split(/\s+/);
  if (parts.length === 1) return { first: parts[0], last: null };
  return { first: parts[0], last: parts.slice(1).join(' ') };
}

/**
 * Slack user-id shape: starts with U, all uppercase alphanumerics.
 * The owner column should store these — never raw names — so analytics
 * joins on owner work and so reminders can route through `chat.scheduleMessage`.
 */
const SLACK_USER_ID_RE = /^U[A-Z0-9]+$/;
export function isSlackUserId(value: string | undefined | null): boolean {
  return !!value && SLACK_USER_ID_RE.test(value);
}

// ── Search ───────────────────────────────────────────────────────

export async function searchDeal(
  company?: string,
  contactName?: string,
): Promise<Deal | null> {
  const bq = getBqClient();

  // Search by company name first (case-insensitive, flexible LIKE match).
  // Zero rows → fall through to the contact-name attempt. BQ / tenant
  // errors propagate to the caller so the Slack transport can surface
  // them honestly instead of pretending "deal not found".
  if (company) {
    const result = await bq.executeQuery(
      `SELECT * FROM ${dealsTable()} WHERE LOWER(company) LIKE LOWER(@companyPattern) ORDER BY updated_at DESC LIMIT 1`,
      { companyPattern: `%${company}%` },
    );
    if (result.rows.length > 0) {
      logger.info('Found existing deal by company name', { company });
      return rowToDeal(result.rows[0]);
    }
  }

  // Fall back to searching by contact name.
  if (contactName) {
    const result = await bq.executeQuery(
      `SELECT * FROM ${dealsTable()} WHERE LOWER(contact_full_name) LIKE LOWER(@namePattern) ORDER BY updated_at DESC LIMIT 1`,
      { namePattern: `%${contactName}%` },
    );
    if (result.rows.length > 0) {
      logger.info('Found existing deal by contact name', { contactName });
      return rowToDeal(result.rows[0]);
    }
  }

  // K — Levenshtein fallback. The LIKE-pass above catches case +
  // substring differences but misses corporate-suffix mismatches
  // ("Scientist.com" vs "scientist") and small typos ("Tiderock" vs
  // "TideRock"). When the user gave us a company string of at least 3
  // normalized chars, pull a 500-row candidate set (recent rows; the
  // table is small enough that this is fine) and rank by fuzzyScore.
  // Threshold 0.5 is generous; tighten if false positives appear in
  // the audit log line.
  if (company) {
    const normalizedQuery = normalizeCompanyName(company);
    if (normalizedQuery.length >= 3) {
      const candidates = await bq.executeQuery(
        `SELECT * FROM ${dealsTable()} WHERE company IS NOT NULL ORDER BY updated_at DESC LIMIT 500`,
      );
      let best: { row: Record<string, unknown>; score: number } | null = null;
      for (const row of candidates.rows) {
        const candidateCompany = (row.company as string) ?? '';
        if (!candidateCompany) continue;
        const score = fuzzyScore(company, candidateCompany);
        if (score > (best?.score ?? 0)) {
          best = { row, score };
        }
      }
      if (best && best.score >= 0.5) {
        logger.info('searchDeal fuzzy fallback hit', {
          input: company,
          matched: best.row.company,
          score: best.score,
        });
        return rowToDeal(best.row);
      }
    }
  }

  return null;
}

function rowToDeal(row: Record<string, unknown>): Deal {
  const rawBrand = row.client_brand as string | null | undefined;
  return {
    deal_id: (row.deal_id as string) || '',
    deal_name: (row.deal_name as string) || (row.company as string) || '',
    company: (row.company as string) || '',
    // Patch L — FK to togari_companies. NULL on legacy rows until the
    // backfill script runs.
    company_id: (row.company_id as string) || undefined,
    contact_full_name: (row.contact_full_name as string) || '',
    contact_email: (row.contact_email as string) || undefined,
    value: (row.value as number) || 0,
    stage: (row.stage as string) || 'researching',
    pipeline: (row.pipeline as string) || 'outbound',
    // Read client_brand defensively — pre-migration rows have NULL here
    // and we don't want isValidBrand to throw at the type boundary.
    client_brand: isValidBrand(rawBrand) ? rawBrand : undefined,
    owner: (row.owner as string) || '',
    close_date: (row.close_date as string) || undefined,
    notes: (row.notes as string) || undefined,
    next_action: (row.next_action as string) || undefined,
    promoted_from_capture_id: (row.promoted_from_capture_id as string) || undefined,
    created_at: (row.created_at as string) || '',
    updated_at: (row.updated_at as string) || '',
  };
}

// ── Create ───────────────────────────────────────────────────────

/**
 * Standardize a free-form owner string onto a Slack user ID.
 *
 * Priority:
 *   1. owner is already a Slack ID  → return as-is
 *   2. owner is a name              → resolve via mention-resolver
 *   3. resolution fails or owner empty → fall back to senderSlackUserId
 *   4. senderSlackUserId not a Slack ID → write 'UNKNOWN_OWNER' as a marker
 *      (we deliberately do NOT write raw names like 'mcp_user' / 'togari' —
 *       the column standardizes on Slack IDs for analytics + reminders).
 */
async function resolveOwnerToSlackId(
  owner: string | undefined,
  senderSlackUserId: string | undefined,
): Promise<string> {
  if (owner && isSlackUserId(owner)) {
    return owner;
  }
  if (owner && owner.trim().length > 0) {
    try {
      const sender = senderSlackUserId && isSlackUserId(senderSlackUserId)
        ? senderSlackUserId
        : 'UNKNOWN_OWNER';
      const resolution = await resolveReminderOwner({
        token: owner,
        senderSlackUserId: sender,
      });
      if (resolution.ownerSlackUserId && isSlackUserId(resolution.ownerSlackUserId)) {
        return resolution.ownerSlackUserId;
      }
      // G.4 — resolver returned `unresolved_name` (or some other miss).
      // createDeal historically falls back to the sender, which is the
      // right semantic ("I just created this deal so I own it"). We log
      // so the miss is greppable: future iterations may prompt instead.
      if (resolution.status === 'unresolved_name') {
        logger.warn('createDeal owner name unresolved; falling through to sender', {
          owner,
          inputToken: resolution.inputToken,
        });
      }
    } catch (err) {
      logger.warn('Owner resolution threw; falling back to sender', {
        owner,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  if (senderSlackUserId && isSlackUserId(senderSlackUserId)) {
    return senderSlackUserId;
  }
  return 'UNKNOWN_OWNER';
}

export async function createDeal(params: {
  company: string;
  /**
   * Patch L — pre-resolved FK to togari_companies.company_id. When the
   * caller already knows the company_id (e.g. promote_capture flow,
   * Fireflies webhook path), pass it through to skip the lookup +
   * upsert dance. Otherwise we resolve `company` via findCompanyByName,
   * creating a new togari_companies row if no match.
   */
  companyId?: string;
  contactName?: string;
  contactEmail?: string;
  value?: number;
  stage?: string;
  pipeline?: string;
  /**
   * H — multi-brand axis. Defaults to 'bma' when omitted. Must match
   * BRAND_PIPELINES[clientBrand].includes(pipeline) — see validation
   * below; otherwise we throw rather than write an inconsistent row.
   */
  clientBrand?: ClientBrand;
  owner?: string;
  notes?: string;
  /**
   * Patch L — set when the deal was created from a togari_captures row.
   * Persisted on the deal so the lineage is greppable (and so the
   * promote_capture handler can update the source capture to point
   * back).
   */
  promotedFromCaptureId?: string;
  /**
   * Slack user id of the Slack/event sender, used as the owner fallback
   * when `owner` is missing or can't be resolved. Non-Slack transports
   * (MCP / HTTP) can omit this — the owner will fall through to the
   * 'UNKNOWN_OWNER' sentinel rather than a free-text name.
   */
  senderSlackUserId?: string;
}): Promise<{ deal: Deal; operation: 'created' }> {
  const bq = getBqClient();
  const companySnake = toSnakeCase(params.company);
  const dateStamp = getDateStamp();
  const dealId = `bma_deal_${companySnake}_${dateStamp}`;
  const clientId = `${companySnake}_${dateStamp}`;
  const { first, last } = splitName(params.contactName || null);
  const today = new Date().toISOString().split('T')[0];
  const noteEntry = params.notes ? `[${today}] ${params.notes}` : `[${today}] Deal created`;
  const resolvedOwner = await resolveOwnerToSlackId(params.owner, params.senderSlackUserId);

  // H — resolve and validate brand+pipeline combo BEFORE writing. We
  // refuse to insert a row where the brand doesn't authorize the
  // pipeline (today every brand allows every pipeline, but the schema
  // is set up so per-brand restrictions are a one-line config change).
  const brand: ClientBrand = isValidBrand(params.clientBrand)
    ? params.clientBrand
    : DEFAULT_BRAND;

  // H follow-up — normalize the pipeline string BEFORE validation so
  // legacy plurals ("partnerships") and colloquialisms ("partner") get
  // mapped to the canonical singular and stored consistently. Unknown
  // non-empty strings throw; empty/missing falls back to the default.
  let pipeline: Pipeline;
  if (params.pipeline && params.pipeline.trim() !== '') {
    const normalized = normalizePipeline(params.pipeline);
    if (!normalized) {
      throw new Error(
        `Unknown pipeline "${params.pipeline}". Valid: ${ALL_PIPELINES.join(', ')}.`,
      );
    }
    pipeline = normalized;
  } else {
    pipeline = 'outbound';
  }

  if (!isValidBrandPipelineCombo(brand, pipeline)) {
    throw new Error(
      `Brand "${brand}" does not have pipeline "${pipeline}". ` +
        `Valid pipelines for ${brand}: ${BRAND_PIPELINES[brand].join(', ')}.`,
    );
  }

  // K — normalize the stage string (canonical / colloquial / capitalized
  // → canonical enum) BEFORE writing. Unknown non-empty strings throw
  // with the list of valid values; empty / missing falls back to the
  // existing 'researching' default. This is the same pattern as the
  // pipeline normalizer just above.
  let stage: string;
  if (params.stage && params.stage.trim() !== '') {
    const normalizedStage = normalizeStage(params.stage);
    if (!normalizedStage) {
      throw new Error(
        `Unknown stage "${params.stage}". Valid: ${VALID_STAGES.join(', ')}.`,
      );
    }
    stage = normalizedStage;
  } else {
    stage = 'researching';
  }

  // Patch L — resolve company_id. Caller may pass a pre-validated id
  // (promote_capture / Fireflies path); otherwise we look the company
  // up by name and create one if no match exists. The new
  // togari_companies row is the source of truth — the free-text
  // `company` string on the deal row is kept for now (legacy callers
  // still read it) but FKs in via company_id.
  let resolvedCompanyId: string | undefined;
  if (params.companyId && isValidEntityId(params.companyId) && params.companyId.startsWith('tco_')) {
    resolvedCompanyId = params.companyId;
  } else {
    try {
      const found = await findCompanyByName(params.company);
      if (found) {
        resolvedCompanyId = found.company_id;
      } else {
        const created = await upsertCompany({ name: params.company });
        resolvedCompanyId = created.company_id;
      }
    } catch (err) {
      // Don't block deal creation on the entity-graph wiring failing —
      // the deal row's free-text `company` column is still authoritative
      // during the transition period. Log loudly so the gap is visible.
      logger.warn('createDeal: company_id resolution failed, inserting without FK', {
        company: params.company,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Build params, strip null/undefined — BigQuery can't handle untyped nulls
  const rawInsertParams: Record<string, unknown> = {
    deal_id: dealId,
    client_id: clientId,
    deal_name: params.company,
    company: params.company,
    company_id: resolvedCompanyId,
    contact_full_name: params.contactName || undefined,
    contact_first_name: first || undefined,
    contact_last_name: last || undefined,
    contact_email: params.contactEmail || undefined,
    value: params.value ?? 0,
    stage,
    pipeline,
    client_brand: brand,
    owner: resolvedOwner,
    deal_source: 'togari',
    next_action: 'Follow up',
    notes: noteEntry,
    promoted_from_capture_id: params.promotedFromCaptureId,
  };

  // Filter to non-null, non-undefined values
  const insertParams: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(rawInsertParams)) {
    if (v !== null && v !== undefined) {
      insertParams[k] = v;
    }
  }

  const columns = Object.keys(insertParams).concat(['created_at', 'updated_at']);
  const values = Object.keys(insertParams).map((k) => `@${k}`).concat(['CURRENT_TIMESTAMP()', 'CURRENT_TIMESTAMP()']);

  await bq.executeWrite(
    `INSERT INTO ${dealsTable()} (${columns.join(', ')}) VALUES (${values.join(', ')})`,
    insertParams,
  );

  // Log activity
  await logActivityInternal(bq, dealId, clientId, 'new_deal', noteEntry);

  // Patch L.2 — materialize the deal's contact into both tables so the
  // person becomes a first-class entity. Wrapped in try/catch because a
  // contact-write failure (e.g. structured table transient error) must
  // not roll back the deal — the row is already in togari_structured_deals
  // and the next upsert pass will repair the gap.
  if (params.contactName && params.contactName.trim() !== '') {
    try {
      const structuredId = await upsertStructuredContact({
        fullName: params.contactName,
        workEmail: params.contactEmail,
        currentCompany: params.company,
        pullId: 'togari_create_deal',
      });
      await upsertContact({
        full_name: params.contactName,
        email: params.contactEmail,
        company_id: resolvedCompanyId,
        company_raw: params.company,
        deal_ids: [dealId],
        sources: ['createDeal'],
        structured_contact_id: structuredId,
      });
      logger.info('createDeal: linked contact', {
        dealId,
        contactName: params.contactName,
        structured_contact_id: structuredId,
      });
    } catch (err) {
      logger.warn('createDeal: contact materialization failed; deal still created', {
        dealId,
        contactName: params.contactName,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  logger.info('Created deal', { dealId, company: params.company });

  const deal: Deal = {
    deal_id: dealId,
    deal_name: params.company,
    company: params.company,
    company_id: resolvedCompanyId,
    contact_full_name: params.contactName || '',
    contact_email: params.contactEmail,
    value: params.value ?? 0,
    stage,
    pipeline,
    client_brand: brand,
    owner: resolvedOwner,
    notes: noteEntry,
    next_action: 'Follow up',
    promoted_from_capture_id: params.promotedFromCaptureId,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  return { deal, operation: 'created' };
}

// ── Update ───────────────────────────────────────────────────────

export async function updateDeal(
  dealId: string,
  updates: Partial<Deal>,
): Promise<{ deal: Deal; operation: 'updated' }> {
  const bq = getBqClient();

  // Fetch current deal
  const currentResult = await bq.executeQuery(
    `SELECT * FROM ${dealsTable()} WHERE deal_id = @dealId LIMIT 1`,
    { dealId },
  );

  if (currentResult.rows.length === 0) {
    throw new Error(`Deal not found: ${dealId}`);
  }

  const existingRow = currentResult.rows[0];
  const setClauses: string[] = [];
  const params: Record<string, unknown> = { where_deal_id: dealId };

  // H — validate brand+pipeline combo BEFORE building setClauses.
  // Take the proposed value where present, fall back to the existing
  // row value otherwise. We only enforce when at least one of the two
  // is being changed; an update that touches neither column skips this.
  //
  // H follow-up — normalize both sides through normalizePipeline so a
  // brand-only update on a legacy "partnerships" row doesn't false-
  // reject. The normalized value is also what we store on an explicit
  // pipeline update below, so legacy rows get repaired on touch.
  let normalizedPipelineForUpdate: Pipeline | null = null;
  if (updates.client_brand !== undefined || updates.pipeline !== undefined) {
    const proposedBrand =
      updates.client_brand ?? (existingRow.client_brand as string | null) ?? DEFAULT_BRAND;
    const proposedPipelineRaw =
      updates.pipeline ?? (existingRow.pipeline as string | null) ?? 'inbound';
    const proposedPipeline = normalizePipeline(proposedPipelineRaw);
    if (!proposedPipeline) {
      throw new Error(
        `Unknown pipeline "${proposedPipelineRaw}". Valid: ${ALL_PIPELINES.join(', ')}.`,
      );
    }
    if (!isValidBrandPipelineCombo(proposedBrand, proposedPipeline)) {
      throw new Error(
        `Brand "${proposedBrand}" does not have pipeline "${proposedPipeline}". ` +
          `Valid pipelines for ${proposedBrand}: ${BRAND_PIPELINES[proposedBrand as ClientBrand]?.join(', ') ?? '(unknown brand)'}.`,
      );
    }
    // Remember the canonical form for the SET clause below — when the
    // caller passed "partnerships" we want to write "partnership".
    if (updates.pipeline !== undefined) {
      normalizedPipelineForUpdate = proposedPipeline;
    }
  }

  if (updates.client_brand) {
    if (!isValidBrand(updates.client_brand)) {
      throw new Error(
        `Invalid client_brand "${updates.client_brand}". Must be one of: ${ALL_BRANDS.join(', ')}.`,
      );
    }
    setClauses.push('client_brand = @client_brand');
    params.client_brand = updates.client_brand;
  }

  // K — normalize stage on update too. Stores the canonical form so a
  // legacy row that gets touched gets repaired in place. Unknown
  // non-empty strings throw; empty/missing skips the SET clause.
  let normalizedStageForUpdate: string | null = null;
  if (updates.stage && updates.stage.trim() !== '') {
    const normalized = normalizeStage(updates.stage);
    if (!normalized) {
      throw new Error(
        `Unknown stage "${updates.stage}". Valid: ${VALID_STAGES.join(', ')}.`,
      );
    }
    normalizedStageForUpdate = normalized;
    setClauses.push('stage = @stage');
    params.stage = normalized;
  }
  // Write the NORMALIZED pipeline (set above) rather than the raw
  // input — that's how legacy rows get repaired on touch.
  if (updates.pipeline) {
    setClauses.push('pipeline = @pipeline');
    params.pipeline = normalizedPipelineForUpdate ?? updates.pipeline;
  }
  if (updates.value !== undefined) { setClauses.push('value = @value'); params.value = updates.value; }
  if (updates.next_action) { setClauses.push('next_action = @next_action'); params.next_action = updates.next_action; }
  if (updates.contact_full_name) {
    const { first, last } = splitName(updates.contact_full_name);
    setClauses.push('contact_full_name = @contact_full_name');
    params.contact_full_name = updates.contact_full_name;
    if (first) { setClauses.push('contact_first_name = @contact_first_name'); params.contact_first_name = first; }
    if (last) { setClauses.push('contact_last_name = @contact_last_name'); params.contact_last_name = last; }
  }
  if (updates.contact_email) { setClauses.push('contact_email = @contact_email'); params.contact_email = updates.contact_email; }

  // Patch L — company_id FK. Validate the prefix before writing so a
  // typo can't smuggle a non-company ID into the column.
  if (updates.company_id !== undefined) {
    if (!isValidEntityId(updates.company_id) || !updates.company_id.startsWith('tco_')) {
      throw new Error(
        `Invalid company_id "${updates.company_id}" — must be a tco_ prefixed entity ID.`,
      );
    }
    setClauses.push('company_id = @company_id');
    params.company_id = updates.company_id;
  }
  if (updates.promoted_from_capture_id !== undefined) {
    if (!isValidEntityId(updates.promoted_from_capture_id) || !updates.promoted_from_capture_id.startsWith('tcp_')) {
      throw new Error(
        `Invalid promoted_from_capture_id "${updates.promoted_from_capture_id}" — must be a tcp_ prefixed entity ID.`,
      );
    }
    setClauses.push('promoted_from_capture_id = @promoted_from_capture_id');
    params.promoted_from_capture_id = updates.promoted_from_capture_id;
  }
  if (updates.owner) {
    // Owner column standardizes on Slack user IDs (see createDeal for the
    // resolution path). Refuse to write a raw name — that's the silent-drop
    // class we're trying to eliminate. Callers must resolve names to IDs
    // via mention-resolver before calling updateDeal.
    if (!isSlackUserId(updates.owner)) {
      throw new Error(
        `Invalid owner "${updates.owner}" — owner must be a Slack user ID (U...). Resolve the name through mention-resolver first.`,
      );
    }
    setClauses.push('owner = @owner');
    params.owner = updates.owner;
  }

  // Append notes (newest on top) rather than overwriting
  if (updates.notes) {
    const existingNotes = (existingRow.notes as string) || '';
    const today = new Date().toISOString().split('T')[0];
    const noteEntry = `[${today}] ${updates.notes}`;
    const updatedNotes = existingNotes ? `${noteEntry}\n${existingNotes}` : noteEntry;
    setClauses.push('notes = @notes');
    params.notes = updatedNotes;
  }

  setClauses.push('updated_at = CURRENT_TIMESTAMP()');

  if (setClauses.length > 1) {
    await bq.executeWrite(
      `UPDATE ${dealsTable()} SET ${setClauses.join(', ')} WHERE deal_id = @where_deal_id`,
      params,
    );
  }

  // Log activity
  const clientId = (existingRow.client_id as string) || 'bma';
  await logActivityInternal(bq, dealId, clientId, 'update_deal', `Updated: ${JSON.stringify(updates)}`);

  logger.info('Updated deal', { dealId });

  // Merge existing + updates for return
  const deal: Deal = {
    deal_id: dealId,
    deal_name: (existingRow.deal_name as string) || (existingRow.company as string) || '',
    company: (existingRow.company as string) || '',
    company_id: updates.company_id ?? (existingRow.company_id as string) ?? undefined,
    contact_full_name: updates.contact_full_name || (existingRow.contact_full_name as string) || '',
    contact_email: updates.contact_email || (existingRow.contact_email as string) || undefined,
    value: updates.value ?? (existingRow.value as number) ?? 0,
    // Surface the NORMALIZED stage so callers see what got written
    // (e.g. "closed_lost" not "we lost it").
    stage: normalizedStageForUpdate ?? updates.stage ?? (existingRow.stage as string) ?? 'researching',
    // Surface the NORMALIZED pipeline so callers see what actually got
    // written (e.g. "partnership" not "partnerships").
    pipeline: normalizedPipelineForUpdate ?? updates.pipeline ?? (existingRow.pipeline as string) ?? 'outbound',
    client_brand: (() => {
      const next = updates.client_brand ?? (existingRow.client_brand as string | null);
      return isValidBrand(next) ? next : undefined;
    })(),
    owner: updates.owner || (existingRow.owner as string) || '',
    notes: (params.notes as string) || (existingRow.notes as string) || undefined,
    next_action: updates.next_action || (existingRow.next_action as string) || undefined,
    promoted_from_capture_id: updates.promoted_from_capture_id ?? (existingRow.promoted_from_capture_id as string) ?? undefined,
    created_at: (existingRow.created_at as string) || '',
    updated_at: new Date().toISOString(),
  };

  return { deal, operation: 'updated' };
}

// ── Query ────────────────────────────────────────────────────────

const SCHEMA_DESCRIPTION = `Schema:
- deal_id (STRING) — format: bma_deal_companyname_mmddyyyy
- client_id (STRING) — format: companyname_mmddyyyy
- deal_name (STRING) — company name
- company (STRING)
- contact_ids (ARRAY<STRING>)
- value (FLOAT) — rate per payment cycle, NOT total value
- stage (STRING) — researching|contacted|conversation_started|discovery_scheduled|discovery_complete|proposal_sent|negotiating|verbal_commit|contract_sent|closed_won|closed_lost|closed_engagement
- pipeline (STRING) — inbound|outbound|partnership|fundraising
- client_brand (STRING) — bma|amber|rytual|togari. Indicates which BMA brand the deal belongs to. NULL on legacy rows (pre-migration); treat NULL as "bma" when filtering. Every brand has the same four pipelines.
- owner (STRING)
- close_date (DATE)
- notes (STRING)
- next_action (STRING)
- next_action_date (DATE)
- created_at (TIMESTAMP)
- updated_at (TIMESTAMP)
- contact_full_name (STRING)
- contact_first_name (STRING)
- contact_last_name (STRING)
- contact_email (STRING)
- contact_linkedin (STRING)
- deal_source (STRING)
- deal_duration (STRING)
- deal_amount_cycle (STRING) — monthly|quarterly|annually|one-time

Important notes:
- To calculate total deal value: value * (duration number). Duration is stored as text like "3 months".
- MRR = sum of value where deal_amount_cycle = 'monthly' and stage in active stages
- "Active deals" = any stage that is not closed_lost or closed_engagement
- The created_at and updated_at fields are TIMESTAMP type, not DATE. Use TIMESTAMP() function for comparisons.
- When someone says 'owned by [name]', search BOTH owner AND contact_full_name AND company fields.
- When someone says "rytual deals" / "amber pipeline" / "togari prospects" / "bma deals", filter by client_brand. Use \`WHERE LOWER(client_brand) = 'rytual'\` (or whichever brand). Remember legacy rows may have NULL client_brand; if the user asks for BMA deals, use \`WHERE client_brand = 'bma' OR client_brand IS NULL\`.
- Example brand-filtered queries:
  - "show me all rytual deals" → SELECT * FROM ... WHERE LOWER(client_brand) = 'rytual'
  - "amber fundraising pipeline" → SELECT * FROM ... WHERE LOWER(client_brand) = 'amber' AND LOWER(pipeline) = 'fundraising'
  - "all deals across brands" → SELECT *, client_brand FROM ... (include client_brand in the projection so the formatter can group)`;

export async function queryDeals(
  naturalLanguageQuery: string,
  opts: {
    timezone?: string;
    sender?: {
      slackId?: string;
      email?: string;
      displayName?: string;
      firstName?: string;
      lastName?: string;
    };
  } = {},
): Promise<{ sql: string; rows: any[]; summary: string }> {
  const { timezone = 'America/Chicago', sender } = opts;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');

  const bq = getBqClient();

  // Step 1: Generate SQL from natural language
  const sqlGen = new SqlGenerator(
    apiKey,
    resolveDataset(),
    'togari_structured_deals',
    PROJECT_ID,
    SCHEMA_DESCRIPTION,
  );

  // Defense-in-depth keyword scan over SqlSanitizer (which already runs
  // inside SqlGenerator.generate). Word-boundary regex so legitimate
  // column names like `updated_at` / `created_at` don't false-positive.
  const DANGEROUS_KEYWORDS = /\b(DROP|DELETE|ALTER|TRUNCATE|INSERT|UPDATE|CREATE|GRANT|REVOKE|EXEC|EXECUTE)\b/i;

  // Generate + validate the SQL. Throws when the LLM emits a mutation
  // keyword or a non-SELECT/WITH statement so the outer try/catch can
  // decide whether to retry with a corrective hint.
  async function generateAndValidate(query: string): Promise<string> {
    const { sql } = await sqlGen.generate(query);
    if (DANGEROUS_KEYWORDS.test(sql)) {
      throw new Error('Forbidden SQL keyword in generated SQL');
    }
    const normalized = sql.trim().toUpperCase();
    if (!normalized.startsWith('SELECT') && !normalized.startsWith('WITH')) {
      throw new Error('Can only run read-only queries (SELECT/WITH).');
    }
    return sql;
  }

  // Build sender identity preamble so the SQL generator can resolve
  // first-person language ("my pipeline", "deals I own") against the
  // owner column. Empty string when no sender was provided.
  let senderContext = '';
  if (sender) {
    const fullName = sender.firstName && sender.lastName
      ? `${sender.firstName} ${sender.lastName}`
      : sender.displayName || sender.firstName || 'Unknown';
    const slackHandle = sender.slackId ? ` (Slack: <@${sender.slackId}>)` : '';
    const emailPart = sender.email ? ` <${sender.email}>` : '';

    // Build the multi-format owner match expression.
    // The owner column in togari_structured_deals is messy — same user appears
    // as a raw Slack ID, full name, first name, or email across rows. Match all.
    const ownerClauses: string[] = [];
    if (sender.slackId) {
      ownerClauses.push(`owner = '${sender.slackId}'`);
    }
    if (sender.firstName && sender.lastName) {
      const fn = `${sender.firstName} ${sender.lastName}`.toLowerCase();
      ownerClauses.push(`LOWER(owner) = '${fn}'`);
    }
    if (sender.firstName) {
      ownerClauses.push(`LOWER(owner) = '${sender.firstName.toLowerCase()}'`);
    }
    if (sender.displayName) {
      ownerClauses.push(`LOWER(owner) = '${sender.displayName.toLowerCase()}'`);
    }
    const ownerMatchExpr = ownerClauses.length > 0
      ? `(${ownerClauses.join(' OR ')})`
      : 'FALSE';

    senderContext = `
The user asking this question is: ${fullName}${emailPart}${slackHandle}.
Their timezone is ${timezone}.

When the user says "my", "mine", "I", "me", or "I'm", they refer to themselves.

CRITICAL — Owner matching for the requesting user:
The \`owner\` column is inconsistent. The same user appears as a raw Slack ID, full name, first name, or email across different rows. When filtering deals owned by THIS user, ALWAYS use this exact WHERE clause (do not paraphrase it, do not simplify it):

${ownerMatchExpr}

Examples:
- "my pipeline" → WHERE ${ownerMatchExpr}
- "deals I own" → WHERE ${ownerMatchExpr}
- "my amber investors" → WHERE ${ownerMatchExpr}  (owner filter applied; client_brand NOT filtered — codename rule applies)
- "all my closed deals" → WHERE ${ownerMatchExpr} AND stage IN ('closed_won', 'closed_engagement')

For deals owned by OTHER named people, use fuzzy LIKE matching as before — but be aware the data is messy and you may need OR-clauses to catch all formats.
`;
  }

  // Brand-axis rules: distinguish brand-as-tag (filter) from brand-as-codename (don't filter).
  const brandHint = `IMPORTANT — Brand filtering rules.

The deals table has a \`client_brand\` column with values: bma, amber, rytual, togari.
Current row counts (for context only — don't over-rely): bma ~22, rytual ~2, amber ~1.
Legacy rows may have NULL client_brand — treat NULL as bma when filtering.

When the user uses a brand word as an EXPLICIT TAG → filter on client_brand:
- "show me all rytual deals" → WHERE LOWER(client_brand) = 'rytual'
- "amber pipeline" → WHERE LOWER(client_brand) = 'amber'
- "togari prospects" → WHERE LOWER(client_brand) = 'togari'
- "deals where the brand is amber" → WHERE LOWER(client_brand) = 'amber'

When the user uses a brand word as a PRODUCT CODENAME (topic modifier, not a tag) → DO NOT filter on client_brand. Include it in the projection instead:
- "investor pipeline for amber"  (investors related to the amber product — most are tagged bma)
- "amber investors"
- "fundraising contacts for amber"
- "who's working on the amber side"
- "rytual customers" (customers of the rytual product line)

Distinguishing rule: if the brand word is the PRIMARY adjective modifying "deals" / "pipeline" / "prospects" / "brand" → tag (filter). If the brand word is a TOPIC modifier and the primary noun is a relationship type (investor, customer, partner, contact) → codename (no filter).

WHEN IN DOUBT: don't filter. Include client_brand in SELECT so the user sees the distribution and can refine.`;

  const queryWithContext = `${senderContext}${brandHint}\n\n${naturalLanguageQuery}`;

  // One retry on forbidden-keyword rejections. The LLM is non-deterministic;
  // re-prompting with an explicit "SELECT-only, no mutation keywords"
  // hint converts most of these into a clean second try. Capped at one
  // retry — if it still fails, surface the original error.
  let rawSql: string;
  try {
    rawSql = await generateAndValidate(queryWithContext);
  } catch (err) {
    if (err instanceof Error && err.message.includes('Forbidden SQL keyword')) {
      logger.warn('Initial SQL rejected, retrying with explicit SELECT-only hint', { error: err.message });
      const hintedQuery = queryWithContext +
        '\n\nIMPORTANT: Generate a SELECT-only query. Do NOT include the keywords INSERT, UPDATE, DELETE, MERGE, CREATE, DROP, ALTER, or TRUNCATE anywhere — not in CTEs, not in subqueries, not in column aliases. Reference timestamp columns by name (created_at, updated_at) without ordering on them if not needed.';
      rawSql = await generateAndValidate(hintedQuery);
    } else {
      throw err;
    }
  }

  console.log('[core/deal-ops] Executing SQL:', rawSql);
  logger.info('Executing generated query', { sql: rawSql, question: naturalLanguageQuery });

  // Step 2: Execute the query
  const result = await bq.executeQuery(rawSql);

  // Step 3: Format results via Claude
  const formatPrompt = `The original question was: ${naturalLanguageQuery}

The SQL that ran was:
\`\`\`sql
${rawSql}
\`\`\`

The query returned ${result.totalRows} rows.

Results:
${JSON.stringify(result.rows.slice(0, 50), null, 2)}${result.totalRows > 50 ? `\n...and ${result.totalRows - 50} more.` : ''}`;

  const formatResponse = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: SONNET,
      max_tokens: 1024,
      system: `${buildDateContext(timezone)}

Format these BigQuery query results as a clean, readable summary. Use bullet points and clear formatting.

If results are empty or fewer than 2 rows:
1. State what filters were applied (paraphrase the SQL — don't paste it). Example: "I filtered for deals tagged client_brand='amber' and got 1 result."
2. If the user used a brand codename (like "amber investors") and the SQL filtered on client_brand, note that the filter may be too narrow and the codename rule may have been misapplied.
3. Suggest one specific broader query the user could try. Example: "Try 'investor pipeline across all brands' to see investors regardless of brand tag."
4. Never say "no results" without context. Always include the filter description.

H — When results span multiple brands (rows have different client_brand values), group the output by brand with a header for each: "## BMA (12 deals)", "## Amber (3 deals)", etc. NULL client_brand is treated as BMA. When results are within a single brand, omit the brand grouping entirely — don't add a redundant header.`,
      messages: [{ role: 'user', content: formatPrompt }],
    }),
  });

  if (!formatResponse.ok) {
    const errorBody = await formatResponse.text();
    throw new Error(`Anthropic API ${formatResponse.status}: ${errorBody}`);
  }

  const formatData = await formatResponse.json() as any;
  const summary = formatData.content
    .filter((c: any) => c.type === 'text')
    .map((c: any) => c.text)
    .join('')
    .trim();

  return { sql: rawSql, rows: result.rows, summary };
}

// ── Activity Logging ─────────────────────────────────────────────

export async function logActivity(params: {
  dealId?: string;
  company?: string;
  contactName?: string;
  type: string;
  content: string;
}): Promise<void> {
  const bq = getBqClient();

  let dealId = params.dealId;
  let clientId = 'bma';

  // If company/contact provided but no dealId, try to find the deal first
  if (!dealId && (params.company || params.contactName)) {
    const existingDeal = await searchDeal(params.company, params.contactName);
    if (existingDeal) {
      dealId = existingDeal.deal_id;
      clientId = toSnakeCase(existingDeal.company) + '_' + getDateStamp();
    }
  }

  if (!dealId) {
    dealId = params.company ? `bma_deal_${toSnakeCase(params.company)}_${getDateStamp()}` : 'unknown';
  }

  await logActivityInternal(bq, dealId, clientId, params.type, params.content);
  logger.info('Activity logged', { dealId, type: params.type });
}

// ── Internal helpers ─────────────────────────────────────────────

async function logActivityInternal(
  bq: BigQueryClient,
  dealId: string,
  clientId: string,
  type: string,
  content: string,
): Promise<void> {
  // Errors propagate. Silently dropping CRM writes lets the bot report
  // false success — caller must decide whether to surface or rethrow.
  const activityId = crypto.randomUUID();
  await bq.executeWrite(
    `INSERT INTO ${activitiesTable()} (activity_id, deal_id, client_id, type, content, timestamp)
     VALUES (@activity_id, @deal_id, @client_id, @type, @content, CURRENT_TIMESTAMP())`,
    {
      activity_id: activityId,
      deal_id: dealId,
      client_id: clientId,
      type,
      content,
    },
  );
}
