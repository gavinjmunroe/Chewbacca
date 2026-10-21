/**
 * A DAY, ASSEMBLED FROM THREE SOURCES THAT DISAGREE.
 *
 * The drawing is easy. What can actually be wrong here:
 *
 *   THE DOUBLE      you told Amber "coffee with Mina at ten" AND the invite is
 *                   in your calendar. Both true, both correct, and the day now
 *                   says you have two coffees.
 *   THE WRONG WORD  calling dinner "virtual" because the invite linked the
 *                   restaurant's menu. A confident wrong word about somebody's
 *                   own day is worse than no word.
 *   THE WRONG DAY   a calendar query asked for a range and answering with the
 *                   edges of the next one.
 *   THE RESHUFFLE   two things at nine o'clock swapping places between renders.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAgenda,
  carriedFromLabel,
  clockTime,
  dayBounds,
  fromAmberEvent,
  fromDeviceEvent,
  agendaKind,
  fromReminder,
  meetingHost,
  meetingUrlFrom,
  placeLine,
  sameMeeting,
  sortAgenda,
  timeRange,
  virtualnessOf,
  type AgendaItem,
} from './agenda.ts';

/**
 * LOCAL MIDNIGHT, BUILT LOCALLY.
 *
 * The first version of this pinned a UTC instant and called it "midnight EDT",
 * which made every expectation below correct only in one timezone -- it passed
 * on a Mac in New York and failed in the UTC container, claiming 2 PM for an
 * event the test called 10 AM. A day boundary IS local; that is the whole
 * reason the server takes two instants from the client instead of a date. So
 * the test builds its day the same way the app does.
 */
const DAY_START = new Date(2026, 8, 8, 0, 0, 0, 0).getTime();
const DAY_END = new Date(2026, 8, 9, 0, 0, 0, 0).getTime();
const at = (h: number, m = 0) => DAY_START + h * 3600_000 + m * 60_000;

const item = (over: Partial<AgendaItem> = {}): AgendaItem => ({
  key: 'k',
  source: 'amber',
  title: 'Thing',
  startsAt: at(10),
  endsAt: null,
  allDay: false,
  withPerson: null,
  location: null,
  meetingUrl: null,
  virtual: null,
  done: false,
  carriedOver: false,
  kind: 'event',
  accent: null,
  ...over,
});

// ── virtual, in person, or nobody said ──────────────────────────────────────

test('a conference link is a meeting; a restaurant website is not', () => {
  assert.equal(meetingUrlFrom('https://meet.google.com/abc-defg-hij'), 'https://meet.google.com/abc-defg-hij');
  assert.equal(meetingUrlFrom('Join at https://acme.zoom.us/j/123'), 'https://acme.zoom.us/j/123');
  assert.ok(meetingUrlFrom('https://teams.microsoft.com/l/meetup-join/x'));
  assert.ok(meetingUrlFrom('https://meet.jit.si/room'));

  // THE ONE THIS LIST EXISTS FOR. Dinner is not virtual because the invite
  // linked the menu.
  assert.equal(meetingUrlFrom('Menu: https://theolivetree.com/menu'), null);
  assert.equal(meetingUrlFrom('https://maps.google.com/?q=cafe'), null);
  assert.equal(meetingUrlFrom('no link at all'), null);
  assert.equal(meetingUrlFrom(null, undefined, ''), null);
});

test('a link is found across any of the fields an invite hides it in', () => {
  assert.ok(meetingUrlFrom(null, null, 'agenda\n\nhttps://zoom.us/j/9 \n\nbring notes'));
  assert.ok(meetingUrlFrom(null, 'https://meet.google.com/xyz', null));
  // Trailing punctuation is not part of the URL.
  assert.equal(meetingUrlFrom('(see https://zoom.us/j/9).'), 'https://zoom.us/j/9');
});

test('VIRTUAL, IN PERSON AND NOT KNOWN ARE THREE DIFFERENT ANSWERS', () => {
  assert.equal(virtualnessOf(null, 'https://zoom.us/j/1'), true);
  assert.equal(virtualnessOf('Cafe Grumpy', null), false);
  // A hybrid invite carries both, and the link is the part that changes what
  // you do.
  assert.equal(virtualnessOf('Room 4', 'https://zoom.us/j/1'), true);
  // Nobody said. NOT false -- guessing "in person" puts a confident wrong word
  // on somebody's own day.
  assert.equal(virtualnessOf(null, null), null);
  assert.equal(virtualnessOf('   ', null), null);
  // Google Calendar's habit of pasting the link into the location field.
  assert.equal(virtualnessOf('https://meet.google.com/abc', null), true);
});

// ── the double ──────────────────────────────────────────────────────────────

test('ONE COFFEE, NOT TWO, WHEN AMBER AND THE CALENDAR BOTH KNOW ABOUT IT', () => {
  const device = fromDeviceEvent({
    id: 'g1',
    title: 'Coffee with Mina',
    startDate: new Date(at(10)).toISOString(),
    endDate: new Date(at(10, 30)).toISOString(),
    location: 'Cafe Grumpy',
  })!;
  const amber = fromAmberEvent({
    id: 'a1',
    title: 'coffee with Mina!',
    startsAt: new Date(at(10, 5)).toISOString(),
    withPerson: { contactId: 'c1', name: 'Mina Cho', amberId: 'am1', avatarUrl: null },
  })!;

  const day = buildAgenda({ device: [device], amber: [amber], dayStart: DAY_START, dayEnd: DAY_END });
  assert.equal(day.length, 1, 'the day shows two coffees');

  // THE DEVICE ONE SURVIVES -- it has the real place and the real end time --
  // BUT IT TAKES THE PERSON FROM THE ONE IT ABSORBS, so nothing is lost.
  assert.equal(day[0]!.source, 'device');
  assert.equal(day[0]!.location, 'Cafe Grumpy');
  assert.equal(day[0]!.endsAt, at(10, 30));
  assert.equal(day[0]!.withPerson?.name, 'Mina Cho');
});

test('collapsing is narrow, because hiding a commitment is worse than showing one twice', () => {
  const a = item({ key: 'a', source: 'device', title: 'Standup', startsAt: at(9) });
  // Same title, two hours apart: two standups, not one.
  assert.equal(sameMeeting(a, item({ key: 'b', source: 'amber', title: 'Standup', startsAt: at(11) })), false);
  // Same time, different meeting.
  assert.equal(sameMeeting(a, item({ key: 'b', source: 'amber', title: 'Dentist', startsAt: at(9) })), false);
  // Two calendar entries are never collapsed into each other -- if your
  // calendar has it twice, your calendar has it twice.
  assert.equal(sameMeeting(a, item({ key: 'b', source: 'device', title: 'Standup', startsAt: at(9) })), false);
  // An empty title matches nothing, rather than matching everything.
  assert.equal(sameMeeting(item({ title: '' }), item({ source: 'device', title: '' })), false);
});

test('titles from two systems still match through case and punctuation', () => {
  const a = item({ source: 'device', title: 'Coffee w/ Mina!' });
  const b = item({ source: 'amber', title: 'coffee w mina', startsAt: at(10, 10) });
  assert.equal(sameMeeting(a, b), true);
});

test('a reminder is never collapsed into a meeting it happens to share a name with', () => {
  // "Pick up prescription" as both a calendar event and a reminder IS the same
  // thing, and collapsing it is right. What must not happen is a reminder
  // swallowing an event's details or vice versa in a way that loses the tick.
  const ev = item({ key: 'e', source: 'device', title: 'Pick up prescription', startsAt: at(16) });
  const rem = item({ key: 'r', source: 'reminder', title: 'Pick up prescription', startsAt: at(16), done: true });
  const day = buildAgenda({ device: [ev], reminders: [rem], dayStart: DAY_START, dayEnd: DAY_END });
  assert.equal(day.length, 1);
  assert.equal(day[0]!.source, 'device');
});

// ── the wrong day ───────────────────────────────────────────────────────────

test('NOTHING OUTSIDE THE DAY GETS ON THE DAY', () => {
  const before = item({ key: 'x', startsAt: DAY_START - 1 });
  const after = item({ key: 'y', startsAt: DAY_END });
  const inside = item({ key: 'z', startsAt: DAY_END - 1 });
  const day = buildAgenda({ amber: [before, after, inside], dayStart: DAY_START, dayEnd: DAY_END });
  assert.deepEqual(day.map((d) => d.key), ['z']);
});

test('the window is half-open, so midnight belongs to one day and not both', () => {
  const midnight = item({ key: 'm', startsAt: DAY_START });
  assert.equal(buildAgenda({ amber: [midnight], dayStart: DAY_START, dayEnd: DAY_END }).length, 1);
  assert.equal(
    buildAgenda({ amber: [midnight], dayStart: DAY_START - 86400_000, dayEnd: DAY_START }).length,
    0,
    'midnight showed up on the previous day too',
  );
});

test('an item with no usable time is dropped rather than stacked at the epoch', () => {
  assert.equal(fromDeviceEvent({ id: 'x', startDate: 'not a date' }), null);
  assert.equal(fromDeviceEvent({ id: 'x', startDate: null }), null);
  assert.equal(fromAmberEvent({ id: 'x', startsAt: undefined }), null);
  assert.equal(fromReminder({ id: 'x', startsAt: '' }), null);
});

// ── the order ───────────────────────────────────────────────────────────────

test('the day reads in the order it happens, all-day first, done last', () => {
  const day = sortAgenda([
    item({ key: 'b', startsAt: at(16), title: 'Prescription' }),
    item({ key: 'a', startsAt: at(10), title: 'Coffee' }),
    item({ key: 'allday', startsAt: DAY_START, allDay: true, title: 'Birthday' }),
    item({ key: 'done', startsAt: at(9), title: 'Ticked', done: true }),
  ]);
  assert.deepEqual(day.map((d) => d.key), ['allday', 'a', 'b', 'done']);
});

test('the sort is total, so two things at nine never swap between renders', () => {
  const a = item({ key: 'k1', startsAt: at(9), title: 'Same' });
  const b = item({ key: 'k2', startsAt: at(9), title: 'Same' });
  assert.deepEqual(sortAgenda([a, b]).map((x) => x.key), sortAgenda([b, a]).map((x) => x.key));
});

// ── the words ───────────────────────────────────────────────────────────────

test('a time range reads like a person wrote it', () => {
  const start = at(10);
  assert.equal(timeRange({ startsAt: start, endsAt: at(10, 30), allDay: false }), '10 AM – 10:30 AM');
  assert.equal(timeRange({ startsAt: at(16), endsAt: null, allDay: false }), '4 PM');
  assert.equal(timeRange({ startsAt: start, endsAt: at(9), allDay: false }), '10 AM', 'an end before the start is not a range');
  assert.equal(timeRange({ startsAt: start, endsAt: start, allDay: false }), '10 AM', 'a zero-length event is not a range');
  assert.equal(timeRange({ startsAt: start, endsAt: at(11), allDay: true }), 'All day');
});

test('the place line says only what is known', () => {
  assert.equal(placeLine({ virtual: true, location: null }), 'Virtual');
  assert.equal(placeLine({ virtual: true, location: 'Room 4' }), 'Virtual · Room 4');
  // A location that IS the link is not repeated after the word Virtual.
  assert.equal(placeLine({ virtual: true, location: 'https://meet.google.com/x' }), 'Virtual');
  assert.equal(placeLine({ virtual: false, location: 'Cafe Grumpy' }), 'In person · Cafe Grumpy');
  assert.equal(placeLine({ virtual: false, location: null }), 'In person');
  // NOBODY SAID. Not "In person".
  assert.equal(placeLine({ virtual: null, location: null }), '');
});

test('an untitled calendar entry says Busy rather than nothing', () => {
  const e = fromDeviceEvent({ id: 'g', title: '  ', startDate: new Date(at(9)).toISOString() })!;
  assert.equal(e.title, 'Busy');
});

test('an Amber event with no title falls back to who it is with', () => {
  const e = fromAmberEvent({
    id: 'a',
    startsAt: new Date(at(9)).toISOString(),
    withPerson: { name: 'Mina Cho' },
  })!;
  assert.equal(e.title, 'With Mina Cho');
  const bare = fromAmberEvent({ id: 'b', startsAt: new Date(at(9)).toISOString() })!;
  assert.equal(bare.title, 'Something planned');
});

test('keys are prefixed by source, so two stores cannot collide', () => {
  const d = fromDeviceEvent({ id: '1', startDate: new Date(at(9)).toISOString() })!;
  const a = fromAmberEvent({ id: '1', startsAt: new Date(at(9)).toISOString() })!;
  const r = fromReminder({ id: '1', startsAt: new Date(at(9)).toISOString() })!;
  assert.equal(new Set([d.key, a.key, r.key]).size, 3);
});

test('a done reminder still says it is done after the merge', () => {
  const r = fromReminder({ id: '1', title: 'Prescription', startsAt: new Date(at(16)).toISOString(), done: true })!;
  const day = buildAgenda({ reminders: [r], dayStart: DAY_START, dayEnd: DAY_END });
  assert.equal(day[0]!.done, true);
});

test('an empty day is an empty list, not a crash', () => {
  assert.deepEqual(buildAgenda({ dayStart: DAY_START, dayEnd: DAY_END }), []);
  assert.deepEqual(sortAgenda([]), []);
  assert.equal(clockTime(Number.NaN), '');
});

// ── the day boundary itself ─────────────────────────────────────────────────
//
// dayBounds feeds three things at once: the calendar query, the server window,
// and the filter inside buildAgenda. Every one of them takes instants, and a
// day is not an instant -- it is a pair whose length changes twice a year. A
// wrong boundary does not error; it silently drops an hour of somebody's
// evening or prints it twice.

test('a day runs from its own midnight to the next one, and the next day picks up exactly there', () => {
  const wed = new Date(2026, 8, 9, 15, 30, 0, 0);
  const { start, end } = dayBounds(wed);
  const s = new Date(start);
  assert.equal(s.getHours(), 0);
  assert.equal(s.getMinutes(), 0);
  assert.equal(s.getSeconds(), 0);
  assert.equal(s.getMilliseconds(), 0);
  assert.equal(s.getDate(), 9);
  assert.equal(new Date(end).getDate(), 10);
  // Half-open, and the seam is exact: tomorrow starts where today stops, so
  // midnight belongs to one day and not to both or to neither.
  assert.equal(dayBounds(new Date(2026, 8, 10, 6, 0, 0, 0)).start, end);
});

test('the time of day you ask with does not move the day', () => {
  const a = dayBounds(new Date(2026, 8, 9, 0, 0, 0, 0));
  const b = dayBounds(new Date(2026, 8, 9, 23, 59, 59, 999));
  assert.deepEqual(a, b);
});

test('month, year and leap-day ends roll over rather than producing the 32nd', () => {
  assert.equal(new Date(dayBounds(new Date(2026, 7, 31, 12)).end).getMonth(), 8);
  assert.equal(new Date(dayBounds(new Date(2026, 7, 31, 12)).end).getDate(), 1);
  const nye = dayBounds(new Date(2026, 11, 31, 12));
  assert.equal(new Date(nye.end).getFullYear(), 2027);
  assert.equal(new Date(nye.end).getMonth(), 0);
  // 2028 is a leap year: the 28th is followed by the 29th, not by March.
  const feb28 = dayBounds(new Date(2028, 1, 28, 12));
  assert.equal(new Date(feb28.end).getDate(), 29);
  assert.equal(new Date(feb28.end).getMonth(), 1);
});

test('THE TWO DAYS A YEAR THE CLOCKS MOVE: a day is not always 24 hours, and this must not add one', () => {
  // Swept over a whole year in the runner's own zone, so this checks the rule
  // rather than one hard-coded American Sunday. In UTC every day is 24 hours
  // and this passes trivially; in a DST zone two of them are not, and a
  // boundary built by adding 86,400,000 fails here.
  //
  // NOT "every day starts at 00:00". That was the first version of this
  // assertion and Santiago failed it, correctly: Chile springs forward AT
  // midnight, so on that Sunday the local time 00:00 does not exist and the day
  // genuinely begins at 01:00. A test that demanded midnight would have been
  // demanding a wrong answer -- and the fix somebody would reach for, clamping
  // to a 24-hour grid, is the actual bug.
  //
  // The two properties that are true in every zone:
  //   * start is the EARLIEST INSTANT OF THAT CALENDAR DATE -- it is on the
  //     date asked for, and one millisecond earlier is on the date before;
  //   * consecutive days TILE -- today's end is tomorrow's start exactly, so no
  //     hour of anybody's life is on two days or on none.
  const day = new Date(2026, 0, 1, 12, 0, 0, 0);
  let odd = 0;
  for (let i = 0; i < 365; i += 1) {
    const { start, end } = dayBounds(day);
    assert.equal(new Date(start).getDate(), day.getDate(), `day ${i} starts on the wrong date`);
    assert.notEqual(
      new Date(start - 1).getDate(),
      day.getDate(),
      `day ${i} does not start at the beginning of its date`,
    );
    const next = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1, 12, 0, 0, 0);
    assert.equal(
      dayBounds(next).start,
      end,
      `day ${i} and the day after it do not meet -- an hour is duplicated or lost`,
    );
    if ((end - start) / 3_600_000 !== 24) odd += 1;
    day.setDate(day.getDate() + 1);
  }
  // A DST zone has two of these a year; a zone that also made a permanent
  // offset change that year could have three. A year full of them is a boundary
  // that has come loose from the calendar.
  assert.ok(odd <= 3, `${odd} days were not 24 hours -- the boundary is drifting`);
});

test('a day built from dayBounds actually holds the things on it', () => {
  const wed = new Date(2026, 8, 9, 15, 30, 0, 0);
  const { start, end } = dayBounds(wed);
  const lateTonight = new Date(2026, 8, 9, 23, 40, 0, 0).getTime();
  const earlyTomorrow = new Date(2026, 8, 10, 0, 20, 0, 0).getTime();
  const day = buildAgenda({
    device: [
      item({ key: 'device:late', source: 'device', title: 'Late', startsAt: lateTonight }),
      item({ key: 'device:tmr', source: 'device', title: 'Tomorrow', startsAt: earlyTomorrow }),
    ],
    dayStart: start,
    dayEnd: end,
  });
  assert.deepEqual(day.map((i) => i.title), ['Late']);
});

test('the host is the part of a join link somebody recognizes', () => {
  assert.equal(meetingHost('https://meet.google.com/abc-defg-hij'), 'meet.google.com');
  assert.equal(meetingHost('https://acme.zoom.us/j/123?pwd=x#top'), 'acme.zoom.us');
  assert.equal(meetingHost('HTTPS://WWW.Webex.com/meet/x'), 'webex.com');
  assert.equal(meetingHost('https://user:pw@teams.microsoft.com:443/l/x'), 'teams.microsoft.com');
  // Not a URL, no URL, and a URL with nothing after the scheme: none of these
  // should ever reach the page, and none of them may throw on the way.
  assert.equal(meetingHost('conference room 4'), 'conference room 4');
  assert.equal(meetingHost(''), '');
  assert.equal(meetingHost(null), '');
  assert.equal(meetingHost(undefined), '');
  assert.equal(meetingHost('https://'), 'https://');
});

// ── which icon a thing on the day gets ──────────────────────────────────────
//
// "With icons, birthdays have the little birthday cake icon, and so on and so
//  forth."
//
// The failure here is not a missing icon, it is a WRONG one. An icon is a
// claim, and the app is making it about somebody's own day from a title
// somebody else typed -- so what these tests mostly pin is the refusal to
// guess.

test('THE BIRTHDAY CALENDAR IS A FACT, and it beats everything else', () => {
  // iOS keeps birthdays in a calendar of their own, filled from the address
  // book. No title parsing can be as reliable as that, so nothing overrules it.
  assert.equal(agendaKind({ title: 'Mina Cho', calendarType: 'birthdays' }), 'birthday');
  assert.equal(
    agendaKind({ title: 'Zoom sync', calendarType: 'birthdays', meetingUrl: 'https://zoom.us/j/1' }),
    'birthday',
  );
  // ...and one written into the ordinary calendar is still a birthday.
  assert.equal(agendaKind({ title: "Sagar's birthday" }), 'birthday');
  assert.equal(agendaKind({ title: 'bday drinks' }), 'birthday');
});

test('A LINK OUTRANKS THE WORDS, because it is a fact and they are a guess', () => {
  // Whatever it is called, if it carries a Zoom link then what you are about to
  // do is open a laptop.
  assert.equal(agendaKind({ title: 'Coffee with Mina', meetingUrl: 'https://zoom.us/j/1' }), 'video');
  assert.equal(agendaKind({ title: 'Coffee with Mina' }), 'meal');
});

test('the words that are only ever one thing', () => {
  assert.equal(agendaKind({ title: 'Flight to SFO' }), 'travel');
  assert.equal(agendaKind({ title: 'Lunch w/ Rowan' }), 'meal');
  assert.equal(agendaKind({ title: 'Dinner at the Olive Tree' }), 'meal');
  assert.equal(agendaKind({ title: 'Pick up prescription', source: 'reminder' }), 'reminder');
});

test('THE REFUSAL TO GUESS IS THE POINT: anything unclear gets the plain icon', () => {
  for (const title of [
    'Deposition',
    'Sync',
    '1:1',
    'Q3 planning',
    'Standup',
    'Board meeting',
    'Dentist',
    '',
  ]) {
    assert.equal(agendaKind({ title }), 'event', `"${title}" was given an icon it did not earn`);
  }
  assert.equal(agendaKind({}), 'event');
});

test('the words match inside a real title, and case and punctuation do not matter', () => {
  assert.equal(agendaKind({ title: 'COFFEE!! with Mina' }), 'meal');
  assert.equal(agendaKind({ title: 'Standup, then lunch' }), 'meal');
});

test('a device event carries its calendar’s own color, and nothing invents one', () => {
  const withColor = fromDeviceEvent({
    id: 'g1',
    title: 'Standup',
    startDate: new Date(at(9)).toISOString(),
    calendarColor: '#4285F4',
  })!;
  assert.equal(withColor.accent, '#4285F4');
  // No calendar behind it, so no color -- the card falls back to the page's
  // gold rather than to a color that means something else somewhere.
  assert.equal(fromDeviceEvent({ id: 'g2', startDate: new Date(at(9)).toISOString() })!.accent, null);
  assert.equal(fromAmberEvent({ id: 'a1', startsAt: new Date(at(9)).toISOString() })!.accent, null);
  assert.equal(fromReminder({ id: 'r1', startsAt: new Date(at(9)).toISOString() })!.kind, 'reminder');
});

test('COLLAPSING TWO ENTRIES KEEPS THE SENTENCE THAT KNEW WHAT IT WAS', () => {
  // The calendar's copy is called "Mina Cho" and wins the merge; the one Amber
  // heard is "coffee with Mina" and is the only one that knows this is coffee.
  // Taking the survivor's kind would throw that away.
  const device = fromDeviceEvent({
    id: 'g1',
    title: 'Mina Cho',
    startDate: new Date(at(10)).toISOString(),
    calendarColor: '#34A853',
  })!;
  const amber = fromAmberEvent({
    id: 'a1',
    title: 'coffee with Mina Cho',
    startsAt: new Date(at(10, 5)).toISOString(),
  })!;
  const day = buildAgenda({ device: [device], amber: [amber], dayStart: DAY_START, dayEnd: DAY_END });
  assert.equal(day.length, 1);
  assert.equal(day[0]!.kind, 'meal');
  assert.equal(day[0]!.accent, '#34A853', 'the calendar color was lost in the merge');
});

// ── reminders that did not get done ─────────────────────────────────────────
//
// "Reminders that should persist across days are anything with an open tag that
//  didn't get completed. If it's something like 'text mom about the trip' and
//  that wasn't completed, then that should persist."
//
// The mechanism is a reminder whose startsAt is deliberately OUTSIDE the day
// being built -- it is still due, from whenever it was due -- and every one of
// these tests is about the two places that would otherwise silently drop it or
// misplace it.

test('a carried-over reminder survives the day window that would drop it', () => {
  const yesterday = DAY_START - 9 * 3600_000;
  const built = buildAgenda({
    reminders: [
      item({
        key: 'reminder:1',
        source: 'reminder',
        kind: 'reminder',
        title: 'Text mom about the trip',
        startsAt: yesterday,
        carriedOver: true,
      }),
    ],
    dayStart: DAY_START,
    dayEnd: DAY_END,
  });
  assert.deepEqual(
    built.map((i) => i.title),
    ['Text mom about the trip'],
    'an open reminder from before today was thrown away with the window',
  );
});

test('...and anything else outside the window is still dropped', () => {
  // The filter is not simply loosened. A meeting from yesterday appearing on
  // today is the kind of wrong that makes somebody stop reading the screen, and
  // it is what a blanket relaxation of the window would produce.
  const built = buildAgenda({
    amber: [item({ key: 'a', startsAt: DAY_START - 3600_000, title: 'Yesterday standup' })],
    device: [item({ key: 'd', source: 'device', startsAt: DAY_END + 3600_000, title: 'Tomorrow' })],
    dayStart: DAY_START,
    dayEnd: DAY_END,
  });
  assert.deepEqual(built, [], 'the window stopped holding');
});

test('a carried-over reminder sits above everything, including an all-day row', () => {
  const built = buildAgenda({
    device: [
      item({ key: 'allday', source: 'device', allDay: true, startsAt: DAY_START, title: 'Ana birthday' }),
      item({ key: 'early', source: 'device', startsAt: at(7), title: 'Gym' }),
    ],
    reminders: [
      item({
        key: 'reminder:1',
        source: 'reminder',
        kind: 'reminder',
        title: 'Text mom about the trip',
        startsAt: DAY_START - 5 * 86400_000,
        carriedOver: true,
      }),
    ],
    dayStart: DAY_START,
    dayEnd: DAY_END,
  });
  assert.equal(built[0]?.title, 'Text mom about the trip', 'it was not at the top of the day');
  assert.deepEqual(built.map((i) => i.title), ['Text mom about the trip', 'Ana birthday', 'Gym']);
});

test('two carried-over reminders keep their own order, oldest first', () => {
  // They are ranked above everything as a GROUP; within the group the older
  // thing is the one that has been waiting longer, and burying it under
  // yesterday's is how a week-old reminder becomes invisible.
  const built = buildAgenda({
    reminders: [
      item({ key: 'r:new', source: 'reminder', kind: 'reminder', title: 'Newer', startsAt: DAY_START - 86400_000, carriedOver: true }),
      item({ key: 'r:old', source: 'reminder', kind: 'reminder', title: 'Older', startsAt: DAY_START - 7 * 86400_000, carriedOver: true }),
    ],
    dayStart: DAY_START,
    dayEnd: DAY_END,
  });
  assert.deepEqual(built.map((i) => i.title), ['Older', 'Newer']);
});

test('a reminder due today is not marked as carried over', () => {
  const built = buildAgenda({
    reminders: [
      item({ key: 'r', source: 'reminder', kind: 'reminder', title: 'Call the vet', startsAt: at(15) }),
      item({ key: 'e', source: 'device', startsAt: at(9), title: 'Standup' }),
    ],
    dayStart: DAY_START,
    dayEnd: DAY_END,
  });
  assert.deepEqual(
    built.map((i) => i.title),
    ['Standup', 'Call the vet'],
    "today's reminder was hoisted to the top as though it were overdue",
  );
});

test('fromReminder carries the server flag through, and defaults it off', () => {
  const carried = fromReminder({
    id: '9',
    title: 'Text mom about the trip',
    startsAt: new Date(DAY_START - 86400_000).toISOString(),
    done: false,
    carriedOver: true,
  });
  assert.equal(carried?.carriedOver, true);

  // A server that has not been deployed yet simply omits the field, and the
  // client must read that as "no" rather than as undefined leaking into a sort.
  const plain = fromReminder({
    id: '10',
    title: 'Call the vet',
    startsAt: new Date(at(15)).toISOString(),
    done: false,
  });
  assert.equal(plain?.carriedOver, false);
});

test('a carried-over reminder that has been ticked off is not carried', () => {
  // Belt and braces: the server only sends undone ones, but done outranks
  // carried in the sort, and a done row at the top of every day would be the
  // exact opposite of "if that's checked, then that goes away".
  const built = buildAgenda({
    reminders: [
      item({ key: 'r:done', source: 'reminder', kind: 'reminder', title: 'Done thing', startsAt: DAY_START - 86400_000, carriedOver: true, done: true }),
      item({ key: 'r:open', source: 'reminder', kind: 'reminder', title: 'Open thing', startsAt: DAY_START - 86400_000, carriedOver: true }),
    ],
    dayStart: DAY_START,
    dayEnd: DAY_END,
  });
  assert.deepEqual(built.map((i) => i.title), ['Open thing', 'Done thing']);
});

// ── how long it has been waiting ────────────────────────────────────────────

test('carriedFromLabel says which day, and stops saying it when it gets vague', () => {
  const now = new Date(2026, 8, 11, 14, 0, 0).getTime(); // Friday
  const daysAgo = (n: number, h = 15) => new Date(2026, 8, 11 - n, h, 0, 0).getTime();

  assert.equal(carriedFromLabel(daysAgo(1), now), 'Since yesterday');
  // Thursday, Wednesday... a weekday still locates it inside a week.
  assert.equal(carriedFromLabel(daysAgo(3), now), 'Since Tuesday');
  assert.equal(carriedFromLabel(daysAgo(6), now), 'Since Saturday');
  // Nine days ago is a Wednesday, and "Wednesday" would mean two days ago.
  assert.match(carriedFromLabel(daysAgo(9), now), /^Since \w+ \d+$/);
  // And a year back needs the year, or it reads as this September.
  assert.match(carriedFromLabel(new Date(2025, 8, 2, 10).getTime(), now), /2025/);
});

test('carriedFromLabel measures between local midnights, not in raw hours', () => {
  // 11pm last night to 1am this morning is two hours and one day. Dividing the
  // difference by 86400000 calls it zero days and prints "Still open" for
  // something that is genuinely from yesterday.
  const now = new Date(2026, 8, 11, 1, 0, 0).getTime();
  const lastNight = new Date(2026, 8, 10, 23, 0, 0).getTime();
  assert.equal(carriedFromLabel(lastNight, now), 'Since yesterday');
});

test('carriedFromLabel never claims a day for something that is not old', () => {
  const now = new Date(2026, 8, 11, 14, 0, 0).getTime();
  assert.equal(carriedFromLabel(new Date(2026, 8, 11, 9, 0, 0).getTime(), now), 'Still open');
  assert.equal(carriedFromLabel(NaN, now), 'Still open');
});

 test('Amber events retain an explicit FaceTime link without treating arbitrary URLs as meetings', () => {
 const event = fromAmberEvent({ id: 'face', startsAt: '2026-09-15T10:00:00Z', placeText: 'https://facetime.apple.com/join#sample' })!;
 assert.equal(event.meetingUrl, 'https://facetime.apple.com/join#sample');
 assert.equal(event.virtual, true);
 const ordinary = fromAmberEvent({ id: 'cafe', startsAt: '2026-09-15T10:00:00Z', placeText: 'https://example.com/cafe' })!;
 assert.equal(ordinary.meetingUrl, null);
 });
