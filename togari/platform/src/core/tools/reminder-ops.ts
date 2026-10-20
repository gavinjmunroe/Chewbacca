/**
 * @togari/core — Transport-agnostic reminder operations
 *
 * Sets reminders via Slack API when platform is Slack,
 * returns reminder data for other platforms to handle.
 */

import { createLogger } from '../../observability/logger';

const logger = createLogger('core/reminder-ops');

function formatReminderTime(unixTime: number): string {
  const date = new Date(unixTime * 1000);
  return date.toLocaleString('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }) + ' ET';
}

/**
 * Outcome of a single Slack reminder-set attempt. `method` tells the
 * caller which API succeeded so cancellation can call the correct
 * delete endpoint (reminders.delete vs chat.deleteScheduledMessage).
 */
interface SlackReminderResult {
  method: 'reminders.add' | 'chat.scheduleMessage';
  slackReminderId?: string;       // id from reminders.add (Rm…)
  scheduledMessageId?: string;    // id from chat.scheduleMessage (Q…)
}

/**
 * Try to set a single reminder via Slack API.
 * Tries reminders.add first, falls back to chat.scheduleMessage.
 */
async function setSlackReminder(
  token: string,
  targetUserId: string,
  reminderText: string,
  unixTime: number,
): Promise<SlackReminderResult | null> {
  // Attempt 1: reminders.add
  try {
    const res = await fetch('https://slack.com/api/reminders.add', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ user: targetUserId, text: reminderText, time: unixTime }),
    });

    const resBody = await res.text();
    let data: any;
    try { data = JSON.parse(resBody); } catch { data = { ok: false, error: resBody }; }

    if (res.ok && data.ok) {
      const reminderId = data?.reminder?.id ? String(data.reminder.id) : undefined;
      logger.info('Reminder set via reminders.add', { userId: targetUserId, time: unixTime, reminderId });
      return { method: 'reminders.add', slackReminderId: reminderId };
    }

    console.log(`[core/reminder-ops] reminders.add failed: ${data.error}, falling back to chat.scheduleMessage`);
  } catch (err) {
    console.error('[core/reminder-ops] reminders.add threw:', err instanceof Error ? err.message : err);
  }

  // Attempt 2: chat.scheduleMessage
  try {
    const res = await fetch('https://slack.com/api/chat.scheduleMessage', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        channel: targetUserId,
        text: `Reminder: ${reminderText}`,
        post_at: unixTime,
      }),
    });

    const resBody = await res.text();
    let data: any;
    try { data = JSON.parse(resBody); } catch { data = { ok: false, error: resBody }; }

    if (res.ok && data.ok) {
      const scheduledMessageId = data?.scheduled_message_id ? String(data.scheduled_message_id) : undefined;
      logger.info('Reminder set via chat.scheduleMessage', { userId: targetUserId, time: unixTime, scheduledMessageId });
      return { method: 'chat.scheduleMessage', scheduledMessageId };
    }

    console.error('[core/reminder-ops] chat.scheduleMessage also failed:', data.error);
    return null;
  } catch (err) {
    console.error('[core/reminder-ops] chat.scheduleMessage threw:', err instanceof Error ? err.message : err);
    return null;
  }
}

// ── Public API ───────────────────────────────────────────────────

/**
 * Per-time result captured so the caller can persist the right
 * (slackReminderId | scheduledMessageId, method) tuple for each
 * scheduled time. Order corresponds 1:1 with `params.times`.
 */
export interface ReminderTimeResult {
  unixTime: number;
  success: boolean;
  apiMethod?: 'reminders.add' | 'chat.scheduleMessage';
  slackReminderId?: string;
  scheduledMessageId?: string;
}

export async function setReminder(params: {
  targetUserId: string;
  text: string;
  times: number[];
  platform: string;
}): Promise<{
  method: string;
  success: boolean;
  details: string;
  perTime: ReminderTimeResult[];
}> {
  // For Slack: use Slack API to set reminders
  if (params.platform === 'slack') {
    const token = process.env.SLACK_BOT_TOKEN;
    if (!token) {
      return {
        method: 'none',
        success: false,
        details: 'SLACK_BOT_TOKEN not set — cannot set Slack reminders.',
        perTime: params.times.map((t) => ({ unixTime: t, success: false })),
      };
    }

    let successCount = 0;
    const confirmLines: string[] = [];
    const perTime: ReminderTimeResult[] = [];

    for (const unixTime of params.times) {
      const r = await setSlackReminder(token, params.targetUserId, params.text, unixTime);
      if (r) {
        successCount++;
        const methodLabel = r.method === 'chat.scheduleMessage' ? ' (scheduled DM)' : '';
        confirmLines.push(`${formatReminderTime(unixTime)}${methodLabel}`);
        perTime.push({
          unixTime,
          success: true,
          apiMethod: r.method,
          slackReminderId: r.slackReminderId,
          scheduledMessageId: r.scheduledMessageId,
        });
      } else {
        perTime.push({ unixTime, success: false });
      }
    }

    if (successCount > 0) {
      const details = `Set ${successCount} reminder${successCount > 1 ? 's' : ''} for ${params.targetUserId}:\n${confirmLines.join('\n')}\n\n${params.text}`;
      logger.info('Slack reminders set', { target: params.targetUserId, count: successCount });
      return { method: 'slack', success: true, details, perTime };
    }

    return {
      method: 'slack',
      success: false,
      details: `Could not set reminder via Slack API. Try using Slack's /remind command instead.\n\nWanted: "${params.text}"`,
      perTime,
    };
  }

  // For other platforms: return the reminder data for the transport to handle
  const timeDescriptions = params.times
    .map((t) => formatReminderTime(t))
    .join(', ');

  logger.info('Reminder data returned for transport handling', {
    platform: params.platform,
    target: params.targetUserId,
    times: params.times,
  });

  return {
    method: 'transport',
    success: true,
    details: `Reminder scheduled: "${params.text}" at ${timeDescriptions}`,
    perTime: params.times.map((t) => ({ unixTime: t, success: true })),
  };
}
