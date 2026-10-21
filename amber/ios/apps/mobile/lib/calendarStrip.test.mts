/**
 * THE DAY STRIP. Seven dates, a key per day, and what is on the day you tapped.
 *
 * All of this is local-time arithmetic, which is where date code goes wrong:
 * month ends, year ends, leap days, and the two mornings a year the clocks
 * move. None of it was tested, because it lived as private helpers at the
 * bottom of a seventeen-hundred-line screen.
 *
 * The DST tests run under a fixed TZ so they mean the same thing on every
 * machine. TZ is read by the Date constructor at call time, so setting it here
 * and restoring it afterwards is enough -- no child process required.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  conversationsForDay,
  countsByDay,
  dayKey,
  getWeekDates,
  isSameDay,
} from './calendarStrip.ts';

/** Run `fn` as though the device were in `tz`. */
function inZone(tz: string, fn: () => void) {
  const prev = process.env.TZ;
  process.env.TZ = tz;
  try {
    fn();
  } finally {
    if (prev === undefined) delete process.env.TZ;
    else process.env.TZ = prev;
  }
}

const conv = (id: string, lastAt: string | null) =>
  ({ conversationId: id, title: id, lastAt, messageCount: 1 }) as any;

// ── dayKey ──────────────────────────────────────────────────────────────────

test('dayKey is the LOCAL day, padded, and never the UTC one', () => {
  inZone('America/Los_Angeles', () => {
    // 11:40pm on the 5th in LA is already the 6th in UTC. toISOString() would
    // file this note on tomorrow for everybody west of Greenwich.
    const late = new Date('2026-03-06T07:40:00Z');
    assert.equal(dayKey(late), '2026-03-05');
  });
  inZone('UTC', () => {
    assert.equal(dayKey(new Date('2026-03-06T07:40:00Z')), '2026-03-06');
    assert.equal(dayKey(new Date(2026, 0, 4)), '2026-01-04', 'month and day are zero-padded');
    assert.equal(dayKey(new Date(2026, 11, 31)), '2026-12-31');
  });
});

test('isSameDay agrees with dayKey and ignores the time', () => {
  inZone('UTC', () => {
    assert.equal(isSameDay(new Date(2026, 4, 2, 0, 0, 1), new Date(2026, 4, 2, 23, 59, 59)), true);
    assert.equal(isSameDay(new Date(2026, 4, 2, 23, 59, 59), new Date(2026, 4, 3, 0, 0, 1)), false);
  });
});

// ── the week ────────────────────────────────────────────────────────────────

test('a week is always seven consecutive days, Sunday first, containing today', () => {
  inZone('America/New_York', () => {
    // Every day of a year, so no month end, year end or leap day is missed.
    for (let i = 0; i < 400; i += 1) {
      const today = new Date(2024, 0, 1 + i, 9, 30);
      const week = getWeekDates(today);
      assert.equal(week.length, 7, dayKey(today));
      assert.equal(week[0].getDay(), 0, `week for ${dayKey(today)} does not start on Sunday`);
      assert.equal(week[6].getDay(), 6, `week for ${dayKey(today)} does not end on Saturday`);
      const keys = week.map(dayKey);
      assert.equal(new Set(keys).size, 7, `week for ${dayKey(today)} repeats a day: ${keys.join(',')}`);
      assert.ok(keys.includes(dayKey(today)), `week for ${dayKey(today)} does not contain today`);
      // Consecutive, with no gap.
      for (let d = 1; d < 7; d += 1) {
        const prev = new Date(week[d - 1]);
        prev.setDate(prev.getDate() + 1);
        assert.equal(dayKey(prev), keys[d], `gap in the week of ${dayKey(today)}`);
      }
    }
  });
});

test('THE WEEK SURVIVES THE MORNINGS THE CLOCKS MOVE', () => {
  // This passes against the implementation that was here before the extraction
  // too -- brute-forced over 35,200 day/time/zone combinations, it never
  // produced a duplicated or missing day. Said plainly because a test comment
  // claiming a bug that never existed is worse than no comment.
  //
  // It is here because the property was holding by accident: nothing in the old
  // code said the time of day must not matter, so an edit could have broken it
  // silently. Now the property is asserted, in the zones where an offset change
  // could reach it.
  for (const tz of ['America/New_York', 'America/Los_Angeles', 'Europe/London', 'Australia/Sydney']) {
    inZone(tz, () => {
      for (const [y, m, d] of [
        [2026, 2, 8],  // US spring forward
        [2026, 10, 1], // US fall back
        [2026, 2, 29], // EU spring forward
        [2026, 9, 25], // EU fall back
        [2026, 3, 5],  // AU fall back
        [2026, 9, 4],  // AU spring forward
      ] as const) {
        for (const hour of [0, 0.5, 1, 2, 3, 23]) {
          const today = new Date(y, m, d, Math.floor(hour), (hour % 1) * 60);
          const keys = getWeekDates(today).map(dayKey);
          assert.equal(new Set(keys).size, 7, `${tz} ${dayKey(today)} @${hour}h -> ${keys.join(',')}`);
          assert.ok(keys.includes(dayKey(today)), `${tz} ${dayKey(today)} @${hour}h lost today`);
        }
      }
    });
  }
});

test('a week that spans a month end, a year end and a leap day is still one week', () => {
  inZone('UTC', () => {
    assert.deepEqual(getWeekDates(new Date(2026, 0, 1, 9)).map(dayKey), [
      '2025-12-28', '2025-12-29', '2025-12-30', '2025-12-31', '2026-01-01', '2026-01-02', '2026-01-03',
    ]);
    assert.deepEqual(getWeekDates(new Date(2024, 1, 29, 9)).map(dayKey), [
      '2024-02-25', '2024-02-26', '2024-02-27', '2024-02-28', '2024-02-29', '2024-03-01', '2024-03-02',
    ]);
  });
});

test('the week does not depend on what time of day it is asked', () => {
  inZone('America/Chicago', () => {
    const base = getWeekDates(new Date(2026, 5, 17, 0, 0, 0)).map(dayKey);
    for (const h of [1, 6, 12, 18, 23]) {
      assert.deepEqual(getWeekDates(new Date(2026, 5, 17, h, 45)).map(dayKey), base, `hour ${h}`);
    }
  });
});

// ── what is on a day ────────────────────────────────────────────────────────

test('a day holds exactly the notes taken on it, newest first', () => {
  inZone('UTC', () => {
    const convs = [
      conv('morning', '2026-05-02T08:00:00Z'),
      conv('night', '2026-05-02T23:59:00Z'),
      conv('yesterday', '2026-05-01T12:00:00Z'),
      conv('noon', '2026-05-02T12:00:00Z'),
      conv('tomorrow', '2026-05-03T00:01:00Z'),
    ];
    assert.deepEqual(
      conversationsForDay(convs, new Date(2026, 4, 2)).map((c) => c.conversationId),
      ['night', 'noon', 'morning'],
    );
  });
});

test('a note with no time is on no day at all', () => {
  // Not "oldest". A note with no timestamp is unplaced, and dropping it to the
  // bottom of today would be an assertion nobody made.
  inZone('UTC', () => {
    const convs = [conv('a', null), conv('b', 'not a date'), conv('c', '2026-05-02T10:00:00Z'), null as any];
    assert.deepEqual(
      conversationsForDay(convs, new Date(2026, 4, 2)).map((c) => c.conversationId),
      ['c'],
    );
  });
});

test('the day boundary is local, both sides of it', () => {
  inZone('America/Los_Angeles', () => {
    // 07:00Z on the 3rd is 00:00 local on the 3rd; 06:59Z is 23:59 on the 2nd.
    const convs = [conv('just-before', '2026-05-03T06:59:00Z'), conv('just-after', '2026-05-03T07:00:00Z')];
    assert.deepEqual(conversationsForDay(convs, new Date(2026, 4, 2)).map((c) => c.conversationId), ['just-before']);
    assert.deepEqual(conversationsForDay(convs, new Date(2026, 4, 3)).map((c) => c.conversationId), ['just-after']);
  });
});

test('an empty or absent list is an empty day, not a crash', () => {
  assert.deepEqual(conversationsForDay([], new Date()), []);
  assert.deepEqual(conversationsForDay(undefined as any, new Date()), []);
  assert.deepEqual(countsByDay(undefined as any), {});
});

test('conversationsForDay does not reorder or mutate the array it was given', () => {
  inZone('UTC', () => {
    const convs = [conv('a', '2026-05-02T08:00:00Z'), conv('b', '2026-05-02T09:00:00Z')];
    const order = convs.map((c) => c.conversationId);
    conversationsForDay(convs, new Date(2026, 4, 2));
    assert.deepEqual(convs.map((c) => c.conversationId), order, 'the source list was sorted in place');
  });
});

// ── the counts under the dates ──────────────────────────────────────────────

test('THE COUNT UNDER A DATE MATCHES WHAT TAPPING IT OPENS', () => {
  // The number in the strip and the list behind it are computed separately. If
  // they ever disagree -- a count of 3 that opens 2 notes -- the screen stops
  // being trustworthy, and nothing about it looks broken enough to report.
  inZone('America/New_York', () => {
    const convs = [
      conv('a', '2026-05-02T08:00:00Z'),
      conv('b', '2026-05-02T23:00:00Z'),
      conv('c', '2026-05-03T04:00:00Z'), // midnight-ish UTC, still the 2nd in NY
      conv('d', '2026-05-04T12:00:00Z'),
      conv('e', null),
      conv('f', 'garbage'),
    ];
    const counts = countsByDay(convs);
    for (const day of getWeekDates(new Date(2026, 4, 4, 10))) {
      assert.equal(
        counts[dayKey(day)] ?? 0,
        conversationsForDay(convs, day).length,
        `the count and the list disagree on ${dayKey(day)}`,
      );
    }
  });
});
