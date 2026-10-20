/**
 * Read-only Google Calendar retrieval source.
 *
 * Fetches recent calendar events for a BMA user via GCP domain-wide
 * delegation and RETURNS them. This module is strictly read-only: it never
 * writes to BigQuery, the CRM, or the calendar itself. There is no BigQuery
 * import anywhere in this file by design.
 *
 * Auth reuses the exact domain-wide-delegation pattern from the email-engine
 * Gmail client (src/email-engine/gmail-client.ts) and calendar-ops
 * (src/core/tools/calendar-ops.ts): a `google.auth.JWT` built from the
 * service-account credentials in GCP_CREDENTIALS_BASE64 (or
 * GOOGLE_CREDENTIALS_BASE64), with `subject` set to the impersonated user.
 * The only scope requested is calendar.readonly.
 *
 * When credentials are missing, or the DWD grant does not include the
 * calendar.readonly scope (a 403 from the API), the function returns a clean
 * non-throwing "not configured / not authorized" result so an operator can
 * call it safely without a stack trace.
 *
 * Env:
 *   GCP_CREDENTIALS_BASE64      domain-wide-delegation service-account JSON (base64).
 *   GOOGLE_CREDENTIALS_BASE64   alternate name for the same creds.
 *   GMAIL_INGEST_USER           user to impersonate (default sagar@bluemodernadvisory.com).
 */

import { google, calendar_v3 } from "googleapis";
import { createLogger } from "../observability/logger";

const logger = createLogger("sources/calendar-fetch");

const DEFAULT_USER = "sagar@bluemodernadvisory.com";
const DEFAULT_SINCE_DAYS = 90;
const DEFAULT_MAX_EVENTS = 100;
const MAX_EVENTS_CAP = 250;

const CALENDAR_READONLY_SCOPE =
  "https://www.googleapis.com/auth/calendar.readonly";

export interface CalendarEvent {
  id: string;
  title: string;
  start: string;
  end: string;
  organizer?: string;
  attendees: string[];
  description?: string;
  location?: string;
}

export interface FetchCalendarEventsResult {
  configured: boolean;
  user: string;
  fetched: number;
  events: CalendarEvent[];
  note?: string;
}

/** Raw domain-wide-delegation credentials, or null when not configured. */
function getCredentials(): Record<string, unknown> | null {
  const b64 =
    process.env.GCP_CREDENTIALS_BASE64 || process.env.GOOGLE_CREDENTIALS_BASE64;
  if (!b64) return null;
  return JSON.parse(Buffer.from(b64, "base64").toString("utf-8"));
}

/**
 * Build a read-only Calendar client for `userEmail` via domain-wide
 * delegation. Mirrors buildClient in email-engine/gmail-client.ts, but
 * requests only the calendar.readonly scope.
 */
function buildClient(
  creds: Record<string, unknown>,
  userEmail: string,
): calendar_v3.Calendar {
  const auth = new google.auth.JWT({
    email: creds.client_email as string,
    key: creds.private_key as string,
    scopes: [CALENDAR_READONLY_SCOPE],
    subject: userEmail,
  });
  return google.calendar({ version: "v3", auth });
}

/** True when a Google API error looks like a permission / 403 problem. */
function isPermissionError(err: unknown): boolean {
  const anyErr = err as {
    code?: number | string;
    status?: number;
    message?: string;
  };
  const code = Number(anyErr?.code ?? anyErr?.status);
  if (code === 403 || code === 401) return true;
  const message = (anyErr?.message ?? "").toLowerCase();
  return (
    message.includes("permission") ||
    message.includes("unauthorized") ||
    message.includes("insufficient") ||
    (message.includes("access") && message.includes("denied"))
  );
}

/** Extract the organizer email from a calendar event. */
function eventOrganizer(e: calendar_v3.Schema$Event): string | undefined {
  const email = e.organizer?.email;
  return typeof email === "string" && email.length > 0 ? email : undefined;
}

/** Extract attendee emails from a calendar event. */
function eventAttendees(e: calendar_v3.Schema$Event): string[] {
  if (!e.attendees) return [];
  return e.attendees
    .map((a) => a.email)
    .filter(
      (email): email is string => typeof email === "string" && email.length > 0,
    );
}

/** dateTime for timed events, date for all-day events, empty string otherwise. */
function eventTime(slot: calendar_v3.Schema$EventDateTime | undefined): string {
  return slot?.dateTime ?? slot?.date ?? "";
}

/**
 * Fetch up to `maxEvents` events from the impersonated user's primary
 * calendar within the last `sinceDays` days. READ ONLY. Never throws:
 * missing creds and 403/permission errors both resolve to a clean
 * `configured: false` result with an explanatory note.
 */
export async function fetchCalendarEvents(params: {
  user?: string;
  sinceDays?: number;
  maxEvents?: number;
}): Promise<FetchCalendarEventsResult> {
  const user = params.user || process.env.GMAIL_INGEST_USER || DEFAULT_USER;
  const sinceDays = params.sinceDays ?? DEFAULT_SINCE_DAYS;
  const maxResults = Math.min(
    params.maxEvents ?? DEFAULT_MAX_EVENTS,
    MAX_EVENTS_CAP,
  );

  const creds = getCredentials();
  if (!creds) {
    return {
      configured: false,
      user,
      fetched: 0,
      events: [],
      note: "Google not configured: set GCP_CREDENTIALS_BASE64",
    };
  }

  const now = new Date();
  const timeMin = new Date(
    now.getTime() - sinceDays * 24 * 60 * 60 * 1000,
  ).toISOString();
  const timeMax = now.toISOString();

  try {
    const calendar = buildClient(creds, user);
    const res = await calendar.events.list({
      calendarId: "primary",
      timeMin,
      timeMax,
      singleEvents: true,
      orderBy: "startTime",
      maxResults,
    });

    const items = res.data.items ?? [];
    const events: CalendarEvent[] = items.map((e) => {
      const event: CalendarEvent = {
        id: String(e.id ?? ""),
        title: String(e.summary ?? "(no title)"),
        start: eventTime(e.start ?? undefined),
        end: eventTime(e.end ?? undefined),
        attendees: eventAttendees(e),
      };
      const organizer = eventOrganizer(e);
      if (organizer) event.organizer = organizer;
      if (e.description) event.description = String(e.description);
      if (e.location) event.location = String(e.location);
      return event;
    });

    logger.info("calendar fetch complete", {
      user,
      sinceDays,
      fetched: events.length,
    });

    return {
      configured: true,
      user,
      fetched: events.length,
      events,
    };
  } catch (err) {
    if (isPermissionError(err)) {
      logger.warn("calendar read not authorized", {
        user,
        error: err instanceof Error ? err.message : String(err),
      });
      return {
        configured: false,
        user,
        fetched: 0,
        events: [],
        note: `Calendar read not authorized for ${user} - the service account DWD grant needs the calendar.readonly scope (and the user must be in the workspace)`,
      };
    }

    const message = err instanceof Error ? err.message : String(err);
    logger.error(
      "calendar fetch failed",
      err instanceof Error ? err : new Error(message),
      { user },
    );
    return {
      configured: true,
      user,
      fetched: 0,
      events: [],
      note: `Calendar fetch failed: ${message}`,
    };
  }
}
