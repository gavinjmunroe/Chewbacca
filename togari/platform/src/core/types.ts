/**
 * @togari/core — Shared type definitions
 *
 * Universal interfaces for the transport-agnostic core intelligence layer.
 * Any transport (Slack, MCP, Teams, API) uses these types to communicate
 * with the core engine.
 */

import type { ClientBrand } from './config/brand-pipelines';

// ── Request / Response ───────────────────────────────────────────

/**
 * An inbound attachment — image, file, voice memo, etc. — that the
 * transport forwards to core alongside the text payload.
 *
 * Phase 1 seam: declared so future callers (image-capable iMessage /
 * Claude.ai file uploads) can populate it without the shape changing.
 */
export interface Attachment {
  kind: 'image' | 'audio' | 'pdf' | 'text' | 'other';
  mimeType?: string;
  filename?: string;
  /** Raw bytes as base64 for inline payloads. */
  base64?: string;
  /** URL the transport has already uploaded the file to. */
  url?: string;
  /** Size of the attachment in bytes (from the transport). */
  size_bytes?: number;
  /** For text attachments — the decoded content. */
  text?: string;
  /**
   * Transcript of an audio attachment (e.g. iMessage voice memos).
   * Phase 2: transports that can decode audio populate this so
   * tools downstream can treat it as additional text context.
   */
  transcript?: string;
}

/**
 * Canonical user context the core engine operates on. Populated by
 * `core/identity.ts::resolveUserContext()` from the transport id.
 *
 * Phase 1: only `userId` / `transport` / `transportId` are populated.
 * Phase 2 will backfill name/email/timezone from a users table.
 */
export interface UserContext {
  userId: string;
  transport: 'slack' | 'mcp' | 'teams' | 'imessage' | 'api' | 'smartlead' | 'openai';
  transportId: string;
  name?: string;
  email?: string;
  timezone?: string;
}

/** The universal request that any transport sends to the core engine. */
export interface TogariRequest {
  text: string;                    // The user's natural language message
  userId: string;                  // Platform-agnostic user identifier
  userName?: string;               // Display name
  userEmail?: string;              // Email if known
  platform: 'slack' | 'mcp' | 'teams' | 'imessage' | 'api';
  context?: Record<string, any>;   // Platform-specific context (e.g. Slack thread_ts)

  /**
   * Phase 2/3 seams — populated by newer transports, ignored by the
   * Phase 1 engine but reserved so no shape change is needed later.
   */
  attachments?: Attachment[];
  conversationId?: string;
  transport?: 'slack' | 'mcp' | 'teams' | 'imessage' | 'api' | 'smartlead' | 'openai';
  /**
   * Open map of transport-specific context. Examples:
   *   Slack:    { channelId, threadTs, messageTs }
   *   iMessage: { phone_hash, loop_message_id, conversation_id,
   *               tapback_of_message_id }
   *   OpenAI:   { thread_id, run_id }
   */
  transportMetadata?: Record<string, unknown>;
  user?: UserContext;
}

/**
 * Progress callback the engine invokes for long-running flows
 * (proposal generation, meeting analysis) so transports can emit
 * intermediate feedback to the end user.
 *
 * Phase 1: the engine accepts this but only invokes it from new code
 * paths. The existing Slack / MCP transports do not yet supply one —
 * they'll start in Step 3 / 4.
 */
export type OnProgress = (update: ProgressUpdate) => void | Promise<void>;

export interface ProgressUpdate {
  stage: string;                   // e.g. 'fetching_transcript', 'drafting'
  message: string;                 // Human-readable status line
  data?: Record<string, any>;
}

/** The universal response the core engine returns. */
export interface TogariResponse {
  type: 'text' | 'deal_created' | 'deal_updated' | 'activity_logged' | 'meeting_scheduled' | 'reminder_set' | 'proposal_generated' | 'meeting_analysis' | 'query_result' | 'email_drafted' | 'deal_transferred' | 'event_updated' | 'warning' | 'error';
  text: string;                    // Human-readable response message
  data?: Record<string, any>;      // Structured data (deal object, query results, proposal, etc.)
  actions?: TogariAction[];        // Actions the transport can render as buttons/tools
  attachments?: TogariAttachment[]; // Files to attach (proposals, reports)
}

export interface TogariAction {
  id: string;                      // Action identifier (e.g. 'send_email', 'create_draft', 'confirm')
  label: string;                   // Display label
  style?: 'primary' | 'danger' | 'default';
  data: Record<string, any>;       // Payload for the action
}

export interface TogariAttachment {
  type: 'markdown' | 'pdf' | 'csv';
  filename: string;
  content: string;                 // Raw content
}

// ── Intent Classification ────────────────────────────────────────

export interface ParsedIntent {
  intent: 'new_deal' | 'update_deal' | 'log_activity' | 'schedule_meeting' | 'set_reminder' | 'generate_proposal' | 'analyze_meeting' | 'query' | 'draft_email' | 'conversation' | 'transfer_deal' | 'update_event' | 'promote_capture';
  confidence: number;
  targetPerson?: string;
  company?: string;
  /**
   * Patch L — when the classifier (or engine pre-pass) has already
   * resolved company/contact names to typed entity IDs, pass them
   * through so downstream handlers don't re-resolve. Optional — most
   * call sites still operate on raw `company` / `contactName` strings.
   */
  companyId?: string;
  contactIds?: string[];
  contactName?: string;
  contactEmail?: string;
  dealValue?: number;
  stage?: string;
  pipeline?: string;
  /**
   * H — multi-brand axis. BMA runs three in-house brands (Amber, Rytual,
   * Togari) as special clients alongside external clients. Extracted by
   * the classifier; default is 'bma'. See src/core/config/brand-pipelines.ts.
   */
  clientBrand?: ClientBrand;
  notes?: string;
  analysisType?: string;
  pricingInstructions?: string;
  meetingTitle?: string;
  reminderText?: string;
  reminderTarget?: string;
  /**
   * ISO-local datetime strings ("YYYY-MM-DDTHH:MM:SS", no TZ suffix),
   * one per reminder occurrence. The Slack transport converts these to
   * Unix epoch seconds using the requester's timezone via
   * `isoLocalToUnix()` — the LLM never computes timestamps itself.
   */
  reminderTimes?: string[];
  calendarDate?: string;
  calendarTime?: string;
  calendarDuration?: number;
  calendarAttendees?: string[];
  /**
   * Internal override flag set when a user explicitly confirms a previously-warned
   * action against an inactive operator (e.g. Kevin). NOT extracted from the LLM —
   * set by the Slack transport's resume path after the user replies "yes proceed".
   */
  __overrideInactive?: boolean;
  rawFields: Record<string, any>;  // All fields from the parser for forward compat
}

// ── Deal ─────────────────────────────────────────────────────────

export interface Deal {
  deal_id: string;
  deal_name: string;
  company: string;
  /**
   * Patch L — FK to togari_companies.company_id. Optional on read for
   * legacy rows that pre-date the entity-graph backfill; required on
   * write (createDeal resolves the company string to an ID).
   */
  company_id?: string;
  contact_full_name: string;
  contact_email?: string;
  value: number;
  stage: string;
  pipeline: string;
  /**
   * H — multi-brand axis. NULL on existing rows until backfilled via
   * scripts/add-client-brand-column.ts; populated on every new write
   * and validated against BRAND_PIPELINES in createDeal / updateDeal.
   */
  client_brand?: ClientBrand;
  owner: string;
  close_date?: string;
  notes?: string;
  next_action?: string;
  /**
   * Patch L — set when this deal was promoted from a togari_captures row
   * (e.g. a Fireflies meeting that seeded the deal). Points back to the
   * source capture so the lineage is greppable.
   */
  promoted_from_capture_id?: string;
  created_at: string;
  updated_at: string;
}

// ── Entity graph (Patch L) ───────────────────────────────────────

/**
 * A company in the warehouse. Root entity — every contact / deal /
 * capture FKs back to one of these. Dedup'd by `name_normalized`
 * (see src/core/identity/normalize.ts::normalizeCompanyName).
 */
export interface Company {
  company_id: string;
  client_id?: string;
  name: string;
  name_normalized?: string;
  aliases?: string[];
  domain?: string;
  linkedin_url?: string;
  notes?: string;
  first_seen_at?: string;
  last_seen_at?: string;
  created_at?: string;
  updated_at?: string;
}

/**
 * A contact (person). INVARIANT: must link to at least one of
 * { company_id, deal_ids[], capture_ids[] } — enforced in
 * contact-ops::upsertContact. BQ does not enforce FKs.
 */
export interface Contact {
  contact_id: string;
  client_id?: string;
  full_name: string;
  first_name?: string;
  last_name?: string;
  email?: string;
  linkedin_url?: string;
  title?: string;
  company_id?: string;
  company_raw?: string;
  deal_ids?: string[];
  capture_ids?: string[];
  first_seen_at?: string;
  last_seen_at?: string;
  sources?: string[];
  notes?: string;
  /**
   * Patch L.1 — FK to togari_structured_contacts.row_id, the master contact
   * universe. NULL when this associated contact isn't in the master DB yet
   * (e.g. a brand-new contact from a Fireflies call we haven't seen before).
   * Populated automatically by upsertContact when an email match is found.
   */
  structured_contact_id?: string;
  created_at?: string;
  updated_at?: string;
}

/**
 * A pre-deal signal captured from an external system (Fireflies
 * transcript, Gmail thread, manual paste). INVARIANT: must link to at
 * least one of { company_id, contact_ids[], deal_id } — enforced in
 * capture-ops::insertCapture.
 */
export interface Capture {
  capture_id: string;
  client_id?: string;
  source: 'fireflies' | 'gmail' | 'manual' | 'exa' | 'web' | string;
  source_id?: string;
  captured_at: string;
  ingested_at: string;
  company_id?: string;
  company_raw?: string;
  contact_ids?: string[];
  deal_id?: string;
  attendees?: string[];
  internal_attendees?: string[];
  title?: string;
  raw_blob?: string;
  metadata?: Record<string, unknown>;
  promoted_to_deal_id?: string;
  client_brand?: ClientBrand;
  created_at?: string;
  updated_at?: string;
}

// ── Meeting ──────────────────────────────────────────────────────

export interface MeetingTranscript {
  id: string;
  title: string;
  date: string;
  duration: number;
  participants: string[];
  summary: {
    overview: string;
    action_items: string[];
    keywords: string[];
    bullets: string[];
  };
  sentences?: { speaker: string; text: string }[];
  fullText?: string;
}

// ── Proposal ─────────────────────────────────────────────────────

export interface ProposalRequest {
  clientName: string;
  clientCompany: string;
  meetingTranscript?: string;
  dealContext?: string;
  userInstructions: string;
  pricing?: string;
}

export interface ProposalResult {
  markdown: string;
  summary: string;
  clientName: string;
  clientCompany: string;
}
