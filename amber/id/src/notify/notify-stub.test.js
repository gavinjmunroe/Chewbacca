/**
 * Unit tests for the NOTIFY decision predicate
 * (src/notify/notify-stub.js, items 175, 177).
 *
 * No network. Run with:  node --test src/notify/notify-stub.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { evaluateEnrichmentForNotify, NOTIFY_FUNCTION } from "./notify-stub.js";

const NOW = Date.parse("2026-06-02T00:00:00Z");

function okEnrichment(over = {}) {
  return {
    status: "ok",
    contactId: "c_1",
    name: "Priya Nair",
    whats_new: null,
    signals: { recency: null, momentum: 0, social_links: {}, top_sources: [] },
    ...over,
  };
}

test("declines when the enrichment is not ok", () => {
  const intent = evaluateEnrichmentForNotify({
    status: "error",
    contactId: "c_9",
  });
  assert.equal(intent.shouldNotify, false);
  assert.equal(intent.reason, "no_enrichment");
  assert.equal(intent.contactId, "c_9");
  assert.equal(intent.source, NOTIFY_FUNCTION);
});

test("detects a job change from the brief at high salience", () => {
  const intent = evaluateEnrichmentForNotify(
    okEnrichment({ whats_new: "Priya Nair joined Acme as VP of Engineering." }),
    { nowMs: NOW },
  );
  assert.equal(intent.shouldNotify, true);
  assert.equal(intent.reason, "job_change");
  assert.equal(intent.salience, "high");
  assert.ok(intent.headline && intent.headline.length > 0);
});

test("detects funding and acquisition", () => {
  const funding = evaluateEnrichmentForNotify(
    okEnrichment({
      whats_new: "Her startup raised a Series B led by Sequoia.",
    }),
    { nowMs: NOW },
  );
  assert.equal(funding.reason, "funding");
  assert.equal(funding.salience, "high");

  const acq = evaluateEnrichmentForNotify(
    okEnrichment({
      whats_new: "The company was acquired by Globex this week.",
    }),
    { nowMs: NOW },
  );
  assert.equal(acq.reason, "acquisition");
});

test("momentum spike on fresh sources fires even without an event phrase", () => {
  const intent = evaluateEnrichmentForNotify(
    okEnrichment({
      whats_new: "Priya has been speaking and writing a lot lately.",
      signals: {
        recency: NOW - 5 * 24 * 60 * 60 * 1000,
        momentum: 4,
        social_links: {},
        top_sources: [],
      },
    }),
    { nowMs: NOW },
  );
  assert.equal(intent.shouldNotify, true);
  assert.equal(intent.reason, "momentum_spike");
  assert.equal(intent.salience, "low");
});

test("declines a quiet enrichment with no event and no spike", () => {
  const intent = evaluateEnrichmentForNotify(
    okEnrichment({ whats_new: "Priya continues to lead engineering at Acme." }),
    { nowMs: NOW },
  );
  assert.equal(intent.shouldNotify, false);
  assert.equal(intent.reason, "not_noteworthy");
});

test("declines when the brief is unchanged from the prior known state", () => {
  const whats = "Priya Nair joined Acme as VP of Engineering.";
  const intent = evaluateEnrichmentForNotify(
    okEnrichment({ whats_new: whats }),
    {
      prior: { whats_new: whats },
      nowMs: NOW,
    },
  );
  assert.equal(intent.shouldNotify, false);
  assert.equal(intent.reason, "unchanged");
});

test("the returned intent is frozen and fully shaped", () => {
  const intent = evaluateEnrichmentForNotify(okEnrichment());
  assert.ok(Object.isFrozen(intent));
  for (const k of [
    "contactId",
    "shouldNotify",
    "reason",
    "salience",
    "headline",
    "source",
  ]) {
    assert.ok(k in intent, `missing ${k}`);
  }
});
