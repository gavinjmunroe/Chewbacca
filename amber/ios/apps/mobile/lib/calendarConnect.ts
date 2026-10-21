import { callMedhaId } from './medhaId';
import * as WebBrowser from 'expo-web-browser';
import { api, fetchConnections } from './api';
import {
  calendarSyncFailed,
  getCalendarAccounts,
  syncCalendarAccounts,
  type CalendarProvider,
} from './calendarAccounts';
import { oauthCallbackStatus } from './oauthCallback';
/** One flow for Gmail and Calendar: confirm server state, then await calendar sync. */
export async function connectCalendarProvider(
  provider: CalendarProvider,
  onProgress: (text: string) => void,
  calendarOnly = false,
) {
  onProgress('Opening secure sign-in…');
  const init = await api.oauthInit(provider, calendarOnly);
  if (!init.ok) throw Error('Google sign-in is unavailable. Please try again.');
  const url = new URL(init.data.authorize_url);
  const host = provider === 'google' ? 'accounts.google.com' : 'login.microsoftonline.com';
  if (url.protocol !== 'https:' || url.hostname !== host)
    throw Error('The sign-in link could not be verified.');
  const result = await WebBrowser.openAuthSessionAsync(url.toString(), 'amber://oauth-callback');
  if (result.type !== 'success') return { connected: false, message: 'Sign-in cancelled.' };
  if (oauthCallbackStatus(result.url, provider) !== 'connected')
    throw Error('Authorization was not completed. Reconnect and allow calendar access.');
  onProgress('Checking your calendar connection…');
  if (provider === 'google')
    await callMedhaId({
      path: '/v1/me/calendars/restore-google',
      method: 'POST',
      requireAuth: true,
    });
  const synced = await syncCalendarAccounts();
  const accounts = await getCalendarAccounts();
  if (!accounts.ok) throw Error('Sign-in returned, but calendar accounts could not be checked.');
  const connected = accounts.data.accounts.some((a) => a.provider === provider);
  if (!connected) {
    const connections = await fetchConnections();
    if (provider === 'google' && connections.ok && connections.data.google?.connected)
      throw Error(
        'Google connected without Calendar access. Use “Connect Calendar” to authorize your calendar.',
      );
    throw Error('No calendar account was confirmed. Reconnect and allow Calendar access.');
  }
  if (!synced.ok || calendarSyncFailed(synced.data))
    return {
      connected: true,
      message: 'Calendar connected. Sync needs attention; pull to refresh to retry.',
    };
  return {
    connected: true,
    message: `Calendar connected · ${synced.data.synced ?? 0} events synced.`,
  };
}
