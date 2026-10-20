/**
 * Slack Events Handler — Express route for POST /slack/events.
 *
 * Handles:
 *   1. Request signature verification (HMAC-SHA256 with SLACK_SIGNING_SECRET)
 *   2. Slack url_verification challenge
 *   3. app_mention events → parse → sync deal → sync calendar → reply
 *
 * The route returns 200 immediately (within 3s), then processes async.
 */

import { createHmac, timingSafeEqual } from 'crypto';
import type { Request, Response } from 'express';
import { parseSlackMessage } from './parser';
import { syncDeal } from './deal-sync';
import { syncCalendar } from './calendar-sync';
import {
  buildConfirmationMessage,
  buildClarificationMessage,
  postThreadReply,
  scheduleReminder,
} from './responder';

// ─── Signature Verification ──────────────────────────────────────────────────

function verifySlackSignature(req: Request): boolean {
  const signingSecret = process.env.SLACK_SIGNING_SECRET;
  if (signingSecret === undefined || signingSecret === null || signingSecret === '') {
    process.stderr.write('SLACK_SIGNING_SECRET not set — skipping verification\n');
    return true; // allow in dev
  }

  const timestamp = req.headers['x-slack-request-timestamp'] as string;
  const slackSig = req.headers['x-slack-signature'] as string;

  if (!timestamp || !slackSig) return false;

  // Reject requests older than 5 minutes (replay protection)
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - parseInt(timestamp, 10)) > 300) return false;

  const body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
  const basestring = `v0:${timestamp}:${body}`;
  const mySignature =
    'v0=' + createHmac('sha256', signingSecret).update(basestring).digest('hex');

  const myBuf = Buffer.from(mySignature, 'utf8');
  const theirBuf = Buffer.from(slackSig, 'utf8');

  if (myBuf.length !== theirBuf.length) return false;

  return timingSafeEqual(myBuf, theirBuf);
}

// ─── Slack Event Types ───────────────────────────────────────────────────────

interface SlackEvent {
  type: string;
  user?: string;
  text?: string;
  channel?: string;
  ts?: string;
  thread_ts?: string;
  bot_id?: string;
}

interface SlackPayload {
  type: string;
  challenge?: string;
  event?: SlackEvent;
}

// ─── Async Mention Handler ───────────────────────────────────────────────────

async function handleSlackMention(event: SlackEvent): Promise<void> {
  const rawText = event.text || '';
  const channel = event.channel || '';
  const slackUser = event.user || 'unknown';
  const threadTs = event.thread_ts || event.ts || '';

  // Strip bot mention (e.g., "<@U12345> " prefix)
  const text = rawText.replace(/<@[A-Z0-9]+>\s*/g, '').trim();

  if (!text) return;

  try {
    // 1. Parse with Claude
    const parsed = await parseSlackMessage(text);

    // 2. If low confidence, ask for clarification
    if (parsed.confidence < 60) {
      const msg = buildClarificationMessage(parsed);
      await postThreadReply(channel, threadTs, msg);
      return;
    }

    // 3. Sync deal to BigQuery
    const dealResult = await syncDeal(parsed, slackUser, channel, text);

    // 4. Sync calendar events (if applicable)
    let calendarResult = undefined;
    if (
      parsed.intent === 'schedule_meeting' &&
      parsed.calendar.action === 'create'
    ) {
      try {
        calendarResult = await syncCalendar(parsed);
      } catch (err) {
        process.stderr.write(
          `Calendar sync failed: ${err instanceof Error ? err.message : String(err)}\n`,
        );
        // Continue — deal was already synced, just skip calendar
      }
    }

    // 5. Post confirmation in thread
    const confirmMsg = buildConfirmationMessage(
      parsed,
      dealResult,
      calendarResult,
    );
    await postThreadReply(channel, threadTs, confirmMsg);

    // 6. Schedule reminder if requested
    if (parsed.intent === 'set_reminder' || parsed.reminder.message) {
      try {
        await scheduleReminder(parsed, slackUser);
      } catch (err) {
        process.stderr.write(
          `Reminder scheduling failed: ${err instanceof Error ? err.message : String(err)}\n`,
        );
      }
    }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`Slack mention handler error: ${errorMsg}\n`);

    try {
      await postThreadReply(
        channel,
        threadTs,
        `:x: Something went wrong processing your message. Error: ${errorMsg}`,
      );
    } catch {
      process.stderr.write('Failed to post error message to Slack\n');
    }
  }
}

// ─── Express Route Handler ───────────────────────────────────────────────────

export function slackEventsHandler(req: Request, res: Response): void {
  try {
    // Parse payload first so we can check for url_verification before signature check
    const payload: SlackPayload =
      typeof req.body === 'string' ? JSON.parse(req.body) : req.body;

    // Handle Slack url_verification challenge immediately — no signature check needed.
    // This is safe because the response is just an echo of the challenge token; no data is written.
    if (payload.type === 'url_verification') {
      res.status(200).json({ challenge: payload.challenge });
      return;
    }

    // Verify Slack signature for all other requests
    if (!verifySlackSignature(req)) {
      res.status(401).json({ error: 'Invalid signature' });
      return;
    }

    // Return 200 immediately for event callbacks (must be <3s)
    res.status(200).json({ ok: true });

    // Process app_mention events asynchronously
    if (payload.type === 'event_callback' && payload.event) {
      const event = payload.event;

      // Ignore bot's own messages
      if (event.bot_id) return;

      if (event.type === 'app_mention') {
        handleSlackMention(event).catch((err) => {
          process.stderr.write(
            `Unhandled error in handleSlackMention: ${err instanceof Error ? err.message : String(err)}\n`,
          );
        });
      }
    }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`slackEventsHandler error: ${errorMsg}\n`);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Internal server error' });
    }
  }
}
