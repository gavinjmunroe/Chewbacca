/**
 * Slack Message Parser — uses Claude Sonnet to extract structured CRM data
 * from raw Slack messages mentioning @togari.
 */

import Anthropic from '@anthropic-ai/sdk';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ParsedPerson {
  name?: string;
  title?: string;
  company?: string;
  phone?: string;
  email?: string;
}

export interface ParsedCompany {
  name?: string;
  notes?: string;
}

export interface ParsedDeal {
  stage?: string;
  value?: number;
  pipeline?: 'partnerships' | 'inbound' | 'outbound';
  notes?: string;
  next_action?: string;
  next_action_date?: string;
  priority?: 'low' | 'medium' | 'high';
}

export interface ParsedCalendar {
  action?: 'create';
  title?: string;
  preferred_times?: string[];
  location?: string;
  duration_minutes?: number;
}

export interface ParsedReminder {
  message?: string;
  when?: string;
}

export type Intent =
  | 'new_deal'
  | 'update_deal'
  | 'log_activity'
  | 'schedule_meeting'
  | 'set_reminder';

export interface ParsedMessage {
  intent: Intent;
  person: ParsedPerson;
  company: ParsedCompany;
  deal: ParsedDeal;
  calendar: ParsedCalendar;
  reminder: ParsedReminder;
  confidence: number;
  clarification_needed?: string;
}

// ─── System Prompt ───────────────────────────────────────────────────────────

function buildSystemPrompt(today: string): string {
  return `You are a CRM message parser for Blue Monitor Advisory. Extract structured data from Slack messages about sales deals and meetings.

Today's date is: ${today}

Return a JSON object with exactly these fields:
- intent: "new_deal" | "update_deal" | "log_activity" | "schedule_meeting" | "set_reminder"
- person: { name, title, company, phone, email }
- company: { name, notes }
- deal: { stage, value, pipeline, notes, next_action, next_action_date, priority }
  - Valid stages: researching, contacted, conversation_started, discovery_scheduled, discovery_complete, proposal_sent, negotiating, verbal_commit, contract_sent, closed_won, closed_lost
  - Valid pipelines: partnerships, inbound, outbound
  - Priority: low, medium, high
  - next_action_date: resolve relative dates ("next tuesday", "tomorrow") to YYYY-MM-DD using today's date
- calendar: { action, title, preferred_times, location, duration_minutes }
  - action is always "create" when calendar info is present
  - preferred_times is an array of strings like "next tuesday 10am", "thursday 2pm"
- reminder: { message, when }
- confidence: 0-100
- clarification_needed: string explaining what's unclear (only when confidence < 60)

Rules:
- Scheduling a meeting/call → intent "schedule_meeting", populate calendar
- New company/deal not tracked → intent "new_deal"
- Updates to existing deal status/stage → intent "update_deal"
- Logging something that happened → intent "log_activity"
- Requesting a reminder → intent "set_reminder"
- Dollar amounts: "$50k" → 50000, "$1.2M" → 1200000
- Default pipeline to "outbound" if unclear
- Default priority to "medium" if not specified
- Omit fields you can't extract (use null)
- Return ONLY valid JSON. No markdown fences, no extra text.`;
}

// ─── Parser ──────────────────────────────────────────────────────────────────

export async function parseSlackMessage(text: string): Promise<ParsedMessage> {
  const client = new Anthropic();
  const today = new Date().toISOString().split('T')[0];

  const response = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1024,
    system: buildSystemPrompt(today),
    messages: [{ role: 'user', content: text }],
  });

  const block = response.content[0];
  if (block.type !== 'text') {
    throw new Error('Unexpected response type from Claude');
  }

  const parsed = JSON.parse(block.text) as ParsedMessage;

  // Ensure defaults
  parsed.person = parsed.person || {};
  parsed.company = parsed.company || {};
  parsed.deal = parsed.deal || {};
  parsed.calendar = parsed.calendar || {};
  parsed.reminder = parsed.reminder || {};
  parsed.confidence = parsed.confidence ?? 50;

  return parsed;
}
