/**
 * Tests for lib/tools/gcal/window.js — PT-aware normalization of the
 * time_min / time_max bounds the LLM passes to list_events and
 * get_availability.
 *
 * Regression target: "May 28"-style queries used to drop every PT-evening
 * event because Google read naked ISO strings as UTC. Each test below
 * pins one of the rules described in window.js's header doc.
 *
 * Run with:
 *   node --test Newton/agent/lib/tools/gcal/__tests__/window.test.js
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  getPtOffsetForDate,
  hasExplicitOffset,
  normalizeWindowBound,
} from "../window.js";

// ── getPtOffsetForDate ─────────────────────────────────────────────────────

test("getPtOffsetForDate: summer date returns PDT (-07:00)", () => {
  assert.equal(getPtOffsetForDate("2026-07-15"), "-07:00");
});

test("getPtOffsetForDate: winter date returns PST (-08:00)", () => {
  assert.equal(getPtOffsetForDate("2026-01-15"), "-08:00");
});

test("getPtOffsetForDate: late-May date is in PDT", () => {
  // The original bug Caleb hit was on 2026-05-28 — confirm we resolve PDT.
  assert.equal(getPtOffsetForDate("2026-05-28"), "-07:00");
});

test("getPtOffsetForDate: handles a naked datetime input", () => {
  assert.equal(getPtOffsetForDate("2026-05-28T20:00:00"), "-07:00");
  assert.equal(getPtOffsetForDate("2026-01-15T20:00:00"), "-08:00");
});

test("getPtOffsetForDate: handles a Date object", () => {
  // 2026-07-15T12:00:00Z — squarely inside PDT.
  assert.equal(getPtOffsetForDate(new Date("2026-07-15T12:00:00Z")), "-07:00");
});

// ── hasExplicitOffset ──────────────────────────────────────────────────────

test("hasExplicitOffset: trailing Z is explicit", () => {
  assert.equal(hasExplicitOffset("2026-05-28T00:00:00Z"), true);
});

test("hasExplicitOffset: numeric offset is explicit", () => {
  assert.equal(hasExplicitOffset("2026-05-28T00:00:00-07:00"), true);
  assert.equal(hasExplicitOffset("2026-05-28T00:00:00+05:30"), true);
});

test("hasExplicitOffset: naked datetime is NOT explicit", () => {
  assert.equal(hasExplicitOffset("2026-05-28T00:00:00"), false);
});

test("hasExplicitOffset: date-only is NOT explicit", () => {
  assert.equal(hasExplicitOffset("2026-05-28"), false);
});

// ── normalizeWindowBound: pass-throughs ────────────────────────────────────

test("normalizeWindowBound: ISO with Z passes through unchanged", () => {
  const input = "2026-05-28T00:00:00Z";
  assert.equal(normalizeWindowBound(input, "min"), input);
  assert.equal(normalizeWindowBound(input, "max"), input);
});

test("normalizeWindowBound: ISO with explicit offset passes through unchanged", () => {
  const input = "2026-05-28T23:00:00-07:00";
  assert.equal(normalizeWindowBound(input, "min"), input);
});

test("normalizeWindowBound: undefined/null/empty pass through", () => {
  assert.equal(normalizeWindowBound(undefined, "min"), undefined);
  assert.equal(normalizeWindowBound(null, "min"), null);
  assert.equal(normalizeWindowBound("", "min"), "");
});

// ── normalizeWindowBound: date-only expansion (the bug) ───────────────────

test("normalizeWindowBound: date-only as 'min' expands to PT start-of-day", () => {
  // 2026-05-28 in PDT (May, so -07:00).
  assert.equal(
    normalizeWindowBound("2026-05-28", "min"),
    "2026-05-28T00:00:00-07:00",
  );
});

test("normalizeWindowBound: date-only as 'max' expands to PT end-of-day", () => {
  assert.equal(
    normalizeWindowBound("2026-05-28", "max"),
    "2026-05-28T23:59:59-07:00",
  );
});

test("normalizeWindowBound: date-only in PST (January) gets -08:00 offset", () => {
  assert.equal(
    normalizeWindowBound("2026-01-15", "min"),
    "2026-01-15T00:00:00-08:00",
  );
  assert.equal(
    normalizeWindowBound("2026-01-15", "max"),
    "2026-01-15T23:59:59-08:00",
  );
});

// ── normalizeWindowBound: naked datetime gets PT offset appended ──────────

test("normalizeWindowBound: naked PDT datetime gets -07:00 appended", () => {
  assert.equal(
    normalizeWindowBound("2026-05-28T00:00:00", "min"),
    "2026-05-28T00:00:00-07:00",
  );
  assert.equal(
    normalizeWindowBound("2026-05-28T23:59:59", "max"),
    "2026-05-28T23:59:59-07:00",
  );
});

test("normalizeWindowBound: naked PST datetime gets -08:00 appended", () => {
  assert.equal(
    normalizeWindowBound("2026-01-15T19:00:00", "min"),
    "2026-01-15T19:00:00-08:00",
  );
});

test("normalizeWindowBound: naked datetime without seconds still works", () => {
  assert.equal(
    normalizeWindowBound("2026-05-28T08:30", "min"),
    "2026-05-28T08:30-07:00",
  );
});

// ── Regression: the original "May 28 query missed evening events" bug ────

test("regression: a 'May 28' day window covers PT-evening events", () => {
  const minStr = normalizeWindowBound("2026-05-28", "min");
  const maxStr = normalizeWindowBound("2026-05-28", "max");

  // 8pm PT on May 28 (= 2026-05-29T03:00:00Z).
  const evening = new Date("2026-05-29T03:00:00Z");
  const min = new Date(minStr);
  const max = new Date(maxStr);

  assert.ok(
    evening.getTime() >= min.getTime(),
    `PT evening event should fall on/after min bound. min=${minStr}, evening=${evening.toISOString()}`,
  );
  assert.ok(
    evening.getTime() <= max.getTime(),
    `PT evening event should fall on/before max bound. max=${maxStr}, evening=${evening.toISOString()}`,
  );
});

test("regression: pre-fix behavior (naked datetime read as UTC) would have missed PT-evening events", () => {
  // What the OLD code did: send "2026-05-28T00:00:00" / "2026-05-28T23:59:59"
  // straight through, which Google interprets as UTC. The resulting window
  // ends at UTC 23:59 May 28 = PT 16:59 May 28, missing a PT 8pm event.
  const buggyMaxAsUtc = new Date("2026-05-28T23:59:59Z");
  const ptEveningEvent = new Date("2026-05-29T03:00:00Z"); // 8pm PT May 28
  assert.ok(
    ptEveningEvent.getTime() > buggyMaxAsUtc.getTime(),
    "Sanity check: under the old UTC interpretation, an 8pm PT event on May 28 falls outside the window — which is exactly the bug we just fixed.",
  );

  // And confirm the new normalizer puts it INSIDE.
  const fixedMax = new Date(normalizeWindowBound("2026-05-28", "max"));
  assert.ok(
    ptEveningEvent.getTime() <= fixedMax.getTime(),
    "The fix should make the PT-evening event fall inside the normalized window.",
  );
});
