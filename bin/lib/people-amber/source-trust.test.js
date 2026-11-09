/**
 * THE RULES THAT DECIDE WHOSE VALUE SURVIVES.
 *
 * Every one of these is a bug somebody would otherwise report as "the app keeps
 * changing my contacts back".
 *
 * Run with:  node --test src/lib/source-trust.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  TRUST,
  UNKNOWN_TRUST,
  trustOf,
  normalizeSource,
  canOverwrite,
  resolveField,
  knownSources,
} from "./source-trust.js";

test("an unrecognized source has the least power, not the most", () => {
  // The direction this fails in matters more than the value. A new integration
  // wired up by someone who never opened this file must be able to ADD and never
  // to DESTROY, so unknown has to sort to the bottom.
  assert.equal(trustOf("some_integration_shipped_next_tuesday"), UNKNOWN_TRUST);
  assert.equal(UNKNOWN_TRUST, TRUST.VENDOR);
  assert.equal(canOverwrite("brand_new_thing", "manual"), false);
  assert.equal(canOverwrite("brand_new_thing", "apple"), false);
});

test("a vendor cannot undo what the person typed", () => {
  const r = resolveField(
    { value: "Stripe", source: "clay" },
    { value: "Acme Corp", source: "manual" },
  );
  assert.equal(r.value, "Acme Corp");
  assert.equal(r.reason, "lower_trust");
});

test("a vendor CAN fill a blank, which is the whole point of enrichment", () => {
  const r = resolveField(
    { value: "Stripe", source: "clay" },
    { value: null, source: "manual" },
  );
  assert.equal(r.value, "Stripe");
  assert.equal(r.reason, "filled_blank");
});

test("the person outranks their own connected accounts", () => {
  // Someone fixes a job title Apple had wrong. The next Apple sync must not
  // put it back.
  assert.equal(canOverwrite("manual", "apple"), true);
  assert.equal(canOverwrite("apple", "manual"), false);
});

test("a source restating its own card may rename; a different card may not", () => {
  // Renaming a contact in Apple Contacts has to rename it here -- that is the
  // authoritative case. But a SECOND Apple-tier card merging in is enrichment
  // from elsewhere and may only fill blanks, or a merge would silently rename
  // the person you have been looking at.
  assert.equal(canOverwrite("apple", "apple", { authoritative: true }), true);
  assert.equal(canOverwrite("apple", "apple", { authoritative: false }), false);
  assert.equal(canOverwrite("google", "apple", { authoritative: false }), false);
});

test("suffixed labels fold to their stem instead of falling off the bottom", () => {
  // `slack-thread-2026-05-26` was a real label in the database. Left unfolded it
  // is an unknown source, so a Slack-sourced contact would quietly lose every
  // argument to a vendor row.
  assert.equal(normalizeSource("slack-thread-2026-05-26"), "slack");
  assert.equal(trustOf("slack-thread-2026-05-26"), TRUST.OWNER_SYNCED);
  assert.equal(normalizeSource("GOOGLE"), "google");
  assert.equal(normalizeSource("  Apple  "), "apple");
  assert.equal(normalizeSource(""), null);
  assert.equal(normalizeSource(null), null);
});

test("identical values are not a conflict and do not churn the row", () => {
  const r = resolveField(
    { value: " Acme ", source: "clay" },
    { value: "Acme", source: "manual" },
  );
  assert.equal(r.reason, "identical");
  assert.equal(r.winner, "existing");
});

test("a blank incoming value never wins, even from the top tier", () => {
  // An agent that omits a field is saying nothing about it, not saying it is
  // empty. Treating absence as a value is how enrichment erases data.
  const r = resolveField(
    { value: "", source: "manual" },
    { value: "Acme", source: "clay" },
  );
  assert.equal(r.value, "Acme");
  assert.equal(r.reason, "incoming_blank");
});

test("every tier is populated, so no tier is dead code", () => {
  const tiers = new Set(knownSources().map((s) => trustOf(s)));
  for (const t of [TRUST.OWNER_STATED, TRUST.OWNER_SYNCED, TRUST.AMBER_DERIVED, TRUST.VENDOR]) {
    assert.ok(tiers.has(t), `no source is classified at tier ${t}`);
  }
});
