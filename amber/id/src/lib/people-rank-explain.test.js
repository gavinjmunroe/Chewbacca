/**
 * Tests for grounded PeopleRank explainability (item 161).
 *
 * Run with:  node --test src/lib/people-rank-explain.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { explainRank } from "./people-rank-explain.js";

const DAY = 86400000;
const NOW = 1_750_000_000_000; // fixed clock for deterministic day math

test("recency is grounded in the real last-touch date", () => {
  const { reason, factors } = explainRank({
    components: { warmth: 0.2, recency: 0.9 },
    lastContactMs: NOW - 3 * DAY,
    nowMs: NOW,
  });
  const recency = factors.find((f) => f.key === "recency");
  assert.equal(recency.detail, "3 days ago");
  assert.match(reason, /Last spoke 3 days ago/);
});

test("warmth surfaces the actual relationship percentage", () => {
  const { factors } = explainRank({
    components: { warmth: 0.8 },
    relationshipScore: 0.82,
    nowMs: NOW,
  });
  const warmth = factors.find((f) => f.key === "warmth");
  assert.equal(warmth.label, "Relationship strength");
  assert.equal(warmth.detail, "82%");
});

test("warmth falls back to message cadence when no relationship score", () => {
  const { factors } = explainRank({
    components: { warmth: 0.5 },
    messageFrequency: 4.2,
    nowMs: NOW,
  });
  const warmth = factors.find((f) => f.key === "warmth");
  assert.equal(warmth.label, "Message cadence");
  assert.equal(warmth.detail, "~4.2/week");
});

test("engagement appears only when the user has confirmed", () => {
  const withEng = explainRank({
    components: { warmth: 0.3 },
    engagement: 0.8,
    nowMs: NOW,
  });
  assert.ok(withEng.factors.some((f) => f.key === "engagement"));
  const noEng = explainRank({
    components: { warmth: 0.3 },
    engagement: 0.1,
    nowMs: NOW,
  });
  assert.ok(!noEng.factors.some((f) => f.key === "engagement"));
});

test("web momentum is grounded in a real source count", () => {
  const { factors } = explainRank({
    components: { warmth: 0.3 },
    signals: { momentum: 2 },
    nowMs: NOW,
  });
  const m = factors.find((f) => f.key === "momentum");
  assert.equal(m.detail, "2 fresh sources");
});

test("no signals -> honest limited-signal line, empty-ish factors", () => {
  const { reason, factors } = explainRank({ components: {}, nowMs: NOW });
  assert.equal(reason, "Limited recent signal");
  assert.equal(factors.length, 0);
});

test("reason picks the two highest-weighted grounded facts", () => {
  const { reason } = explainRank({
    components: { warmth: 0.9, recency: 0.95 },
    lastContactMs: NOW - 1 * DAY,
    relationshipScore: 0.9,
    nowMs: NOW,
  });
  // Two clauses joined by the middot separator.
  assert.match(reason, / · /);
});

test("today / yesterday are humanized", () => {
  const today = explainRank({
    components: { recency: 1 },
    lastContactMs: NOW,
    nowMs: NOW,
  });
  assert.equal(today.factors.find((f) => f.key === "recency").detail, "today");
  const yesterday = explainRank({
    components: { recency: 1 },
    lastContactMs: NOW - 1 * DAY,
    nowMs: NOW,
  });
  assert.equal(
    yesterday.factors.find((f) => f.key === "recency").detail,
    "yesterday",
  );
});
