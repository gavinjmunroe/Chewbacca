/**
 * THE FOUR THINGS THE MESSAGES PANEL CAN GET WRONG WITHOUT LOOKING WRONG.
 *
 * Every test here is one I could not have caught by opening the panel: an inbox
 * whose order is nearly right, a stamp that disagrees with the phone's own
 * notification center by ten minutes, a letter list that opens on the numbers,
 * and a caption that changes which circle it names depending on what order the
 * server answered in.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  RECENT_DM_COUNT,
  alphaSections,
  circleLabels,
  filterPeople,
  messageStamp,
  recentThreads,
  threadPreview,
} from './messagesPanel.ts';
import type { DmThread } from './dms.ts';
import type { CircleMember } from './circles.ts';
import type { NetworkIdentity } from './network.ts';

function thread(id: string, createdAt: string, extra: Partial<DmThread['last']> = {}): DmThread {
  return {
    threadId: id,
    other: { amberId: `a-${id}`, username: id, name: id, avatarUrl: null },
    unread: 0,
    blocked: false,
    last: {
      id: `m-${id}`,
      kind: 'text',
      body: `hi from ${id}`,
      durationMs: 0,
      mine: false,
      createdAt,
      ...extra,
    },
  };
}

// ── 1. WHICH FIVE ───────────────────────────────────────────────────────────

test('the five most RECENT conversations, whatever order the server sent them in', () => {
  // Deliberately shuffled, and deliberately nearly-sorted: this is the shape a
  // real answer has, and the shape that looks correct until it isn't.
  const threads = [
    thread('c', '2026-09-09T10:00:00Z'),
    thread('a', '2026-09-11T10:00:00Z'),
    thread('e', '2026-09-07T10:00:00Z'),
    thread('b', '2026-09-10T10:00:00Z'),
    thread('g', '2026-09-05T10:00:00Z'),
    thread('d', '2026-09-08T10:00:00Z'),
    thread('f', '2026-09-06T10:00:00Z'),
  ];
  const { shown, hiddenCount } = recentThreads(threads);
  assert.deepEqual(
    shown.map((t) => t.threadId),
    ['a', 'b', 'c', 'd', 'e'],
  );
  assert.equal(shown.length, RECENT_DM_COUNT);
  assert.equal(hiddenCount, 2, 'the "See N more" number has to be the number actually hidden');
});

test('fewer than five hides nothing, and expanding shows everybody', () => {
  const threads = [thread('a', '2026-09-11T10:00:00Z'), thread('b', '2026-09-10T10:00:00Z')];
  assert.equal(recentThreads(threads).hiddenCount, 0);
  const all = recentThreads(
    [...threads, thread('c', '2026-09-09T10:00:00Z'), thread('d', '2026-09-08T10:00:00Z'), thread('e', '2026-09-07T10:00:00Z'), thread('f', '2026-09-06T10:00:00Z')],
    true,
  );
  assert.equal(all.shown.length, 6);
  assert.equal(all.hiddenCount, 0, 'nothing is hidden once it is expanded');
});

test('a thread with a broken timestamp sinks rather than taking the top of the inbox', () => {
  // DATED IN THE PAST ON PURPOSE, and this is not incidental. Written against
  // today's date, a "fall back to Date.now()" implementation passes or fails
  // depending on what time of day the suite is run -- I watched it do exactly
  // that. A real conversation from last year still has to outrank a row whose
  // stamp we cannot read, at every hour of every day.
  const threads = [
    thread('broken', 'not a date'),
    thread('real', '2025-01-04T10:00:00Z'),
    thread('older', '2024-01-04T10:00:00Z'),
  ];
  const { shown } = recentThreads(threads);
  assert.deepEqual(
    shown.map((t) => t.threadId),
    ['real', 'older', 'broken'],
  );
});

test('no threads at all is an empty list, not a crash', () => {
  assert.deepEqual(recentThreads(null), { shown: [], hiddenCount: 0 });
  assert.deepEqual(recentThreads(undefined), { shown: [], hiddenCount: 0 });
});

// ── 2. WHAT TIME IT SAYS ────────────────────────────────────────────────────

test('TEN MINUTES PAST MIDNIGHT: last night is "Yesterday", not "23h"', () => {
  // The bug this exists to prevent: an hours-since stamp calls a message sent at
  // 11:50pm "23h" at 12:10am the next day, and keeps saying it until nearly
  // midnight again. The phone's own notification center says Yesterday.
  const sent = new Date(2026, 8, 10, 23, 50, 0).getTime();
  const now = new Date(2026, 8, 11, 0, 10, 0).getTime();
  assert.equal(messageStamp(new Date(sent).toISOString(), now), 'Yesterday');
});

test('today is a clock time; twenty-three hours ago is not', () => {
  const now = new Date(2026, 8, 11, 14, 0, 0).getTime();
  const thisMorning = new Date(2026, 8, 11, 9, 41, 0);
  const stamp = messageStamp(thisMorning.toISOString(), now);
  // The exact rendering is the platform's (a 24-hour locale says 09:41), so the
  // assertion is on the SHAPE: it names a time, and it is not a day name.
  assert.match(stamp, /\d/, `today should read as a clock time, got ${stamp}`);
  assert.ok(!/Yesterday|Mon|Tue|Wed|Thu|Fri|Sat|Sun/.test(stamp), stamp);

  const yesterdayAfternoon = new Date(2026, 8, 10, 15, 0, 0);
  assert.equal(messageStamp(yesterdayAfternoon.toISOString(), now), 'Yesterday');
});

test('two to six days back is a weekday name; seven is a date', () => {
  const now = new Date(2026, 8, 11, 12, 0, 0).getTime(); // a Friday
  const sixBack = messageStamp(new Date(2026, 8, 5, 12, 0, 0).toISOString(), now);
  assert.match(sixBack, /^[A-Z][a-z]{2}$/, `six days back should be a weekday, got ${sixBack}`);
  // AT SEVEN IT STOPS. "Fri" a week later means either this Friday or last, and
  // an ambiguous stamp is worse than a date.
  const sevenBack = messageStamp(new Date(2026, 8, 4, 12, 0, 0).toISOString(), now);
  assert.ok(!/^[A-Z][a-z]{2}$/.test(sevenBack), `seven days back must not be a bare weekday, got ${sevenBack}`);
  assert.match(sevenBack, /\d/, sevenBack);
});

test('a future timestamp reads as a time, never as "in 3 days"', () => {
  const now = new Date(2026, 8, 11, 12, 0, 0).getTime();
  const skewed = new Date(2026, 8, 14, 9, 0, 0).toISOString();
  const stamp = messageStamp(skewed, now);
  assert.match(stamp, /\d/);
  assert.ok(!/in /.test(stamp), stamp);
});

test('an unparseable timestamp is blank rather than "Invalid Date"', () => {
  assert.equal(messageStamp('nonsense'), '');
  assert.equal(messageStamp(null), '');
  assert.equal(messageStamp(undefined), '');
});

// ── the preview line ────────────────────────────────────────────────────────

test('a voice memo previews as its TRANSCRIPT, and falls back to a duration', () => {
  const withWords = thread('v', '2026-09-11T10:00:00Z', {
    kind: 'voice',
    body: 'running ten minutes late',
    durationMs: 4200,
  });
  assert.equal(threadPreview(withWords), 'running ten minutes late');

  const stillTranscribing = thread('v', '2026-09-11T10:00:00Z', {
    kind: 'voice',
    body: null,
    durationMs: 65_000,
  });
  assert.equal(threadPreview(stillTranscribing), 'Voice message · 1:05');
});

test('your own last word is marked as yours', () => {
  const mine = thread('m', '2026-09-11T10:00:00Z', { mine: true, body: 'on my way' });
  assert.equal(threadPreview(mine), 'You: on my way');
});

// ── 3. WHICH LETTER ─────────────────────────────────────────────────────────

function person(name: string, extra: Partial<NetworkIdentity> = {}): NetworkIdentity {
  return { id: `id-${name}`, name, ...extra };
}

test('THE NUMBERS GO LAST. An address book does not open on "#"', () => {
  const sections = alphaSections([
    person('7-Eleven Manager'),
    person('Zoë Ramirez'),
    person('Alice Chen'),
    person(''),
  ]);
  assert.deepEqual(
    sections.map((s) => s.letter),
    ['A', 'Z', '#'],
  );
  // A plain sort() would put '#' (0x23) first, which is what this is here to
  // catch -- and it would look like a rendering bug, not an ordering one.
  assert.equal(sections[sections.length - 1]!.letter, '#');
  assert.equal(sections[2]!.data.length, 2, 'both the numbered and the nameless rows');
});

test('rows inside a letter are sorted, because the sync does not sort them', () => {
  const sections = alphaSections([
    person('Adam Silver'),
    person('Aaron Blake'),
    person('Ada Lovelace'),
  ]);
  assert.deepEqual(
    sections[0]!.data.map((p) => p.name),
    ['Aaron Blake', 'Ada Lovelace', 'Adam Silver'],
  );
});

test('the filter reads the email and the handle, not just the name', () => {
  const people = [
    person('Alice Chen', { email: 'alice@bluemodern.example' }),
    person('Bob Marsh', { handle: '@bmarsh' }),
    person('Carla Diaz'),
  ];
  assert.deepEqual(filterPeople(people, 'bluemodern').map((p) => p.name), ['Alice Chen']);
  assert.deepEqual(filterPeople(people, 'bmarsh').map((p) => p.name), ['Bob Marsh']);
  assert.equal(filterPeople(people, '').length, 3);
  assert.equal(filterPeople(people, '   ').length, 3, 'whitespace is not a query');
});

// ── 4. WHICH CIRCLE ─────────────────────────────────────────────────────────

function member(contactId: string): CircleMember {
  return { contactId, name: contactId, avatarUrl: null, connected: false, amberId: null, username: null };
}

test('THE SMALLEST CIRCLE NAMES THE ROW, so the caption is the most specific thing said', () => {
  const members = new Map<string, CircleMember[]>([
    ['everyone', [member('k'), member('a'), member('b'), member('c')]],
    ['family', [member('k'), member('a')]],
  ]);
  const names = new Map([
    ['everyone', 'Everyone'],
    ['family', 'Family'],
  ]);
  const labels = circleLabels(members, names);
  assert.equal(labels.get('k'), 'Family');
  assert.equal(labels.get('b'), 'Everyone', 'somebody only in the big circle still gets a caption');
});

test('the answer does not depend on which order the circles came back in', () => {
  const names = new Map([
    ['work', 'Work'],
    ['friends', 'Friends'],
  ]);
  // Same two circles, same size, opposite insertion order. A "first one wins"
  // implementation passes one of these and fails the other -- which is exactly
  // the failure that would appear the day the server added an index.
  const a = circleLabels(
    new Map<string, CircleMember[]>([
      ['work', [member('k'), member('x')]],
      ['friends', [member('k'), member('y')]],
    ]),
    names,
  );
  const b = circleLabels(
    new Map<string, CircleMember[]>([
      ['friends', [member('k'), member('y')]],
      ['work', [member('k'), member('x')]],
    ]),
    names,
  );
  assert.equal(a.get('k'), b.get('k'));
  assert.equal(a.get('k'), 'Friends', 'ties break on the name, alphabetically');
});

test('a circle whose name we do not have labels nobody, rather than labeling them undefined', () => {
  const labels = circleLabels(
    new Map<string, CircleMember[]>([['ghost', [member('k')]]]),
    new Map(),
  );
  assert.equal(labels.get('k'), undefined);
  assert.equal(labels.size, 0);
});

test('no circles at all is an empty map', () => {
  assert.equal(circleLabels(null, null).size, 0);
  assert.equal(circleLabels(undefined, undefined).size, 0);
});

test('THE SECTIONS ARE SHAPED THE WAY SectionList READS THEM', () => {
  // This is a test about a KEY NAME, which is the kind of thing that feels too
  // small to test and is exactly why the panel first rendered a column of
  // letter headings with nothing under any of them. SectionList takes its rows
  // from `data`; a section with the right rows under the wrong key renders as an
  // empty section, silently -- no error, no warning, no red screen.
  const sections = alphaSections([person('Alice Chen'), person('Bob Marsh')]);
  for (const s of sections) {
    assert.ok(Array.isArray((s as { data?: unknown }).data), `section ${s.letter} has no data array`);
    assert.ok(s.data.length > 0, `section ${s.letter} is empty`);
  }
  assert.equal(
    sections.reduce((n, s) => n + s.data.length, 0),
    2,
    'every person given has to come back out of exactly one section',
  );
});

test('nobody is dropped and nobody is duplicated across the letters', () => {
  // The bucketing is a loop with a fallthrough bucket, and both failure modes
  // are quiet: a name that matches no branch vanishes, and a name that matches
  // two appears twice a screen apart.
  const names = ['Ada', 'ada lovelace', 'Émile Zola', '99 Cents Guy', '', 'Zed'];
  const sections = alphaSections(names.map((n) => person(n)));
  const out = sections.flatMap((s) => s.data.map((p) => p.name));
  assert.equal(out.length, names.length, `expected ${names.length} rows, got ${out.length}`);
  assert.equal(new Set(out).size, out.length, 'somebody is in two letters at once');
});
