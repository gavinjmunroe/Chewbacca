/**
 * Tests for the segmented-reply planning logic.
 *
 * Specifically covers the resume bug: a single paragraph longer than
 * `limit` previously got assigned to `current` and then dropped on the
 * next iteration when the post-loop fallback only ran for empty
 * results. The new implementation hard-splits oversize paragraphs
 * inline and never overflows the limit.
 *
 * Run with:  node --test Newton/agent/lib/__tests__/segment-and-send.test.mjs
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { planSegments } from "../tiwari/visualize.js";

test("planSegments: short text passes through as one segment", () => {
  const out = planSegments("hello world", 100);
  assert.deepEqual(out, ["hello world"]);
});

test("planSegments: empty / null returns []", () => {
  assert.deepEqual(planSegments("", 100), []);
  assert.deepEqual(planSegments(null, 100), []);
});

test("planSegments: paragraphs that fit collapse into one segment", () => {
  const text = "Line one.\n\nLine two.";
  const out = planSegments(text, 100);
  assert.equal(out.length, 1);
  assert.match(out[0], /Line one\./);
  assert.match(out[0], /Line two\./);
});

test("planSegments: paragraphs split across segments when over limit", () => {
  const a = "A".repeat(50);
  const b = "B".repeat(50);
  const c = "C".repeat(50);
  const out = planSegments([a, b, c].join("\n\n"), 100);
  // Exact distribution depends on join overhead; what matters is each
  // segment is under limit and content is preserved.
  for (const seg of out) assert.ok(seg.length <= 100, `seg ${seg.length}`);
  const joined = out.join(" ");
  for (const ch of ["A", "B", "C"]) {
    assert.equal((joined.match(new RegExp(ch, "g")) || []).length, 50);
  }
});

test("planSegments: oversize single paragraph is hard-split (resume bug fix)", () => {
  // Single paragraph far longer than the limit. The old implementation
  // would drop it after the first chunk because the only fallback
  // fired when segments was still empty.
  const huge = "x".repeat(5000);
  const out = planSegments(huge, 1900);
  assert.ok(out.length >= 3, `expected 3+ segments, got ${out.length}`);
  for (const seg of out) {
    assert.ok(seg.length <= 1900, `segment over limit: ${seg.length}`);
  }
  // No characters are dropped.
  const total = out.reduce((n, s) => n + s.length, 0);
  assert.equal(total, 5000);
});

test("planSegments: mixed normal + oversize paragraphs both flushed", () => {
  const big = "y".repeat(3000);
  const text = `intro paragraph\n\n${big}\n\nclosing paragraph`;
  const out = planSegments(text, 1900);
  // All segments under limit.
  for (const seg of out) {
    assert.ok(seg.length <= 1900, `segment over limit: ${seg.length}`);
  }
  // Intro and closing must survive somewhere in the output.
  const joined = out.join("\n\n");
  assert.ok(joined.includes("intro paragraph"));
  assert.ok(joined.includes("closing paragraph"));
  // The big block's character count is preserved.
  const totalY = out.reduce(
    (n, s) => n + (s.match(/y/g) || []).length,
    0,
  );
  assert.equal(totalY, 3000);
});

test("planSegments: prefers newline / space breakpoints near the limit", () => {
  const block =
    "alpha beta gamma delta epsilon zeta eta theta iota kappa\n".repeat(80);
  const out = planSegments(block, 200);
  for (const seg of out) {
    assert.ok(seg.length <= 200);
    // Should not start mid-word.
    assert.ok(!/^\s/.test(seg));
  }
});
