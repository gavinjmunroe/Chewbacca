/**
 * WHICH ROW CAN BE EDITED, AND WHAT GETS SENT WHEN ONE IS.
 *
 * Both halves have a specific way of going wrong that no amount of looking at
 * the screen would reveal: an edit posted to another row's id, and a save that
 * quietly overwrites a field the user never touched.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  agendaTargetOf,
  eventPatchFrom,
  isEditable,
  reminderPatchFrom,
  type EventDraft,
  type ReminderDraft,
} from './scheduleEdits.ts';

const EVENT_DRAFT: EventDraft = {
  title: 'Quarterly review',
  description: 'Bring the deck',
  place: 'Dumbo',
  startsAt: '2026-09-14T14:00:00.000Z',
  endsAt: '2026-09-14T15:00:00.000Z',
  allDay: false,
  repeat: 'none',
  repeatUntil: null,
  notifyMinutesBefore: 10,
};

const REMINDER_DRAFT: ReminderDraft = {
  title: 'Find a place for deep work',
  description: '',
  place: '',
  repeat: 'weekends',
  repeatUntil: '2026-09-13',
  repeatDays: null,
  startsOn: '2026-09-12',
  notifyAtLocal: null,
};

test('a row points at its own id, and a device id keeps its colons', () => {
  /**
   * buildAgenda composes the key as `${source}:${id}` and a device id is the
   * phone's own string, which routinely contains colons. Splitting on every
   * colon and taking the second field would send an edit to a truncated id --
   * either a 404 or, far worse, somebody else's row.
   */
  assert.deepEqual(agendaTargetOf({ key: 'amber:2c9a1f10-3b44', source: 'amber' }), {
    kind: 'event',
    id: '2c9a1f10-3b44',
  });
  assert.deepEqual(agendaTargetOf({ key: 'reminder:rem_abc', source: 'reminder' }), {
    kind: 'reminder',
    id: 'rem_abc',
  });
  assert.deepEqual(
    agendaTargetOf({ key: 'device:ABC:DEF/GHI:0', source: 'device' }),
    { kind: 'device', id: 'ABC:DEF/GHI:0' },
    'a device id was truncated at its first colon',
  );
});

test('a malformed key points at nothing rather than at something', () => {
  for (const bad of [
    { key: '', source: 'amber' as const },
    { key: 'amber:', source: 'amber' as const },
    { key: ':abc', source: 'amber' as const },
    { key: 'noseparator', source: 'amber' as const },
  ]) {
    assert.equal(agendaTargetOf(bad), null, `resolved: ${JSON.stringify(bad)}`);
  }
});

test("THE PHONE'S OWN CALENDAR IS NOT EDITABLE, AND THAT IS DELIBERATE", () => {
  /**
   * deviceCalendar.ts asks for read permission and never write. Offering Save on
   * a row that belongs to iCloud or a work Exchange would mean asking for a
   * permission the app has never asked for, and failing to save if the user says
   * no. The editor offers the Calendar app instead.
   */
  assert.equal(isEditable({ key: 'device:ABC', source: 'device' }), false);
  assert.equal(isEditable({ key: 'amber:abc', source: 'amber' }), true);
  assert.equal(isEditable({ key: 'reminder:rem_1', source: 'reminder' }), true);
  assert.equal(isEditable(null), false);
});

test('SAVING SENDS ONLY WHAT CHANGED', () => {
  // Sending every field would work and would also overwrite anything the user
  // did not touch with whatever the screen happened to be holding.
  assert.deepEqual(eventPatchFrom(EVENT_DRAFT, EVENT_DRAFT), {});
  assert.deepEqual(eventPatchFrom(EVENT_DRAFT, { ...EVENT_DRAFT, title: 'Board review' }), {
    title: 'Board review',
  });
});

test('the repeat and its end date move as one unit', () => {
  /**
   * Two CHECK constraints bind them on the server: repeat_until needs a repeat.
   * Setting the frequency without resetting the other makes the database refuse
   * the whole update, and the user's edit fails with nothing on screen to say
   * so. Changing either half sends both.
   */
  const weekly = eventPatchFrom(EVENT_DRAFT, { ...EVENT_DRAFT, repeat: 'weekly' });
  assert.equal(weekly.repeat, 'weekly');
  assert.ok('repeatUntil' in weekly, 'the end date was left behind');

  // And turning a repeat off clears the end date rather than orphaning it.
  const off = eventPatchFrom(
    { ...EVENT_DRAFT, repeat: 'weekly', repeatUntil: '2026-12-31' },
    { ...EVENT_DRAFT, repeat: 'none', repeatUntil: '2026-12-31' },
  );
  assert.equal(off.repeat, 'none');
  assert.equal(off.repeatUntil, null);
});

test('clearing a text field sends null, not an empty string', () => {
  // The columns are nullable and the server's cleanText turns "" into null
  // anyway; sending the empty string would leave the two disagreeing about what
  // "no description" looks like.
  const cleared = eventPatchFrom(EVENT_DRAFT, { ...EVENT_DRAFT, description: '', place: '' });
  assert.equal(cleared.description, null);
  assert.equal(cleared.place, null);
});

test('TURNING THE NOTIFICATION OFF IS A CHANGE, NOT AN OMISSION', () => {
  /**
   * null means silent and undefined means "leave it alone", and a diff that
   * treated them alike would make "no notification" the one setting the editor
   * could not save. The server's schema accepts null for exactly this reason.
   */
  const silent = eventPatchFrom(EVENT_DRAFT, { ...EVENT_DRAFT, notifyMinutesBefore: null });
  assert.ok('notifyMinutesBefore' in silent);
  assert.equal(silent.notifyMinutesBefore, null);
});

test('a reminder drops its chosen days when it stops being weekly', () => {
  /**
   * reminders_repeat_days_chk allows repeat_days ONLY on a weekly repeat, so
   * moving to daily without clearing them is an update Postgres refuses
   * outright: the user picks "Every day", nothing changes, and no error is
   * shown.
   */
  const patch = reminderPatchFrom(
    { ...REMINDER_DRAFT, repeat: 'weekly', repeatDays: [1, 3] },
    { ...REMINDER_DRAFT, repeat: 'daily', repeatDays: [1, 3] },
  );
  assert.equal(patch.repeat, 'daily');
  assert.equal(patch.repeatDays, null);
  assert.equal(patch.repeatUntil, REMINDER_DRAFT.repeatUntil);
});

test('changing only the days still sends the whole repeat unit', () => {
  const patch = reminderPatchFrom(
    { ...REMINDER_DRAFT, repeat: 'weekly', repeatDays: [1] },
    { ...REMINDER_DRAFT, repeat: 'weekly', repeatDays: [1, 4] },
  );
  assert.deepEqual(patch.repeatDays, [1, 4]);
  assert.equal(patch.repeat, 'weekly');
});

test('a reminder save with no changes is empty, so the editor can skip the call', () => {
  // The server answers an empty patch with 400 no_fields. Closing the editor
  // without touching anything must not produce an error toast.
  assert.deepEqual(reminderPatchFrom(REMINDER_DRAFT, REMINDER_DRAFT), {});
});

test('moving a reminder to a different start day is a change on its own', () => {
  const patch = reminderPatchFrom(REMINDER_DRAFT, { ...REMINDER_DRAFT, startsOn: '2026-09-19' });
  assert.deepEqual(patch, { startsOn: '2026-09-19' });
});
