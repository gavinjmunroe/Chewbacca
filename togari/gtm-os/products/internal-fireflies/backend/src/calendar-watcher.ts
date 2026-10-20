/**
 * Google Calendar watcher — polls for upcoming meetings with video conferencing
 * links and auto-schedules recording bots.
 *
 * In production, this would use Calendar push notifications (webhooks).
 * For now, it polls every 5 minutes via the Google Calendar API.
 */

import { google, type calendar_v3 } from 'googleapis';
import { v4 as uuidv4 } from 'uuid';
import { store } from './store';
import type { Meeting, Participant, MeetingSource } from '../../shared/src/types';

const POLL_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

let pollTimer: ReturnType<typeof setInterval> | null = null;

function getCalendarClient(): calendar_v3.Calendar | null {
  const credentials = process.env.GOOGLE_CALENDAR_CREDENTIALS;
  const refreshToken = process.env.GOOGLE_CALENDAR_REFRESH_TOKEN;

  if (!credentials || !refreshToken) {
    return null;
  }

  try {
    const creds = JSON.parse(credentials);
    const oauth2Client = new google.auth.OAuth2(
      creds.client_id,
      creds.client_secret,
      creds.redirect_uri
    );
    oauth2Client.setCredentials({ refresh_token: refreshToken });
    return google.calendar({ version: 'v3', auth: oauth2Client });
  } catch {
    console.warn('Failed to initialize Google Calendar client');
    return null;
  }
}

function detectMeetingSource(event: calendar_v3.Schema$Event): { source: MeetingSource; url: string } | null {
  // Google Meet
  if (event.hangoutLink) {
    return { source: 'google_meet', url: event.hangoutLink };
  }

  // Zoom or Teams in description/location
  const text = `${event.description || ''} ${event.location || ''}`;
  const zoomMatch = text.match(/(https:\/\/[\w.-]*zoom\.us\/j\/\S+)/i);
  if (zoomMatch) {
    return { source: 'zoom', url: zoomMatch[1] };
  }

  const teamsMatch = text.match(/(https:\/\/teams\.microsoft\.com\/l\/meetup-join\/\S+)/i);
  if (teamsMatch) {
    return { source: 'teams', url: teamsMatch[1] };
  }

  return null;
}

function eventToParticipants(event: calendar_v3.Schema$Event): Participant[] {
  return (event.attendees || []).map((a) => ({
    name: a.displayName || a.email?.split('@')[0] || 'Unknown',
    email: a.email || undefined,
    role: a.organizer ? 'host' as const : 'attendee' as const,
  }));
}

async function pollUpcomingMeetings(): Promise<void> {
  const calendar = getCalendarClient();
  if (!calendar) return;

  const now = new Date();
  const lookAhead = new Date(now.getTime() + 30 * 60 * 1000); // 30 min ahead

  try {
    const response = await calendar.events.list({
      calendarId: 'primary',
      timeMin: now.toISOString(),
      timeMax: lookAhead.toISOString(),
      singleEvents: true,
      orderBy: 'startTime',
    });

    const events = response.data.items || [];

    for (const event of events) {
      if (!event.id) continue;

      // Skip if already tracked
      const existing = store.list().find((m) => m.calendarEventId === event.id);
      if (existing) continue;

      const meetingInfo = detectMeetingSource(event);
      if (!meetingInfo) continue; // No video link, skip

      const meeting: Meeting = {
        id: uuidv4(),
        title: event.summary || 'Untitled Meeting',
        status: 'scheduled',
        source: meetingInfo.source,
        calendarEventId: event.id,
        meetingUrl: meetingInfo.url,
        participants: eventToParticipants(event),
        scheduledAt: event.start?.dateTime || event.start?.date,
        tags: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      store.create(meeting);
      console.log(`[calendar-watcher] Scheduled recording for: ${meeting.title} at ${meeting.scheduledAt}`);
    }
  } catch (err) {
    console.error('[calendar-watcher] Poll failed:', err instanceof Error ? err.message : err);
  }
}

export function startCalendarWatcher(): void {
  const calendar = getCalendarClient();
  if (!calendar) {
    console.log('[calendar-watcher] No Google Calendar credentials — watcher disabled');
    return;
  }

  console.log('[calendar-watcher] Started — polling every 5 minutes');
  pollUpcomingMeetings(); // Initial poll
  pollTimer = setInterval(pollUpcomingMeetings, POLL_INTERVAL_MS);
}

export function stopCalendarWatcher(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
    console.log('[calendar-watcher] Stopped');
  }
}
