/**
 * THE LOCAL DATE, AND HOW A REPEAT READS.
 *
 * Both are small and both are the kind of small that has already gone wrong in
 * this codebase: a date built from the wrong timezone, and a label built from a
 * second copy of the weekday order.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { localDateKey, repeatLabel, type OpenReminder } from './openReminders.ts';

const r = (over: Partial<OpenReminder> = {}): OpenReminder => ({
  id: 'rem_1',
  title: 'Drink water',
  description: null,
  place: null,
  contactId: null,
  repeat: 'none',
  repeatUntil: null,
  repeatDays: null,
  startsOn: null,
  notifyAtLocal: null,
  doneToday: false,
  createdAt: '2026-09-11T12:00:00.000Z',
  ...over,
});

test('the date key is the LOCAL date, not the UTC one', () => {
  /**
   * THE BUG THIS EXISTS FOR. `toISOString().slice(0, 10)` is the UTC date, so
   * at 8pm in New York it returns TOMORROW -- and the whole evening's reminders
   * are fetched for a day that has not started. Anyone west of Greenwich sees it
   * every night.
   *
   * Built from a local-constructed Date so the assertion holds in any timezone
   * the test runs in, which is the other half of the same lesson (see the note
   * atop lib/agenda.test.mts).
   */
  const evening = new Date(2026, 8, 11, 20, 30, 0);
  assert.equal(localDateKey(evening), '2026-09-11');

  const justAfterMidnight = new Date(2026, 8, 12, 0, 5, 0);
  assert.equal(localDateKey(justAfterMidnight), '2026-09-12');
});

test('the date key pads, so it is always ten characters', () => {
  // The server's schema is ^\d{4}-\d{2}-\d{2}$ and refuses "2026-9-1", so an
  // unpadded month silently fetches nothing at all for nine months of the year.
  assert.equal(localDateKey(new Date(2026, 0, 5)), '2026-01-05');
  assert.match(localDateKey(new Date(2026, 11, 31)), /^\d{4}-\d{2}-\d{2}$/);
});

test('a one-off has no repeat line', () => {
  assert.equal(repeatLabel(r()), null);
});

test('the plain frequencies read as words', () => {
  assert.equal(repeatLabel(r({ repeat: 'daily' })), 'Every day');
  assert.equal(repeatLabel(r({ repeat: 'weekdays' })), 'Weekdays');
  assert.equal(repeatLabel(r({ repeat: 'weekends' })), 'Weekends');
  assert.equal(repeatLabel(r({ repeat: 'monthly' })), 'Monthly');
});

test('a weekly repeat names its days, in week order', () => {
  // Given out of order on purpose: the server stores a sorted array, but a
  // label that depended on that would break the first time an editor sent one
  // the other way round.
  assert.equal(repeatLabel(r({ repeat: 'weekly', repeatDays: [3, 1] })), 'Mon, Wed');
  assert.equal(repeatLabel(r({ repeat: 'weekly', repeatDays: [0, 6] })), 'Sun, Sat');
});

test('a weekly repeat with no days still says something', () => {
  // The database allows repeat='weekly' with repeat_days NULL, so the label has
  // to survive it rather than render an empty line.
  assert.equal(repeatLabel(r({ repeat: 'weekly', repeatDays: null })), 'Weekly');
  assert.equal(repeatLabel(r({ repeat: 'weekly', repeatDays: [] })), 'Weekly');
});

test('a day index that is not a day is dropped, not printed as blank', () => {
  assert.equal(repeatLabel(r({ repeat: 'weekly', repeatDays: [1, 99] })), 'Mon');
});

test('a repeat that stops says when it stops', () => {
  /**
   * THE BUG THIS EXISTS FOR. "Remind me Saturday and Sunday to find a place for
   * deep work" is one weekend, and it is stored as repeat=weekends with an end
   * date. A card that read "Weekends" and nothing else would be telling the
   * user they had set up a standing habit -- the exact thing they said they did
   * not want ("I should not see them on Monday or anything beyond").
   */
  assert.equal(
    repeatLabel(r({ repeat: 'weekends', repeatUntil: '2026-09-13' })),
    'Weekends until Sep 13',
  );
  assert.equal(
    repeatLabel(r({ repeat: 'weekly', repeatDays: [1, 3], repeatUntil: '2026-10-01' })),
    'Mon, Wed until Oct 1',
  );
});

test('a one-off says nothing, even when it carries an end date', () => {
  // repeat='none' has no frequency to qualify, and "until Sep 13" alone would
  // read as a deadline the user never set.
  assert.equal(repeatLabel(r({ repeat: 'none', repeatUntil: '2026-09-13' })), null);
});

test('the stop date is the day it says, in every timezone', () => {
  /**
   * new Date("2026-09-13") is UTC midnight, which is the 12th everywhere west
   * of Greenwich -- a weekend reminder that reads as ending on Saturday. The
   * label is built from the string rather than from a Date precisely so this
   * assertion means the same thing on a laptop in Seattle and on a CI box in
   * UTC. The month is spelled out to catch the off-by-one in the other
   * direction: MONTHS[m] instead of MONTHS[m - 1] gives October.
   */
  assert.equal(repeatLabel(r({ repeat: 'daily', repeatUntil: '2026-09-13' })), 'Every day until Sep 13');
  assert.equal(repeatLabel(r({ repeat: 'daily', repeatUntil: '2026-01-01' })), 'Every day until Jan 1');
  assert.equal(repeatLabel(r({ repeat: 'daily', repeatUntil: '2026-12-31' })), 'Every day until Dec 31');
});

test('a junk stop date is left off rather than printed', () => {
  for (const bad of ['soon', '2026-9-1', '2026-13-01', 'Sun Sep 13', '', null]) {
    assert.equal(
      repeatLabel(r({ repeat: 'daily', repeatUntil: bad as string | null })),
      'Every day',
      `printed ${JSON.stringify(bad)}`,
    );
  }
});
