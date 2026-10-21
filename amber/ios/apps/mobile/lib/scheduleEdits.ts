/**
 * EDITING WHAT A SPOKEN PLAN BECAME.
 *
 *   "Look at how this is all-encompassing and has everything you need. The
 *    reminders and events should both have stuff like this... how often it
 *    repeats, if the reminder involves someone, if there's a description, if it
 *    involves a location, if the reminder should stop on a certain day."
 *
 * The endpoints have been there since the strip landed. This is the client half:
 * which row can be edited at all, and what to send when one is.
 *
 * THREE KINDS OF ROW ON A DAY, AND ONLY TWO OF THEM ARE OURS:
 *
 *   amber     an event in Amber's own table, from something the user said or
 *             from a calendar account Amber syncs. Fully editable.
 *   reminder  an untimed reminder. Fully editable.
 *   device    an event read off the phone's calendar through expo-calendar.
 *             READ ONLY, and not because it is hard: lib/deviceCalendar.ts asks
 *             for read permission only and never requests write. Editing one
 *             means asking for a permission the app has never asked for, to
 *             change a row that belongs to iCloud or a work Exchange. The
 *             editor says so and offers the Calendar app instead of quietly
 *             failing to save.
 */
import { callMedhaId, type MedhaIdResult } from './medhaId';
import type { AgendaItem } from './agenda';
import type { Repeat } from './openReminders';

/** What an agenda row points at, when it points at something editable. */
export type EditTarget =
  | { kind: 'event'; id: string }
  | { kind: 'reminder'; id: string }
  | { kind: 'device'; id: string };

/**
 * The row's identity, dug back out of its key.
 *
 * buildAgenda composes `key` as `${source}:${id}` from three different stores
 * so two of them cannot collide. Reading it back is the reverse of that one
 * line, and it lives here rather than at the call site because getting it
 * slightly wrong -- splitting on the first colon when a device id contains one,
 * say -- would send an edit to another row's id.
 */
export function agendaTargetOf(item: Pick<AgendaItem, 'key' | 'source'>): EditTarget | null {
  const key = String(item?.key ?? '');
  const sep = key.indexOf(':');
  if (sep <= 0) return null;
  // Everything AFTER the first colon, not the second field of a split: a device
  // event id is the phone's own string and routinely contains colons.
  const id = key.slice(sep + 1);
  if (!id) return null;
  const source = item?.source;
  if (source === 'amber') return { kind: 'event', id };
  if (source === 'reminder') return { kind: 'reminder', id };
  if (source === 'device') return { kind: 'device', id };
  return null;
}

/** Can this row be changed from inside Amber at all? */
export function isEditable(item: Pick<AgendaItem, 'key' | 'source'> | null): boolean {
  if (!item) return false;
  const t = agendaTargetOf(item);
  return t !== null && t.kind !== 'device';
}

/** Everything the event editor can change. Omitted keys are left alone. */
export type EventPatch = {
  title?: string;
  description?: string | null;
  place?: string | null;
  startsAt?: string;
  endsAt?: string | null;
  allDay?: boolean;
  repeat?: Repeat;
  repeatUntil?: string | null;
  /** null is "silent", which is a real choice and not the same as omitting it. */
  notifyMinutesBefore?: number | null;
};

export function updateCalendarEvent(
  id: string,
  patch: EventPatch,
): Promise<MedhaIdResult<{ ok: boolean; id: string }>> {
  return callMedhaId<{ ok: boolean; id: string }>({
    path: `/v1/me/calendar-events/${encodeURIComponent(id)}`,
    method: 'PATCH',
    body: patch,
    requireAuth: true,
  });
}

/**
 * PUT SOMETHING ON THE CALENDAR WITHOUT SAYING IT OUT LOUD.
 *
 *   "there should be an add event manually for calendar button that opens up
 *    that UI for making a calendar event"
 *
 * Everything in this table until now arrived by being spoken -- the capture
 * pipeline heard a time and wrote a row. That path is good and stays the default,
 * but it was the ONLY path, which makes the parser a single point of failure for
 * the whole calendar: when migrations 049 and 050 turned out to be unapplied,
 * every INSERT threw and there was no other way to add anything at all.
 *
 * THE WHOLE DRAFT GOES, not a diff. There is nothing to diff against on a row
 * that does not exist yet, and the server requires a title and a start.
 */
export function createCalendarEvent(
  draft: EventDraft,
  requestId?: string,
): Promise<MedhaIdResult<{ ok: boolean; id: string }>> {
  return callMedhaId<{ ok: boolean; id: string }>({
    path: '/v1/me/calendar-events',
    method: 'POST',
    body: {
      ...(requestId ? { requestId } : {}),
      title: draft.title.trim() || 'Event',
      description: draft.description || null,
      place: draft.place || null,
      startsAt: draft.startsAt,
      endsAt: draft.endsAt,
      allDay: draft.allDay,
      repeat: draft.repeat,
      repeatUntil: draft.repeat === 'none' ? null : draft.repeatUntil,
      notifyMinutesBefore: draft.notifyMinutesBefore,
    },
    requireAuth: true,
  });
}

/**
 * The event a person gets when they tap Add: the next round hour, one hour long.
 *
 * NOT "NOW". A sheet that opens at 14:37 makes everybody edit the minutes before
 * they can do anything else, and the overwhelmingly common case is something on
 * the hour. `day` is the day currently on screen, so adding from a day you have
 * scrolled to lands on THAT day rather than today.
 */
export function blankEventDraft(day: Date, now: Date = new Date()): EventDraft {
  const start = new Date(day);
  const sameDay = day.toDateString() === now.toDateString();
  // On today, the next hour that has not happened. On any other day, 9am, which
  // is where a day starts for scheduling purposes.
  start.setHours(sameDay ? now.getHours() + 1 : 9, 0, 0, 0);
  const end = new Date(start.getTime() + 60 * 60 * 1000);
  return {
    title: '',
    description: '',
    place: '',
    startsAt: start.toISOString(),
    endsAt: end.toISOString(),
    allDay: false,
    repeat: 'none',
    repeatUntil: null,
    notifyMinutesBefore: null,
  };
}

export function deleteCalendarEvent(id: string): Promise<MedhaIdResult<{ ok: boolean }>> {
  return callMedhaId<{ ok: boolean }>({
    path: `/v1/me/calendar-events/${encodeURIComponent(id)}`,
    method: 'DELETE',
    requireAuth: true,
  });
}

/**
 * ONLY WHAT CHANGED, AND NEVER AN EMPTY PATCH.
 *
 * The server rejects a body with no recognized fields (`no_fields`, 400) rather
 * than reporting success on a no-op, so sending every field on every save would
 * work but would also overwrite anything the user did not touch with whatever
 * the screen happened to be showing. A diff is the difference between "I changed
 * the time" and "I rewrote the row".
 *
 * REPEAT MOVES AS A UNIT. The server binds repeat, repeat_until and repeat_days
 * together behind two CHECK constraints -- setting a frequency without resetting
 * the others makes the database refuse the whole update, and the user's edit
 * fails with nothing on screen to say so. So a change to either half sends both.
 */
export function eventPatchFrom(before: EventDraft, after: EventDraft): EventPatch {
  const patch: EventPatch = {};
  if (after.title !== before.title) patch.title = after.title;
  if (after.description !== before.description) patch.description = after.description || null;
  if (after.place !== before.place) patch.place = after.place || null;
  if (after.startsAt !== before.startsAt) patch.startsAt = after.startsAt;
  if (after.endsAt !== before.endsAt) patch.endsAt = after.endsAt;
  if (after.allDay !== before.allDay) patch.allDay = after.allDay;
  if (after.notifyMinutesBefore !== before.notifyMinutesBefore) {
    patch.notifyMinutesBefore = after.notifyMinutesBefore;
  }
  if (after.repeat !== before.repeat || after.repeatUntil !== before.repeatUntil) {
    patch.repeat = after.repeat;
    patch.repeatUntil = after.repeat === 'none' ? null : after.repeatUntil;
  }
  return patch;
}

/** The event fields the editor holds while somebody is typing. */
export type EventDraft = {
  title: string;
  description: string;
  place: string;
  /** ISO instants. */
  startsAt: string;
  endsAt: string | null;
  allDay: boolean;
  repeat: Repeat;
  /** YYYY-MM-DD, or null for forever. */
  repeatUntil: string | null;
  /** Minutes before the start, or null for no notification. */
  notifyMinutesBefore: number | null;
};

/** The reminder fields the editor holds. Mirrors OpenReminderPatch. */
export type ReminderDraft = {
  title: string;
  description: string;
  place: string;
  repeat: Repeat;
  repeatUntil: string | null;
  repeatDays: number[] | null;
  startsOn: string | null;
  /** "HH:MM" local, or null for no notification. */
  notifyAtLocal: string | null;
};

/**
 * The same diff for a reminder.
 *
 * repeatDays joins the repeat unit here: `reminders_repeat_days_chk` allows days
 * ONLY on a weekly repeat, so moving to daily without clearing them is an
 * update the database refuses outright.
 */
export function reminderPatchFrom(
  before: ReminderDraft,
  after: ReminderDraft,
): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  if (after.title !== before.title) patch.title = after.title;
  if (after.description !== before.description) patch.description = after.description || null;
  if (after.place !== before.place) patch.place = after.place || null;
  if (after.startsOn !== before.startsOn) patch.startsOn = after.startsOn;
  if (after.notifyAtLocal !== before.notifyAtLocal) patch.notifyAtLocal = after.notifyAtLocal;
  const daysChanged =
    JSON.stringify(after.repeatDays ?? null) !== JSON.stringify(before.repeatDays ?? null);
  if (after.repeat !== before.repeat || after.repeatUntil !== before.repeatUntil || daysChanged) {
    patch.repeat = after.repeat;
    patch.repeatUntil = after.repeat === 'none' ? null : after.repeatUntil;
    patch.repeatDays = after.repeat === 'weekly' ? (after.repeatDays ?? null) : null;
  }
  return patch;
}

/** The notification leads the editor offers, in minutes. null is "none". */
export const NOTIFY_CHOICES: { label: string; minutes: number | null }[] = [
  { label: 'None', minutes: null },
  { label: '10 minutes before', minutes: 10 },
  { label: '15 minutes before', minutes: 15 },
  { label: '30 minutes before', minutes: 30 },
  { label: '1 hour before', minutes: 60 },
];

/** The frequencies, in the order the editor lists them. */
export const REPEAT_CHOICES: { label: string; value: Repeat }[] = [
  { label: 'Does not repeat', value: 'none' },
  { label: 'Every day', value: 'daily' },
  { label: 'Weekdays', value: 'weekdays' },
  { label: 'Weekends', value: 'weekends' },
  { label: 'Weekly', value: 'weekly' },
  { label: 'Monthly', value: 'monthly' },
];
