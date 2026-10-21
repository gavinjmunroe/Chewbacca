import { callMedhaId } from './medhaId';
import type { ReviewRequest } from './memoActions';
export async function createGoogleMemoEvent(request: ReviewRequest, requestId: string) {
  if (!request.googleAccountId) throw new Error('Choose a Google account first.');
  const result = await callMedhaId<{
    ok: boolean;
    id: string;
    destination: string;
    accountEmail: string;
  }>({
    path: '/v1/me/google-calendar-events',
    method: 'POST',
    requireAuth: true,
    timeoutMs: 65000,
    retries: 0,
    body: {
      requestId,
      accountId: request.googleAccountId,
      title: request.title,
      description: request.text,
      ...(request.place?.trim() ? { place: request.place.trim() } : {}),
      startsAt: request.startsAt.toISOString(),
      endsAt: request.endsAt.toISOString(),
    },
  });
  if (!result.ok) {
    const copy: Record<string, string> = {
      google_reconnect: 'Reconnect Google Calendar with permission to create events, then retry.',
      google_not_connected: 'Connect your Google Calendar account first.',
      google_not_writable: 'Your Google calendar does not allow event creation.',
      google_saved_amber_pending:
        'Saved in Google Calendar. Amber is still syncing; retry this unchanged draft safely.',
      google_action_conflict:
        'This action differs from an existing or removed Google event. Check Google Calendar before making another event.',
    };
    throw Object.assign(
      new Error(
        copy[result.error] ||
          'Google has not confirmed the save. Retry this unchanged draft safely.',
      ),
      { name: 'CalendarWriteError' },
    );
  }
  return result;
}
