import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calendarWindow,
  monthDates,
  moveCalendarDay,
  moveCalendarMonth,
  selectedWeekIndex,
} from './calendarNavigation.ts';
import { dayKey, getWeekDates } from './calendarStrip.ts';
test('expanded month aligns with the same dates as the collapsed selected week', () => {
  for (const day of [new Date(2026, 8, 21), new Date(2026, 7, 31), new Date(2027, 0, 1)]) {
    const grid = monthDates(day);
    const week = selectedWeekIndex(day, day);
    assert.deepEqual(grid.slice(week * 7, week * 7 + 7).map(dayKey), getWeekDates(day).map(dayKey));
    assert.equal(grid.length, 42);
    assert.equal(new Set(grid.map(dayKey)).size, 42);
  }
});
test('month navigation does not skip February when starting on January 31', () => {
  assert.equal(dayKey(moveCalendarMonth(new Date(2028, 0, 31), 1)), '2028-02-01');
  assert.ok(monthDates(new Date(2028, 1, 1)).some((d) => dayKey(d) === '2028-02-29'));
});
test('week navigation crosses year and daylight-saving boundaries as seven calendar days', () => {
  assert.equal(dayKey(moveCalendarDay(new Date(2026, 11, 29), 7)), '2027-01-05');
  for (const zone of ['America/Los_Angeles', 'Europe/London', 'Asia/Kolkata']) {
    const prior = process.env.TZ;
    process.env.TZ = zone;
    try {
      const day = new Date(2026, 2, 6, 23);
      assert.equal(dayKey(moveCalendarDay(day, 7)), '2026-03-13');
      assert.equal(dayKey(moveCalendarDay(moveCalendarDay(day, 7), -7)), '2026-03-06');
    } finally {
      if (prior) process.env.TZ = prior;
      else delete process.env.TZ;
    }
  }
});

test('upcoming crosses months and includes thirty local dates across DST', () => {
  const prior = process.env.TZ;
  process.env.TZ = 'America/Los_Angeles';
  try {
    const day = new Date(2026, 9, 20, 17);
    const upcoming = calendarWindow(day, 'upcoming');
    assert.equal(dayKey(new Date(upcoming.start)), '2026-10-20');
    assert.equal(dayKey(new Date(upcoming.end)), '2026-11-19');
    assert.equal((upcoming.end - upcoming.start) / 3600000, 721);
    const focused = calendarWindow(new Date(2026, 10, 1), 'day');
    assert.equal((focused.end - focused.start) / 3600000, 25);
    assert.equal(new Date(focused.end).getHours(), 0);
    assert.equal(dayKey(day), '2026-10-20');
  } finally {
    if (prior) process.env.TZ = prior;
    else delete process.env.TZ;
  }
});
