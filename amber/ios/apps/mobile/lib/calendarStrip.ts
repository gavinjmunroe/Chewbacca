/**
 * THE DAY STRIP AT THE TOP OF TODAY, AS LOGIC RATHER THAN AS PART OF A SCREEN.
 *
 * These three functions decide which seven days the strip shows, which day a
 * note belongs to, and what is on the day you tapped. They lived as private
 * helpers at the bottom of HomePage.tsx -- seventeen hundred lines of layout
 * with the calendar buried in it, reachable by nothing and tested by nothing.
 *
 * That is a bad place for them for two reasons. The obvious one: a redesign of
 * Today rewrites HomePage.tsx, and a private helper at the bottom of a file
 * being rewritten is a helper that gets dropped or subtly re-implemented. The
 * quieter one: date handling is where correctness lives here. Every one of
 * these is local-time arithmetic across month ends, year ends, leap days and
 * the two days a year the clocks move, and none of that was checked.
 *
 * LOCAL TIME IS THE POINT, not a shortcut. A note taken at 11:40pm belongs to
 * the day the person was living, not to the UTC day it happened to land in.
 * Everything here is deliberately in the device's zone; the server stores UTC
 * and `dayKey` is the boundary between the two.
 *
 * See lib/calendarStrip.test.mts.
 */
import type { ConversationSummary } from './conversations';

/**
 * The local calendar day a Date falls on, as YYYY-MM-DD.
 *
 * The key for every day comparison in the app. Built from the local getters
 * rather than toISOString(), which would answer in UTC and put a late-evening
 * note on tomorrow for anybody west of Greenwich.
 */
export function dayKey(date: Date): string {
  return (
    `${date.getFullYear()}-` +
    `${String(date.getMonth() + 1).padStart(2, '0')}-` +
    `${String(date.getDate()).padStart(2, '0')}`
  );
}

/**
 * The seven days of the week `today` is in, Sunday first.
 *
 * NOON, NOT THE CURRENT TIME. The version this was extracted from copied the
 * current time of day onto all seven dates, and the honest finding is that it
 * WORKED: brute-forced over 35,200 combinations -- every day of a 400-day span,
 * eleven times of day, in eight zones including the half-hour and 45-minute
 * ones -- it never produced a duplicated or missing day. `setDate` moves the
 * calendar day and only shifts the clock forward into a gap, never back across
 * midnight.
 *
 * Noon is kept anyway, and the reason is not a bug that existed. It is that the
 * property holding this together was an accident of how one method handles a
 * nonexistent wall time -- nothing in the code said "the time must not matter",
 * so an edit that started doing arithmetic on these Dates could break it with no
 * test in sight. Anchoring at local noon makes it structural: every date sits
 * twelve hours from both boundaries, so no offset change of any size reaches
 * one. The strip only reads the calendar day off these, so the time is free.
 *
 * The DST tests below therefore pin a property, not a fix.
 */
export function getWeekDates(today: Date): Date[] {
  const anchor = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 12, 0, 0, 0);
  const sunday = new Date(anchor);
  sunday.setDate(anchor.getDate() - anchor.getDay());
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(sunday);
    d.setDate(sunday.getDate() + i);
    return d;
  });
}

/** Is this Date the same local calendar day as that one? */
export function isSameDay(a: Date, b: Date): boolean {
  return dayKey(a) === dayKey(b);
}

/**
 * The conversations that happened on one local day, newest first.
 *
 * A row with no `lastAt`, or an unparseable one, is not on any day and is
 * dropped rather than sorted to an end -- a note with no time is not "oldest",
 * it is unplaced, and putting it at the bottom of today would be an assertion
 * nobody made.
 */
export function conversationsForDay(
  convs: readonly ConversationSummary[],
  day: Date,
): ConversationSummary[] {
  const key = dayKey(day);
  return (convs ?? [])
    .filter((c) => {
      if (!c?.lastAt) return false;
      const d = new Date(c.lastAt);
      return !Number.isNaN(d.getTime()) && dayKey(d) === key;
    })
    .sort((a, b) => {
      const ta = a.lastAt ? Date.parse(a.lastAt) : 0;
      const tb = b.lastAt ? Date.parse(b.lastAt) : 0;
      return tb - ta;
    });
}

/**
 * How many conversations landed on each local day, keyed by dayKey.
 *
 * Drives the count under each date in the strip. Same filtering rule as
 * conversationsForDay, so a note the strip counts is a note the day list will
 * actually show -- a count that does not match what tapping it opens is the
 * kind of small wrongness that makes people stop trusting the screen.
 */
export function countsByDay(convs: readonly ConversationSummary[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const c of convs ?? []) {
    if (!c?.lastAt) continue;
    const d = new Date(c.lastAt);
    if (Number.isNaN(d.getTime())) continue;
    const k = dayKey(d);
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}
