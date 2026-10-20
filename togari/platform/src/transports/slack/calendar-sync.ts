/**
 * @togari/transports/slack — Calendar sync (thin wrapper)
 *
 * Delegates to `core/tools/calendar-ops.scheduleEvent`. As of Patch F.3
 * the core helper no longer force-includes Kevin (or anyone else) as
 * an attendee — attendees are exactly what the user specified. Calendar
 * writes are per-sender: this wrapper threads the Slack user id through
 * so scheduleEvent can pick the right per-user OAuth refresh token.
 */

import type { ParsedIntent } from '../../core/types';
import { scheduleEvent } from '../../core/tools/calendar-ops';
import { createLogger } from '../../observability/logger';

const logger = createLogger('slack/calendar-sync');

export interface CalendarEvent {
  id: string;
  summary: string;
  htmlLink: string;
  start: string;
  end: string;
}

function resolveDateTime(intent: ParsedIntent): string {
  if (intent.calendarDate && intent.calendarTime) return `${intent.calendarDate} ${intent.calendarTime}`;
  if (intent.calendarDate && !intent.calendarTime) throw new Error('schedule_meeting without time — engine must gate this before reaching calendar-sync');
  if (intent.calendarTime) return intent.calendarTime;
  const fromRaw: string | undefined =
    intent.rawFields?.calendar?.preferred_times?.[0] ||
    intent.rawFields?.preferred_times?.[0];
  if (fromRaw) return fromRaw;
  throw new Error('No date/time provided for meeting');
}

function resolveTitle(intent: ParsedIntent): string {
  return (
    intent.meetingTitle ||
    intent.rawFields?.calendar?.meeting_title ||
    intent.rawFields?.calendar?.title ||
    `Meeting${intent.contactName ? ` with ${intent.contactName}` : ''}`
  );
}

function resolveAttendees(intent: ParsedIntent): string[] {
  return (
    intent.calendarAttendees ||
    intent.rawFields?.calendar?.attendees ||
    []
  );
}

function resolveDuration(intent: ParsedIntent): number {
  return (
    intent.calendarDuration ||
    intent.rawFields?.calendar?.duration_minutes ||
    30
  );
}

/**
 * Create Google Calendar events for a `schedule_meeting` intent.
 * Returns an array (always 0 or 1 element) so callers that used to
 * render multi-event Block Kit don't need a shape change.
 */
export async function syncCalendar(
  intent: ParsedIntent,
  timezone: string = 'America/New_York',
  senderSlackUserId?: string,
): Promise<CalendarEvent[]> {
  try {
    const result = await scheduleEvent({
      title: resolveTitle(intent),
      dateTime: resolveDateTime(intent),
      duration: resolveDuration(intent),
      attendeeEmails: resolveAttendees(intent),
      timezone,
      senderSlackUserId,
    });

    return [
      {
        id: result.eventId,
        summary: resolveTitle(intent),
        htmlLink: result.link,
        start: result.summary,
        end: '',
      },
    ];
  } catch (err) {
    logger.error('Calendar sync failed', err instanceof Error ? err : new Error(String(err)));
    throw err;
  }
}
