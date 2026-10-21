/**
 * Tests for checkin-schedule.js (pure helpers).
 *
 * Run with: node --test Newton/agent/lib/__tests__/checkin-schedule.test.mjs
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  defaultSagarSchedule,
  resolveSchedule,
  targetMinutesForWindow,
  shouldFireNow,
  nextFireTimeForWindow,
  localPartsAt,
} from "../checkin-schedule.js";

// ── targetMinutesForWindow ───────────────────────────────────────────────

test("targetMinutesForWindow: morning = wake + offset", () => {
  const schedule = defaultSagarSchedule("07:00");
  assert.equal(targetMinutesForWindow("morning", schedule), 7 * 60 + 5);
});

test("targetMinutesForWindow: nightly anchors to wake with negative offset", () => {
  const schedule = defaultSagarSchedule("07:00");
  // 07:00 - 485 min = wraps backward to 22:55 the prior day.
  const expected = (((7 * 60 - 485) % 1440) + 1440) % 1440;
  assert.equal(targetMinutesForWindow("nightly", schedule), expected);
  assert.equal(expected, 22 * 60 + 55);
});

test("targetMinutesForWindow: sunday uses absolute time", () => {
  const schedule = defaultSagarSchedule("07:00");
  assert.equal(targetMinutesForWindow("sunday", schedule), 7 * 60);
});

test("targetMinutesForWindow: disabled window returns null", () => {
  const schedule = defaultSagarSchedule("07:00");
  schedule.morning.enabled = false;
  assert.equal(targetMinutesForWindow("morning", schedule), null);
});

// ── shouldFireNow ────────────────────────────────────────────────────────

test("shouldFireNow: master enabled=false returns false even if in window", () => {
  const schedule = defaultSagarSchedule("07:00");
  schedule.enabled = false;
  // Pick any time
  const now = new Date("2026-06-01T14:07:00Z"); // 07:07 PT
  assert.equal(shouldFireNow("morning", schedule, now), false);
});

test("shouldFireNow: morning fires inside [07:05, 07:10) PT", () => {
  const schedule = defaultSagarSchedule("07:00");
  // 2026-06-01 is a Monday, PT is UTC-7 in June.
  // 14:06 UTC = 07:06 PT — inside [07:05, 07:10).
  const inside = new Date("2026-06-01T14:06:00Z");
  assert.equal(shouldFireNow("morning", schedule, inside), true);
});

test("shouldFireNow: morning does NOT fire before target", () => {
  const schedule = defaultSagarSchedule("07:00");
  // 14:04 UTC = 07:04 PT — one minute before 07:05.
  const before = new Date("2026-06-01T14:04:00Z");
  assert.equal(shouldFireNow("morning", schedule, before), false);
});

test("shouldFireNow: morning does NOT fire after window", () => {
  const schedule = defaultSagarSchedule("07:00");
  // 14:10 UTC = 07:10 PT — boundary, window is [07:05, 07:10).
  const after = new Date("2026-06-01T14:10:00Z");
  assert.equal(shouldFireNow("morning", schedule, after), false);
});

test("shouldFireNow: sunday fires only on Sundays", () => {
  const schedule = defaultSagarSchedule("07:00");
  // 2026-06-01 = Monday. 14:00 UTC = 07:00 PT.
  const monday = new Date("2026-06-01T14:00:00Z");
  assert.equal(shouldFireNow("sunday", schedule, monday), false);
  // 2026-05-31 = Sunday. 14:00 UTC = 07:00 PT.
  const sunday = new Date("2026-05-31T14:00:00Z");
  assert.equal(shouldFireNow("sunday", schedule, sunday), true);
});

test("shouldFireNow: nightly fires at wake-485 (22:55 PT)", () => {
  const schedule = defaultSagarSchedule("07:00");
  // 06:55 UTC next day = 22:55 PT current day (PT is UTC-7 in June).
  const inside = new Date("2026-06-02T05:57:00Z"); // 22:57 PT 6/1
  assert.equal(shouldFireNow("nightly", schedule, inside), true);
});

// ── nextFireTimeForWindow ────────────────────────────────────────────────

test("nextFireTimeForWindow: returns absolute Date in future for morning", () => {
  const schedule = defaultSagarSchedule("07:00");
  const now = new Date("2026-06-01T14:00:00Z"); // 07:00 PT — before 07:05 target
  const next = nextFireTimeForWindow("morning", schedule, now);
  assert.ok(next instanceof Date);
  assert.ok(next.getTime() > now.getTime());
  const local = localPartsAt(next, schedule.timezone);
  assert.equal(local.hour, 7);
  assert.equal(local.minute, 5);
});

test("nextFireTimeForWindow: sunday lands on next Sunday", () => {
  const schedule = defaultSagarSchedule("07:00");
  const monday = new Date("2026-06-01T14:00:00Z");
  const next = nextFireTimeForWindow("sunday", schedule, monday);
  assert.ok(next instanceof Date);
  const local = localPartsAt(next, schedule.timezone);
  assert.equal(local.dayOfWeek, 0, "must be Sunday");
  assert.equal(local.hour, 7);
  assert.equal(local.minute, 0);
});

test("nextFireTimeForWindow: disabled master returns null", () => {
  const schedule = defaultSagarSchedule("07:00");
  schedule.enabled = false;
  assert.equal(nextFireTimeForWindow("morning", schedule, new Date()), null);
});

// ── resolveSchedule ──────────────────────────────────────────────────────

test("resolveSchedule: returns null when missing", () => {
  assert.equal(resolveSchedule(null), null);
  assert.equal(resolveSchedule({}), null);
  assert.equal(resolveSchedule({ checkInSchedule: "not-an-object" }), null);
});

test("resolveSchedule: returns the schedule object when present", () => {
  const s = defaultSagarSchedule("07:00");
  assert.equal(resolveSchedule({ checkInSchedule: s }), s);
});

// ── defaultSagarSchedule ─────────────────────────────────────────────────

test("defaultSagarSchedule: morning=emotional, nightly=physical, sunday=spiritual", () => {
  const s = defaultSagarSchedule("07:30");
  assert.equal(s.wakeAlarmTime, "07:30");
  assert.deepEqual(s.morning.dimensions, ["emotional"]);
  assert.deepEqual(s.nightly.dimensions, ["physical"]);
  assert.deepEqual(s.sunday.dimensions, ["spiritual"]);
  assert.equal(s.morning.offsetMinutes, 5);
  assert.equal(s.nightly.offsetMinutes, -485);
  assert.equal(s.nightly.anchor, "wake_alarm");
});
