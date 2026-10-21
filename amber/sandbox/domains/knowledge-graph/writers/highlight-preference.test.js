/**
 * Tests for highlight-preference reranking.
 *
 * Run with:  node --test src/knowledge/highlight-preference.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  applyHighlightPreference,
  HIGHLIGHT_PREFERENCE_DERANK_FACTOR,
} from "./highlight-preference.js";

test("returns input untouched when empty or non-array", () => {
  assert.deepEqual(applyHighlightPreference([]), []);
  assert.deepEqual(applyHighlightPreference(null), []);
  assert.deepEqual(applyHighlightPreference(undefined), []);
});

test("deranks consolidated source chunks below uncovered matches", () => {
  const matches = [
    {
      id: "raw1",
      score: 0.95,
      metadata: { consolidated_into: "dh-2026-05-28-0" },
    },
    { id: "highlight", score: 0.6, metadata: { kind: "daily_highlight" } },
    { id: "raw2", score: 0.5, metadata: {} },
  ];
  const out = applyHighlightPreference(matches);
  // raw1 had the top raw score but is consolidated, so 0.95 * 0.1 = 0.095,
  // which sinks it below the highlight (0.6) and the uncovered chunk (0.5).
  assert.deepEqual(
    out.map((m) => m.id),
    ["highlight", "raw2", "raw1"],
  );
  assert.equal(out[2].deranked, true);
  assert.equal(out[0].deranked, undefined);
});

test("keeps every match (nothing dropped)", () => {
  const matches = [
    { id: "a", score: 0.9, metadata: { consolidated_into: "dh-1" } },
    { id: "b", score: 0.8, metadata: { consolidated_into: "dh-1" } },
  ];
  const out = applyHighlightPreference(matches);
  assert.equal(out.length, 2);
  // Relative order among consolidated chunks is preserved (both deranked by
  // the same factor, original order breaks the tie).
  assert.deepEqual(
    out.map((m) => m.id),
    ["a", "b"],
  );
});

test("derank factor is below 1 so consolidated always sinks", () => {
  assert.ok(HIGHLIGHT_PREFERENCE_DERANK_FACTOR < 1);
  assert.ok(HIGHLIGHT_PREFERENCE_DERANK_FACTOR > 0);
});
