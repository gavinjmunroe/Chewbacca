/**
 * THE MANUAL WAY ONTO THE CALENDAR.
 *
 *   "there should be an add event manually for calendar button that opens up
 *    that UI for making a calendar event"
 *
 * Everything on this calendar until now got there by being said out loud. That
 * path is good and stays the default, but being the only path made one parser a
 * single point of failure for the whole feature -- when migrations 049 and 050
 * turned out to be unapplied, every write threw and there was no other door.
 *
 * What is worth pinning is the draft the sheet opens on, because a form that
 * opens on the wrong day or on a ragged time is a form everybody has to fix
 * before they can use it.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { blankEventDraft } from './scheduleEdits.ts';

const at = (iso: string) => new Date(iso);

test('IT OPENS ON THE DAY BEING LOOKED AT, not on today', () => {
  /**
   * The strip is the whole reason: you scrolled to Thursday to add something to
   * Thursday. Landing on today would be its own bug, and a quiet one -- the
   * event saves fine, just onto the wrong day.
   */
  const thursday = at('2026-09-17T00:00:00');
  const today = at('2026-09-12T14:37:00');
  const d = blankEventDraft(thursday, today);
  const start = new Date(d.startsAt);
  assert.equal(start.getDate(), 17);
  assert.equal(start.getMonth(), 8);
});

test('a future day starts the working day, not midnight', () => {
  // Midnight is never the answer, and it is what `new Date(day)` gives you.
  const d = blankEventDraft(at('2026-09-17T00:00:00'), at('2026-09-12T14:37:00'));
  assert.equal(new Date(d.startsAt).getHours(), 9);
  assert.equal(new Date(d.startsAt).getMinutes(), 0);
});

test('TODAY OPENS ON THE NEXT HOUR, AND NEVER IN THE PAST', () => {
  /**
   * Opening at 14:37 makes everybody edit the minutes before they can do
   * anything else, and opening at 9am on today would put the event hours behind
   * them. The next round hour is the one that needs no editing at all.
   */
  const now = at('2026-09-12T14:37:00');
  const d = blankEventDraft(at('2026-09-12T00:00:00'), now);
  const start = new Date(d.startsAt);
  assert.equal(start.getHours(), 15);
  assert.equal(start.getMinutes(), 0);
  assert.ok(start.getTime() > now.getTime(), 'a new event opened in the past');
});

test('an hour long, ending after it starts', () => {
  const d = blankEventDraft(at('2026-09-17T00:00:00'), at('2026-09-12T14:37:00'));
  const start = new Date(d.startsAt).getTime();
  const end = new Date(d.endsAt ?? '').getTime();
  assert.equal(end - start, 60 * 60 * 1000);
  // The server drops an end that precedes its start, so this is not cosmetic.
  assert.ok(end > start);
});

test('the rest of the draft is empty, because guessing is worse than blank', () => {
  const d = blankEventDraft(at('2026-09-17T00:00:00'));
  assert.equal(d.title, '');
  assert.equal(d.description, '');
  assert.equal(d.place, '');
  assert.equal(d.allDay, false);
  assert.equal(d.repeat, 'none');
  assert.equal(d.repeatUntil, null);
  assert.equal(d.notifyMinutesBefore, null);
});

test('the instant it produces is one the server will accept', () => {
  // createScheduledEvent throws on an unparseable startsAt, and a draft that
  // cannot round-trip through Date is a sheet that fails on Save every time.
  const d = blankEventDraft(at('2026-09-17T00:00:00'), at('2026-09-12T23:30:00'));
  assert.ok(!Number.isNaN(new Date(d.startsAt).getTime()));
  assert.match(d.startsAt, /^\d{4}-\d{2}-\d{2}T/);
});

test('LATE AT NIGHT ON TODAY DOES NOT PRODUCE AN INVALID HOUR', () => {
  // setHours(24) is not an error, it rolls into tomorrow -- which is the right
  // answer and the reason this is not clamped. What would be wrong is an
  // invalid date or a time already gone.
  const now = at('2026-09-12T23:30:00');
  const d = blankEventDraft(at('2026-09-12T00:00:00'), now);
  const start = new Date(d.startsAt);
  assert.ok(!Number.isNaN(start.getTime()), 'a late-night add produced an invalid date');
  assert.ok(start.getTime() > now.getTime(), 'a late-night add opened in the past');
  assert.equal(start.getHours(), 0);
  assert.equal(start.getDate(), 13);
});
