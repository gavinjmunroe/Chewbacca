/**
 * @togari/core — Transport-agnostic calendar operations
 *
 * Creates Google Calendar events via OAuth2 refresh token flow.
 * Extracted from slack-sync/calendar-sync.ts.
 */

import { createLogger } from '../../observability/logger';

const logger = createLogger('core/calendar-ops');

const DEFAULT_TIMEZONE = 'America/New_York';

/**
 * Thrown by `getAccessToken` when no per-user OAuth refresh token is
 * configured for the sender. Caller layers (engine, Slack transport)
 * recognize this class and surface a friendly explanation instead of
 * a 500-style error.
 */
export class CalendarAuthMissingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CalendarAuthMissingError';
  }
}

/**
 * The legacy single-tenant token (env `GOOGLE_CALENDAR_REFRESH_TOKEN`)
 * is whoever did the original OAuth dance. Honor it only for that user;
 * anyone else needs their own per-user token to avoid writing events on
 * the wrong calendar.
 */
const LEGACY_CALENDAR_OWNER_SLACK_ID =
  process.env.GOOGLE_CALENDAR_LEGACY_OWNER_SLACK_ID ?? 'U08L8PFMWBE'; // Karthik

/**
 * Compute "now" components (y/m/d/dow/h/m) in the given IANA timezone.
 * Used for day-of-week math instead of Date.getDay() which returns
 * the day in *server local time* (UTC on Railway).
 */
function nowInTimezone(tz: string): { year: number; month: number; day: number; dayOfWeek: number; hours: number; minutes: number } {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    weekday: 'short',
    hour12: false,
  }).formatToParts(now);
  const get = (type: string) => parts.find(p => p.type === type)?.value || '';
  const dayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    year: parseInt(get('year'), 10),
    month: parseInt(get('month'), 10) - 1,
    day: parseInt(get('day'), 10),
    dayOfWeek: dayMap[get('weekday')] ?? 0,
    hours: parseInt(get('hour'), 10),
    minutes: parseInt(get('minute'), 10),
  };
}

function isValidEmail(str: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(str);
}

/**
 * Look up a refresh token for the given Slack user. Tried in order:
 *   1. `GOOGLE_CALENDAR_REFRESH_TOKEN_<SLACK_ID>` env var (per-user).
 *   2. `GOOGLE_CALENDAR_REFRESH_TOKENS` JSON map (per-user, batch form).
 *   3. Legacy `GOOGLE_CALENDAR_REFRESH_TOKEN` — only honored when the
 *      sender matches LEGACY_CALENDAR_OWNER_SLACK_ID, so we don't write
 *      Sagar's events onto Karthik's calendar by mistake.
 * Returns `null` if no token resolves — caller throws CalendarAuthMissingError.
 */
function getRefreshTokenForUser(slackUserId?: string): string | null {
  if (slackUserId) {
    const perUser = process.env[`GOOGLE_CALENDAR_REFRESH_TOKEN_${slackUserId}`];
    if (perUser) return perUser;

    const json = process.env.GOOGLE_CALENDAR_REFRESH_TOKENS;
    if (json) {
      try {
        const map = JSON.parse(json) as Record<string, string>;
        if (typeof map[slackUserId] === 'string' && map[slackUserId].length > 0) {
          return map[slackUserId];
        }
      } catch (err) {
        logger.warn('GOOGLE_CALENDAR_REFRESH_TOKENS JSON parse failed', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    if (slackUserId === LEGACY_CALENDAR_OWNER_SLACK_ID) {
      const legacy = process.env.GOOGLE_CALENDAR_REFRESH_TOKEN;
      if (legacy) return legacy;
    }
  }

  return null;
}

async function getAccessToken(senderSlackUserId?: string): Promise<string> {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('Missing Google OAuth credentials (GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET)');
  }

  const refreshToken = getRefreshTokenForUser(senderSlackUserId);
  if (!refreshToken) {
    throw new CalendarAuthMissingError(
      `Calendar writes require per-user OAuth. ` +
        `Currently only Karthik has a token configured. Sagar / Maggie / others need to OAuth their calendar ` +
        `before I can schedule for them. Karthik to set up the per-user OAuth flow as a follow-up. ` +
        `(sender: ${senderSlackUserId ?? '<unknown>'})`,
    );
  }

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Google OAuth token refresh failed ${response.status}: ${errorBody}`);
  }

  const data = await response.json() as any;
  return data.access_token;
}

function formatLocalISO(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const h = String(date.getHours()).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');
  const s = String(date.getSeconds()).padStart(2, '0');
  return `${y}-${m}-${d}T${h}:${min}:${s}`;
}

function extractTime(str: string): { hours: number; minutes: number } | null {
  const lower = str.toLowerCase();

  // Match "3pm", "10am", "3:30pm", "10:30 am"
  const ampmMatch = lower.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i);
  if (ampmMatch) {
    let hours = parseInt(ampmMatch[1], 10);
    const minutes = parseInt(ampmMatch[2] || '0', 10);
    if (ampmMatch[3].toLowerCase() === 'pm' && hours < 12) hours += 12;
    if (ampmMatch[3].toLowerCase() === 'am' && hours === 12) hours = 0;
    return { hours, minutes };
  }

  // Match 24h format "15:00"
  const h24Match = lower.match(/(?:^|[^/\d])(\d{1,2}):(\d{2})(?:$|[^/\d])/);
  if (h24Match) {
    const hours = parseInt(h24Match[1], 10);
    const minutes = parseInt(h24Match[2], 10);
    if (hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59) {
      return { hours, minutes };
    }
  }

  return null;
}

function resolveDay(lower: string, timezone: string): Date | null {
  const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const hasNext = lower.includes('next');

  for (let i = 0; i < dayNames.length; i++) {
    if (lower.includes(dayNames[i])) {
      const tzNow = nowInTimezone(timezone);
      let daysAhead = i - tzNow.dayOfWeek;
      if (daysAhead <= 0) daysAhead += 7;
      if (hasNext && daysAhead < 7) daysAhead += 7;
      // Build the target date as a wall-clock date in the user's TZ.
      // We construct a Date using local fields, but downstream code
      // formats with the user's TZ on the Google event payload — the
      // wall-clock components are what matter, not the underlying UTC
      // instant.
      const target = new Date(tzNow.year, tzNow.month, tzNow.day);
      target.setDate(target.getDate() + daysAhead);
      return target;
    }
  }

  return null;
}

function resolveMonthDay(lower: string, timezone: string): Date | null {
  const monthNames = [
    'january', 'february', 'march', 'april', 'may', 'june',
    'july', 'august', 'september', 'october', 'november', 'december',
  ];

  const tzNow = nowInTimezone(timezone);

  for (let m = 0; m < monthNames.length; m++) {
    const monthMatch = lower.match(new RegExp(`${monthNames[m]}\\s+(\\d{1,2})(?:,?\\s*(\\d{4}))?`));
    if (monthMatch) {
      const day = parseInt(monthMatch[1], 10);
      const year = monthMatch[2] ? parseInt(monthMatch[2], 10) : tzNow.year;
      return new Date(year, m, day);
    }
  }

  // Numeric: "4/16" or "4/16/2026"
  const numericMatch = lower.match(/(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?/);
  if (numericMatch) {
    const month = parseInt(numericMatch[1], 10) - 1;
    const day = parseInt(numericMatch[2], 10);
    const year = numericMatch[3] ? parseInt(numericMatch[3], 10) : tzNow.year;
    return new Date(year, month, day);
  }

  return null;
}

/**
 * Parse a datetime string into a Date object whose wall-clock fields
 * (year/month/day/hour/minute) represent the intended local time in the
 * user's timezone. The Google Calendar payload pairs the formatted ISO
 * with `timeZone: <tz>`, so the underlying UTC instant doesn't have to
 * match — what matters is the wall-clock components.
 *
 * The bug this fixes: previously this used `now.getDay()` for
 * day-of-week resolution, which returns the day in server-local time
 * (UTC on Railway). For a user sending "Tuesday" at 9pm ET on Monday,
 * the server saw it as Tuesday already in UTC and resolved to the wrong
 * Tuesday. Now all day math is anchored to the user's TZ.
 */
function parseDateTime(timeStr: string, timezone: string): Date | null {
  // Strategy 1: ISO string with timezone offset
  if (/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(timeStr)) {
    try {
      const parsed = new Date(timeStr);
      if (!isNaN(parsed.getTime()) && parsed.getFullYear() > 2020) {
        const tzParts = new Intl.DateTimeFormat('en-US', {
          timeZone: timezone,
          year: 'numeric', month: '2-digit', day: '2-digit',
          hour: '2-digit', minute: '2-digit', second: '2-digit',
          hour12: false,
        }).formatToParts(parsed);
        const get = (type: string) => parseInt(tzParts.find(p => p.type === type)?.value || '0', 10);
        return new Date(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
      }
    } catch {
      // fall through
    }
  }

  // Strategy 2: Unix timestamp
  const numericVal = Number(timeStr);
  if (!isNaN(numericVal) && numericVal > 1_000_000_000 && numericVal < 10_000_000_000) {
    const d = new Date(numericVal * 1000);
    const tzParts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hour12: false,
    }).formatToParts(d);
    const get = (type: string) => parseInt(tzParts.find(p => p.type === type)?.value || '0', 10);
    return new Date(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  }

  // Strategy 3: Natural language
  const lower = timeStr.toLowerCase().trim();

  const timeOfDay = extractTime(lower);

  let targetDate: Date | null = null;

  if (lower.includes('tomorrow')) {
    const tzNow = nowInTimezone(timezone);
    targetDate = new Date(tzNow.year, tzNow.month, tzNow.day);
    targetDate.setDate(targetDate.getDate() + 1);
  }

  if (!targetDate && lower.includes('today')) {
    const tzNow = nowInTimezone(timezone);
    targetDate = new Date(tzNow.year, tzNow.month, tzNow.day);
  }

  if (!targetDate) {
    targetDate = resolveDay(lower, timezone);
  }

  if (!targetDate) {
    targetDate = resolveMonthDay(lower, timezone);
  }

  // Strategy 4: plain Date.parse as last resort
  if (!targetDate) {
    try {
      const parsed = new Date(timeStr);
      if (!isNaN(parsed.getTime()) && parsed.getFullYear() > 2020) {
        if (!timeOfDay) return null;
        parsed.setHours(timeOfDay.hours, timeOfDay.minutes, 0, 0);
        return parsed;
      }
    } catch {
      // fall through
    }
    return null;
  }

  // We have a date but no time — refuse to fabricate one. The caller
  // must gate this case before reaching parseDateTime.
  if (!timeOfDay) return null;

  targetDate.setHours(timeOfDay.hours, timeOfDay.minutes, 0, 0);
  return targetDate;
}

// ── Public API ───────────────────────────────────────────────────

export async function scheduleEvent(params: {
  title: string;
  dateTime: string;
  duration?: number;
  attendeeEmails?: string[];
  timezone: string;
  /**
   * Slack user id of the sender. Used to look up the per-user calendar
   * refresh token via getRefreshTokenForUser. Omitting this falls back
   * to the legacy single-token path only when the legacy owner is the
   * (unknown) sender — for safety we throw rather than guess.
   */
  senderSlackUserId?: string;
}): Promise<{ eventId: string; link: string; summary: string }> {
  const accessToken = await getAccessToken(params.senderSlackUserId);
  const duration = params.duration || 30;
  const timezone = params.timezone || DEFAULT_TIMEZONE;

  const startDate = parseDateTime(params.dateTime, timezone);
  if (!startDate) {
    throw new Error(`Could not parse date/time: ${params.dateTime}`);
  }

  const endDate = new Date(startDate.getTime() + duration * 60 * 1000);

  // F.3 — attendees are exactly what the user specified. We no longer
  // force-include Kevin (or any other team member); that contradicted
  // multi-tenancy and confused calendar UX for non-Kevin senders.
  const validAttendees = (params.attendeeEmails || []).filter((a) => isValidEmail(a));

  const event: Record<string, unknown> = {
    summary: params.title,
    start: {
      dateTime: formatLocalISO(startDate),
      timeZone: timezone,
    },
    end: {
      dateTime: formatLocalISO(endDate),
      timeZone: timezone,
    },
    attendees: validAttendees.map((email) => ({ email })),
  };

  console.log('[core/calendar-ops] Creating event:', JSON.stringify({
    summary: event.summary,
    start: event.start,
    end: event.end,
  }));

  const response = await fetch(
    'https://www.googleapis.com/calendar/v3/calendars/primary/events',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(event),
    },
  );

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Google Calendar API ${response.status}: ${errorBody}`);
  }

  const created = await response.json() as any;

  const startFormatted = startDate.toLocaleString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });

  const summaryText = `${params.title} on ${startFormatted} (${timezone}, ${duration} minutes)`;

  logger.info('Created calendar event', { eventId: created.id, title: params.title });

  return {
    eventId: created.id,
    link: created.htmlLink,
    summary: summaryText,
  };
}

// ── F.4: update_event support ──────────────────────────────────────

export interface CalendarEventMatch {
  id: string;
  summary: string;
  start: string;
  htmlLink: string;
}

/**
 * Search the sender's calendar for events matching the query within
 * the next 14 days. Used by the `update_event` intent to locate the
 * event the user wants to modify. Returns ordered matches (soonest
 * first); caller is responsible for ambiguity / no-match handling.
 */
export async function findCalendarEvent(params: {
  query: string;
  senderSlackUserId?: string;
  windowDays?: number;
}): Promise<CalendarEventMatch[]> {
  const accessToken = await getAccessToken(params.senderSlackUserId);
  const now = new Date();
  const windowDays = params.windowDays ?? 14;
  const future = new Date(now.getTime() + windowDays * 24 * 60 * 60 * 1000);

  const url = new URL('https://www.googleapis.com/calendar/v3/calendars/primary/events');
  url.searchParams.set('q', params.query);
  url.searchParams.set('timeMin', now.toISOString());
  url.searchParams.set('timeMax', future.toISOString());
  url.searchParams.set('singleEvents', 'true');
  url.searchParams.set('orderBy', 'startTime');
  url.searchParams.set('maxResults', '10');

  const response = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Google Calendar API ${response.status}: ${errorBody}`);
  }
  const data = (await response.json()) as { items?: Array<Record<string, any>> };
  const items = data.items ?? [];
  return items.map((e) => ({
    id: String(e.id ?? ''),
    summary: String(e.summary ?? '(no title)'),
    start: String(e.start?.dateTime ?? e.start?.date ?? ''),
    htmlLink: String(e.htmlLink ?? ''),
  }));
}

/**
 * PATCH an existing calendar event. Supply only the fields you want to
 * change; everything else is preserved by the Calendar API. Caller is
 * responsible for resolving the new wall-clock date/time first.
 */
export async function updateCalendarEvent(params: {
  eventId: string;
  updates: {
    title?: string;
    dateTime?: string;     // natural-language or ISO — parsed via parseDateTime
    duration?: number;     // minutes; if dateTime is set, used to compute end
    attendeeEmails?: string[];
  };
  timezone: string;
  senderSlackUserId?: string;
}): Promise<{ eventId: string; link: string; summary: string }> {
  const accessToken = await getAccessToken(params.senderSlackUserId);
  const timezone = params.timezone || DEFAULT_TIMEZONE;

  const patch: Record<string, unknown> = {};
  if (params.updates.title) patch.summary = params.updates.title;
  if (params.updates.dateTime) {
    const startDate = parseDateTime(params.updates.dateTime, timezone);
    if (!startDate) {
      throw new Error(`Could not parse date/time: ${params.updates.dateTime}`);
    }
    const duration = params.updates.duration ?? 30;
    const endDate = new Date(startDate.getTime() + duration * 60 * 1000);
    patch.start = { dateTime: formatLocalISO(startDate), timeZone: timezone };
    patch.end = { dateTime: formatLocalISO(endDate), timeZone: timezone };
  }
  if (params.updates.attendeeEmails) {
    patch.attendees = params.updates.attendeeEmails
      .filter((a) => isValidEmail(a))
      .map((email) => ({ email }));
  }

  const response = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(params.eventId)}`,
    {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(patch),
    },
  );
  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Google Calendar API ${response.status}: ${errorBody}`);
  }
  const updated = (await response.json()) as Record<string, any>;

  const startStr = updated.start?.dateTime ?? updated.start?.date ?? '';
  const summaryText = `${updated.summary ?? params.updates.title ?? '(updated)'}${startStr ? ` — ${startStr}` : ''}`;

  logger.info('Updated calendar event', { eventId: updated.id, title: updated.summary });

  return {
    eventId: String(updated.id ?? params.eventId),
    link: String(updated.htmlLink ?? ''),
    summary: summaryText,
  };
}
