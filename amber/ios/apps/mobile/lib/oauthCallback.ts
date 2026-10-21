import type { CalendarProvider } from './calendarAccounts';
export function oauthCallbackStatus(
  url: string,
  provider: CalendarProvider,
): 'connected' | 'failed' {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'amber:' &&
      parsed.hostname === 'oauth-callback' &&
      parsed.searchParams.get('platform') === provider &&
      parsed.searchParams.get('status') === 'connected'
      ? 'connected'
      : 'failed';
  } catch {
    return 'failed';
  }
}
