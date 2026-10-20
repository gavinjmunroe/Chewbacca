/**
 * @togari/core — Consolidated system prompts
 *
 * Single source of truth for the core conversation system prompt with
 * optional conditional injections (Smartlead tone, few-shot examples, etc.).
 *
 * Phase 1 Step 2 scope:
 * - Consolidates the `CONVERSATION_SYSTEM_PROMPT` into a single source of
 *   truth consumed by `core/engine.ts` and all transports.
 * - Introduces a no-op `loadExamples()` hook so few-shot examples can
 *   be loaded later without changing the call site.
 * - Introduces an optional `injectSmartleadTone` flag so the smartlead
 *   responder can eventually share the same base prompt (the actual
 *   BMA tone rules still live in
 *   agents/smartlead-responder/classifier.ts until that agent migrates).
 *
 * Phase 2/3 seams: the `PromptContext` argument accepts transport /
 * attachments / conversationId so future prompt logic can condition on
 * them without breaking existing callers.
 */

// ── Types ─────────────────────────────────────────────────────────

import { buildDateContext } from '../identity/date-context';

const DEFAULT_TIMEZONE = 'America/Chicago';

export interface PromptContext {
  /** Transport the request is coming from. */
  transport?: 'slack' | 'mcp' | 'teams' | 'imessage' | 'api' | 'smartlead' | 'openai';
  /** Conversation / thread identifier for multi-turn context (Phase 2 seam). */
  conversationId?: string;
  /** Whether the caller wants the Smartlead tone overlay. */
  injectSmartleadTone?: boolean;
  /** Optional per-message instructions to append to the system prompt. */
  extraInstructions?: string;
  /** Requester IANA timezone — used to inject a "today is …" anchor at the top of the prompt. */
  timezone?: string;
  /** Optional wall-clock anchor — defaults to `new Date()`. */
  now?: Date;
}

export interface FewShotExample {
  user: string;
  assistant: string;
}

// ── Base conversation prompt ──────────────────────────────────────
//
// Single source of truth for the conversation prompt. Consumed by
// core/engine.ts and all transports (Slack migrated in Step 3).

const BASE_CONVERSATION_PROMPT = `You are Togari, a sales operations assistant built by Blue Modern Advisory. You help the BMA team with their entire sales pipeline. Here's what you can do:

1. Deal Management: Create, update, and query deals. Example: 'new deal with Acme Corp at 5k monthly' or 'update Sift to closed_won'
2. Pipeline Queries: Ask about your pipeline in natural language. Example: 'show me all deals in discovery' or 'what's our total pipeline value'
3. Meeting Scheduling: Schedule meetings on Google Calendar. Example: 'meeting with John Doe at 3pm Wednesday'
4. Reminders: Set reminders for follow-ups and tasks. Example: 'remind me to follow up with Brett next week'
5. Meeting Analysis: Analyze Fireflies call recordings for next steps, action items, summaries. Example: 'suggest next steps from my last call with Carlo'
6. Proposal Generation: Generate proposals from meeting transcripts and deal data. Example: 'generate a proposal for Jane Doe at 7k monthly'
7. Email Drafting: Draft professional emails. Example: 'draft an email to John following up on our proposal'
8. CRM Queries: Natural language queries about deals, pipeline, MRR, and more.

Be helpful, concise, and friendly. Answer the user's question directly.`;

// ── Smartlead tone overlay ────────────────────────────────────────
//
// Applied on top of the base prompt when the caller sets
// `injectSmartleadTone: true`. Mirrors the tone guardrails enforced in
// the current smartlead-responder/classifier.ts BASE_SYSTEM_PROMPT so
// Step 3+ can route that agent through this module without regressing
// the BMA voice.

const SMARTLEAD_TONE_OVERLAY = `

Tone overlay — you are drafting on behalf of Sagar Tiwari at Blue Modern Advisory.
- Warm, direct, human. Contractions are fine (I'm, we're, they've).
- Match the lead's tone (casual vs. formal).
- Sign off as 'Sagar' on its own line — no 'Best,' no 'Thanks,' no 'Cheers.'
- Never use: 'strong fit,' 'great fit,' 'synergy,' 'leverage,' 'circle back,' 'touch base,' 'I hope this email finds you well,' 'reach out,' 'reaching out,' 'just wanted to,' 'quick question.'`;

// ── Few-shot examples loader (Phase 2 seam) ────────────────────────

/**
 * Returns few-shot examples to prepend to the prompt. Currently a no-op
 * stub — always returns an empty array. When examples are introduced in
 * Phase 3 they will be loaded here (e.g. from a BigQuery table of
 * curated exemplars) and filtered to the 5-10 most relevant for the
 * given `messageType`, without the caller needing to change.
 *
 * @param messageType Coarse intent bucket (e.g. 'conversation',
 *        'proposal', 'sql_generate') used to filter examples.
 * @param ctx Optional full prompt context for finer-grained selection.
 */
export function loadExamples(
  _messageType?: string,
  _ctx?: PromptContext,
): FewShotExample[] {
  return [];
}

// ── Main prompt builder ───────────────────────────────────────────

export function buildConversationPrompt(ctx: PromptContext = {}): string {
  // Always anchor the model to today's date in the requester's TZ —
  // without this the conversation handler will happily echo dates from
  // its training distribution into "what day is it" / "by when" answers.
  const dateContext = buildDateContext(ctx.timezone ?? DEFAULT_TIMEZONE, ctx.now);
  const parts: string[] = [`${dateContext}\n\n${BASE_CONVERSATION_PROMPT}`];

  if (ctx.injectSmartleadTone) {
    parts.push(SMARTLEAD_TONE_OVERLAY);
  }

  // Phase 1: no messageType yet — engine passes undefined.
  const examples = loadExamples(undefined, ctx);
  if (examples.length > 0) {
    const rendered = examples
      .map((ex, i) => `Example ${i + 1}:\nUser: ${ex.user}\nAssistant: ${ex.assistant}`)
      .join('\n\n');
    parts.push(`\n\nExamples of good responses:\n\n${rendered}`);
  }

  if (ctx.extraInstructions) {
    parts.push(`\n\n${ctx.extraInstructions}`);
  }

  return parts.join('');
}
