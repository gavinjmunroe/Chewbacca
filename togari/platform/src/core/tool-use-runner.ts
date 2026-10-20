/**
 * @togari/core — Tool-use loop runner
 *
 * The new dispatch path. Replaces `classifyIntent → switch(case)` with
 * `runClaudeLoop` over the 16 tool definitions in src/core/tool-registry.ts.
 *
 * Responsibilities:
 *   1. Build the per-invocation ToolContext (sender identity, timezone,
 *      tenant id, pending-side-effects bucket).
 *   2. Check togari_pending_clarifications for an unexpired row matching
 *      thread_ts — if present, merge `partial_state` into the request
 *      context so the user's reply resumes the in-flight tool call.
 *   3. Optionally pull recent thread context via Slack
 *      conversations.replies so multi-turn follow-ups have prior
 *      messages in the loop input.
 *   4. Run runClaudeLoop with the system prompt + tool defs + handlers.
 *   5. After the loop ends, flush ctx.pendingSideEffects (post Block
 *      Kit confirmation messages, persist reminder rows). If any
 *      handler returned status='needs_clarification', insert one row
 *      into togari_pending_clarifications keyed by thread_ts.
 *   6. Audit-log the run to togari_invocations.
 *
 * Returns a TogariResponse — same shape transports already render.
 */

import { createLogger } from '../observability/logger';
import { runClaudeLoop, type ClaudeMessage } from './claude-loop';
import {
  TOGARI_TOOL_DEFS,
  bindHandlers,
  type MutableToolContext,
  type PendingSideEffect,
} from './tool-registry';
import { resolveDatePhrases } from './identity/date-resolver';
import { buildDateContext } from './identity/date-context';
import { findUserBySlackId, type UserRow } from './identity/user-directory';
import { getUserTimezone } from './identity/slack-profile';
import { tenantStorage } from '../tenant/context';
import {
  insertPendingClarification,
  findActiveByThread,
  markResolved,
} from '../storage/pending-clarifications-store';
import { insertInvocation, type InvocationToolCall } from '../storage/invocations-store';
import { insertReminder } from '../storage/reminders-store';
import type { TogariRequest, TogariResponse, OnProgress } from './types';

const logger = createLogger('core/tool-use-runner');

const DEFAULT_TIMEZONE = 'America/New_York';

// ── Feature flag ────────────────────────────────────────────────

export function isToolLoopEnabled(): boolean {
  return process.env.TOGARI_TOOL_LOOP_ENABLED === 'true';
}

// ── System prompt builder ───────────────────────────────────────

interface SystemPromptParams {
  timezone: string;
  sender: UserRow | null;
  transport: string;
}

function buildSystemPrompt(p: SystemPromptParams): string {
  const dateContext = buildDateContext(p.timezone);
  const senderLine = p.sender
    ? `Sender: ${[p.sender.first_name, p.sender.last_name].filter(Boolean).join(' ') || p.sender.email} (slack:${p.sender.slack_user_id ?? '?'})`
    : 'Sender: unknown';

  return `You are Togari, the CRM assistant for Blue Modern Advisory (BMA). You operate via tool-use: every action you take goes through one of the 16 tools declared in this turn.

CORE RULES:

1. When uncertain between a read tool (query_deals, search_meetings, get_deal_context) and any write tool, prefer the read tool. Reads are reversible; writes are not.

2. Never call a write tool without the user's clear intent. If the user only described what happened (past), don't schedule anything new. If the user asked for data, don't log activity.

3. NEVER fall back to the sender as a reminder target when the user named someone else. If you can't resolve the target, return an error and ask — the tool handler enforces this.

4. For multi-action messages ("Pedro Noyola at meeting 2, $7500/mo, BMA inbound, remind Sagar to follow up next week"), emit ALL the tool calls in one assistant turn. Anthropic supports multiple tool_use blocks per response — use that. Order: read → context-gathering → writes.

5. When a write would have ≥3 tool calls in a single turn, you may still emit them — the runner doesn't gate batch writes today. Be deliberate about whether each call is what the user asked for.

DOMAIN VOCABULARY:

- Brands (client_brand): bma (~70% of deals), amber (~20%), rytual (~10%), togari (rare internal). Brand words as TAGS filter; brand words as PRODUCT CODENAMES do not — see query_deals docstring.
- Stages: researching, contacted, conversation_started, discovery_scheduled, discovery_complete, proposal_sent, negotiating, verbal_commit, contract_sent, closed_won, closed_lost, closed_engagement. Map: "meeting 2" → discovery_complete, "verbal yes" → verbal_commit, "they ghosted" → closed_lost.
- Pipelines: inbound, outbound, partnership, fundraising. Map: "investor"/"VC"/"LP"/"raise" → fundraising.
- Active team for reminder targets / owners: karthik, sagar, maggie, drew, shirley, caleb, tyler, reem, rania. Inactive (will warn): kevin.
- Default timezone: America/New_York. Today's context: ${dateContext}.
- Company shorthand examples (canonical): scientist → Scientist.com, kcla → KCLA, tide rock → TideRock, river → River Associates, hhh → Healthy Hip Hop, serif → Serif Health, podqi → Podqi, traba → Traba. The deal-resolver fuzzy-matches anyway — use the canonical name if you recognize it, otherwise the user's exact words.

CONFIRMATION FLOW:

- send_email, transfer_deal, and new_deal-against-existing-deal return status='needs_clarification' from the handler. The transport posts a Block Kit confirmation; do NOT prompt the user again in your text response — just acknowledge that confirmation is pending.

OUTPUT:

- For pure data answers (queries, summaries, meeting analyses), include the result text in your final assistant message.
- For write-only chains (creating 3 deals, scheduling 2 meetings), a one-line acknowledgement is enough — the transport renders per-tool confirmations.
- For mixed read+write chains, summarize what you read AND what you wrote, briefly.

${senderLine}
Transport: ${p.transport}`;
}

// ── Main entry ──────────────────────────────────────────────────

export interface RunOptions {
  /** Optional Slack channel + thread context for resume + persistence. */
  channelId?: string;
  threadTs?: string;
  /** Bot user id (for thread context filtering). Optional. */
  botUserId?: string;
  /** Prior messages from the same Slack thread, oldest-first. */
  threadHistory?: ClaudeMessage[];
  /** Progress callback (long-running tools). */
  onProgress?: OnProgress;
}

export interface RunResult {
  response: TogariResponse;
  /** Side effects the transport must execute after the response is rendered. */
  pendingSideEffects: PendingSideEffect[];
  /** Invocation id (audit trail). */
  invocationId: string;
}

function getCurrentTenantId(): string {
  const ctx = tenantStorage.getStore();
  return ctx?.tenantId ?? 'bma';
}

async function loadSender(slackUserId: string | undefined): Promise<UserRow | null> {
  if (!slackUserId) return null;
  try {
    return await findUserBySlackId(slackUserId);
  } catch (err) {
    logger.warn('findUserBySlackId failed', { error: err instanceof Error ? err.message : String(err) });
    return null;
  }
}

async function resolveTimezone(slackUserId: string | undefined): Promise<string> {
  if (!slackUserId) return DEFAULT_TIMEZONE;
  try {
    return await getUserTimezone(slackUserId);
  } catch {
    return DEFAULT_TIMEZONE;
  }
}

/**
 * The new entry path. Wraps runClaudeLoop with all the surrounding
 * production concerns (sender resolution, pending-clarification resume,
 * audit logging, side-effect flushing).
 */
export async function runToolUseLoop(
  request: TogariRequest,
  options: RunOptions = {},
): Promise<RunResult> {
  const startedAt = new Date();
  const tenantId = getCurrentTenantId();
  const timezone = await resolveTimezone(request.userId);
  const sender = await loadSender(request.userId);

  // Date pre-resolver — emits [date: YYYY-MM-DD] / [time: HH:MM] markers
  // so the LLM doesn't compute timestamps itself.
  const { rewritten } = resolveDatePhrases(request.text, timezone);

  const ctx: MutableToolContext = {
    request,
    sender,
    timezone,
    tenantId,
    pendingSideEffects: [],
  };

  // Pending-clarification resume check.
  let resumeContext: string | null = null;
  let activeClarificationId: string | null = null;
  if (options.threadTs) {
    const active = await findActiveByThread(options.threadTs, tenantId);
    if (active) {
      activeClarificationId = active.clarification_id;
      const ps = active.partial_state ?? {};
      resumeContext = `[CLARIFICATION RESUME] Earlier in this thread you started a ${ps.tool ?? 'tool'} call and asked: "${active.question_asked ?? '(no question recorded)'}" The user's previous message was: "${active.original_message ?? '(unrecorded)'}" The partial input was: ${JSON.stringify(ps.input ?? {})}. The user's new message is the answer — merge it and complete the call.`;
    }
  }

  // Build the message list. Prior thread context (oldest-first) +
  // resume context (synthetic system-style nudge in the user role) +
  // the current rewritten message.
  const messages: ClaudeMessage[] = [];
  if (options.threadHistory && options.threadHistory.length > 0) {
    messages.push(...options.threadHistory);
  }
  if (resumeContext) {
    messages.push({ role: 'user', content: resumeContext });
  }
  messages.push({ role: 'user', content: rewritten });

  // Run the loop.
  const handlers = bindHandlers(ctx);
  const system = buildSystemPrompt({ timezone, sender, transport: request.platform });

  let toolCallsForAudit: InvocationToolCall[] = [];
  let finalText = '';
  let iterationCount = 0;
  let errorText: string | undefined;

  try {
    const result = await runClaudeLoop({
      system,
      messages,
      tools: TOGARI_TOOL_DEFS,
      toolHandlers: handlers,
      messageType: 'other',
      complexity: 'high',
      maxIterations: 10,
      maxTokens: 4096,
    });
    finalText = result.text;
    iterationCount = result.iterations;
    toolCallsForAudit = result.toolCalls.map((tc) => {
      const out = tc.output as { status?: string } | undefined;
      const status: InvocationToolCall['status'] = (() => {
        const s = out?.status;
        if (s === 'ok') return 'ok';
        if (s === 'needs_clarification') return 'needs_clarification';
        return 'error';
      })();
      return {
        name: tc.name,
        input: tc.input,
        output: tc.output,
        duration_ms: 0,
        status,
      };
    });
  } catch (err) {
    errorText = err instanceof Error ? err.message : String(err);
    logger.error('runClaudeLoop threw', err instanceof Error ? err : new Error(errorText));
    return {
      response: {
        type: 'error',
        text: `Something went wrong while processing: ${errorText}. Please try again or rephrase.`,
      },
      pendingSideEffects: ctx.pendingSideEffects,
      invocationId: '',
    };
  }

  // If any handler returned needs_clarification AND we have a threadTs,
  // persist a row so the next user message resumes the call.
  const needsClar = toolCallsForAudit.find((t) => t.status === 'needs_clarification');
  if (needsClar && options.threadTs && !activeClarificationId) {
    const out = needsClar.output as {
      question?: string;
      partial_state?: Record<string, unknown>;
    };
    await insertPendingClarification({
      thread_ts: options.threadTs,
      channel_id: options.channelId,
      user_id: request.userId,
      tenant_id: tenantId,
      original_message: request.text,
      partial_state: out.partial_state ?? {},
      question_asked: out.question ?? null,
      tool_name: needsClar.name,
    });
  }

  // If we resumed and the loop produced any non-clarification tool call,
  // mark the original clarification resolved.
  if (activeClarificationId) {
    const resolvedWithSomething = toolCallsForAudit.some((t) => t.status === 'ok');
    if (resolvedWithSomething || needsClar) {
      await markResolved(activeClarificationId, resolvedWithSomething ? 'resumed_ok' : 'asked_again');
    }
  }

  // Build the final TogariResponse. Aggregation: prefer the last tool's
  // user_message when present; fall back to Claude's text; if both
  // empty, return a generic ack.
  const lastOk = [...toolCallsForAudit].reverse().find((t) => t.status === 'ok') ?? toolCallsForAudit[toolCallsForAudit.length - 1];
  let responseText = finalText.trim();
  if (!responseText) {
    if (lastOk) {
      const out = lastOk.output as { user_message?: string; message?: string };
      responseText = out.user_message || out.message || `Tool ${lastOk.name} completed.`;
    } else {
      responseText = "I'm not sure I understood that — could you rephrase?";
    }
  }

  const completedAt = new Date();
  const invocationId = await insertInvocation({
    user_id: request.userId,
    channel_id: options.channelId,
    thread_ts: options.threadTs,
    tenant_id: tenantId,
    original_message: request.text,
    tools_called: toolCallsForAudit,
    final_response: responseText,
    iteration_count: iterationCount,
    started_at: startedAt,
    completed_at: completedAt,
    error_text: errorText,
  });

  // Persist any reminder rows so the [❌ Cancel] button can find them.
  // (We do this here in the runner — handlers don't have storage access
  // by design; they only push side effects.) We thread the per-time API
  // method + Slack-side ID through so the cancel handler can call the
  // right delete endpoint (reminders.delete vs chat.deleteScheduledMessage).
  for (const side of ctx.pendingSideEffects) {
    if (side.kind === 'reminder_confirm') {
      const p = side.payload as {
        target_user_id?: string;
        reminder_text?: string;
        fire_at_unix?: number;
        set_reminder_result?: {
          method?: string;
          success?: boolean;
          details?: string;
          perTime?: Array<{
            unixTime: number;
            success: boolean;
            apiMethod?: 'reminders.add' | 'chat.scheduleMessage';
            slackReminderId?: string;
            scheduledMessageId?: string;
          }>;
        };
        original_text?: string;
      };
      // The set_reminder tool always calls setReminder with a single-time
      // array, so perTime has at most one entry. Match by unixTime to be
      // defensive against future multi-time calls.
      const perTime = p.set_reminder_result?.perTime?.find((t) => t.unixTime === p.fire_at_unix)
        ?? p.set_reminder_result?.perTime?.[0];
      const reminderId = await insertReminder({
        tenant_id: tenantId,
        creator_user_id: request.userId,
        target_user_id: p.target_user_id ?? null,
        channel: options.channelId ?? null,
        thread_ts: options.threadTs ?? null,
        original_text: p.original_text ?? request.text,
        reminder_text: p.reminder_text ?? null,
        scheduled_at: p.fire_at_unix ? new Date(p.fire_at_unix * 1000) : null,
        slack_scheduled_message_id: perTime?.scheduledMessageId ?? null,
        slack_reminder_id: perTime?.slackReminderId ?? null,
        slack_api_method: perTime?.apiMethod ?? null,
        status: perTime?.success === false ? 'failed' : 'scheduled',
      });
      // Stash the reminder id on the side-effect payload so the
      // transport can include it on the [❌ Cancel] button.
      (side.payload as Record<string, unknown>).reminder_id = reminderId;
    }
  }

  return {
    response: { type: 'text', text: responseText, data: { invocation_id: invocationId, tool_calls: toolCallsForAudit.length } },
    pendingSideEffects: ctx.pendingSideEffects,
    invocationId,
  };
}
