/**
 * @togari/transports/slack — Slack events route handler
 *
 * Handles POST /slack/events for the @Togari CRM bot.
 * Verifies Slack request signatures, parses messages with the core
 * intent classifier, routes every action through `core/engine.executeIntent`,
 * and surfaces intermediate progress + final results back into the thread.
 *
 * Phase 1 Step 3: the transport is a THIN shell — all domain logic
 * (deal CRUD, SQL queries, calendar events, proposal generation,
 * meeting analysis, conversation replies) lives in `core/`. This file
 * owns only Slack-specific concerns: signature verification, event
 * dedup, Block Kit formatting, progress callbacks, and conflict UX.
 */

import crypto from 'crypto';
import type { Request, Response } from 'express';
import { createLogger } from '../../observability/logger';
import { parseSlackMessage } from './parser';
import { syncDeal } from './deal-sync';
import { syncCalendar } from './calendar-sync';
import { postClarificationMessage, postTextReply } from './responder';
import { postProposalToSlack } from './proposal-output';
import { executeIntent } from '../../core/engine';
import { isToolLoopEnabled, runToolUseLoop } from '../../core/tool-use-runner';
import { getBotUserId } from './bot-identity';
import { isHomeWorkspaceEvent } from './workspace-gate';
import { clientForSlack } from '../../agents/replybot/client-config';
import { handleClientMention, handleClientMessage } from '../../agents/client-assistant';
import { getThreadContext } from './thread-context';
import { postReminderConfirm } from './reminder-confirm';
import {
  buildSendEmailConfirmBlocks,
  buildTransferDealConfirmBlocks,
  buildNewDealDedupeConfirmBlocks,
  buildCoalescedConfirmBlocks,
  shouldCoalesce,
} from './confirm-actions';
import { resolveReminderOwner, isOwnerRoutingEnabled, getUserTimezone } from '../../core/identity';
import { isInactiveOperator } from '../../core/identity/mention-resolver';
import {
  resolveDatePhrases,
  resolveDurationPhrase,
  resolveImpliedDuration,
} from '../../core/identity/date-resolver';
import { isoLocalToUnix } from '../../core/identity/date-context';
import type { ParsedIntent, TogariRequest, OnProgress } from '../../core/types';

const logger = createLogger('SlackEventsHandler');

// G.5 — first-person vocabulary used by the suspicious-reminder assertion
// to distinguish "remind me" (sender=target is correct) from "remind dave"
// where sender=target means the resolver miss became a wrong-target bug.
const FIRST_PERSON_TOKENS = new Set(['i', 'me', 'my', 'mine', 'myself', 'self']);

// ── Event deduplication ─────────────────────────────────────────
// Slack retries events if it doesn't get a 200 fast enough.
// Track processed event_ids with timestamps; purge entries older than 5 min.
const processedEvents = new Map<string, number>();
const DEDUP_TTL_MS = 5 * 60 * 1000;

// ── In-memory clarification state ───────────────────────────────
// When schedule_meeting fires the time-gate (date but no time), we
// stash the partial intent here keyed by thread_ts. The next mention
// in the same thread that arrives with a [time: HH:MM] marker (after
// resolveDatePhrases) merges that time into the stored intent and
// executes it directly, skipping the parser. NOT persisted — process
// restarts forget pending clarifications, which is acceptable for a
// 15-minute TTL.
interface PendingClarification {
  intent: ParsedIntent;
  slackUser: string;
  channel: string;
  threadTs: string;
  // 'inactive_operator_confirm' is stashed by the F.2 guardrail when the
  // resolved Slack id is in INACTIVE_OPERATORS. The user's follow-up
  // ("yes proceed" / "assign to Sagar" / "never mind") will drive the
  // resume — wiring that resume is a follow-up patch; for now the stash
  // just lives until the TTL sweeper purges it.
  awaitingField: 'calendar_time' | 'calendar_duration' | 'inactive_operator_confirm';
  /** Original user text — used for implied-duration keyword detection on resume. */
  originalText?: string;
  createdAt: number;
}
const PENDING_CLARIFICATION_TTL_MS = 15 * 60 * 1000;
const PENDING_CLARIFICATION_CLEANUP_MS = 5 * 60 * 1000;
const pendingClarifications = new Map<string, PendingClarification>();

function purgePendingClarifications(now: number = Date.now()): void {
  for (const [key, p] of pendingClarifications) {
    if (now - p.createdAt > PENDING_CLARIFICATION_TTL_MS) {
      pendingClarifications.delete(key);
    }
  }
}

// Periodic cleanup. .unref() so the interval doesn't keep node alive
// in tests / short-lived scripts.
const _clarificationCleanupTimer: any = setInterval(
  () => purgePendingClarifications(),
  PENDING_CLARIFICATION_CLEANUP_MS,
);
if (typeof _clarificationCleanupTimer?.unref === 'function') {
  _clarificationCleanupTimer.unref();
}

// Test-only hooks (used by smoke tests).
export function _resetPendingClarifications(): void {
  pendingClarifications.clear();
}
export function _getPendingClarifications(): Map<string, PendingClarification> {
  return pendingClarifications;
}

function isDuplicate(eventId: string): boolean {
  // Purge stale entries
  const now = Date.now();
  for (const [id, ts] of processedEvents) {
    if (now - ts > DEDUP_TTL_MS) {
      processedEvents.delete(id);
    }
  }

  if (processedEvents.has(eventId)) {
    return true;
  }
  processedEvents.set(eventId, now);
  return false;
}

function verifySlackSignature(rawBody: string, timestamp: string, signature: string): boolean {
  const signingSecret = process.env.SLACK_SIGNING_SECRET;

  if (!signingSecret) {
    logger.warn('SLACK_SIGNING_SECRET not set — skipping signature verification (dev mode)');
    return true;
  }

  // Replay protection: reject requests older than 5 minutes
  const requestTime = parseInt(timestamp, 10);
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - requestTime) > 300) {
    logger.warn('Slack request timestamp too old', { requestTime, now, diff: Math.abs(now - requestTime) });
    return false;
  }

  const baseString = `v0:${timestamp}:${rawBody}`;
  const hmac = crypto.createHmac('sha256', signingSecret).update(baseString).digest('hex');
  const expectedSignature = `v0=${hmac}`;

  try {
    return crypto.timingSafeEqual(
      Buffer.from(expectedSignature, 'utf8'),
      Buffer.from(signature, 'utf8'),
    );
  } catch (err) {
    console.error('SLACK ERROR:', err instanceof Error ? err.message : err);
    console.error('SLACK STACK:', err instanceof Error ? err.stack : 'no stack');
    return false;
  }
}

export async function slackEventsHandler(req: Request, res: Response): Promise<void> {
  console.log('Slack event received', { method: req.method, path: req.path, contentType: req.headers['content-type'] });
  try {
    const rawBody = typeof req.body === 'string' ? req.body : String(req.body);
    let payload: any;

    try {
      payload = JSON.parse(rawBody);
    } catch (err) {
      console.error('SLACK ERROR:', err instanceof Error ? err.message : err);
      console.error('SLACK STACK:', err instanceof Error ? err.stack : 'no stack');
      logger.error('Failed to parse Slack event body as JSON');
      res.status(400).json({ error: 'Invalid JSON' });
      return;
    }

    // URL verification challenge
    if (payload.type === 'url_verification') {
      console.log('SLACK STEP: url_verification challenge');
      logger.info('Slack URL verification challenge received');
      res.status(200).json({ challenge: payload.challenge });
      return;
    }

    // Verify signature
    console.log('SLACK STEP: before signature verification');
    const timestamp = req.headers['x-slack-request-timestamp'] as string || '';
    const signature = req.headers['x-slack-signature'] as string || '';

    if (!verifySlackSignature(rawBody, timestamp, signature)) {
      console.log('SLACK STEP: signature verification FAILED');
      logger.warn('Slack signature verification failed');
      res.status(401).json({ error: 'Invalid signature' });
      return;
    }
    console.log('SLACK STEP: after signature verification — passed');

    // Return 200 immediately — Slack requires <3s response
    res.status(200).json({ ok: true });

    // Process asynchronously
    const event = payload.event;
    // A plain message in a client's own channel: Jonah and Ryan talk to Togari
    // without tagging it (Caleb, 2026-10-17). Only the channel itself counts
    // here, never the client's people in some other channel, and only a
    // person's own new message (no edits, joins or bot posts).
    if (event?.type === 'message' && !event.subtype && !event.bot_id && event.user) {
      const forChannel = clientForSlack(event.channel as string);
      if (!forChannel) return;
      const evId = payload.event_id || event.client_msg_id || event.ts;
      if (evId && isDuplicate(evId)) return;
      getBotUserId()
        .catch(() => '')
        .then((botUserId) =>
          handleClientMessage(
            forChannel,
            { user: event.user, channel: event.channel, ts: event.ts, thread_ts: event.thread_ts, text: event.text || '' },
            botUserId,
          ),
        )
        .catch((err) => logger.error('Client message failed', err instanceof Error ? err : new Error(String(err))));
      return;
    }
    if (!event || event.type !== 'app_mention') {
      console.log('SLACK STEP: not an app_mention event, ignoring', { type: event?.type });
      return;
    }

    // A client's channel, or a client's own person, talks to that client's
    // assistant and never reaches BMA's (src/agents/client-assistant).
    const forClient = clientForSlack(event.channel as string, event.user as string);
    if (forClient && !event.bot_id) {
      const evId = payload.event_id || event.client_msg_id || event.ts;
      if (evId && isDuplicate(evId)) return;
      handleClientMention(forClient, {
        user: event.user, channel: event.channel, ts: event.ts, thread_ts: event.thread_ts, text: event.text || '',
      }).catch((err) => logger.error('Client assistant failed', err instanceof Error ? err : new Error(String(err))));
      return;
    }

    // The assistant answers in the home workspace only. A client workspace
    // that installed Togari for its reply cards must not reach BMA's data.
    if (!(await isHomeWorkspaceEvent(payload))) {
      logger.warn('Ignoring app_mention from another workspace', {
        teamId: payload.authorizations?.[0]?.team_id ?? payload.team_id,
      });
      return;
    }

    // Deduplicate — Slack retries if it thinks we were too slow
    const eventId = payload.event_id || event.client_msg_id || event.ts;
    if (eventId && isDuplicate(eventId)) {
      console.log('SLACK STEP: duplicate event, skipping', { eventId });
      logger.info('Duplicate Slack event, skipping', { eventId });
      return;
    }

    // Ignore bot messages to prevent loops
    if (event.bot_id) {
      console.log('SLACK STEP: ignoring bot message', { botId: event.bot_id });
      logger.debug('Ignoring bot message', { botId: event.bot_id });
      return;
    }

    const slackUser = event.user as string;
    const channel = event.channel as string;
    const threadTs = (event.thread_ts || event.ts) as string;
    const rawText = (event.text || '') as string;

    // Strip ONLY the leading bot-mention prefix (@togari ...). Mentions
    // inside the body (@kevin, @sagar) survive so the intent router and
    // the owner resolver can see them. Previously we globally stripped
    // every <@U...> token, which was the root cause of reminders firing
    // at sender regardless of which user was @mentioned.
    const cleanedText = rawText.replace(/^\s*<@[A-Z0-9]+>\s*/, '').trim();
    console.log('SLACK STEP: cleaned text', { cleanedText, slackUser, channel });

    if (!cleanedText) {
      console.log('SLACK STEP: empty message after stripping mention, ignoring');
      logger.info('Empty message after stripping mention, ignoring');
      return;
    }

    processSlackMessage(cleanedText, slackUser, channel, threadTs, rawText).catch((err: any) => {
      console.error('SLACK ERROR:', err instanceof Error ? err.message : err);
      console.error('SLACK STACK:', err instanceof Error ? err.stack : 'no stack');
      logger.error('Async Slack message processing failed', err instanceof Error ? err : new Error(String(err)), { channel, slackUser, error: err?.message, stack: err?.stack });
    });
  } catch (err) {
    console.error('SLACK ERROR:', err instanceof Error ? (err as Error).message : err);
    console.error('SLACK STACK:', err instanceof Error ? (err as Error).stack : 'no stack');
    logger.error('Slack events handler error', err as Error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Internal error' });
    }
  }
}

// ── Single-action handler result ─────────────────────────────────

interface ActionResult {
  success: boolean;
  summary: string;    // One-line summary for aggregated reply
  emoji: string;      // Emoji prefix for the summary line
  details?: string;   // Extra text (e.g. calendar link) — only used for non-aggregated single replies
  isClarification?: boolean; // True when this result is asking the user for missing info
}

/**
 * Build the universal TogariRequest from a Slack event. Slack-specific
 * identifiers (userId, channelId, threadTs, rawText with `<@U...>`
 * mentions) are preserved on `transportMetadata` so the core and any
 * tools that care about origin info can pick them up.
 */
function buildRequest(
  slackUser: string,
  channel: string,
  threadTs: string,
  rawText: string,
  cleanedText: string,
): TogariRequest {
  return {
    text: cleanedText,
    userId: slackUser,
    platform: 'slack',
    transport: 'slack',
    transportMetadata: {
      userId: slackUser,
      channelId: channel,
      threadTs,
      rawText,
    },
  };
}

/**
 * Render a calendarDate field as a natural English phrase. The parser
 * may emit an ISO date ("2026-05-13"), a weekday ("Tuesday"), or a
 * phrase ("next Tuesday"). For ISO dates we render the weekday so
 * the prompt-for-time message reads like "What time on Tuesday?"
 * instead of "What time on 2026-05-13?".
 */
function humanizeCalendarDate(date?: string): string {
  if (!date) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    const d = new Date(`${date}T12:00:00`);
    if (!isNaN(d.getTime())) {
      return d.toLocaleString('en-US', { weekday: 'long' });
    }
  }
  return date;
}

/**
 * Render a calendarDate as "Tuesday, May 12" (weekday + month + day).
 * Used in the success summary for schedule_meeting. Falls back to the
 * weekday-only humanization, then the raw value, when the input isn't
 * a YYYY-MM-DD ISO string.
 */
function formatMeetingDate(date?: string): string {
  if (!date) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    const d = new Date(`${date}T12:00:00`);
    if (!isNaN(d.getTime())) {
      return d.toLocaleString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
    }
  }
  return humanizeCalendarDate(date);
}

/**
 * Format a "HH:MM" 24-hour time string as "2:00 PM". Returns the
 * input unchanged when it doesn't match HH:MM, so callers can pass
 * through pre-humanized values like "3pm" without surprise.
 */
function formatTime12h(time?: string): string {
  if (!time) return '';
  const m = /^(\d{1,2}):(\d{2})$/.exec(time);
  if (!m) return time;
  let h = parseInt(m[1], 10);
  const mm = m[2];
  if (Number.isNaN(h) || h < 0 || h > 23) return time;
  const meridiem = h >= 12 ? 'PM' : 'AM';
  if (h === 0) h = 12;
  else if (h > 12) h -= 12;
  return `${h}:${mm} ${meridiem}`;
}

/**
 * Build the success-line summary for a scheduled meeting. Includes
 * meeting title, weekday + month/day, 12-hour start time, duration,
 * attendees (joined by commas), and a Slack-formatted Google Calendar
 * link. Empty pieces are omitted gracefully.
 */
function buildMeetingSuccessSummary(
  parsed: ParsedIntent,
  htmlLink: string,
): string {
  const title =
    parsed.meetingTitle ||
    (parsed.rawFields?.calendar?.meeting_title as string | undefined) ||
    (parsed.rawFields?.calendar?.title as string | undefined) ||
    `Meeting${parsed.contactName ? ` with ${parsed.contactName}` : ''}`;
  const dateStr = formatMeetingDate(parsed.calendarDate);
  const timeStr = formatTime12h(parsed.calendarTime);
  const dateAtTime = [dateStr, timeStr ? `at ${timeStr}` : ''].filter(Boolean).join(' ').trim();
  const dur = parsed.calendarDuration ? ` (${parsed.calendarDuration} min)` : '';
  const attendees = (parsed.calendarAttendees ?? []).filter(Boolean);
  const attendeesStr = attendees.length > 0 ? ` with ${attendees.join(', ')}` : '';
  const linkStr = htmlLink ? ` — <${htmlLink}|Open in Google Calendar>` : '';
  const when = dateAtTime ? ` scheduled for *${dateAtTime}*` : ' scheduled';
  return `*${title}*${when}${dur}${attendeesStr}${linkStr}`;
}

/**
 * Build an onProgress callback that posts intermediate status updates
 * into the originating Slack thread via `postTextReply` (WebClient path).
 */
function buildOnProgress(channel: string, threadTs: string): OnProgress {
  return async (update) => {
    if (!update.message) return;
    try {
      await postTextReply(channel, threadTs, update.message);
    } catch (err) {
      logger.warn('Failed to post progress update', { error: String(err) });
    }
  };
}

/**
 * Slack-specific reminder scheduling. Reminders are a first-class
 * Slack primitive (chat.scheduleMessage) rather than a BQ/DB row, so
 * we handle them directly in the transport instead of routing through
 * core/tools/reminder-ops. Only called for `set_reminder` intents that
 * have a concrete `reminderTimes[]` array resolved by the parser.
 */
async function handleSlackReminder(
  parsed: ParsedIntent,
  slackUser: string,
  channel: string,
  threadTs: string,
  rawText?: string,
  requesterTimezone: string = 'America/New_York',
): Promise<ActionResult> {
  const reminderText =
    parsed.reminderText ||
    parsed.rawFields?.reminder_text ||
    parsed.rawFields?.reminder?.reminder_text ||
    parsed.rawFields?.reminder?.message;
  // Parser emits ISO-local datetime strings; we convert to Unix epoch
  // here so we own the timezone math (and can enforce a past-time gate).
  const reminderTimeStrings: string[] =
    parsed.reminderTimes ||
    parsed.rawFields?.reminder_times ||
    parsed.rawFields?.reminder?.reminder_times ||
    [];
  const reminderTimes: number[] = [];
  for (const iso of reminderTimeStrings) {
    try {
      reminderTimes.push(isoLocalToUnix(iso, requesterTimezone));
    } catch (err) {
      logger.warn('Skipping malformed reminder time', {
        iso,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Past-time guard: LLMs sometimes infer a past timestamp when the
  // user's phrase is ambiguous ("this morning" said at 3pm). Drop any
  // time that's already happened (with a 30s grace window). If every
  // parsed time is in the past, ask the user to re-specify.
  const nowEpoch = Math.floor(Date.now() / 1000);
  const validTimes: number[] = [];
  const pastTimes: number[] = [];
  for (const t of reminderTimes) {
    if (t > nowEpoch + 30) {
      validTimes.push(t);
    } else {
      pastTimes.push(t);
    }
  }
  if (validTimes.length === 0 && pastTimes.length > 0) {
    await postTextReply(
      channel,
      threadTs,
      `:warning: I parsed "${reminderText ?? 'that'}" as a time in the past. ` +
        `Can you give me a specific date and time? (e.g. "Tuesday at 3pm" or "tomorrow morning")`,
    );
    return {
      success: false,
      summary: 'reminder timing in the past — asked for clarification',
      emoji: ':warning:',
    };
  }
  if (pastTimes.length > 0) {
    logger.warn('Dropping past-dated reminder times', { count: pastTimes.length });
  }

  const llmTargetToken: string | undefined =
    parsed.reminderTarget ||
    parsed.rawFields?.reminder_target ||
    parsed.rawFields?.reminder?.reminder_target;

  // Owner routing (feature-flagged). Falls back to sender on error or
  // when the flag is disabled — legacy behaviour unchanged.
  let reminderTarget: string = llmTargetToken || slackUser;
  if (isOwnerRoutingEnabled()) {
    try {
      const owner = await resolveReminderOwner({
        token: llmTargetToken,
        senderSlackUserId: slackUser,
        rawText,
      });
      if (owner.status === 'ambiguous') {
        const names = (owner.ambiguousCandidates ?? []).map((c) => c.display).join(', ');
        return {
          success: false,
          summary: `*Reminder:* who did you mean — ${names}? Please rephrase with @mention or a fuller name.`,
          emoji: ':raised_hand:',
        };
      }
      // G.4 — refuse to send to the sender when a name was extracted
      // but didn't resolve. This is the wrong-person-got-reminded path.
      if (owner.status === 'unresolved_name') {
        return {
          success: false,
          summary: `I couldn't find "${owner.inputToken ?? llmTargetToken ?? 'that person'}" on the team. Did you mean someone specific? Try @-mentioning them or using their full name. (Active team: karthik, sagar, maggie, drew, shirley, caleb, tyler, reem, rania)`,
          emoji: ':raised_hand:',
        };
      }
      if (owner.ownerSlackUserId) {
        reminderTarget = owner.ownerSlackUserId;
      }
    } catch (err) {
      console.warn('[reminder] owner resolver failed; using sender fallback:', err instanceof Error ? err.message : err);
    }
  }

  // F.2 inactive-operator guardrail: refuse to schedule a NEW reminder
  // for someone who's left the team. Stash the parsed intent so the
  // user's follow-up reply ("yes proceed" / "use karthik" / "cancel")
  // can resume via the inactive_operator_confirm branch in
  // processSlackMessage. __overrideInactive is set by that resume path
  // when the user confirms, so we skip this gate on the re-entry.
  if (isInactiveOperator(reminderTarget) && !parsed.__overrideInactive) {
    pendingClarifications.set(threadTs, {
      intent: parsed,
      slackUser,
      channel,
      threadTs,
      awaitingField: 'inactive_operator_confirm',
      originalText: rawText,
      createdAt: Date.now(),
    });
    return {
      success: false,
      summary: `:information_source: <@${reminderTarget}> is no longer an active operator and won't receive reminders. Want me to assign to Karthik or Sagar instead, or rephrase with a different person?`,
      emoji: ':information_source:',
      isClarification: true,
    };
  }

  if (reminderText && validTimes.length > 0) {
    const token = process.env.SLACK_BOT_TOKEN;
    if (!token) {
      return { success: false, summary: `Reminder "${reminderText}" — SLACK_BOT_TOKEN not set`, emoji: ':warning:' };
    }

    // G.5 — assertion logging. Every reminder write emits a structured
    // line with the resolved target so wrong-target bugs are grep-able
    // in prod logs. The SUSPICIOUS_REMINDER warn below fires when
    // sender == target but the LLM extracted a non-first-person name —
    // the canonical wrong-person-got-reminded signal.
    logger.info('Reminder scheduling', {
      originalTarget: parsed.reminderTarget ?? null,
      resolvedSlackId: reminderTarget,
      isSender: reminderTarget === slackUser,
      isInactive: isInactiveOperator(reminderTarget),
      reminderText,
      unixTimes: validTimes,
    });
    if (
      reminderTarget === slackUser &&
      parsed.reminderTarget &&
      !FIRST_PERSON_TOKENS.has(parsed.reminderTarget.toLowerCase())
    ) {
      logger.warn('SUSPICIOUS REMINDER: resolved target equals sender but LLM extracted a third-party name', {
        parsedTarget: parsed.reminderTarget,
        sender: slackUser,
        reminderText,
      });
    }

    let successCount = 0;
    const errors: string[] = [];
    const succeededTimes: number[] = [];
    for (const unixTime of validTimes) {
      try {
        const res = await fetch('https://slack.com/api/chat.scheduleMessage', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json; charset=utf-8',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            channel: reminderTarget,
            text: `:bell: Reminder: ${reminderText}`,
            post_at: unixTime,
          }),
        });
        const resBody = await res.text();
        let data: any;
        try { data = JSON.parse(resBody); } catch { data = { ok: false, error: resBody }; }
        if (res.ok && data.ok) {
          successCount++;
          succeededTimes.push(unixTime);
        } else {
          errors.push(String(data.error || 'unknown_error'));
          console.error(`[reminder] chat.scheduleMessage failed: ${data.error}`);
        }
      } catch (err) {
        errors.push(err instanceof Error ? err.message : String(err));
        console.error('[reminder] chat.scheduleMessage threw:', err instanceof Error ? err.message : err);
      }
    }

    // Honest confirmation: if NOTHING was scheduled, return failure with
    // the underlying Slack error (e.g. time_too_early). If only some
    // succeeded, surface that too rather than lying about success.
    if (successCount === 0) {
      const errSummary = errors.length > 0 ? ` (${errors.join(', ')})` : '';
      return {
        success: false,
        summary: `:warning: Could not schedule reminder "${reminderText}"${errSummary}`,
        emoji: ':warning:',
      };
    }

    const targetDisplay = reminderTarget === slackUser ? 'you' : `<@${reminderTarget}>`;
    const timeDisplay = succeededTimes.map(t => new Date(t * 1000).toLocaleString('en-US', {
      timeZone: requesterTimezone,
      weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
    })).join(', ');
    const partial = successCount < validTimes.length
      ? ` (${validTimes.length - successCount} of ${validTimes.length} failed: ${errors.join(', ')})`
      : '';
    return {
      success: true,
      summary: `:bell: Reminder set for ${targetDisplay} at ${timeDisplay}: ${reminderText}${partial}`,
      emoji: ':bell:',
    };
  }

  return { success: false, summary: `Couldn't determine reminder timing`, emoji: ':warning:' };
}

/** Process a single parsed action and return the result (no Slack posting). */
export async function processSingleAction(
  parsed: ParsedIntent,
  slackUser: string,
  channel: string,
  threadTs: string,
  rawText: string,
  cleanedText: string,
  requesterTimezone: string = 'America/New_York',
): Promise<ActionResult> {
  // ── Conversation ── delegate to core engine's conversation handler
  if (parsed.intent === 'conversation') {
    const request = buildRequest(slackUser, channel, threadTs, rawText, cleanedText);
    const response = await executeIntent(parsed, request);
    return { success: true, summary: response.text, emoji: ':speech_balloon:', details: response.text };
  }

  // ── Set reminder ── Slack-specific scheduling path
  if (parsed.intent === 'set_reminder') {
    return handleSlackReminder(parsed, slackUser, channel, threadTs, rawText, requesterTimezone);
  }

  // ── Generate proposal ── core engine, render markdown via Block Kit
  if (parsed.intent === 'generate_proposal') {
    const request = buildRequest(slackUser, channel, threadTs, rawText, cleanedText);
    const onProgress = buildOnProgress(channel, threadTs);
    const response = await executeIntent(parsed, request, onProgress);

    if (response.type === 'error') {
      return { success: false, summary: response.text, emoji: ':warning:' };
    }

    const markdown = response.data?.markdown as string | undefined;
    const clientName = (response.data?.clientName as string) || parsed.targetPerson || 'client';
    const clientCompany = (response.data?.clientCompany as string) || '';
    if (markdown) {
      await postProposalToSlack(channel, threadTs, markdown, clientName, undefined);
    }
    return {
      success: true,
      summary: `*Proposal:* generated for *${clientName}*${clientCompany ? ` at *${clientCompany}*` : ''}`,
      emoji: ':page_facing_up:',
    };
  }

  // ── Analyze meeting ── core engine, post the analysis text directly
  if (parsed.intent === 'analyze_meeting') {
    const request = buildRequest(slackUser, channel, threadTs, rawText, cleanedText);
    const onProgress = buildOnProgress(channel, threadTs);
    const response = await executeIntent(parsed, request, onProgress);

    if (response.type === 'error') {
      return { success: false, summary: response.text, emoji: ':warning:' };
    }

    const analysisText = response.text;
    await postTextReply(channel, threadTs, analysisText);
    const displayTarget = parsed.targetPerson || (response.data?.meetingTitle as string) || cleanedText;
    return { success: true, summary: `*Meeting Analysis:* posted for *${displayTarget}*`, emoji: ':bulb:' };
  }

  // ── Query ── route through the engine (matches every other intent in this file).
  // The engine resolves sender identity from request.userId via findUserBySlackId
  // and surfaces forbidden-SQL errors as response.type === 'error'.
  if (parsed.intent === 'query') {
    const request = buildRequest(slackUser, channel, threadTs, rawText, cleanedText);
    const response = await executeIntent(parsed, request);
    if (response.type === 'error') {
      return { success: false, summary: response.text, emoji: ':warning:', details: response.text };
    }
    return { success: true, summary: response.text, emoji: ':mag:', details: response.text };
  }

  // ── Draft email ── core engine, return text directly
  if (parsed.intent === 'draft_email') {
    const request = buildRequest(slackUser, channel, threadTs, rawText, cleanedText);
    const response = await executeIntent(parsed, request);
    return { success: response.type !== 'error', summary: response.text, emoji: ':email:', details: response.text };
  }

  // ── Update event ── core engine finds the existing event in the
  // sender's calendar and PATCHes it. Ambiguity / missing OAuth surface
  // as :warning: rather than a generic error.
  if (parsed.intent === 'update_event') {
    const request = buildRequest(slackUser, channel, threadTs, rawText, cleanedText);
    const response = await executeIntent(parsed, request);
    if (response.type === 'error') {
      return { success: false, summary: response.text, emoji: ':warning:' };
    }
    if (response.type === 'warning') {
      return { success: false, summary: response.text, emoji: ':warning:' };
    }
    const summary = (response.data?.summary as string | undefined) || response.text;
    return {
      success: true,
      summary: `*Event updated:* ${summary}`,
      emoji: ':calendar:',
    };
  }

  // ── Transfer deal ── core engine resolves the new owner, looks up the
  // deal, and runs the validated owner-only update. Errors (ambiguous
  // name, no matching deal, unresolved person) surface as :warning:.
  // The F.2 inactive-operator guardrail returns type === 'warning' —
  // stash the parsed intent so a "yes proceed" follow-up (resume parser
  // TBD) can apply the original transfer.
  if (parsed.intent === 'transfer_deal') {
    const request = buildRequest(slackUser, channel, threadTs, rawText, cleanedText);
    const response = await executeIntent(parsed, request);
    if (response.type === 'error') {
      return { success: false, summary: response.text, emoji: ':warning:' };
    }
    if (response.type === 'warning') {
      pendingClarifications.set(threadTs, {
        intent: parsed,
        slackUser,
        channel,
        threadTs,
        awaitingField: 'inactive_operator_confirm',
        originalText: rawText,
        createdAt: Date.now(),
      });
      return {
        success: false,
        summary: response.text,
        emoji: ':information_source:',
        isClarification: true,
      };
    }
    const newOwnerSlackId = response.data?.newOwnerSlackUserId as string | undefined;
    const dealCompany = (response.data?.deal as { company?: string } | undefined)?.company || parsed.company || 'the deal';
    const targetDisplay = newOwnerSlackId ? `<@${newOwnerSlackId}>` : 'the new owner';
    return {
      success: true,
      summary: `*Ownership transferred:* ${dealCompany} → ${targetDisplay}`,
      emoji: ':handshake:',
    };
  }

  // ── schedule_meeting time-gate ──
  // Fire BEFORE any deal/activity side effects so a half-formed meeting
  // doesn't create deal rows, activity logs, or calendar events. We
  // can't put a meeting on the calendar without knowing the time of
  // day, so just ask the user — naturally, no jargon, no ISO dates.
  if (parsed.intent === 'schedule_meeting' && !parsed.calendarTime && !parsed.rawFields?.calendar?.preferred_times?.[0]) {
    // Stash the partial intent so a follow-up @togari mention in this
    // thread that supplies the time can merge + execute without
    // re-parsing the original phrase.
    pendingClarifications.set(threadTs, {
      intent: parsed,
      slackUser,
      channel,
      threadTs,
      awaitingField: 'calendar_time',
      originalText: cleanedText,
      createdAt: Date.now(),
    });
    const dateStr = humanizeCalendarDate(parsed.calendarDate);
    const dayPhrase = dateStr ? ` on ${dateStr}` : '';
    return {
      success: false,
      summary: `What time${dayPhrase}?`,
      emoji: ':grey_question:',
      isClarification: true,
    };
  }

  // ── schedule_meeting duration-gate ──
  // Calendar time is now known. Check duration: explicit > implied
  // keyword > prompt. Skip the prompt when the user's original phrase
  // contained an implied-duration keyword ("quick call" → 15,
  // "discovery" → 60, etc.) — applying the default in code keeps the
  // common case zero-friction. Otherwise stash the partial and ask.
  if (
    parsed.intent === 'schedule_meeting' &&
    !parsed.calendarDuration &&
    !parsed.rawFields?.calendar?.duration_minutes
  ) {
    const sourceText =
      cleanedText ||
      (parsed.rawFields?.calendar?.meeting_title as string | undefined) ||
      parsed.meetingTitle ||
      '';
    const implied = resolveImpliedDuration(sourceText);
    if (implied !== null) {
      // Merge the implied default into the intent and fall through to
      // the normal calendar-event path. No prompt, no stash.
      const storedCalendar = (parsed.rawFields?.calendar ?? {}) as Record<string, any>;
      parsed = {
        ...parsed,
        calendarDuration: implied,
        rawFields: {
          ...(parsed.rawFields ?? {}),
          calendar: { ...storedCalendar, duration_minutes: implied },
        },
      };
    } else {
      pendingClarifications.set(threadTs, {
        intent: parsed,
        slackUser,
        channel,
        threadTs,
        awaitingField: 'calendar_duration',
        originalText: cleanedText,
        createdAt: Date.now(),
      });
      return {
        success: false,
        summary: 'How long should the meeting be?',
        emoji: ':grey_question:',
        isClarification: true,
      };
    }
  }

  // ── Patch L — promote_capture ──
  // The engine resolves the company, pulls the latest capture, extracts
  // structured fields via Claude, calls createDeal, and marks the
  // capture as promoted. Slack just renders the result. Errors (no
  // captures, missing company) surface as :warning: so the user sees
  // why nothing was created.
  if (parsed.intent === 'promote_capture') {
    const request = buildRequest(slackUser, channel, threadTs, rawText, cleanedText);
    const response = await executeIntent(parsed, request);
    if (response.type === 'error') {
      return { success: false, summary: response.text, emoji: ':warning:' };
    }
    return {
      success: true,
      summary: response.text,
      emoji: ':rocket:',
    };
  }

  // ── Deal mutations (new_deal, update_deal, log_activity, schedule_meeting) ──
  // Keep the Slack-specific syncDeal wrapper: it threads rawText into the
  // BQ notes column and does conflict detection on new_deal.
  const dealResult = await syncDeal(parsed, slackUser, channel, rawText);

  if (dealResult.operation === 'conflict' && dealResult.conflict_deal) {
    return {
      success: false,
      summary: `Deal for *${dealResult.company}* already exists (${dealResult.conflict_deal.deal_id}, stage: ${dealResult.conflict_deal.stage})`,
      emoji: ':warning:',
    };
  }


  // ── Calendar events for schedule_meeting ──
  // Gate the success message on actually creating the event. If the
  // sync throws (auth failure, API error, parse failure) or returns
  // no events, surface the error truthfully — never claim "Meeting
  // Scheduled" without a real calendar entry to back it up.
  if (parsed.intent === 'schedule_meeting') {
    let calendarEvent: { id: string; summary: string; htmlLink: string; start: string; end: string } | undefined;
    try {
      const calendarEvents = await syncCalendar(parsed, requesterTimezone, slackUser);
      calendarEvent = calendarEvents[0];
    } catch (err) {
      // CalendarAuthMissingError → friendly per-user OAuth message, not
      // a 500-style stack. Anything else is a real failure to surface.
      const msg = err instanceof Error ? err.message : String(err);
      if (err instanceof Error && err.name === 'CalendarAuthMissingError') {
        return {
          success: false,
          summary: `:warning: ${msg}`,
          emoji: ':warning:',
        };
      }
      console.error('SLACK ERROR:', msg);
      logger.error('Calendar sync failed', err as Error);
      return {
        success: false,
        summary: `Couldn't create the calendar event: ${msg}`,
        emoji: ':warning:',
      };
    }
    if (!calendarEvent) {
      return {
        success: false,
        summary: `Couldn't create the calendar event`,
        emoji: ':warning:',
      };
    }
    return {
      success: true,
      summary: buildMeetingSuccessSummary(parsed, calendarEvent.htmlLink),
      emoji: ':calendar:',
    };
  }

  let operationEmoji: string;
  let operationLabel: string;
  const dealStage = parsed.stage;

  if (dealStage === 'closed_lost') {
    operationEmoji = ':x:';
    operationLabel = 'Closed Lost';
  } else if (dealStage === 'closed_won') {
    operationEmoji = ':white_check_mark:';
    operationLabel = 'Closed Won';
  } else if (dealResult.operation === 'inserted') {
    operationEmoji = ':new:';
    operationLabel = 'New Deal';
  } else if (dealResult.operation === 'updated') {
    operationEmoji = ':memo:';
    operationLabel = 'Updated';
  } else {
    operationEmoji = ':memo:';
    operationLabel = 'Activity Logged';
  }
  const contact = parsed.contactName || '';
  const company = dealResult.company || '';
  // H — pipeline + brand pulled from the resolved deal (engine-of-truth)
  // rather than the raw parsed intent, so a defaulted brand or
  // server-side validation correction reaches the user. Format:
  //   ":new: New Deal: Jane at TestCo — outbound (BMA) — $2,000"
  const pipeline = dealResult.pipeline || parsed.pipeline || '';
  const brand = dealResult.client_brand || parsed.clientBrand || '';
  const value = dealResult.value ? ` — $${dealResult.value.toLocaleString()}` : '';
  const brandSuffix = brand ? ` (${brand.toUpperCase()})` : '';
  const pipelineLabel = pipeline ? ` — ${pipeline}${brandSuffix}` : (brand ? ` — ${brandSuffix.trim()}` : '');

  const summary = `*${operationLabel}:* ${contact}${contact && company ? ' at ' : ''}${company}${pipelineLabel}${value}`;

  return { success: true, summary, emoji: operationEmoji };
}

// ── Multi-action processing ──────────────────────────────────────

export async function processSlackMessage(
  cleanedText: string,
  slackUser: string,
  channel: string,
  threadTs: string,
  rawText: string,
): Promise<void> {
  try {
    // TOGARI_TOOL_LOOP_ENABLED — bypass the legacy classifier path
    // entirely. The runner handles parsing, dispatch, pending
    // clarifications, side-effect rendering. The legacy code below
    // remains intact for rollback (clear the env flag → old path).
    if (isToolLoopEnabled()) {
      await runSlackToolUseLoop(cleanedText, slackUser, channel, threadTs, rawText);
      return;
    }

    // Look up the requester's timezone once, up front, so the parser
    // can compute reminder_times in the user's TZ and downstream
    // handlers (calendar, reminder confirmations) can format times
    // consistently.
    const requesterTimezone = await getUserTimezone(slackUser);

    // ── Clarification resume ────────────────────────────────────
    // If this thread has a pending clarification (we asked the user
    // for a time and they're responding) AND the new message contains
    // a [time: HH:MM] marker, merge the time into the stored intent
    // and skip the parser. resolveDatePhrases is pure / idempotent —
    // calling it here doesn't disturb the second pass inside
    // classifyIntent for non-resume messages.
    const { replacements } = resolveDatePhrases(cleanedText, requesterTimezone);
    const pending = pendingClarifications.get(threadTs);
    if (pending) {
      const ageMs = Date.now() - pending.createdAt;
      if (ageMs > PENDING_CLARIFICATION_TTL_MS) {
        // Stale — drop and fall through to the normal parser path.
        pendingClarifications.delete(threadTs);
        console.log('SLACK STEP: dropped stale clarification', { threadTs, ageMs });
      } else if (pending.awaitingField === 'calendar_time') {
        // Strict dispatch: we asked for a time, so only a time can
        // satisfy this pending. resolveDatePhrases is the source of
        // truth for time markers — anything else means the user gave
        // us something we can't use, in which case we re-prompt
        // (NOT fall through to the LLM parser, which would silently
        // re-classify the reply as a new schedule_meeting and drop
        // the stored calendarDate).
        const timeMarker = replacements
          .map(r => r.resolved)
          .find(s => s.startsWith('[time:'));
        const timeMatch = timeMarker ? /\[time:\s*(\d{2}:\d{2})\]/.exec(timeMarker) : null;
        if (timeMatch) {
          const time = timeMatch[1];
          const storedCalendar = (pending.intent.rawFields?.calendar ?? {}) as Record<string, any>;
          const merged: ParsedIntent = {
            ...pending.intent,
            calendarTime: time,
            rawFields: {
              ...(pending.intent.rawFields ?? {}),
              calendar_time: time,
              calendar: { ...storedCalendar, preferred_times: [time] },
            },
          };
          pendingClarifications.delete(threadTs);
          console.log('SLACK STEP: resuming pending clarification with time', { threadTs, time });
          // Use the ORIGINAL message text for the resumed action so
          // the duration-gate's implied-keyword check ("quick call" →
          // 15) sees the right text. The follow-up reply ("3pm") has
          // no semantic clue about duration.
          const resumeText = pending.originalText ?? cleanedText;
          const result = await processSingleAction(
            merged, slackUser, channel, threadTs, rawText, resumeText, requesterTimezone,
          );
          if (result.details) {
            await postTextReply(channel, threadTs, result.details);
          } else {
            await postTextReply(channel, threadTs, `${result.emoji} ${result.summary}`);
          }
          return;
        }
        // No time marker found — re-prompt and keep pending intact.
        const dateStr = humanizeCalendarDate(pending.intent.calendarDate);
        const dayPhrase = dateStr ? ` on ${dateStr}` : '';
        await postTextReply(channel, threadTs, `:grey_question: What time${dayPhrase}?`);
        return;
      } else if (pending.awaitingField === 'calendar_duration') {
        // Strict dispatch for duration: try the deterministic phrase
        // parser first ("30 min", "an hour"), then fall back to the
        // implied-keyword resolver ("quick" → 15, "1:1" → 30,
        // "discovery" → 60). Only re-prompt if BOTH return null;
        // never fall through to the LLM parser, which would re-
        // classify the reply as a new schedule_meeting and drop
        // the already-resolved calendarDate / calendarTime.
        const minutes = resolveDurationPhrase(cleanedText) ?? resolveImpliedDuration(cleanedText);
        if (minutes !== null) {
          const storedCalendar = (pending.intent.rawFields?.calendar ?? {}) as Record<string, any>;
          const merged: ParsedIntent = {
            ...pending.intent,
            calendarDuration: minutes,
            rawFields: {
              ...(pending.intent.rawFields ?? {}),
              calendar_duration: minutes,
              calendar: { ...storedCalendar, duration_minutes: minutes },
            },
          };
          pendingClarifications.delete(threadTs);
          console.log('SLACK STEP: resuming pending clarification with duration', { threadTs, minutes });
          // Reuse the original message text so any further gates (none
          // currently) see the right context.
          const resumeText = pending.originalText ?? cleanedText;
          const result = await processSingleAction(
            merged, slackUser, channel, threadTs, rawText, resumeText, requesterTimezone,
          );
          if (result.details) {
            await postTextReply(channel, threadTs, result.details);
          } else {
            await postTextReply(channel, threadTs, `${result.emoji} ${result.summary}`);
          }
          return;
        }
        // No duration extracted — re-prompt and keep pending intact.
        await postTextReply(channel, threadTs, ':grey_question: How long should the meeting be?');
        return;
      } else if (pending.awaitingField === 'inactive_operator_confirm') {
        // F.2 follow-up. Three accepted patterns:
        //   1. "yes" / "proceed" / "go ahead" / "do it anyway"
        //      → set __overrideInactive on the stash, re-run processSingleAction.
        //   2. "use karthik" / "assign to sagar" / "karthik instead" / "give it to sagar"
        //      → swap reminder_target on the stash, re-run processSingleAction.
        //      The canonical-override resolver picks the active operator.
        //   3. "never mind" / "cancel" / "nvm" / "forget it"
        //      → drop the stash, ack and stop.
        // Anything else → keep the stash and re-prompt with the menu.
        const reply = cleanedText.trim().toLowerCase();
        const RE_PROCEED = /^(yes|yeah|yep|proceed|do it anyway|go ahead|confirm)\b/;
        const RE_CANCEL = /^(no|never mind|nvm|cancel|forget it|drop it|stop)\b/;
        const RE_REASSIGN = /\b(?:use|assign(?:ed)?(?:\s+(?:to|it\s+to))?|give\s+(?:it\s+)?to)\s+(karthik|sagar)\b|\b(karthik|sagar)\s+instead\b/;

        if (RE_CANCEL.test(reply)) {
          pendingClarifications.delete(threadTs);
          await postTextReply(channel, threadTs, ':white_check_mark: Got it, cancelled.');
          return;
        }

        const reassignMatch = RE_REASSIGN.exec(reply);
        if (reassignMatch) {
          const newTarget = (reassignMatch[1] ?? reassignMatch[2]).toLowerCase();
          const merged: ParsedIntent = {
            ...pending.intent,
            reminderTarget: newTarget,
            rawFields: {
              ...(pending.intent.rawFields ?? {}),
              reminder_target: newTarget,
            },
          };
          pendingClarifications.delete(threadTs);
          console.log('SLACK STEP: resuming inactive-operator clarification with reassign', { threadTs, newTarget });
          const resumeText = pending.originalText ?? cleanedText;
          const result = await processSingleAction(
            merged, slackUser, channel, threadTs, rawText, resumeText, requesterTimezone,
          );
          if (result.details) {
            await postTextReply(channel, threadTs, result.details);
          } else {
            await postTextReply(channel, threadTs, `${result.emoji} ${result.summary}`);
          }
          return;
        }

        if (RE_PROCEED.test(reply)) {
          const merged: ParsedIntent = {
            ...pending.intent,
            __overrideInactive: true,
          };
          pendingClarifications.delete(threadTs);
          console.log('SLACK STEP: resuming inactive-operator clarification with override', { threadTs });
          const resumeText = pending.originalText ?? cleanedText;
          const result = await processSingleAction(
            merged, slackUser, channel, threadTs, rawText, resumeText, requesterTimezone,
          );
          if (result.details) {
            await postTextReply(channel, threadTs, result.details);
          } else {
            await postTextReply(channel, threadTs, `${result.emoji} ${result.summary}`);
          }
          return;
        }

        // Unrecognized reply — keep pending, re-prompt.
        await postTextReply(
          channel,
          threadTs,
          ":information_source: Reply with 'yes' to proceed anyway, 'use karthik' / 'use sagar' to reassign, or 'cancel' to drop.",
        );
        return;
      }
    }

    // No active pending clarification — proceed to normal parse path.

    // Parse with the core intent classifier
    console.log('SLACK STEP: before parsing with Claude');
    const actions = await parseSlackMessage(cleanedText, requesterTimezone);
    console.log('SLACK STEP: after parsing', { actionCount: actions.length, intents: actions.map(a => a.intent) });

    // Filter by confidence — threshold 40 for non-conversation, no gate for conversation
    const executableActions: ParsedIntent[] = [];
    const skippedActions: ParsedIntent[] = [];

    for (const action of actions) {
      if (action.intent === 'conversation') {
        executableActions.push(action);
      } else if (action.confidence >= 40) {
        executableActions.push(action);
      } else {
        skippedActions.push(action);
      }
    }

    // If ALL actions are below threshold, ask for clarification
    if (executableActions.length === 0) {
      const maxConfidence = Math.max(...actions.map(a => a.confidence));
      console.log('SLACK STEP: all actions below confidence threshold', { maxConfidence });
      await postClarificationMessage(channel, threadTs, maxConfidence);
      return;
    }

    // Single conversation / query action — post response directly (no aggregation)
    if (
      executableActions.length === 1 &&
      (executableActions[0].intent === 'conversation' || executableActions[0].intent === 'query')
    ) {
      const result = await processSingleAction(
        executableActions[0], slackUser, channel, threadTs, rawText, cleanedText, requesterTimezone,
      );
      await postTextReply(channel, threadTs, result.details ?? result.summary);
      return;
    }

    // Multi-action — process all and aggregate reply
    console.log(`SLACK STEP: processing ${executableActions.length} actions`);
    const results: ActionResult[] = [];

    for (const action of executableActions) {
      try {
        const result = await processSingleAction(action, slackUser, channel, threadTs, rawText, cleanedText, requesterTimezone);
        results.push(result);
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        console.error(`SLACK ERROR processing ${action.intent}:`, errMsg);
        results.push({
          success: false,
          summary: `${action.intent} failed: ${errMsg}`,
          emoji: ':warning:',
        });
      }
    }

    // If only 1 action and it has details (conversation or query-like), post directly
    if (results.length === 1 && results[0].details) {
      await postTextReply(channel, threadTs, results[0].details);
      return;
    }

    // Build aggregated reply — list all results in order
    const successCount = results.filter(r => r.success).length;
    const failCount = results.filter(r => !r.success).length;

    const lines: string[] = [];

    // If every result is a clarification question (e.g. just the
    // "What time on Tuesday?" prompt from the schedule_meeting
    // time-gate), skip the failure header — phrasing that as
    // "All 1 action failed" reads as if Togari errored out, when in
    // fact it's politely asking the user for missing information.
    const allClarifications = results.length > 0 && results.every(r => r.isClarification);

    if (!allClarifications) {
      // Header
      if (failCount === 0) {
        lines.push(`:white_check_mark: Processed ${successCount} action${successCount > 1 ? 's' : ''} from your message:`);
      } else if (successCount === 0) {
        lines.push(`:warning: All ${failCount} action${failCount > 1 ? 's' : ''} failed:`);
      } else {
        lines.push(`:white_check_mark: ${successCount} succeeded, :warning: ${failCount} failed:`);
      }
      lines.push('');
    }

    // List all results in order (no grouping — preserves the natural order of the message)
    for (const r of results) {
      lines.push(`${r.emoji} ${r.summary}`);
    }

    // Mention skipped actions
    if (skippedActions.length > 0) {
      lines.push('');
      lines.push(`:grey_question: ${skippedActions.length} action${skippedActions.length > 1 ? 's were' : ' was'} unclear — could you rephrase?`);
    }

    await postTextReply(channel, threadTs, lines.join('\n'));

    logger.info('Multi-action message fully processed', {
      totalActions: executableActions.length,
      successCount,
      failCount,
      skippedCount: skippedActions.length,
      intents: executableActions.map(a => a.intent),
    });
  } catch (err) {
    console.error('SLACK ERROR:', err instanceof Error ? err.message : err);
    console.error('SLACK STACK:', err instanceof Error ? err.stack : 'no stack');
    throw err;
  }
}

// ── Tool-use loop path (TOGARI_TOOL_LOOP_ENABLED) ─────────────────

/**
 * Slack dispatch through the new tool-use runner. Builds the
 * TogariRequest, pulls 5 prior thread messages for context, runs the
 * loop, then flushes pending side effects (confirmation blocks,
 * reminder confirmation posts) before posting the final response.
 *
 * Replaces the entire legacy `processSlackMessage` body when the flag
 * is on. Pending-clarification state has moved to BQ — the in-memory
 * `pendingClarifications` Map is no longer touched on this path.
 */
async function runSlackToolUseLoop(
  cleanedText: string,
  slackUser: string,
  channel: string,
  threadTs: string,
  rawText: string,
): Promise<void> {
  const request: TogariRequest = {
    text: cleanedText,
    userId: slackUser,
    platform: 'slack',
    transport: 'slack',
    transportMetadata: { userId: slackUser, channelId: channel, threadTs, rawText },
  };

  // Try to fetch thread context for multi-turn follow-ups. Failures
  // degrade silently — the loop still runs single-turn.
  let threadHistory: { role: 'user' | 'assistant'; content: string }[] = [];
  try {
    const botUserId = await getBotUserId();
    const prior = await getThreadContext(channel, threadTs, botUserId, 5);
    threadHistory = prior.map((m) => ({ role: m.role, content: m.content }));
  } catch (err) {
    logger.warn('Could not fetch thread context for tool-use loop', {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  const onProgress = buildOnProgress(channel, threadTs);

  let runResult: Awaited<ReturnType<typeof runToolUseLoop>>;
  try {
    runResult = await runToolUseLoop(request, {
      channelId: channel,
      threadTs,
      threadHistory,
      onProgress,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error('Tool-use loop failed', err instanceof Error ? err : new Error(msg));
    await postTextReply(channel, threadTs, `:warning: Something went wrong: ${msg}`);
    return;
  }

  // Flush pending side effects FIRST so confirmation buttons appear
  // alongside the response. Coalesce same-kind confirm side effects in
  // one assistant turn into a single multi-row card (Block Kit, per-row
  // drop buttons + global Confirm/Cancel-all). Single-action cards
  // remain unchanged.
  const sideEffects = runResult.pendingSideEffects;
  const sendEmails = sideEffects.filter((s) => s.kind === 'confirm_send_email');
  const transferDeals = sideEffects.filter((s) => s.kind === 'confirm_transfer_deal');
  const newDealDedupes = sideEffects.filter((s) => s.kind === 'confirm_new_deal_dedupe');
  const reminders = sideEffects.filter((s) => s.kind === 'reminder_confirm');

  const coalesced: Set<string> = new Set();
  for (const [kind, list] of [
    ['send_email', sendEmails] as const,
    ['transfer_deal', transferDeals] as const,
    ['new_deal_dedupe', newDealDedupes] as const,
  ]) {
    if (shouldCoalesce(list.length)) {
      try {
        const rows = list.map((s) => ({
          payload: s.payload as Record<string, unknown>,
          label: '',
        }));
        await postBlocks(channel, threadTs, buildCoalescedConfirmBlocks({ kind, rows }));
        coalesced.add(kind);
      } catch (err) {
        logger.warn('Failed to post coalesced confirm card', {
          kind,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  for (const side of sideEffects) {
    try {
      if (side.kind === 'confirm_send_email') {
        if (coalesced.has('send_email')) continue;
        await postBlocks(channel, threadTs, buildSendEmailConfirmBlocks(side.payload as any));
      } else if (side.kind === 'confirm_transfer_deal') {
        if (coalesced.has('transfer_deal')) continue;
        await postBlocks(channel, threadTs, buildTransferDealConfirmBlocks(side.payload as any));
      } else if (side.kind === 'confirm_new_deal_dedupe') {
        if (coalesced.has('new_deal_dedupe')) continue;
        const dedupeMessage = String((side.payload as any).dedupe_message ?? 'Possible duplicate.');
        await postBlocks(channel, threadTs, buildNewDealDedupeConfirmBlocks(side.payload as any, dedupeMessage));
      } else if (side.kind === 'reminder_confirm') {
        const p = side.payload as {
          target_user_id: string;
          reminder_text: string;
          fire_at_unix: number;
          reminder_id: string;
        };
        const targetDisplay = p.target_user_id === slackUser ? 'you' : `<@${p.target_user_id}>`;
        const timeDisplay = new Date(p.fire_at_unix * 1000).toLocaleString('en-US', {
          weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
        });
        await postReminderConfirm({
          channel,
          threadTs,
          reminderId: p.reminder_id,
          targetDisplay,
          timeDisplay,
          reminderText: p.reminder_text,
        });
      }
    } catch (err) {
      logger.warn('Failed to flush side effect', {
        kind: side.kind,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (runResult.response.text) {
    await postTextReply(channel, threadTs, runResult.response.text);
  }
}

/** Post raw Block Kit blocks via chat.postMessage in the same thread. */
async function postBlocks(channel: string, threadTs: string, blocks: any[]): Promise<void> {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) return;
  try {
    await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ channel, thread_ts: threadTs, blocks, text: 'Action required' }),
    });
  } catch (err) {
    logger.warn('postBlocks failed', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
