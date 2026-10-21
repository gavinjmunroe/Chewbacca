/**
 * THE OPEN REMINDERS: the things you asked to be reminded about that have no
 * time on them.
 *
 *   "Anything that's a reminder, like 'remind me to pick up my clothes sometime
 *    this week,' should just be a notification and a reminder that sits at the
 *    top of your notes and journals until it's checked off. It doesn't need to
 *    go in the calendar. ... If they check it off, it goes away for the day, but
 *    it's still on the next day and every other day."
 *
 * A SEPARATE LIST FROM THE AGENDA, on purpose. Anything with a stated time is an
 * event and lives on the calendar; these have none, so there is no day they
 * belong to and no row on a timeline to draw. They are what you still owe,
 * carried forward until you say otherwise.
 *
 * THE DATE IS SENT, NOT ASSUMED. A repeating reminder is ONE row on the server,
 * and which days it falls on -- and whether it has been ticked off for the day
 * you are looking at -- are both answered against a LOCAL date. The server has
 * no way to know what day it is where you are, so the client says.
 */
import { callMedhaId, type MedhaIdResult } from './medhaId';

/** Mirrors the CHECK in migration 049 and REPEATS in db/schedule-store.js. */
export type Repeat = 'none' | 'daily' | 'weekdays' | 'weekends' | 'weekly' | 'monthly';

export type OpenReminder = {
  id: string;
  title: string;
  description: string | null;
  place: string | null;
  contactId: string | null;
  repeat: Repeat;
  /** ISO date the repeat stops, or null for forever. */
  repeatUntil: string | null;
  /**
   * The first LOCAL date it appears on, or null for "from now on".
   *
   * "Remind me tomorrow and Sunday to find a place for deep work" is not a
   * reminder for today, and before this existed it was: an untimed reminder had
   * an upper bound and no lower one, so it sat at the top of every day the user
   * could scroll to, in both directions. See migration 050.
   */
  startsOn: string | null;
  /** 0=Sunday .. 6=Saturday, matching Date#getDay(). Only set when weekly. */
  repeatDays: number[] | null;
  /** "HH:MM" local wall clock, or null for no notification. */
  notifyAtLocal: string | null;
  /**
   * Ticked off FOR THE DAY BEING VIEWED, which is not the same as finished.
   * A daily reminder ticked this morning is done today and open tomorrow.
   */
  doneToday: boolean;
  createdAt: string;
};

/**
 * The local date as YYYY-MM-DD.
 *
 * BUILT FROM THE LOCAL PARTS, never from toISOString().slice(0,10) -- that is
 * the UTC date, so anyone west of Greenwich gets yesterday's reminders for the
 * whole evening. The one-line version of this bug has appeared twice in this
 * codebase already.
 */
export function localDateKey(d: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export async function listOpenReminders(onDate: string): Promise<OpenReminder[]> {
  const res = await callMedhaId<{ reminders: OpenReminder[] }>({
    path: `/v1/me/open-reminders?onDate=${encodeURIComponent(onDate)}`,
    method: 'GET',
    requireAuth: true,
  });
  return res.ok && Array.isArray(res.data?.reminders) ? res.data.reminders : [];
}

/** Tick one off for one day, or put it back. */
export function setOpenReminderDone(
  id: string,
  onDate: string,
  done: boolean,
): Promise<MedhaIdResult<{ ok: boolean }>> {
  return callMedhaId<{ ok: boolean }>({
    path: `/v1/me/open-reminders/${encodeURIComponent(id)}/complete`,
    method: 'POST',
    body: { onDate, done },
    requireAuth: true,
  });
}

/** Everything the reminder editor can change. Omitted keys are left alone. */
export type OpenReminderPatch = {
  title?: string;
  description?: string | null;
  place?: string | null;
  contactId?: string | null;
  repeat?: Repeat;
  repeatUntil?: string | null;
  repeatDays?: number[] | null;
  startsOn?: string | null;
  notifyAtLocal?: string | null;
};

export function updateOpenReminder(
  id: string,
  patch: OpenReminderPatch,
): Promise<MedhaIdResult<{ ok: boolean; id: string }>> {
  return callMedhaId<{ ok: boolean; id: string }>({
    path: `/v1/me/open-reminders/${encodeURIComponent(id)}`,
    method: 'PATCH',
    body: patch,
    requireAuth: true,
  });
}

export function deleteOpenReminder(id: string): Promise<MedhaIdResult<{ ok: boolean }>> {
  return callMedhaId<{ ok: boolean }>({
    path: `/v1/me/open-reminders/${encodeURIComponent(id)}`,
    method: 'DELETE',
    requireAuth: true,
  });
}

/**
 * How a repeat reads on the card.
 *
 * A STOP DATE IS PART OF THE FREQUENCY, not a footnote. "Remind me Saturday and
 * Sunday" stores repeat=weekends with an end on that Sunday, and a card that
 * said only "Weekends" would be telling the user they had signed up for every
 * weekend from now on -- which is the thing they explicitly did not ask for.
 */
export function repeatLabel(r: OpenReminder): string | null {
  const base = repeatFrequencyLabel(r);
  if (!base) return null;
  const until = untilLabel(r.repeatUntil);
  return until ? `${base} until ${until}` : base;
}

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

/**
 * "Sep 13" from a YYYY-MM-DD.
 *
 * NO Date OBJECT IS INVOLVED, deliberately. `new Date("2026-09-13")` is UTC
 * midnight -- the 12th in every American timezone -- so the obvious one-liner
 * shows a weekend reminder ending on Saturday. The less obvious fix,
 * `new Date(y, m - 1, d).toLocaleDateString(...)`, is correct but UNTESTABLE on
 * a CI box running in UTC: the mutation that breaks it passes there. A string
 * built from the string has no timezone to get wrong and no environment it
 * behaves differently in.
 */
function untilLabel(iso: string | null): string | null {
  if (!iso) return null;
  // The two checks below ARE the validation. A regex on the whole shape was here
  // first and every mutation of it survived: "soon", "2026-9-1" and a Date's
  // "Sun Sep 13" all fail these anyway, and a guard no test can distinguish is a
  // safety net that only looks like one.
  const month = MONTHS[Number(iso.slice(5, 7)) - 1];
  const day = Number(iso.slice(8, 10));
  if (!month || !(day >= 1 && day <= 31)) return null;
  return `${month} ${day}`;
}

function repeatFrequencyLabel(r: OpenReminder): string | null {
  switch (r.repeat) {
    case 'daily':
      return 'Every day';
    case 'weekdays':
      return 'Weekdays';
    case 'weekends':
      return 'Weekends';
    case 'monthly':
      return 'Monthly';
    case 'weekly': {
      const days = r.repeatDays ?? [];
      if (days.length === 0) return 'Weekly';
      // Short names, in week order, from the same 0=Sunday index the server
      // stores -- so there is no translation table to get wrong.
      const NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      return days
        .slice()
        .sort((a, b) => a - b)
        .map((d) => NAMES[d] ?? '')
        .filter(Boolean)
        .join(', ');
    }
    default:
      return null;
  }
}
