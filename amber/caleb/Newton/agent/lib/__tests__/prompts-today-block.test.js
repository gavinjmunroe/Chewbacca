/**
 * Tests for buildTodayBlock — the date-injection block prepended to every
 * Medha system prompt. Regression coverage for the bug where Medha called
 * "today" the server's UTC day (e.g. saying "today, May 28" at 11pm PT on
 * May 27).
 *
 * Run with:
 *   node --test Newton/agent/lib/__tests__/prompts-today-block.test.js
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { buildTodayBlock } from "../prompts.js";

// May 27, 2026 at 23:00 UTC. In PT that is 4pm PT on May 27. In UTC it is
// already May 27 but later; in NY it is 7pm May 27. This is the trivial case.
const PT_AFTERNOON = new Date("2026-05-27T23:00:00Z");

// May 28, 2026 at 04:00 UTC. In PT this is 9pm on May 27. The bug Medha hit:
// without the block she would call this May 28 because the server is UTC.
const PT_EVENING = new Date("2026-05-28T04:00:00Z");

// March 8, 2026 at 11:00 UTC — the morning after PT springs forward (DST
// transition was at 2am PT March 8 → 3am PT). Tests that DST math is right.
const PT_DST_MORNING = new Date("2026-03-08T11:00:00Z");

test("buildTodayBlock anchors today to the user's PT day during the UTC-rollover window", () => {
  const block = buildTodayBlock(null, PT_EVENING);
  assert.match(block, /America\/Los_Angeles/);
  // It is 9pm PT on May 27 — today must be May 27, not May 28.
  assert.match(block, /Today: Wednesday, May 27, 2026 \(2026-05-27\)/);
  assert.match(block, /Yesterday: Tuesday, May 26, 2026 \(2026-05-26\)/);
  assert.match(block, /Tomorrow: Thursday, May 28, 2026 \(2026-05-28\)/);
});

test("buildTodayBlock formats today correctly when UTC and PT agree on the date", () => {
  const block = buildTodayBlock(null, PT_AFTERNOON);
  assert.match(block, /Today: Wednesday, May 27, 2026 \(2026-05-27\)/);
});

test("buildTodayBlock includes the right-now time with a PT zone label", () => {
  const block = buildTodayBlock(null, PT_EVENING);
  // 9:00 PM PT, "PDT" because California is in PDT in May.
  assert.match(block, /Right now: 9:00 PM PDT/);
});

test("buildTodayBlock respects tenant.timezone when provided", () => {
  const block = buildTodayBlock({ timezone: "America/New_York" }, PT_EVENING);
  // 9pm PT on May 27 is 12am ET on May 28.
  assert.match(block, /America\/New_York/);
  assert.match(block, /Today: Thursday, May 28, 2026 \(2026-05-28\)/);
});

test("buildTodayBlock handles the PT spring-forward DST transition", () => {
  const block = buildTodayBlock(null, PT_DST_MORNING);
  // 11:00 UTC on March 8, 2026 is 4:00 AM PDT (after spring-forward). The
  // date label must be March 8 in PT, and the zone must read PDT, not PST.
  assert.match(block, /Today: Sunday, March 8, 2026 \(2026-03-08\)/);
  assert.match(block, /Right now: 4:00 AM PDT/);
});

test("buildTodayBlock instructs the model to ignore the server clock", () => {
  const block = buildTodayBlock(null, PT_EVENING);
  // The whole point of the block — make sure the instruction is there.
  assert.match(block, /do NOT use the server clock for "today"/);
});
