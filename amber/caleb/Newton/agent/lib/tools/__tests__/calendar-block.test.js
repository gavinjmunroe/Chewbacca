/**
 * Tests for lib/tools/calendar-block.js — Tab 25 block scheduling + focus time.
 *
 * Covers the pure, network-free helpers that carry the scheduling logic:
 *   - mergeBusy: overlapping/adjacent busy intervals collapse correctly.
 *   - freeGapsInWindow: gaps that fit a duration are found; packed windows
 *     return nothing; a leading/trailing free span is detected.
 *   - stripEmoji: focus-block titles come out emoji-free (CLAUDE rule).
 *   - date helpers: PT date math + day-hour boundaries resolve PST/PDT.
 *
 * Run with:
 *   node --test Newton/agent/lib/tools/__tests__/calendar-block.test.js
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  mergeBusy,
  freeGapsInWindow,
  stripEmoji,
  ptDateString,
  addDaysToDateStr,
  ptDayHourMs,
  CALENDAR_BLOCK_TOOLS,
  CALENDAR_BLOCK_TOOL_NAMES,
} from "../calendar-block.js";

// ── mergeBusy ───────────────────────────────────────────────────────────────

test("mergeBusy: collapses overlapping intervals", () => {
  const merged = mergeBusy([
    { start: 0, end: 100 },
    { start: 50, end: 150 },
    { start: 200, end: 300 },
  ]);
  assert.deepEqual(merged, [
    { start: 0, end: 150 },
    { start: 200, end: 300 },
  ]);
});

test("mergeBusy: collapses adjacent (touching) intervals", () => {
  const merged = mergeBusy([
    { start: 0, end: 100 },
    { start: 100, end: 200 },
  ]);
  assert.deepEqual(merged, [{ start: 0, end: 200 }]);
});

test("mergeBusy: sorts out-of-order input and drops zero/negative spans", () => {
  const merged = mergeBusy([
    { start: 300, end: 400 },
    { start: 0, end: 100 },
    { start: 500, end: 500 }, // zero-length, dropped
    { start: 700, end: 600 }, // inverted, dropped
  ]);
  assert.deepEqual(merged, [
    { start: 0, end: 100 },
    { start: 300, end: 400 },
  ]);
});

// ── freeGapsInWindow ──────────────────────────────────────────────────────────

const MIN = 60 * 1000;

test("freeGapsInWindow: finds a gap between two meetings", () => {
  // Window 0..600min. Busy 60..120 and 300..360. A 60-min block fits in the
  // 120..300 gap (and also 0..60, and 360..600).
  const gaps = freeGapsInWindow(
    0,
    600 * MIN,
    [
      { start: 60 * MIN, end: 120 * MIN },
      { start: 300 * MIN, end: 360 * MIN },
    ],
    60 * MIN,
  );
  // First gap is the leading free span 0..60.
  assert.equal(gaps[0].start, 0);
  assert.equal(gaps[0].end, 60 * MIN);
  // A gap anchored at 120 (after first meeting) must exist.
  assert.ok(gaps.some((g) => g.start === 120 * MIN));
});

test("freeGapsInWindow: returns nothing when the window is fully busy", () => {
  const gaps = freeGapsInWindow(
    0,
    120 * MIN,
    [{ start: 0, end: 120 * MIN }],
    30 * MIN,
  );
  assert.deepEqual(gaps, []);
});

test("freeGapsInWindow: returns nothing when no gap is long enough", () => {
  // Two 30-min gaps around a meeting, but we need 60 min.
  const gaps = freeGapsInWindow(
    0,
    90 * MIN,
    [{ start: 30 * MIN, end: 60 * MIN }],
    60 * MIN,
  );
  assert.deepEqual(gaps, []);
});

test("freeGapsInWindow: empty calendar yields one block at the window start", () => {
  const gaps = freeGapsInWindow(0, 120 * MIN, [], 60 * MIN);
  assert.equal(gaps.length, 1);
  assert.equal(gaps[0].start, 0);
  assert.equal(gaps[0].end, 60 * MIN);
});

test("freeGapsInWindow: window shorter than duration yields nothing", () => {
  const gaps = freeGapsInWindow(0, 30 * MIN, [], 60 * MIN);
  assert.deepEqual(gaps, []);
});

// ── stripEmoji ────────────────────────────────────────────────────────────────

test("stripEmoji: removes emoji from a title", () => {
  assert.equal(stripEmoji("Deep work \u{1F9E0}\u{1F525}"), "Deep work");
});

test("stripEmoji: leaves a clean title untouched", () => {
  assert.equal(stripEmoji("Newsletter writing"), "Newsletter writing");
});

test("stripEmoji: collapses the double space left behind", () => {
  assert.equal(stripEmoji("Focus \u{1F4DD} time"), "Focus time");
});

// ── Date helpers ──────────────────────────────────────────────────────────────

test("addDaysToDateStr: simple increment", () => {
  assert.equal(addDaysToDateStr("2026-05-30", 1), "2026-05-31");
});

test("addDaysToDateStr: rolls over month boundary", () => {
  assert.equal(addDaysToDateStr("2026-05-31", 1), "2026-06-01");
});

test("addDaysToDateStr: handles negative offsets", () => {
  assert.equal(addDaysToDateStr("2026-06-01", -1), "2026-05-31");
});

test("ptDateString: returns YYYY-MM-DD for a known PT moment", () => {
  // 2026-05-30T20:00:00Z is 1pm PDT on 2026-05-30.
  assert.equal(ptDateString(new Date("2026-05-30T20:00:00Z")), "2026-05-30");
});

test("ptDayHourMs: 9am PDT resolves to the correct UTC instant", () => {
  // PDT is UTC-7, so 9am PT on a summer day == 16:00Z.
  const ms = ptDayHourMs("2026-07-15", 9);
  assert.equal(new Date(ms).toISOString(), "2026-07-15T16:00:00.000Z");
});

test("ptDayHourMs: 9am PST resolves to the correct UTC instant", () => {
  // PST is UTC-8, so 9am PT on a winter day == 17:00Z.
  const ms = ptDayHourMs("2026-01-15", 9);
  assert.equal(new Date(ms).toISOString(), "2026-01-15T17:00:00.000Z");
});

// ── Tool schema wiring ────────────────────────────────────────────────────────

test("CALENDAR_BLOCK_TOOLS exposes the three Tab 25 tools", () => {
  const names = CALENDAR_BLOCK_TOOLS.map((t) => t.name).sort();
  assert.deepEqual(names, [
    "find_free_block",
    "propose_reschedule",
    "schedule_focus_block",
  ]);
});

test("every tool has a name, description, and input_schema", () => {
  for (const tool of CALENDAR_BLOCK_TOOLS) {
    assert.ok(tool.name, "tool has a name");
    assert.ok(tool.description.length > 20, "tool has a real description");
    assert.equal(tool.input_schema.type, "object");
  }
});

test("CALENDAR_BLOCK_TOOL_NAMES matches the schema names", () => {
  for (const tool of CALENDAR_BLOCK_TOOLS) {
    assert.ok(CALENDAR_BLOCK_TOOL_NAMES.has(tool.name));
  }
  assert.equal(CALENDAR_BLOCK_TOOL_NAMES.size, CALENDAR_BLOCK_TOOLS.length);
});

test("no tool description contains an em dash or emoji", () => {
  const emDash = /—/;
  const emoji = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
  for (const tool of CALENDAR_BLOCK_TOOLS) {
    assert.ok(!emDash.test(tool.description), `${tool.name} has an em dash`);
    assert.ok(!emoji.test(tool.description), `${tool.name} has an emoji`);
  }
});
