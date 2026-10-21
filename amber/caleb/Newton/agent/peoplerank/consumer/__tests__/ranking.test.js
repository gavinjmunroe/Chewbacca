/**
 * Tests for peoplerank/consumer/ranking.js — the in-process PeopleRank
 * query-ranker. Mirrors peoplerank/tests/test_ranking.py so the JS that runs
 * on the request path stays in lockstep with the Python reference port of the
 * CTO's togari-search scoring/rationale logic.
 *
 * Run with:
 *   node --test Newton/agent/peoplerank/consumer/__tests__/ranking.test.js
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  CONFIDENCE_WEIGHTS,
  computeConfidence,
  confidenceLabel,
  validateRationale,
  scrubAiTells,
  rankCandidates,
} from "../ranking.js";

const candidate = (name, score, opts = {}) => ({
  score,
  name,
  source: opts.source ?? "contacts/linkedin",
  handle: opts.handle ?? "@h",
  external_id: opts.external_id ?? `id-${name}`,
  text: opts.text ?? "a b c d e",
});

// ── Confidence model (ported weights/bands) ──

test("confidence weights match the CTO source", () => {
  assert.deepEqual(CONFIDENCE_WEIGHTS, {
    text_completeness: 0.5,
    structured_coverage: 0.3,
    graph_signal: 0.2,
  });
});

test("computeConfidence is the weighted sum", () => {
  assert.equal(computeConfidence(1, 1, 1), 1);
  assert.equal(computeConfidence(1, 0, 0), 0.5);
  assert.equal(computeConfidence(0, 1, 0), 0.3);
  assert.equal(computeConfidence(0, 0, 1), 0.2);
});

test("confidenceLabel: high has empty reason", () => {
  const { band, reason } = confidenceLabel(0.8, 1, 1, 1);
  assert.equal(band, "high");
  assert.equal(reason, "");
});

test("confidenceLabel: medium names the weakest component", () => {
  const { band, reason } = confidenceLabel(0.5, 0.9, 0.2, 0.9);
  assert.equal(band, "medium");
  assert.match(reason, /structured data/);
});

// ── Rationale validators / scrubber (ported verbatim) ──

test("validateRationale rejects em dash", () => {
  const { ok, reason } = validateRationale("She is great — really great.");
  assert.equal(ok, false);
  assert.equal(reason, "em_dash");
});

test("validateRationale rejects banned substring", () => {
  const { ok, reason } = validateRationale("In a world where contacts matter.");
  assert.equal(ok, false);
  assert.match(reason, /^banned_sub/);
});

test("validateRationale rejects banned pattern", () => {
  const { ok, reason } = validateRationale("They could be a good match here.");
  assert.equal(ok, false);
  assert.match(reason, /^banned_pat/);
});

test("validateRationale accepts clean text", () => {
  const { ok } = validateRationale(
    "Jane shows up from LinkedIn for your query. Strong relevance.",
  );
  assert.equal(ok, true);
});

test("scrubAiTells removes em dash, smart quotes, hedge phrases", () => {
  const out = scrubAiTells("Moreover, he said “hi” — then left");
  assert.ok(!out.includes("—"));
  assert.ok(!out.includes("“") && !out.includes("”"));
  assert.ok(!/^moreover/i.test(out));
});

// ── Ranking ──

test("rankCandidates orders by score desc", () => {
  const ranked = rankCandidates("q", [
    candidate("Low", 0.1),
    candidate("High", 0.95),
    candidate("Mid", 0.55),
  ]);
  assert.deepEqual(ranked.map((r) => r.name), ["High", "Mid", "Low"]);
});

test("rankCandidates output shape", () => {
  const [r] = rankCandidates("q", [candidate("A", 0.9)]);
  for (const k of ["id", "name", "score", "confidence", "rationale", "signals", "source"]) {
    assert.ok(k in r, `missing key ${k}`);
  }
  assert.ok(Array.isArray(r.signals));
  assert.ok(r.confidence >= 0 && r.confidence <= 1);
  assert.ok(r.score >= 0 && r.score <= 100);
});

test("rankCandidates handles empty and null scores", () => {
  assert.deepEqual(rankCandidates("q", []), []);
  const [r] = rankCandidates("q", [candidate("N", null)]);
  assert.ok(r.score >= 0);
});

test("generated rationale always passes the validator", () => {
  const [r] = rankCandidates("founders in NYC", [
    candidate("Jane Doe", 0.82, {
      source: "contacts/linkedin",
      handle: "@jane",
      text: "NYC founder fintech ".repeat(10),
    }),
  ]);
  const { ok, reason } = validateRationale(r.rationale);
  assert.ok(ok, `rationale failed validator: ${reason} :: ${r.rationale}`);
  assert.ok(!r.rationale.includes("—"));
});

test("graph source outranks address book at equal relevance", () => {
  const ranked = rankCandidates("q", [
    candidate("Linked", 0.8, { source: "contacts/linkedin", handle: "@l" }),
    candidate("Apple", 0.8, { source: "contacts/apple", handle: "" }),
  ]);
  assert.equal(ranked[0].name, "Linked");
});
