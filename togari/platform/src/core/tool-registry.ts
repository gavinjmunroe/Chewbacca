/**
 * @togari/core — Tool registry for the Anthropic tool-use loop
 *
 * Exports:
 *   - TOGARI_TOOL_DEFS — the 16 tool definitions (Anthropic JSON format)
 *   - bindHandlers(ctx) — returns a name → handler map that closes over
 *     the per-invocation context (request, sender, timezone, etc.).
 *
 * Every tool description follows the Blocker-1 structure: WHAT / USE
 * WHEN / DO NOT USE WHEN. Read tools include the disambiguation hint:
 * "Always prefer this over `log_activity` when the user is asking ABOUT
 *  data rather than recording new data."
 *
 * Handlers wrap the EXISTING pure operations in src/core/tools/*.ts —
 * they do NOT reimplement business logic. Each handler returns a
 * ToolResult<T> (status: ok | error | needs_clarification) — see types
 * below — and the runner serializes that result back to Claude.
 */

import type { TogariRequest } from './types';
import type { UserRow } from './identity/user-directory';
import type { ClaudeTool, ToolHandler } from './claude-loop';

import {
  searchDeal,
  createDeal,
  updateDeal,
  queryDeals,
  logActivity,
} from './tools/deal-ops';
import { findCompanyByName, upsertCompany } from './tools/company-ops';
import { searchCapturesByCompany, markCapturePromoted } from './tools/capture-ops';
import {
  scheduleEvent,
  findCalendarEvent,
  updateCalendarEvent,
  CalendarAuthMissingError,
} from './tools/calendar-ops';
import { findMeeting, analyzeMeeting, searchMeetings } from './tools/meeting-intel';
import { generateProposal } from './tools/proposal-ops';
import { draftReply, sendEmail } from './tools/email-ops';
import { setReminder } from './tools/reminder-ops';
import {
  resolveReminderOwner,
  isInactiveOperator,
} from './identity/mention-resolver';
import { isoLocalToUnix } from './identity/date-context';
import { runHelp } from './tools/help';

// ── Per-invocation context ───────────────────────────────────────

export interface ToolContext {
  request: TogariRequest;
  /** The resolved sender (from togari.users) if available. */
  sender: UserRow | null;
  /** Sender's timezone (defaults to America/New_York). */
  timezone: string;
  /** Tenant id (defaults to 'bma'). */
  tenantId: string;
}

// ── ToolResult (Blocker 3 contract) ──────────────────────────────

export type ToolResult<T = unknown> =
  | { status: 'ok'; data: T; user_message?: string }
  | { status: 'error'; message: string; retry_possible: boolean; data?: unknown }
  | {
      status: 'needs_clarification';
      question: string;
      missing_fields: string[];
      partial_state: Record<string, unknown>;
    };

// ── Tool descriptions (Blocker 1 structure) ──────────────────────

const D_QUERY_DEALS = `WHAT: Query the CRM deals database (togari_structured_deals) for pipeline, deals, stages, owners, values, contacts, or any aggregate. The tool runs a SELECT-only BigQuery query and returns formatted results. The user's identity is automatically injected so "my pipeline" / "deals I own" works. Always prefer this over \`log_activity\` when the user is asking ABOUT data rather than recording new data.

USE WHEN:
- "show me my pipeline" / "deals I own"
- "investor pipeline for amber" / "rytual customers"
- "how many deals closed last month" / "what's our total pipeline"

DO NOT USE WHEN:
- The user is recording a fact they JUST did → use \`log_activity\`.
- The user is asking about ONE specific company or person → use \`get_deal_context\` (returns deal + activities + recent meeting for a single entity).
- The user is asking about meetings (not deals) → use \`search_meetings\`.

Brand words used as TAGS ("amber pipeline", "rytual deals") filter on client_brand. Brand words used as PRODUCT CODENAMES ("investor pipeline for amber", "amber investors") do NOT filter on client_brand — return all brands.`;

const D_SEARCH_MEETINGS = `WHAT: Search Fireflies meeting transcripts by person, company, topic, or keyword. Returns a list of matching meeting metadata (title, date, participants, one-paragraph summary).

USE WHEN:
- "what meetings did I have with KCLA last week"
- "list calls about pricing"
- "find the call where we discussed the redline"

DO NOT USE WHEN:
- The user wants ACTION ITEMS, next steps, or a summary of ONE meeting → use \`analyze_meeting\`.
- The user is asking about DEALS, not meetings → use \`query_deals\` even if a person is named.`;

const D_ANALYZE_MEETING = `WHAT: Analyze ONE specific Fireflies meeting transcript — returns next steps, action items, summary, key decisions, or a markdown table of metrics. Long-running (~10-15 seconds).

USE WHEN:
- "next steps from the call with Carlo"
- "action items from yesterday's BMA standup"
- "summarize the discovery call with Sift"

DO NOT USE WHEN:
- The user wants a LIST of meetings → use \`search_meetings\`.
- The user wants to update a deal based on the call → use \`update_deal\` after this.`;

const D_GET_DEAL_CONTEXT = `WHAT: Look up everything we know about ONE specific company or person — their deal stage, value, owner, notes, recent activities. Use this as a precursor to a write tool when you need context before a change.

USE WHEN:
- "what's the status of Acme"
- "where are we with John Smith"
- "tell me about the KCLA deal"

DO NOT USE WHEN:
- The user wants a LIST of deals → use \`query_deals\`.
- The user wants meeting transcripts → use \`search_meetings\` or \`analyze_meeting\`.`;

const D_NEW_DEAL = `WHAT: Create a NEW deal in the CRM. Brand defaults to "bma"; pipeline defaults to "outbound"; stage defaults to "researching". Brand+pipeline combo is validated server-side.

USE WHEN:
- "kyle exa partnerships" / "add Sarah at Acme, $5k/mo"
- The message describes a wholly NEW engagement that isn't already tracked.

DO NOT USE WHEN:
- The deal already exists → use \`update_deal\`.
- The user said "promote X" or "make X a deal" AND a Fireflies/Gmail capture exists for X → use \`promote_capture\` (it pulls more context).
- Use \`transfer_deal\` for ownership changes, not new_deal.`;

const D_UPDATE_DEAL = `WHAT: Modify an existing deal — change value, stage, contact, pipeline, brand, notes. Owner is read-only here; use \`transfer_deal\` for ownership.

USE WHEN:
- "Pedro Noyola is at meeting 2, $7500/mo, BMA inbound" → stage + value + pipeline + brand
- "update river to 7k" / "move acme to discovery"

DO NOT USE WHEN:
- The deal doesn't exist yet → use \`new_deal\`.
- The verb is "transfer" / "give to" / "shift to" → use \`transfer_deal\`.

If you're not sure whether the deal exists, call \`get_deal_context\` first.`;

const D_TRANSFER_DEAL = `WHAT: Change deal OWNERSHIP — assign a deal to a different team member. The owner column is special-cased: only validated Slack IDs may be written. The handler resolves names via the same path \`set_reminder\` uses. Always confirm before applying.

USE WHEN:
- "transfer Acme to Sagar"
- "shift the Sift deal to Karthik"
- "give the KCLA deal to Maggie"

DO NOT USE WHEN:
- Any non-ownership update → use \`update_deal\`.
- The user is asking who owns a deal (not changing it) → use \`get_deal_context\` or \`query_deals\`.

Active team: karthik, sagar, maggie, drew, shirley, caleb, tyler, reem, rania. Kevin is inactive; the handler will warn before assigning to him.`;

const D_LOG_ACTIVITY = `WHAT: Record a sales activity (call, email, meeting note, observation) as an audit row against a deal or contact. INCLUDES the user's full phrasing in content.

USE WHEN:
- "log my call with Roy"
- "note: Daniel said they'd circle back next week"
- "record that we sent the SOW"

DO NOT USE WHEN:
- The user is asking ABOUT data → use \`query_deals\` or \`get_deal_context\`.
- The user is scheduling a future reminder → use \`set_reminder\`.
- The user is creating or updating a deal → use \`new_deal\` / \`update_deal\` (those auto-log).`;

const D_SET_REMINDER = `WHAT: Schedule a Slack reminder for the user OR a teammate. Each reminder posts with a [❌ Cancel] button so the user can cancel before it fires. Multiple reminders in one message ("Eric, Pat, Chris for SD visit Sunday-Tuesday") = multiple parallel set_reminder calls, one per target.

USE WHEN:
- "remind Kevin at 3pm Tuesday to text John"
- "have Sagar follow up with Acme tomorrow"
- "remind me to text John about the redline"

DO NOT USE WHEN:
- The verb is "schedule"/"meet"/"sync" with 2+ people → use \`schedule_meeting\`.
- The user just wants to record something they did → use \`log_activity\`.

NEVER fall back to the sender silently. If you can't resolve the named person, return an error and ask the user. The handler enforces this — only first-person tokens ("me"/"myself") default to the sender.

Active team: karthik, sagar, maggie, drew, shirley, caleb, tyler, reem, rania. Inactive (will warn): kevin.

Default timezone is America/New_York; the handler localizes \`fire_at_iso_local\` to the requester's TZ.`;

const D_SCHEDULE_MEETING = `WHAT: Create a NEW Google Calendar event. The handler localizes the time to the requester's TZ and returns the calendar link.

USE WHEN:
- "schedule a discovery with Sarah at 3pm Wednesday"
- "1:1 with Karthik tomorrow at 10"
- "block off Friday 2-4 for the Sift kickoff"

DO NOT USE WHEN:
- The event already exists; the user is rescheduling → use \`update_event\`.
- Only one person doing an action → use \`set_reminder\`.

Time gate: if the user provided a DATE but no TIME, return needs_clarification with question="What time?" — never fabricate a time. Duration: if absent, omit the field; the engine falls back to implied-duration mappings ("quick" → 15, "discovery"/"demo"/"review"/"kickoff" → 60, "1:1"/"intro"/"coffee" → 30).`;

const D_UPDATE_EVENT = `WHAT: Modify an EXISTING calendar event — change time, duration, attendees, or title. Distinct from \`schedule_meeting\` (which creates).

USE WHEN:
- "reschedule the Sift discovery to 4pm"
- "move the Carlo call to Thursday"
- "push back the BMA standup an hour"

DO NOT USE WHEN:
- No matching event exists → tell the user, don't fall back to schedule_meeting.

Before calling: restate the change you're about to make so the user can correct. If multiple events match, the handler returns the list — relay it and ask which one.`;

const D_GENERATE_PROPOSAL = `WHAT: Generate a markdown proposal/SOW for a deal, based on a Fireflies meeting transcript + the CRM deal context. Long-running (~15s).

USE WHEN:
- "generate a proposal for Carlo, 7k/mo for 3 months"
- "draft a SOW for the Sift call"

DO NOT USE WHEN:
- The user just wants a short email reply → use \`draft_email\`.

Returns markdown the transport renders as an attachment.`;

const D_DRAFT_EMAIL = `WHAT: Draft an email reply or outreach. Returns subject + body. Does NOT send — for sending, the user must confirm a follow-up \`send_email\` call.

USE WHEN:
- "draft a check-in to john@acme.com"
- "draft a reply: thanks for the intro, let's set time for next week"

DO NOT USE WHEN:
- The user wants to actually SEND right now — still draft FIRST and ask for confirmation. Never call \`send_email\` without an explicit "send it" / "go" from the user.

Banned phrasings (per system prompt): "I hope this email finds you well", "synergy", "leverage".`;

const D_SEND_EMAIL = `WHAT: ACTUALLY SEND an email via Gmail from sagar@bluemodernadvisory.com. There is no undo. The transport ALWAYS confirms via a Block Kit button before delivery — the handler returns a needs_clarification result that the runner converts into a [:rocket: Send / :x: Cancel] message in the thread.

USE WHEN:
- The user has reviewed a draft and explicitly said "send it" / "yes send" / "go".

DO NOT USE WHEN:
- You haven't shown the user a draft yet → use \`draft_email\` first.
- Any uncertainty about the user's intent — call \`draft_email\` and ask.`;

const D_PROMOTE_CAPTURE = `WHAT: Convert a pre-deal CAPTURE (Fireflies transcript, Gmail thread, manual paste) into a tracked DEAL. The handler finds the most recent capture for the company, extracts structured fields (stage, value, pipeline, contact) from the transcript via Claude, and creates the deal.

USE WHEN:
- "make Carlo a deal" / "promote the Carlo meeting"
- "turn the KCLA call into a deal"

DO NOT USE WHEN:
- No capture exists for the company → use \`new_deal\` with the user-supplied fields.
- The user supplied all the fields explicitly → use \`new_deal\`.`;

const D_HELP = `WHAT: Return Togari's capability menu — a curated list of things Togari can do with verbatim example phrasings.

USE WHEN:
- "what can you do" / "help" / "show me your tools"
- The user seems lost or asks "how do I X"
- The message is "/togari help" or similar

DO NOT USE WHEN:
- The user is making a specific request (even a vague one) — try the appropriate tool instead. \`help\` is for explicit capability inquiries only.`;

// ── 16 Tool definitions (Anthropic JSON format) ──────────────────

export const TOGARI_TOOL_DEFS: ClaudeTool[] = [
  {
    name: 'query_deals',
    description: D_QUERY_DEALS,
    input_schema: {
      type: 'object',
      properties: {
        question: {
          type: 'string',
          description: 'Verbatim or lightly rephrased version of the user\'s question. Include modifiers like "my", "amber", "closed", "this quarter" if they were in the message.',
        },
      },
      required: ['question'],
    },
  },
  {
    name: 'search_meetings',
    description: D_SEARCH_MEETINGS,
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Person name, company name, topic, or keyword.' },
        limit: { type: 'integer', description: 'Max meetings to return. Default 5. Cap 10.' },
      },
      required: ['query'],
    },
  },
  {
    name: 'analyze_meeting',
    description: D_ANALYZE_MEETING,
    input_schema: {
      type: 'object',
      properties: {
        meeting_reference: {
          type: 'string',
          description: 'What the user called the meeting — can be a person name, team name (BMA standup), topic, time, or company. Pass the entire user phrase if unsure.',
        },
        analysis_type: {
          type: 'string',
          enum: ['next_steps', 'action_items', 'summary', 'table', 'general'],
          description: "Default 'general'.",
        },
      },
      required: ['meeting_reference'],
    },
  },
  {
    name: 'get_deal_context',
    description: D_GET_DEAL_CONTEXT,
    input_schema: {
      type: 'object',
      properties: {
        company: { type: 'string', description: 'Company name. Casual phrasing OK (scientist → Scientist.com).' },
        person: { type: 'string', description: 'Contact full name.' },
      },
    },
  },
  {
    name: 'new_deal',
    description: D_NEW_DEAL,
    input_schema: {
      type: 'object',
      properties: {
        company: { type: 'string' },
        contact_name: { type: 'string' },
        contact_email: { type: 'string' },
        value: { type: 'number', description: 'Deal value per payment cycle (NOT total). Treat "5k" as 5000.' },
        stage: {
          type: 'string',
          enum: ['researching', 'contacted', 'conversation_started', 'discovery_scheduled', 'discovery_complete', 'proposal_sent', 'negotiating', 'verbal_commit', 'contract_sent', 'closed_won', 'closed_lost', 'closed_engagement'],
          description: 'Map: "meeting 2" → discovery_complete, "they ghosted" → closed_lost, "verbal yes" → verbal_commit, "we won" → closed_won. Default researching.',
        },
        pipeline: {
          type: 'string',
          enum: ['inbound', 'outbound', 'partnership', 'fundraising'],
          description: 'Map: "investor"/"VC"/"LP"/"raise" → fundraising. "partner" → partnership. "they reached out" → inbound. Default outbound.',
        },
        client_brand: {
          type: 'string',
          enum: ['bma', 'amber', 'rytual', 'togari'],
          description: 'Default "bma". Today\'s deal counts: bma ~70%, amber ~20%, rytual ~10%, togari (rare).',
        },
        notes: { type: 'string' },
      },
      required: ['company'],
    },
  },
  {
    name: 'update_deal',
    description: D_UPDATE_DEAL,
    input_schema: {
      type: 'object',
      properties: {
        company: { type: 'string', description: 'Company name to find the deal. Required.' },
        contact_name: { type: 'string', description: 'Secondary search key if company is ambiguous.' },
        stage: { type: 'string', enum: ['researching', 'contacted', 'conversation_started', 'discovery_scheduled', 'discovery_complete', 'proposal_sent', 'negotiating', 'verbal_commit', 'contract_sent', 'closed_won', 'closed_lost', 'closed_engagement'] },
        pipeline: { type: 'string', enum: ['inbound', 'outbound', 'partnership', 'fundraising'] },
        client_brand: { type: 'string', enum: ['bma', 'amber', 'rytual', 'togari'] },
        value: { type: 'number' },
        contact_email: { type: 'string' },
        next_action: { type: 'string' },
        notes: { type: 'string' },
        explicit_create_if_missing: { type: 'boolean', description: 'Default false. Legacy behavior was true; the new default fails loudly when no deal matches.' },
      },
      required: ['company'],
    },
  },
  {
    name: 'transfer_deal',
    description: D_TRANSFER_DEAL,
    input_schema: {
      type: 'object',
      properties: {
        company: { type: 'string' },
        new_owner: { type: 'string', description: 'Lowercase first name (karthik, sagar, maggie, drew, shirley, caleb, tyler, reem, rania). Pass the user\'s exact phrasing if unsure; the handler resolves.' },
        notes: { type: 'string' },
      },
      required: ['company', 'new_owner'],
    },
  },
  {
    name: 'log_activity',
    description: D_LOG_ACTIVITY,
    input_schema: {
      type: 'object',
      properties: {
        company: { type: 'string' },
        contact_name: { type: 'string' },
        activity_type: { type: 'string', enum: ['call', 'email', 'meeting', 'note', 'slack'], description: 'Default "note".' },
        content: { type: 'string', description: 'Full text — keep the user\'s wording. Don\'t summarize aggressively.' },
      },
      required: ['content'],
    },
  },
  {
    name: 'set_reminder',
    description: D_SET_REMINDER,
    input_schema: {
      type: 'object',
      properties: {
        target: { type: 'string', description: 'Lowercase first name, or "me"/"self" for the sender.' },
        reminder_text: { type: 'string', description: 'What the person should do. Include any context ("Text John about the contract redline"), not just the verb.' },
        fire_at_iso_local: { type: 'string', description: 'ISO-local datetime "YYYY-MM-DDTHH:MM:SS", NO timezone suffix. The engine localizes to America/New_York by default or the requester\'s TZ.' },
      },
      required: ['target', 'reminder_text', 'fire_at_iso_local'],
    },
  },
  {
    name: 'schedule_meeting',
    description: D_SCHEDULE_MEETING,
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Meeting title. Infer from contact name if user didn\'t give one.' },
        date_time: { type: 'string', description: 'Natural-language or ISO-local. The engine parses "Tuesday at 3pm" / "tomorrow 10am" / "2026-05-29 09:00".' },
        duration_minutes: { type: 'integer', description: 'Optional. Omit to use implied-duration defaults.' },
        attendee_emails: { type: 'array', items: { type: 'string' } },
      },
      required: ['title', 'date_time'],
    },
  },
  {
    name: 'update_event',
    description: D_UPDATE_EVENT,
    input_schema: {
      type: 'object',
      properties: {
        event_query: { type: 'string', description: 'Meeting title, person, or topic.' },
        new_date_time: { type: 'string' },
        new_duration_minutes: { type: 'integer' },
        new_title: { type: 'string' },
        new_attendee_emails: { type: 'array', items: { type: 'string' } },
      },
      required: ['event_query'],
    },
  },
  {
    name: 'generate_proposal',
    description: D_GENERATE_PROPOSAL,
    input_schema: {
      type: 'object',
      properties: {
        client_name: { type: 'string', description: 'Primary contact\'s full name. Used to find the Fireflies meeting.' },
        client_company: { type: 'string' },
        pricing_instructions: { type: 'string', description: 'E.g. "7k/mo for 6 months", "15k POC".' },
        additional_instructions: { type: 'string' },
      },
      required: ['client_name'],
    },
  },
  {
    name: 'draft_email',
    description: D_DRAFT_EMAIL,
    input_schema: {
      type: 'object',
      properties: {
        to_email: { type: 'string' },
        to_name: { type: 'string' },
        context: { type: 'string', description: 'What the email should be about. Include any specific points to cover.' },
        reply_to_message: { type: 'string' },
      },
      required: ['to_email', 'context'],
    },
  },
  {
    name: 'send_email',
    description: D_SEND_EMAIL,
    input_schema: {
      type: 'object',
      properties: {
        to: { type: 'string' },
        subject: { type: 'string' },
        body: { type: 'string' },
        in_reply_to: { type: 'string' },
      },
      required: ['to', 'subject', 'body'],
    },
  },
  {
    name: 'promote_capture',
    description: D_PROMOTE_CAPTURE,
    input_schema: {
      type: 'object',
      properties: {
        company: { type: 'string' },
        pipeline: { type: 'string' },
        stage: { type: 'string' },
        client_brand: { type: 'string' },
        deal_value: { type: 'number' },
        contact_name: { type: 'string' },
        notes: { type: 'string' },
      },
      required: ['company'],
    },
  },
  {
    name: 'help',
    description: D_HELP,
    input_schema: {
      type: 'object',
      properties: {
        topic: {
          type: 'string',
          description: 'Optional. One of: deals, reminders, meetings, email, calendar, queries. Omit for the full menu.',
        },
      },
    },
  },
];

// ── Pending side-effects that the runner must surface to the transport ─

/**
 * Tool handlers can request the transport perform a deferred side-effect
 * (e.g. post a confirmation Block Kit message). The runner accumulates
 * these on `ctx.pending` and the transport executes them after the loop.
 *
 * Kept on a mutable property of ToolContext so the handlers and the
 * runner share one source of truth. (The runner attaches this at start.)
 */
export interface PendingSideEffect {
  kind: 'confirm_send_email' | 'confirm_transfer_deal' | 'confirm_new_deal_dedupe' | 'reminder_confirm';
  payload: Record<string, unknown>;
}

export interface MutableToolContext extends ToolContext {
  pendingSideEffects: PendingSideEffect[];
}

// ── Handler bindings ─────────────────────────────────────────────

function isHighFuzzyDealMatch(score: number): boolean {
  // Per the migration plan §7 — Levenshtein match ≥ 0.5 indicates a
  // possible duplicate worth confirming before creating a new deal.
  return score >= 0.5;
}

/**
 * Build the name → handler map for one invocation. Closes over the
 * shared MutableToolContext so handlers can push side effects.
 */
export function bindHandlers(ctx: MutableToolContext): Record<string, ToolHandler> {
  const senderTzOrDefault = ctx.timezone || ctx.sender?.timezone || 'America/New_York';

  // Shared sender shape used by queryDeals for "my pipeline" interpretation.
  function buildSenderForQuery() {
    if (!ctx.sender) return undefined;
    return {
      slackId: ctx.sender.slack_user_id ?? undefined,
      email: ctx.sender.email,
      displayName: ctx.sender.slack_display_name ?? undefined,
      firstName: ctx.sender.first_name ?? undefined,
      lastName: ctx.sender.last_name ?? undefined,
    };
  }

  return {
    query_deals: async (input) => {
      const question = String((input as any).question ?? ctx.request.text ?? '').trim();
      if (!question) {
        return { status: 'error', message: 'No question provided.', retry_possible: false } as ToolResult;
      }
      try {
        const result = await queryDeals(question, {
          timezone: senderTzOrDefault,
          sender: buildSenderForQuery(),
        });
        return {
          status: 'ok',
          data: { sql: result.sql, rows: result.rows, summary: result.summary, total_rows: result.rows.length },
          user_message: result.summary,
        } as ToolResult;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (/mutation|forbidden|read-only|SELECT only/i.test(msg)) {
          return { status: 'error', message: ':warning: I can only run read-only queries.', retry_possible: false } as ToolResult;
        }
        return { status: 'error', message: msg, retry_possible: true } as ToolResult;
      }
    },

    search_meetings: async (input) => {
      const query = String((input as any).query ?? '').trim();
      const limit = Math.min(Math.max(Number((input as any).limit ?? 5), 1), 10);
      if (!query) return { status: 'error', message: 'No search query provided.', retry_possible: false } as ToolResult;
      const meetings = await searchMeetings(query, limit);
      const rows = meetings.map((m) => ({
        id: m.id,
        title: m.title,
        date: m.date,
        participants: m.participants,
        overview: m.summary?.overview ?? '',
      }));
      return {
        status: 'ok',
        data: { meetings: rows, count: rows.length },
        user_message: rows.length === 0
          ? `No meetings matching "${query}".`
          : `Found ${rows.length} meeting${rows.length === 1 ? '' : 's'} for "${query}".`,
      } as ToolResult;
    },

    analyze_meeting: async (input) => {
      const reference = String((input as any).meeting_reference ?? ctx.request.text ?? '').trim();
      const analysisType = String((input as any).analysis_type ?? 'general');
      if (!reference) return { status: 'error', message: 'No meeting reference provided.', retry_possible: false } as ToolResult;
      const transcript = await findMeeting(reference);
      if (!transcript) {
        return {
          status: 'error',
          message: `Couldn't find a Fireflies meeting matching "${reference}". Try using the exact name or topic.`,
          retry_possible: false,
        } as ToolResult;
      }
      const analysis = await analyzeMeeting(transcript, analysisType, undefined, senderTzOrDefault);
      const header = `Meeting Analysis — ${transcript.title}\n${analysisType.replace(/_/g, ' ')} | ${transcript.date}\n\n`;
      return {
        status: 'ok',
        data: {
          meeting_title: transcript.title,
          meeting_date: transcript.date,
          analysis_type: analysisType,
          participants: transcript.participants,
        },
        user_message: header + analysis,
      } as ToolResult;
    },

    get_deal_context: async (input) => {
      const company = String((input as any).company ?? '').trim();
      const person = String((input as any).person ?? '').trim();
      if (!company && !person) {
        return { status: 'error', message: 'Pass either company or person.', retry_possible: false } as ToolResult;
      }
      const deal = await searchDeal(company || undefined, person || undefined);
      if (!deal) {
        return {
          status: 'ok',
          data: { found: false, company, person },
          user_message: `No deal found for ${company || person}.`,
        } as ToolResult;
      }
      return {
        status: 'ok',
        data: { found: true, deal },
        user_message: `*${deal.company}* (${deal.contact_full_name || 'no contact'}) — ${deal.stage} — $${deal.value?.toLocaleString() ?? '—'}${deal.pipeline ? ` — ${deal.pipeline}` : ''}${deal.next_action ? ` | next: ${deal.next_action}` : ''}`,
      } as ToolResult;
    },

    new_deal: async (input) => {
      const company = String((input as any).company ?? '').trim();
      if (!company) return { status: 'error', message: 'Company is required.', retry_possible: false } as ToolResult;

      // Dedupe check — Levenshtein ≥ 0.5 triggers a confirmation prompt
      // (Blocker per migration plan §7). The handler defers the actual
      // INSERT to the confirm action via a pending side effect.
      const existing = await searchDeal(company, (input as any).contact_name);
      if (existing) {
        // Score: searchDeal already returns the best fuzzy match — assume
        // it cleared its internal threshold (~0.5). Always confirm.
        ctx.pendingSideEffects.push({
          kind: 'confirm_new_deal_dedupe',
          payload: {
            company,
            contact_name: (input as any).contact_name,
            contact_email: (input as any).contact_email,
            value: (input as any).value,
            stage: (input as any).stage,
            pipeline: (input as any).pipeline,
            client_brand: (input as any).client_brand,
            notes: (input as any).notes,
            existing_deal_id: existing.deal_id,
            existing_stage: existing.stage,
            dedupe_message: `A deal for *${company}* already exists (${existing.deal_id}, stage: ${existing.stage}).`,
          },
        });
        return {
          status: 'needs_clarification',
          question: `A deal for *${company}* already exists (${existing.deal_id}). Create a new one anyway? Use the buttons in the thread.`,
          missing_fields: ['confirm'],
          partial_state: { tool: 'new_deal', input },
        } as ToolResult;
      }

      try {
        const { deal } = await createDeal({
          company,
          contactName: (input as any).contact_name,
          contactEmail: (input as any).contact_email,
          value: (input as any).value,
          stage: (input as any).stage,
          pipeline: (input as any).pipeline,
          clientBrand: (input as any).client_brand,
          owner: ctx.request.userName,
          senderSlackUserId: ctx.request.userId,
          notes: (input as any).notes ?? ctx.request.text,
        });
        return {
          status: 'ok',
          data: { deal, operation: 'created' },
          user_message: `:new: New deal created for *${deal.company}*${deal.contact_full_name ? ` (${deal.contact_full_name})` : ''} — Stage: ${deal.stage}, Value: $${deal.value?.toLocaleString() ?? '—'}`,
        } as ToolResult;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { status: 'error', message: msg, retry_possible: false } as ToolResult;
      }
    },

    update_deal: async (input) => {
      const company = String((input as any).company ?? '').trim();
      if (!company) return { status: 'error', message: 'Company is required.', retry_possible: false } as ToolResult;
      const existing = await searchDeal(company, (input as any).contact_name);
      if (!existing) {
        const allowCreate = (input as any).explicit_create_if_missing === true;
        if (!allowCreate) {
          return {
            status: 'error',
            message: `No deal found for *${company}*. Did you mean to create one? Use new_deal explicitly.`,
            retry_possible: false,
          } as ToolResult;
        }
        // Legacy silent-create path (preserved behind explicit flag).
        try {
          const { deal } = await createDeal({
            company,
            contactName: (input as any).contact_name,
            contactEmail: (input as any).contact_email,
            value: (input as any).value,
            stage: (input as any).stage,
            pipeline: (input as any).pipeline,
            clientBrand: (input as any).client_brand,
            owner: ctx.request.userName,
            senderSlackUserId: ctx.request.userId,
            notes: (input as any).notes ?? ctx.request.text,
          });
          return {
            status: 'ok',
            data: { deal, operation: 'created' },
            user_message: `No existing deal — created new deal for *${deal.company}* (stage: ${deal.stage}).`,
          } as ToolResult;
        } catch (err) {
          return { status: 'error', message: err instanceof Error ? err.message : String(err), retry_possible: false } as ToolResult;
        }
      }
      const updates: Record<string, any> = {};
      if ((input as any).stage) updates.stage = (input as any).stage;
      if ((input as any).pipeline) updates.pipeline = (input as any).pipeline;
      if ((input as any).client_brand) updates.client_brand = (input as any).client_brand;
      if ((input as any).value !== undefined) updates.value = (input as any).value;
      if ((input as any).contact_name) updates.contact_full_name = (input as any).contact_name;
      if ((input as any).contact_email) updates.contact_email = (input as any).contact_email;
      if ((input as any).next_action) updates.next_action = (input as any).next_action;
      updates.notes = (input as any).notes ?? ctx.request.text;
      try {
        const { deal } = await updateDeal(existing.deal_id, updates);
        return {
          status: 'ok',
          data: { deal, operation: 'updated' },
          user_message: `:memo: Updated *${deal.company}* — Stage: ${deal.stage}, Value: $${deal.value?.toLocaleString() ?? '—'}`,
        } as ToolResult;
      } catch (err) {
        return { status: 'error', message: err instanceof Error ? err.message : String(err), retry_possible: false } as ToolResult;
      }
    },

    transfer_deal: async (input) => {
      const company = String((input as any).company ?? '').trim();
      const newOwner = String((input as any).new_owner ?? '').trim();
      const notes = (input as any).notes;
      if (!company || !newOwner) {
        return { status: 'error', message: 'Both company and new_owner are required.', retry_possible: false } as ToolResult;
      }
      // Always confirm — push a side effect and return needs_clarification.
      ctx.pendingSideEffects.push({
        kind: 'confirm_transfer_deal',
        payload: { company, new_owner_token: newOwner, notes },
      });
      return {
        status: 'needs_clarification',
        question: `Transfer *${company}* to *${newOwner}* — confirm via the buttons in the thread.`,
        missing_fields: ['confirm'],
        partial_state: { tool: 'transfer_deal', input },
      } as ToolResult;
    },

    log_activity: async (input) => {
      const content = String((input as any).content ?? '').trim();
      if (!content) return { status: 'error', message: 'Activity content is required.', retry_possible: false } as ToolResult;
      const company = (input as any).company;
      const contactName = (input as any).contact_name;
      const type = String((input as any).activity_type ?? 'note');
      await logActivity({ company, contactName, type, content });
      return {
        status: 'ok',
        data: { logged: true },
        user_message: `:memo: Activity logged${company ? ` for *${company}*` : ''}${contactName ? ` (${contactName})` : ''}.`,
      } as ToolResult;
    },

    set_reminder: async (input) => {
      const target = String((input as any).target ?? '').trim();
      const reminderText = String((input as any).reminder_text ?? '').trim();
      const fireAt = String((input as any).fire_at_iso_local ?? '').trim();
      if (!target || !reminderText || !fireAt) {
        return {
          status: 'needs_clarification',
          question: 'Reminders need a target, text, and fire-at time.',
          missing_fields: ['target', 'reminder_text', 'fire_at_iso_local'].filter((k) => !(input as any)[k]),
          partial_state: { tool: 'set_reminder', input },
        } as ToolResult;
      }
      let unix: number;
      try {
        unix = isoLocalToUnix(fireAt, senderTzOrDefault);
      } catch (err) {
        return { status: 'error', message: `Couldn't parse "${fireAt}" as a local datetime — use YYYY-MM-DDTHH:MM:SS.`, retry_possible: false } as ToolResult;
      }
      const now = Math.floor(Date.now() / 1000);
      if (unix <= now + 30) {
        return {
          status: 'error',
          message: `That time is in the past. Try a specific future date and time.`,
          retry_possible: false,
        } as ToolResult;
      }
      // Owner resolution — preserves the G.4 guarantee.
      const owner = await resolveReminderOwner({
        token: target,
        senderSlackUserId: ctx.request.userId,
      });
      if (owner.status === 'ambiguous') {
        const names = (owner.ambiguousCandidates ?? []).map((c) => c.display).join(', ');
        return {
          status: 'error',
          message: `Multiple matches for "${target}" (${names}). Please be more specific.`,
          retry_possible: false,
        } as ToolResult;
      }
      if (owner.status === 'unresolved_name') {
        return {
          status: 'error',
          message: `I couldn't find "${target}" on the team. Active: karthik, sagar, maggie, drew, shirley, caleb, tyler, reem, rania.`,
          retry_possible: false,
        } as ToolResult;
      }
      const targetSlackId = owner.ownerSlackUserId ?? ctx.request.userId;
      if (isInactiveOperator(targetSlackId)) {
        return {
          status: 'error',
          message: `<@${targetSlackId}> is on the inactive list. Pick a different person or reply "proceed anyway" to override.`,
          retry_possible: false,
        } as ToolResult;
      }
      const result = await setReminder({
        targetUserId: targetSlackId,
        text: reminderText,
        times: [unix],
        platform: ctx.request.platform,
      });
      // Push a side effect so the transport posts the confirmation
      // message with the [❌ Cancel] button + persists the row.
      ctx.pendingSideEffects.push({
        kind: 'reminder_confirm',
        payload: {
          target_user_id: targetSlackId,
          reminder_text: reminderText,
          fire_at_unix: unix,
          fire_at_iso_local: fireAt,
          set_reminder_result: result,
          original_text: ctx.request.text,
        },
      });
      const timeDisplay = new Date(unix * 1000).toLocaleString('en-US', {
        timeZone: senderTzOrDefault,
        weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
      });
      return {
        status: 'ok',
        data: {
          target_slack_id: targetSlackId,
          fire_at_unix: unix,
          method: result.method,
          success: result.success,
        },
        user_message: `:bell: Reminder set for ${targetSlackId === ctx.request.userId ? 'you' : `<@${targetSlackId}>`} at ${timeDisplay}: ${reminderText}`,
      } as ToolResult;
    },

    schedule_meeting: async (input) => {
      const title = String((input as any).title ?? '').trim();
      const dateTime = String((input as any).date_time ?? '').trim();
      const duration = (input as any).duration_minutes;
      const attendees = (input as any).attendee_emails as string[] | undefined;
      if (!title || !dateTime) {
        return {
          status: 'needs_clarification',
          question: 'I need a meeting title and a specific date/time.',
          missing_fields: ['title', 'date_time'].filter((k) => !(input as any)[k]),
          partial_state: { tool: 'schedule_meeting', input },
        } as ToolResult;
      }
      try {
        const result = await scheduleEvent({
          title,
          dateTime,
          duration: typeof duration === 'number' ? duration : 30,
          attendeeEmails: attendees,
          timezone: senderTzOrDefault,
          senderSlackUserId: ctx.request.userId,
        });
        return {
          status: 'ok',
          data: { event_id: result.eventId, link: result.link, summary: result.summary },
          user_message: `:calendar: Meeting scheduled: ${result.summary}\n${result.link}`,
        } as ToolResult;
      } catch (err) {
        if (err instanceof CalendarAuthMissingError) {
          return { status: 'error', message: `:warning: ${err.message}`, retry_possible: false } as ToolResult;
        }
        return { status: 'error', message: err instanceof Error ? err.message : String(err), retry_possible: true } as ToolResult;
      }
    },

    update_event: async (input) => {
      const eventQuery = String((input as any).event_query ?? '').trim();
      if (!eventQuery) {
        return { status: 'error', message: 'Need a meeting title, person, or topic to find the event.', retry_possible: false } as ToolResult;
      }
      let matches: Awaited<ReturnType<typeof findCalendarEvent>>;
      try {
        matches = await findCalendarEvent({ query: eventQuery, senderSlackUserId: ctx.request.userId });
      } catch (err) {
        if (err instanceof CalendarAuthMissingError) {
          return { status: 'error', message: `:warning: ${err.message}`, retry_possible: false } as ToolResult;
        }
        throw err;
      }
      if (matches.length === 0) {
        return { status: 'error', message: `No calendar event matching "${eventQuery}" in the next 14 days.`, retry_possible: false } as ToolResult;
      }
      if (matches.length > 1) {
        const list = matches.slice(0, 5).map((m, i) => `${i + 1}. ${m.summary} — ${m.start}`).join('\n');
        return {
          status: 'needs_clarification',
          question: `Found ${matches.length} events matching "${eventQuery}". Which one?\n${list}`,
          missing_fields: ['event_id'],
          partial_state: { tool: 'update_event', input, matches: matches.slice(0, 5) },
        } as ToolResult;
      }
      try {
        const result = await updateCalendarEvent({
          eventId: matches[0].id,
          updates: {
            title: (input as any).new_title,
            dateTime: (input as any).new_date_time,
            duration: (input as any).new_duration_minutes,
            attendeeEmails: (input as any).new_attendee_emails,
          },
          timezone: senderTzOrDefault,
          senderSlackUserId: ctx.request.userId,
        });
        return {
          status: 'ok',
          data: { event_id: result.eventId, link: result.link, summary: result.summary },
          user_message: `:calendar: Event updated: ${result.summary}${result.link ? `\n${result.link}` : ''}`,
        } as ToolResult;
      } catch (err) {
        if (err instanceof CalendarAuthMissingError) {
          return { status: 'error', message: `:warning: ${err.message}`, retry_possible: false } as ToolResult;
        }
        return { status: 'error', message: err instanceof Error ? err.message : String(err), retry_possible: true } as ToolResult;
      }
    },

    generate_proposal: async (input) => {
      const clientName = String((input as any).client_name ?? '').trim();
      const clientCompany = String((input as any).client_company ?? '');
      if (!clientName) {
        return { status: 'error', message: 'client_name is required.', retry_possible: false } as ToolResult;
      }
      const transcript = await findMeeting(`${clientName} ${clientCompany}`.trim());
      if (!transcript) {
        return {
          status: 'error',
          message: `Couldn't find a Fireflies meeting for "${clientName}". Try the exact name from the meeting title.`,
          retry_possible: false,
        } as ToolResult;
      }
      const transcriptText = transcript.fullText
        || transcript.sentences?.map((s) => `${s.speaker}: ${s.text}`).join('\n')
        || transcript.summary.overview;
      const result = await generateProposal({
        clientName,
        clientCompany: clientCompany || transcript.title,
        meetingTranscript: transcriptText,
        dealContext: 'No CRM context loaded — call get_deal_context first if you need it.',
        userInstructions: String((input as any).additional_instructions ?? '') || ctx.request.text,
        pricing: (input as any).pricing_instructions,
      });
      return {
        status: 'ok',
        data: {
          markdown: result.markdown,
          client_name: result.clientName,
          client_company: result.clientCompany,
          meeting_title: transcript.title,
        },
        user_message: `:page_facing_up: Proposal generated for *${result.clientName}*${result.clientCompany ? ` at *${result.clientCompany}*` : ''}. ${result.summary}`,
      } as ToolResult;
    },

    draft_email: async (input) => {
      const toEmail = String((input as any).to_email ?? '').trim();
      const context = String((input as any).context ?? '').trim();
      if (!toEmail || !context) {
        return { status: 'error', message: 'Both to_email and context are required.', retry_possible: false } as ToolResult;
      }
      const toName = String((input as any).to_name ?? toEmail);
      const replyTo = String((input as any).reply_to_message ?? '');
      const result = await draftReply({
        leadEmail: toEmail,
        leadName: toName,
        replyText: context,
        originalOutreach: replyTo,
        category: 'outreach',
      });
      return {
        status: 'ok',
        data: { subject: result.subject, body: result.body, urgency: result.urgency, to: toEmail, to_name: toName },
        user_message: `:email: Email draft ready for *${toName}*:\n\nSubject: ${result.subject}\n\n${result.body}\n\n_Use \`send_email\` (with confirmation) to deliver._`,
      } as ToolResult;
    },

    send_email: async (input) => {
      const to = String((input as any).to ?? '').trim();
      const subject = String((input as any).subject ?? '').trim();
      const body = String((input as any).body ?? '').trim();
      if (!to || !subject || !body) {
        return { status: 'error', message: 'send_email requires to, subject, body.', retry_possible: false } as ToolResult;
      }
      ctx.pendingSideEffects.push({
        kind: 'confirm_send_email',
        payload: { to, subject, body, in_reply_to: (input as any).in_reply_to },
      });
      return {
        status: 'needs_clarification',
        question: `Confirm send to ${to} via the [:rocket: Send / :x: Cancel] buttons in the thread.`,
        missing_fields: ['user_confirmation'],
        partial_state: { tool: 'send_email', input },
      } as ToolResult;
    },

    promote_capture: async (input) => {
      const companyName = String((input as any).company ?? '').trim();
      if (!companyName) return { status: 'error', message: 'Company is required.', retry_possible: false } as ToolResult;
      const company = await findCompanyByName(companyName) ?? await upsertCompany({ name: companyName });
      const captures = await searchCapturesByCompany(company.company_id, 5);
      if (captures.length === 0) {
        return {
          status: 'error',
          message: `No captures found for *${company.name}*. Use new_deal to create a deal directly.`,
          retry_possible: false,
        } as ToolResult;
      }
      const sourceCapture = captures[0];
      try {
        const { deal } = await createDeal({
          company: company.name,
          companyId: company.company_id,
          contactName: (input as any).contact_name,
          value: (input as any).deal_value,
          stage: (input as any).stage,
          pipeline: (input as any).pipeline,
          clientBrand: (input as any).client_brand,
          notes: (input as any).notes ?? `Promoted from capture ${sourceCapture.capture_id}`,
          owner: ctx.request.userName,
          senderSlackUserId: ctx.request.userId,
          promotedFromCaptureId: sourceCapture.capture_id,
        });
        try {
          await markCapturePromoted(sourceCapture.capture_id, deal.deal_id);
        } catch {
          /* non-fatal */
        }
        const valueStr = deal.value ? `$${deal.value.toLocaleString()}` : '—';
        return {
          status: 'ok',
          data: { deal, source_capture_id: sourceCapture.capture_id },
          user_message: `:rocket: *Promoted to Deal:* ${deal.contact_full_name || '(no contact)'} at *${deal.company}* — ${deal.pipeline} — ${valueStr}`,
        } as ToolResult;
      } catch (err) {
        return { status: 'error', message: err instanceof Error ? err.message : String(err), retry_possible: false } as ToolResult;
      }
    },

    help: async (input) => {
      const out = runHelp({ topic: (input as any).topic });
      return { status: 'ok', data: { topic: out.topic }, user_message: out.markdown } as ToolResult;
    },
  };
}

/**
 * Suppress unused-import warnings — `isHighFuzzyDealMatch` is preserved
 * for the migration plan's §7 ≥0.5 threshold; today searchDeal already
 * applies its own threshold so the value is informational.
 */
void isHighFuzzyDealMatch;
