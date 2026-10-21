import { callMedhaId, MedhaIdRequestError } from './medhaId';

// Notification delivery channels for reminders. Two independent switches:
//   - apple    → on-device Apple LOCAL notifications (lock screen & banners).
//                The APP owns this: lib/reminders.ts schedules them, and only
//                when this channel is on.
//   - imessage → the SERVER texts the user their reminders. Entirely
//                server-side; the app never sends an iMessage. The app only
//                surfaces/edits the toggle.
//
// Backend contract:
//   GET   /v1/me/notification-settings → { channels: { apple, imessage } }
//   PATCH /v1/me/notification-settings body { channels: { apple?, imessage? } }
//         → merged { channels }
// Defaults, if the server has never been written, are apple:true / imessage:false.

export type NotificationChannels = { apple: boolean; imessage: boolean };

/**
 * WHAT AMBER MAY INTERRUPT YOU ABOUT.
 *
 * One switch for everything was the only control there was, and it is the wrong
 * grain: not wanting to hear about every note your network shares is not the
 * same as not wanting to hear that a reminder came due. The keys are the
 * `data.type` each push carries, because that is what the server has at send
 * time and what the tap handler routes on.
 */
export type NotificationCategories = {
  reminder: boolean;
  note: boolean;
  circle: boolean;
  connection: boolean;
  question: boolean;
  dm: boolean;
};

export type NotificationPrefs = {
  channels: NotificationChannels;
  categories: NotificationCategories;
  /** Amber ids this account has muted. One person, not one category. */
  muted: string[];
};

export type NotificationSettings = Partial<NotificationPrefs>;

export const DEFAULT_CHANNELS: NotificationChannels = { apple: true, imessage: false };
export const DEFAULT_CATEGORIES: NotificationCategories = {
  reminder: true,
  note: true,
  circle: true,
  connection: true,
  question: true,
  dm: true,
};

// The order and copy of the rows in Settings. Here rather than in the screen so
// the labels and the wire keys cannot drift apart.
export const CATEGORY_ROWS: { key: keyof NotificationCategories; title: string; sub: string }[] = [
  { key: 'reminder', title: 'Reminders', sub: 'The ones you set out loud or by hand' },
  { key: 'dm', title: 'Direct messages', sub: 'When somebody writes to you' },
  { key: 'note', title: 'Shared notes', sub: 'A note shared with you or with their network' },
  { key: 'circle', title: 'Circles', sub: 'Added to one, or something posted in one' },
  { key: 'connection', title: 'Requests', sub: 'Somebody wants to connect, or accepted' },
  { key: 'question', title: 'Amber asks', sub: "Questions Amber asks you about your people" },
];

// A short-lived process cache so lib/reminders.ts can gate local scheduling on
// the Apple channel without hitting the network on every parse. The GET is also
// de-duped/retried by callMedhaId, but this TTL keeps back-to-back reminders (a
// voice note plus a typed message seconds later) off the wire entirely.
const TTL_MS = 30_000;
let cache: { channels: NotificationChannels; at: number } | null = null;
// The rest of the preferences, cached separately: reminders only ever needs the
// channels, and the settings screen and a person's card are the only readers of
// these. One TTL, two caches, so a mute does not invalidate the hot path.
let prefsCache: { prefs: NotificationPrefs; at: number } | null = null;

// Cleared on sign-out so the next account does not inherit the previous user's
// notification channel preferences.
export function clearNotificationSettingsCache(): void {
  cache = null;
  prefsCache = null;
}

// Coerce a possibly-partial server payload into a full, boolean-safe shape,
// falling back to defaults for any missing/mistyped key.
function normalize(c: Partial<NotificationChannels> | undefined | null): NotificationChannels {
  return {
    apple: typeof c?.apple === 'boolean' ? c.apple : DEFAULT_CHANNELS.apple,
    imessage: typeof c?.imessage === 'boolean' ? c.imessage : DEFAULT_CHANNELS.imessage,
  };
}

// Overwrite the cache. The settings UI calls this after an optimistic toggle or
// a successful PATCH so a reminder created moments later reflects the new value
// immediately, without waiting for the TTL to expire.
export function setCachedNotificationChannels(channels: NotificationChannels): void {
  cache = { channels: normalize(channels), at: Date.now() };
}

function normalizeCategories(
  c: Partial<NotificationCategories> | undefined | null,
): NotificationCategories {
  const out = { ...DEFAULT_CATEGORIES };
  for (const key of Object.keys(DEFAULT_CATEGORIES) as (keyof NotificationCategories)[]) {
    if (typeof c?.[key] === 'boolean') out[key] = c[key] as boolean;
  }
  return out;
}

const normalizeMuted = (m: unknown): string[] =>
  Array.isArray(m) ? Array.from(new Set(m.filter((v): v is string => typeof v === 'string'))) : [];

function normalizePrefs(d: NotificationSettings | undefined | null): NotificationPrefs {
  return {
    channels: normalize(d?.channels),
    categories: normalizeCategories(d?.categories),
    muted: normalizeMuted(d?.muted),
  };
}

/**
 * Everything the settings screen and a person's card need: the channel
 * switches, the per-category switches and the mute list. Never throws -- falls
 * back to the last good read, then to the documented defaults, so the screen
 * always renders something honest rather than an error state.
 */
export async function getNotificationPrefs(force = false): Promise<NotificationPrefs> {
  if (!force && prefsCache && Date.now() - prefsCache.at < TTL_MS) return prefsCache.prefs;
  const res = await callMedhaId<NotificationSettings>({
    path: '/v1/me/notification-settings',
    method: 'GET',
    requireAuth: true,
  });
  if (res.ok) {
    const prefs = normalizePrefs(res.data);
    prefsCache = { prefs, at: Date.now() };
    // The channels arrived in the same payload, so the reminder path gets them
    // for free rather than making a second identical request.
    cache = { channels: prefs.channels, at: Date.now() };
    return prefs;
  }
  return prefsCache?.prefs ?? { channels: DEFAULT_CHANNELS, categories: DEFAULT_CATEGORIES, muted: [] };
}

/**
 * Turn one category on or off. Returns the merged preferences.
 *
 * Throws MedhaIdRequestError on failure so a React Query mutation can put the
 * switch back -- a toggle that stays flipped after a failed write is a promise
 * the app cannot keep.
 */
export async function patchNotificationCategories(
  patch: Partial<NotificationCategories>,
): Promise<NotificationPrefs> {
  const res = await callMedhaId<NotificationSettings>({
    path: '/v1/me/notification-settings',
    method: 'PATCH',
    body: { categories: patch },
    requireAuth: true,
  });
  if (!res.ok) throw new MedhaIdRequestError(res);
  const prefs = normalizePrefs(res.data);
  prefsCache = { prefs, at: Date.now() };
  cache = { channels: prefs.channels, at: Date.now() };
  return prefs;
}

/**
 * Mute or unmute one person, by contact or by account.
 *
 * MUTING IS NOT BLOCKING. It changes what you receive and the other person is
 * never told; blocking lives in the DM surface and says so there. The server
 * stores the account id, so this needs one of the two ids to point at an
 * account -- a contact with no Amber account cannot notify you and the server
 * answers `not_on_amber` rather than pretending to store something.
 */
export async function setPersonMuted(
  who: { contactId?: string; amberId?: string },
  muted: boolean,
): Promise<string[]> {
  const res = await callMedhaId<{ muted: string[] }>({
    path: '/v1/me/notification-settings/mute',
    method: 'POST',
    body: { ...who, muted },
    requireAuth: true,
    retries: 0,
  });
  if (!res.ok) throw new MedhaIdRequestError(res);
  const list = normalizeMuted(res.data?.muted);
  if (prefsCache) prefsCache = { prefs: { ...prefsCache.prefs, muted: list }, at: Date.now() };
  return list;
}

/**
 * Fetch the user's notification channels. Cached for TTL_MS; pass `force` to
 * bypass. Never throws — on any failure it returns the last good cache, or the
 * documented defaults — so callers (reminders + settings UI) can rely on always
 * getting a usable value.
 */
export async function getNotificationSettings(force = false): Promise<NotificationChannels> {
  if (!force && cache && Date.now() - cache.at < TTL_MS) return cache.channels;
  const res = await callMedhaId<NotificationSettings>({
    path: '/v1/me/notification-settings',
    method: 'GET',
    requireAuth: true,
  });
  if (res.ok) {
    const channels = normalize(res.data?.channels);
    cache = { channels, at: Date.now() };
    return channels;
  }
  // Don't cache a failure: keep whatever we last knew, else defaults.
  return cache?.channels ?? DEFAULT_CHANNELS;
}

/**
 * Convenience for lib/reminders.ts: is the Apple LOCAL notification channel on?
 * Cached; never throws.
 */
export async function appleChannelEnabled(): Promise<boolean> {
  const channels = await getNotificationSettings();
  return channels.apple === true;
}

/**
 * Is the iMessage channel on? The app never SENDS over iMessage — the server's
 * reminder scheduler does — but it needs to know, so it can tell the user that a
 * reminder will arrive as a text rather than saying nothing at all.
 * Cached; never throws.
 */
export async function imessageChannelEnabled(): Promise<boolean> {
  const channels = await getNotificationSettings();
  return channels.imessage === true;
}

/**
 * PATCH one or both channels and return the merged result. Throws
 * MedhaIdRequestError on failure so a React Query mutation can revert an
 * optimistic update. Updates the cache on success.
 */
export async function patchNotificationSettings(
  patch: Partial<NotificationChannels>,
): Promise<NotificationChannels> {
  const res = await callMedhaId<NotificationSettings>({
    path: '/v1/me/notification-settings',
    method: 'PATCH',
    body: { channels: patch },
    requireAuth: true,
  });
  if (!res.ok) throw new MedhaIdRequestError(res);
  const channels = normalize(res.data?.channels);
  cache = { channels, at: Date.now() };
  return channels;
}
