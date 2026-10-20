/**
 * @togari/transports/slack — Reminder confirmation + cancel button
 *
 * When the tool-use runner's `set_reminder` handler fires, this module:
 *   1. Posts a small confirmation message in the same thread with a
 *      [❌ Cancel] button (action_id: 'togari_cancel_reminder').
 *   2. Returns the message ts so the caller can persist it on the
 *      togari_reminders row alongside slack_scheduled_message_id.
 *
 * The cancel button handler is also in this file. It looks up the
 * reminder row, calls chat.deleteScheduledMessage to undo the schedule,
 * marks the row cancelled, and updates the confirmation message to
 * ":x: Cancelled" (button removed).
 *
 * The "fired_at notification" path is NOT implemented in this PR —
 * Slack's chat.scheduleMessage doesn't notify us when the message
 * actually goes out. See migration plan §7 punted follow-up.
 */

import { createLogger } from '../../observability/logger';
import { getReminderById, markReminderCancelled, markReminderFired } from '../../storage/reminders-store';

const logger = createLogger('slack/reminder-confirm');

export const TOGARI_REMINDER_ACTION_IDS = ['togari_cancel_reminder'] as const;

export function isTogariReminderActionId(actionId: string): boolean {
  return (TOGARI_REMINDER_ACTION_IDS as readonly string[]).includes(actionId);
}

interface PostConfirmParams {
  channel: string;
  threadTs: string;
  reminderId: string;
  targetDisplay: string;   // "you" or "<@U...>"
  timeDisplay: string;     // e.g. "Tue May 27 at 3:00 PM ET"
  reminderText: string;
}

/**
 * Post the confirmation message with the cancel button. Returns the
 * channel + ts so the caller can persist them on the reminders row.
 */
export async function postReminderConfirm(p: PostConfirmParams): Promise<{ channel: string; ts: string } | null> {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) {
    logger.warn('SLACK_BOT_TOKEN not set — skipping reminder confirm');
    return null;
  }

  const text = `:bell: Reminder set for ${p.targetDisplay} at ${p.timeDisplay}: ${p.reminderText}`;
  const blocks: any[] = [
    { type: 'section', text: { type: 'mrkdwn', text } },
    {
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: ':x: Cancel', emoji: true },
          action_id: 'togari_cancel_reminder',
          value: JSON.stringify({ reminder_id: p.reminderId }),
        },
      ],
    },
  ];

  try {
    const res = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        channel: p.channel,
        thread_ts: p.threadTs,
        text,
        blocks,
      }),
    });
    if (!res.ok) {
      logger.warn('chat.postMessage HTTP error', { status: res.status });
      return null;
    }
    const data = (await res.json()) as { ok?: boolean; ts?: string; channel?: string; error?: string };
    if (!data.ok || !data.ts) {
      logger.warn('chat.postMessage API error', { error: data.error });
      return null;
    }
    return { channel: data.channel ?? p.channel, ts: data.ts };
  } catch (err) {
    logger.warn('postReminderConfirm failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

interface InteractivityPayload {
  user?: { id?: string; username?: string };
  response_url?: string;
  actions?: Array<{ action_id?: string; value?: string }>;
}

async function deleteScheduledMessage(channel: string, scheduledMessageId: string): Promise<boolean> {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) return false;
  try {
    const res = await fetch('https://slack.com/api/chat.deleteScheduledMessage', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ channel, scheduled_message_id: scheduledMessageId }),
    });
    if (!res.ok) return false;
    const data = (await res.json()) as { ok?: boolean; error?: string };
    if (!data.ok) {
      logger.warn('chat.deleteScheduledMessage API error', { error: data.error });
      // Some errors (invalid_scheduled_message_id, message_not_found) mean
      // the message already fired — treat as "best-effort done".
      return data.error === 'invalid_scheduled_message_id' || data.error === 'message_not_found';
    }
    return true;
  } catch (err) {
    logger.warn('deleteScheduledMessage threw', {
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

/**
 * Delete a reminder created via Slack's `reminders.add` API. This is the
 * companion to `chat.deleteScheduledMessage` for the other API path the
 * `setReminder` helper uses. Slack returns `not_found` after the reminder
 * has already fired — treat that as a no-op success.
 */
async function deleteSlackReminder(reminderId: string): Promise<boolean> {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) return false;
  try {
    const res = await fetch('https://slack.com/api/reminders.delete', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ reminder: reminderId }),
    });
    if (!res.ok) return false;
    const data = (await res.json()) as { ok?: boolean; error?: string };
    if (!data.ok) {
      logger.warn('reminders.delete API error', { error: data.error });
      return data.error === 'not_found';
    }
    return true;
  } catch (err) {
    logger.warn('deleteSlackReminder threw', {
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

/**
 * Handle the togari_cancel_reminder button click. Looks up the
 * reminder row, deletes the scheduled Slack message, marks the row
 * cancelled, and updates the confirmation message in place.
 */
export async function handleCancelReminder(payload: InteractivityPayload): Promise<void> {
  const action = payload.actions?.[0];
  if (!action) return;
  const responseUrl = payload.response_url ?? '';
  const username = payload.user?.username ?? 'unknown';
  const userId = payload.user?.id ?? '';

  let reminderId = '';
  try {
    const v = JSON.parse(action.value ?? '{}');
    reminderId = String(v.reminder_id ?? '');
  } catch {
    /* ignore */
  }
  if (!reminderId) {
    await updateViaResponseUrl(responseUrl, `:warning: Couldn't parse cancel payload.`);
    return;
  }

  const row = await getReminderById(reminderId);
  if (!row) {
    await updateViaResponseUrl(responseUrl, `:warning: Reminder not found.`);
    return;
  }
  if (row.status === 'cancelled') {
    await updateViaResponseUrl(responseUrl, `:x: Cancelled (already cancelled)`);
    return;
  }
  if (row.status === 'fired') {
    await updateViaResponseUrl(responseUrl, `:white_check_mark: This reminder already fired.`);
    return;
  }

  // Lazy post-fire detection: if the scheduled time is in the past, the
  // reminder almost certainly already fired (Slack doesn't notify us when
  // it does). Mark it fired, update the confirmation, and tell the user.
  if (row.scheduled_at && row.scheduled_at.getTime() <= Date.now()) {
    await markReminderFired(reminderId);
    const firedDisplay = row.scheduled_at.toLocaleString('en-US', {
      timeZone: 'America/New_York',
      weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true,
    });
    await updateViaResponseUrl(responseUrl, `:white_check_mark: Fired at ${firedDisplay} ET`);
    return;
  }

  // Branch on which Slack API was used to schedule. Each API has its
  // own delete endpoint and ID format.
  if (row.slack_api_method === 'reminders.add' && row.slack_reminder_id) {
    await deleteSlackReminder(row.slack_reminder_id);
  } else if (row.slack_api_method === 'chat.scheduleMessage' && row.slack_scheduled_message_id && row.target_user_id) {
    await deleteScheduledMessage(row.target_user_id, row.slack_scheduled_message_id);
  } else {
    // Best-effort fallback for legacy rows (pre-method-tracking).
    if (row.slack_scheduled_message_id && row.target_user_id) {
      await deleteScheduledMessage(row.target_user_id, row.slack_scheduled_message_id);
    }
  }
  await markReminderCancelled(reminderId, userId || username);
  await updateViaResponseUrl(responseUrl, `:x: Cancelled by @${username}`);
}

async function updateViaResponseUrl(responseUrl: string, text: string): Promise<void> {
  if (!responseUrl) return;
  try {
    await fetch(responseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        replace_original: true,
        text,
        blocks: [{ type: 'section', text: { type: 'mrkdwn', text } }],
      }),
    });
  } catch (err) {
    logger.warn('updateViaResponseUrl failed', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
