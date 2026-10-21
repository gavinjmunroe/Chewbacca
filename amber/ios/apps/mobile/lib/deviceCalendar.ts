/**
 * THE PHONE'S OWN CALENDAR, READ THROUGH expo-calendar.
 *
 * Everything in this file touches a permission, a native module, or both, so
 * none of it can be tested. That is the reason it is this thin: the decisions
 * -- what a day is, which of two entries for one meeting to keep, whether
 * anything here is virtual -- all live in lib/agenda.ts where a test can reach
 * them. This fetches rows and hands them over.
 *
 * NOTHING HERE EVER THROWS. A calendar is somebody else's software: the
 * permission can be revoked mid-session, a corporate profile can hide every
 * calendar, an account can be mid-sync and answer with nothing. Every one of
 * those is a quieter day, not a broken screen, so every path resolves to a
 * value and the caller cannot tell a denied permission from an empty Tuesday
 * except by asking.
 *
 * WE ONLY EVER READ. No write permission is requested and nothing here creates,
 * edits or deletes an event. Amber's own plans go in Amber's own table.
 */
import * as Calendar from 'expo-calendar';
import type { DeviceEvent } from './agenda';

/**
 * Whether we may read the calendar.
 *
 *   granted       read away
 *   undetermined  nobody has been asked yet -- the UI offers, it does not grab
 *   denied        asked and refused, or restricted by a profile. Never ask
 *                 again; iOS will not show the sheet a second time anyway, so
 *                 a button that re-prompts is a button that does nothing.
 */
export type CalendarAccess = 'granted' | 'undetermined' | 'denied';

function readAccess(res: {
  status?: string;
  granted?: boolean;
  canAskAgain?: boolean;
}): CalendarAccess {
  if (res?.granted || res?.status === 'granted') return 'granted';
  /**
   * `undetermined` is the honest answer only while iOS would still show the
   * sheet. Once canAskAgain is false, an "Allow" button cannot do anything, so
   * this reports denied and the UI stops offering.
   */
  if (res?.status === 'undetermined' && res?.canAskAgain !== false) return 'undetermined';
  return 'denied';
}

/** What access we have, WITHOUT prompting. Safe to call on every render path. */
export async function calendarAccess(): Promise<CalendarAccess> {
  try {
    return readAccess(await Calendar.getCalendarPermissionsAsync());
  } catch {
    return 'denied';
  }
}

/**
 * Ask, once, because somebody tapped something that means "yes".
 *
 * DELIBERATELY NOT CALLED ON MOUNT. A permission sheet that appears because a
 * tab was opened is a sheet people dismiss, and iOS only offers it once -- so
 * an unprompted ask does not just annoy, it permanently costs the feature. The
 * You tab shows a line offering the calendar and this runs when it is tapped.
 */
export async function requestCalendarAccess(): Promise<CalendarAccess> {
  try {
    return readAccess(await Calendar.requestCalendarPermissionsAsync());
  } catch {
    return 'denied';
  }
}

/**
 * Every event on the phone between two instants.
 *
 * ALL CALENDARS, not a chosen subset. Somebody's day is their day; asking them
 * to pick which of their calendars counts is a settings screen in front of a
 * feature that should just be right. Duplicates across accounts -- the same
 * invite in iCloud and in Google -- are handled downstream by sameMeeting.
 *
 * Returns [] when there is no permission rather than asking for one, so a
 * refresh can never surface a system sheet the person did not ask for.
 */
export async function readDeviceEvents(from: Date, to: Date, strict = false): Promise<DeviceEvent[]> {
  try {
    if ((await calendarAccess()) !== 'granted') return [];
    const calendars = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
    const ids = (calendars ?? []).map((c) => c?.id).filter((id): id is string => !!id);
    if (ids.length === 0) return [];
    /**
     * WHAT EACH CALENDAR IS AND WHAT COLOR IT DRAWS IN.
     *
     * Two things the event rows do not carry and the day needs. The color is
     * so a card's edge is the same color the person's own calendar app uses --
     * Amber has no business deciding that Work is orange. The type is how
     * birthdays are known: iOS keeps them in a calendar of their own, filled
     * from the address book, which is a fact rather than a word in a title.
     */
    const meta = new Map(
      (calendars ?? []).map((c) => [
        String(c.id),
        { color: c.color ?? null, type: c.type ? String(c.type) : null },
      ]),
    );
    const events = await Calendar.getEventsAsync(ids, from, to);
    return (events ?? [])
      .filter((e) => e && e.id)
      .map((e) => ({
        /**
         * A RECURRING EVENT REPEATS ITS id ACROSS INSTANCES on iOS -- the id
         * identifies the series, not the Tuesday. Two instances in one window
         * would collide on `device:<id>` and React would render one of them.
         * The start disambiguates, and it is stable across refetches, which a
         * counter or a random suffix would not be.
         */
        id: e.instanceId ? String(e.instanceId) : `${String(e.id)}@${String(e.startDate ?? '')}`,
        title: e.title ?? null,
        startDate: e.startDate ?? null,
        endDate: e.endDate ?? null,
        allDay: Boolean(e.allDay),
        location: e.location ?? null,
        notes: e.notes ?? null,
        url: e.url ?? null,
        calendarColor: meta.get(String(e.calendarId))?.color ?? null,
        calendarType: meta.get(String(e.calendarId))?.type ?? null,
      }));
  } catch (error) {
    if (strict) throw error;
    // A revoked permission, a calendar that failed to sync, a native error on
    // an OS we have not seen. The day still renders; it renders with what Amber
    // itself knows.
    return [];
  }
}

/**
 * WHICH ACCOUNTS THE PHONE IS ACTUALLY SYNCING, for the calendar sheet.
 *
 * One permission brings in every account added in iOS Settings -- iCloud, a
 * Google account, Exchange, a subscribed feed -- so the honest way to show what
 * is connected is to name them rather than to say "Apple Calendar".
 *
 * GROUPED BY SOURCE, not listed per calendar. A Google account with eight
 * calendars in it is one thing somebody connected, and eight rows saying
 * "Holidays in the United States" is a list nobody reads.
 *
 * Birthdays are dropped: it is a calendar iOS synthesizes from the address book
 * rather than an account anybody connected, and listing it as one implies it
 * could be disconnected here.
 */
export async function readCalendarSources(): Promise<{ title: string; account: string | null }[]> {
  try {
    if ((await calendarAccess()) !== 'granted') return [];
    const calendars = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
    const seen = new Map<string, { title: string; account: string | null }>();
    for (const c of calendars ?? []) {
      if (c?.type === 'birthdays') continue;
      const title = (c?.source?.name ?? '').trim() || (c?.title ?? '').trim();
      if (!title) continue;
      const key = String(c?.sourceId ?? title);
      if (seen.has(key)) continue;
      // The source's own name is the account label on iOS ("iCloud",
      // "you@work.com", "Exchange"), which is exactly what somebody needs to
      // recognize which account this is.
      seen.set(key, { title, account: c?.source?.type ? String(c.source.type) : null });
    }
    return [...seen.values()];
  } catch {
    return [];
  }
}
