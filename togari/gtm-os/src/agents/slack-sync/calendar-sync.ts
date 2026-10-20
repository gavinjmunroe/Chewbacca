/**
 * Calendar Sync — Google Calendar event creation from parsed Slack messages.
 *
 * Uses the Google Calendar REST API directly with a shared refresh token (MVP).
 * Env vars: GOOGLE_CALENDAR_REFRESH_TOKEN, GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET
 */

import type { ParsedMessage } from './parser';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface CalendarSyncResult {
  created: boolean;
  events_count: number;
  event_summaries: string[];
}

interface TokenResponse {
  access_token: string;
  expires_in: number;
  token_type: string;
}

// ─── Auth ────────────────────────────────────────────────────────────────────

async function getAccessToken(): Promise<string> {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_CALENDAR_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error(
      'Missing Google Calendar credentials. Set GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, and GOOGLE_CALENDAR_REFRESH_TOKEN.',
    );
  }

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to refresh Google access token: ${res.status} ${text}`);
  }

  const data = (await res.json()) as TokenResponse;
  return data.access_token;
}

// ─── Calendar API ────────────────────────────────────────────────────────────

interface CalendarEvent {
  summary: string;
  location?: string;
  description?: string;
  start: { dateTime: string; timeZone: string };
  end: { dateTime: string; timeZone: string };
}

async function insertCalendarEvent(
  accessToken: string,
  event: CalendarEvent,
): Promise<void> {
  const res = await fetch(
    'https://www.googleapis.com/calendar/v3/calendars/primary/events',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(event),
    },
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Google Calendar API error: ${res.status} ${text}`);
  }
}

// ─── Date Parsing ────────────────────────────────────────────────────────────

const TIMEZONE = 'America/New_York';

function parsePreferredTime(timeStr: string): Date | null {
  const now = new Date();
  const lower = timeStr.toLowerCase().trim();

  // Extract time portion (e.g., "10am", "2pm", "2:30pm")
  const timeMatch = lower.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)/);
  let hours = 10; // default 10am
  let minutes = 0;
  if (timeMatch) {
    hours = parseInt(timeMatch[1], 10);
    minutes = timeMatch[2] ? parseInt(timeMatch[2], 10) : 0;
    if (timeMatch[3] === 'pm' && hours < 12) hours += 12;
    if (timeMatch[3] === 'am' && hours === 12) hours = 0;
  }

  // "tomorrow"
  if (lower.startsWith('tomorrow')) {
    const d = new Date(now);
    d.setDate(d.getDate() + 1);
    d.setHours(hours, minutes, 0, 0);
    return d;
  }

  // "next tuesday", "thursday", etc.
  const dayNames = [
    'sunday', 'monday', 'tuesday', 'wednesday',
    'thursday', 'friday', 'saturday',
  ];
  for (let i = 0; i < dayNames.length; i++) {
    if (lower.includes(dayNames[i])) {
      const d = new Date(now);
      const currentDay = d.getDay();
      let daysAhead = i - currentDay;
      if (daysAhead <= 0) daysAhead += 7;
      d.setDate(d.getDate() + daysAhead);
      d.setHours(hours, minutes, 0, 0);
      return d;
    }
  }

  // "4/1 10am", "3/25", "12/15 2pm" — M/D format
  const dateMatch = lower.match(/(\d{1,2})\/(\d{1,2})/);
  if (dateMatch) {
    const month = parseInt(dateMatch[1], 10) - 1;
    const day = parseInt(dateMatch[2], 10);
    const d = new Date(now.getFullYear(), month, day, hours, minutes, 0, 0);
    if (d < now) d.setFullYear(d.getFullYear() + 1);
    return d;
  }

  // "today 3pm"
  if (lower.startsWith('today')) {
    const d = new Date(now);
    d.setHours(hours, minutes, 0, 0);
    return d;
  }

  return null;
}

function getDefaultDuration(title: string): number {
  const lower = (title || '').toLowerCase();
  if (lower.includes('coffee') || lower.includes('intro') || lower.includes('quick')) {
    return 30;
  }
  if (lower.includes('discovery') || lower.includes('demo') || lower.includes('deep')) {
    return 60;
  }
  return 30;
}

// ─── Main Export ─────────────────────────────────────────────────────────────

export async function syncCalendar(
  parsed: ParsedMessage,
): Promise<CalendarSyncResult> {
  if (!parsed.calendar.action || parsed.calendar.action !== 'create') {
    return { created: false, events_count: 0, event_summaries: [] };
  }

  const times = parsed.calendar.preferred_times || [];
  if (times.length === 0) {
    return { created: false, events_count: 0, event_summaries: [] };
  }

  const accessToken = await getAccessToken();
  const title = parsed.calendar.title || `Meeting with ${parsed.person.name || parsed.company.name || 'TBD'}`;
  const duration = parsed.calendar.duration_minutes || getDefaultDuration(title);
  const isMultiple = times.length > 1;
  const eventSummaries: string[] = [];

  for (const timeStr of times) {
    const startDate = parsePreferredTime(timeStr);
    if (!startDate) continue;

    const endDate = new Date(startDate.getTime() + duration * 60 * 1000);
    const eventTitle = isMultiple ? `[HOLD] ${title}` : title;

    await insertCalendarEvent(accessToken, {
      summary: eventTitle,
      location: parsed.calendar.location || undefined,
      description: `Created via Togari Slack bot.\nCompany: ${parsed.company.name || 'N/A'}\nContact: ${parsed.person.name || 'N/A'}`,
      start: {
        dateTime: startDate.toISOString(),
        timeZone: TIMEZONE,
      },
      end: {
        dateTime: endDate.toISOString(),
        timeZone: TIMEZONE,
      },
    });

    const dateStr = startDate.toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZone: TIMEZONE,
    });
    eventSummaries.push(`${eventTitle} — ${dateStr}`);
  }

  return {
    created: eventSummaries.length > 0,
    events_count: eventSummaries.length,
    event_summaries: eventSummaries,
  };
}
