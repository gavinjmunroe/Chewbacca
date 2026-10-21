/**
 * THE CALENDARS AMBER HOLDS ITSELF, as opposed to the ones on the phone.
 *
 *   "It should show me Google logins so I can log into multiple calendars. It's
 *    showing me the calendars I already have logged in. If I have Apple and one
 *    Google account, it should say 'you have your Apple and this Google
 *    account', and you should have the option to add another Apple account,
 *    another Google account, another Calendly account, or whatever."
 *
 * THERE ARE TWO KINDS AND THEY ARE NOT INTERCHANGEABLE, which is the whole
 * reason this file exists next to deviceCalendar.ts rather than inside it:
 *
 *   ON THE PHONE   iOS keeps one calendar database and every account added in
 *                  iOS Settings writes into it -- iCloud, a work Exchange, a
 *                  Google account signed in on the device. Amber reads it with
 *                  one permission and holds no tokens. Nothing can ADD one from
 *                  inside this app: account setup is the Settings app, and no
 *                  third-party app is allowed near it.
 *
 *   IN AMBER       an account this app logged into itself, over OAuth, with its
 *                  own row in calendar_accounts and its own refresh token. This
 *                  is how a work Google that is not on the phone gets in, and
 *                  how a second one coexists with the first (migration 046 --
 *                  the secrets bag could only ever hold one).
 *
 * So the screen shows both lists and says which is which. Claiming Amber can add
 * an iCloud account would be a lie, and hiding the phone's calendars would hide
 * where most people's events actually are.
 */
import { callMedhaId, type MedhaIdResult } from './medhaId';

/** The providers Amber can log into directly. Mirrors the CHECK in migration 046. */
export type CalendarProvider = 'google' | 'microsoft';

export type CalendarAccount = {
  id: string;
  provider: CalendarProvider;
  /** The address that says WHICH account, so a work Google reads apart from a personal one. */
  accountEmail: string;
  displayName: string | null;
  connectedAt: string | null;
  /** Last successful sync, or null if it has never finished one. */
  syncedAt: string | null;
  /**
   * The last failure, kept so a quietly dead connection can SAY it is dead
   * rather than looking like an empty calendar.
   */
  lastError: string | null;
};

type AccountRow = {
  id?: unknown;
  provider?: unknown;
  account_email?: unknown;
  accountEmail?: unknown;
  display_name?: unknown;
  displayName?: unknown;
  connected_at?: unknown;
  connectedAt?: unknown;
  synced_at?: unknown;
  syncedAt?: unknown;
  last_error?: unknown;
  lastError?: unknown;
};

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

/**
 * Read one row, tolerating both spellings.
 *
 * The route hands back the database's snake_case today. A camelCase mapping
 * layer landing there later must not empty this screen, and a screen that
 * silently shows nothing is the failure mode worth spending six lines on.
 */
function toAccount(row: AccountRow): CalendarAccount | null {
  const id = str(row.id);
  const provider = str(row.provider);
  if (!id || (provider !== 'google' && provider !== 'microsoft')) return null;
  return {
    id,
    provider,
    accountEmail: str(row.account_email) ?? str(row.accountEmail) ?? 'Unknown account',
    displayName: str(row.display_name) ?? str(row.displayName),
    connectedAt: str(row.connected_at) ?? str(row.connectedAt),
    syncedAt: str(row.synced_at) ?? str(row.syncedAt),
    lastError: str(row.last_error) ?? str(row.lastError),
  };
}

/** Preserve failure separately from a successful empty account list. */
export async function getCalendarAccounts(): Promise<
  MedhaIdResult<{ accounts: CalendarAccount[] }>
> {
  const res = await callMedhaId<{ accounts: AccountRow[] }>({
    path: '/v1/me/calendars',
    method: 'GET',
    requireAuth: true,
  });
  if (!res.ok) return res;
  if (!Array.isArray(res.data?.accounts)) throw new Error('Invalid calendar account response');
  return {
    ...res,
    data: {
      accounts: res.data.accounts.map(toAccount).filter((a): a is CalendarAccount => a !== null),
    },
  };
}
export async function listCalendarAccounts(): Promise<CalendarAccount[]> {
  const res = await getCalendarAccounts();
  return res.ok ? res.data.accounts : [];
}
export type CalendarSyncResult = {
  results?: { ok?: boolean; error?: string | null; written?: number }[];
  synced?: number;
};
export function calendarSyncFailed(result: CalendarSyncResult): boolean {
  return (result.results ?? []).some((row) => row.ok === false || !!row.error);
}

/** Pull each connected account's events in now, rather than waiting for the worker. */
export function syncCalendarAccounts(): Promise<MedhaIdResult<CalendarSyncResult>> {
  return callMedhaId<CalendarSyncResult>({
    path: '/v1/me/calendars/sync',
    method: 'POST',
    timeoutMs: 120000,
    retries: 0,
    requireAuth: true,
  });
}

/**
 * Disconnect one account.
 *
 * Its events go with it (calendar_account_id, migration 046) and the others are
 * left alone, which is the entire reason accounts are rows rather than a
 * single slot in a secrets bag.
 */
export function disconnectCalendarAccount(
  id: string,
): Promise<MedhaIdResult<{ disconnected: boolean }>> {
  return callMedhaId<{ disconnected: boolean }>({
    path: `/v1/me/calendars/${encodeURIComponent(id)}`,
    method: 'DELETE',
    requireAuth: true,
  });
}

export const PROVIDER_LABEL: Record<CalendarProvider, string> = {
  google: 'Google',
  microsoft: 'Outlook',
};

/**
 * The line under an account's address.
 *
 * A BROKEN CONNECTION SAYS SO FIRST. A grant that has been revoked keeps its row
 * and stops returning events, which on a screen that only printed "synced 3
 * hours ago" is indistinguishable from a quiet week. The error outranks the
 * timestamp for exactly that reason.
 */
export function accountStatusLine(
  account: Pick<CalendarAccount, 'syncedAt' | 'lastError'>,
  now: Date = new Date(),
): string {
  if (account.lastError) return 'Needs attention. Reconnect to start syncing again.';
  if (!account.syncedAt) return 'Connected. First sync has not finished yet.';
  const when = new Date(account.syncedAt);
  if (Number.isNaN(when.getTime())) return 'Connected.';
  const mins = Math.floor((now.getTime() - when.getTime()) / 60000);
  if (mins < 2) return 'Synced just now.';
  if (mins < 60) return `Synced ${mins} minutes ago.`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `Synced ${hours} hour${hours === 1 ? '' : 's'} ago.`;
  const days = Math.floor(hours / 24);
  return `Synced ${days} day${days === 1 ? '' : 's'} ago.`;
}
