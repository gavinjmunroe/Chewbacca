/**
 * Slack Responder — thread reply formatting, posting, and reminder scheduling.
 */

import type { ParsedMessage } from './parser';
import type { DealSyncResult } from './deal-sync';
import type { CalendarSyncResult } from './calendar-sync';

// ─── Message Builders ────────────────────────────────────────────────────────

export function buildConfirmationMessage(
  parsed: ParsedMessage,
  dealResult: DealSyncResult,
  calendarResult?: CalendarSyncResult,
): string {
  const lines: string[] = [];

  // Header
  lines.push(':white_check_mark: *Got it — here\'s what I did:*');
  lines.push('');

  // Deal section
  if (dealResult.action === 'created') {
    lines.push(':briefcase: *NEW DEAL CREATED*');
    lines.push(`> *${dealResult.deal_name}*`);
    lines.push(`> Stage: \`${dealResult.new_stage}\``);
    if (parsed.deal.pipeline) lines.push(`> Pipeline: \`${parsed.deal.pipeline}\``);
    if (parsed.deal.priority) lines.push(`> Priority: \`${parsed.deal.priority}\``);
    if (parsed.deal.value) lines.push(`> Value: $${parsed.deal.value.toLocaleString()}`);
  } else if (dealResult.action === 'updated') {
    lines.push(':briefcase: *DEAL UPDATED*');
    lines.push(`> *${dealResult.deal_name}*`);
    if (dealResult.previous_stage !== dealResult.new_stage) {
      lines.push(`> Stage: \`${dealResult.previous_stage}\` → \`${dealResult.new_stage}\``);
    }
    if (parsed.deal.pipeline) lines.push(`> Pipeline: \`${parsed.deal.pipeline}\``);
    if (parsed.deal.priority) lines.push(`> Priority: \`${parsed.deal.priority}\``);
    if (parsed.deal.value) lines.push(`> Value: $${parsed.deal.value.toLocaleString()}`);
  } else {
    lines.push(':briefcase: *Activity logged*');
    lines.push(`> Deal: *${dealResult.deal_name}*`);
  }

  if (parsed.deal.next_action) {
    lines.push(`> Next action: ${parsed.deal.next_action}`);
    if (parsed.deal.next_action_date) {
      lines.push(`> Due: ${parsed.deal.next_action_date}`);
    }
  }

  // Calendar section
  if (calendarResult && calendarResult.created) {
    lines.push('');
    lines.push(`:date: *Calendar — ${calendarResult.events_count} event(s) created:*`);
    for (const summary of calendarResult.event_summaries) {
      lines.push(`> ${summary}`);
    }
  }

  // Missing info warnings
  const missing: string[] = [];
  if (!parsed.person.phone) missing.push('phone number');
  if (!parsed.person.email) missing.push('email address');
  if (missing.length > 0) {
    lines.push('');
    lines.push(`:warning: *Missing info:* ${missing.join(', ')} — add when you have it`);
  }

  // Reminder section
  if (parsed.reminder.message) {
    lines.push('');
    lines.push(`:bell: *Reminder set:* ${parsed.reminder.message}`);
    if (parsed.reminder.when) lines.push(`> When: ${parsed.reminder.when}`);
  }

  return lines.join('\n');
}

export function buildClarificationMessage(parsed: ParsedMessage): string {
  const lines: string[] = [];

  lines.push(':thinking_face: *I\'m not sure I understood that correctly.* Could you clarify:');
  lines.push('');

  if (parsed.clarification_needed) {
    lines.push(`> ${parsed.clarification_needed}`);
  } else {
    // Generic clarification questions based on what's missing
    if (!parsed.company.name && !parsed.person.company) {
      lines.push('> • Which company is this about?');
    }
    if (!parsed.deal.stage && parsed.intent !== 'log_activity') {
      lines.push('> • What stage is this deal in?');
    }
    if (parsed.intent === 'schedule_meeting' && (!parsed.calendar.preferred_times || parsed.calendar.preferred_times.length === 0)) {
      lines.push('> • When would you like to schedule the meeting?');
    }
  }

  lines.push('');
  lines.push(`_Confidence: ${parsed.confidence}%_`);

  return lines.join('\n');
}

// ─── Slack API ───────────────────────────────────────────────────────────────

async function slackApiPost(
  endpoint: string,
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) throw new Error('SLACK_BOT_TOKEN not set');

  const res = await fetch(`https://slack.com/api/${endpoint}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify(body),
  });

  const data = (await res.json()) as Record<string, unknown>;
  if (!data.ok) {
    throw new Error(`Slack API error (${endpoint}): ${data.error}`);
  }
  return data;
}

export async function postThreadReply(
  channel: string,
  threadTs: string,
  text: string,
): Promise<void> {
  await slackApiPost('chat.postMessage', {
    channel,
    thread_ts: threadTs,
    text,
  });
}

export async function scheduleReminder(
  parsed: ParsedMessage,
  slackUser: string,
): Promise<void> {
  if (!parsed.reminder.message || !parsed.reminder.when) return;

  const unixTime = parseReminderTime(parsed.reminder.when);
  if (!unixTime) return;

  await slackApiPost('reminders.add', {
    user: slackUser,
    text: parsed.reminder.message,
    time: unixTime,
  });
}

// ─── Reminder Time Parsing ───────────────────────────────────────────────────

function parseReminderTime(when: string): number | null {
  const now = Date.now();
  const lower = when.toLowerCase().trim();

  // "in X minutes/hours/days"
  const relativeMatch = lower.match(/in\s+(\d+)\s+(minute|hour|day|week)s?/);
  if (relativeMatch) {
    const amount = parseInt(relativeMatch[1], 10);
    const unit = relativeMatch[2];
    const ms: Record<string, number> = {
      minute: 60_000,
      hour: 3_600_000,
      day: 86_400_000,
      week: 604_800_000,
    };
    return Math.floor((now + amount * ms[unit]) / 1000);
  }

  // "tomorrow Xam/pm"
  if (lower.includes('tomorrow')) {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    const timeMatch = lower.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)/);
    if (timeMatch) {
      let h = parseInt(timeMatch[1], 10);
      const m = timeMatch[2] ? parseInt(timeMatch[2], 10) : 0;
      if (timeMatch[3] === 'pm' && h < 12) h += 12;
      if (timeMatch[3] === 'am' && h === 12) h = 0;
      d.setHours(h, m, 0, 0);
    } else {
      d.setHours(9, 0, 0, 0);
    }
    return Math.floor(d.getTime() / 1000);
  }

  // "end of day" / "eod"
  if (lower.includes('eod') || lower.includes('end of day')) {
    const d = new Date();
    d.setHours(17, 0, 0, 0);
    if (d.getTime() < now) d.setDate(d.getDate() + 1);
    return Math.floor(d.getTime() / 1000);
  }

  return null;
}
