/**
 * Tests for lib/bootstrapping.js — trip-planning v2 handshake + opt-in
 * detection (flaw #95).
 *
 * Pure-function coverage:
 *   - detectOptIn: tapback reactions, "yes" variants, edge cases
 *   - detectOptOut: tapback reactions, "no" variants
 *   - detectStop: only fires on STOP / unsubscribe alone, not in prose
 *   - shouldRunHandshake: first_touch / retroactive / skip routing
 *
 * Run with:
 *   node --test Newton/agent/lib/__tests__/bootstrapping.test.js
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  detectOptIn,
  detectOptOut,
  detectStop,
  shouldRunHandshake,
} from "../bootstrapping.js";

// ── detectOptIn ───────────────────────────────────────────────────────────

test("detectOptIn: thumbs_up tapback fires", () => {
  assert.equal(detectOptIn({ reactionType: "thumbs_up" }), true);
  assert.equal(detectOptIn({ reactionType: "thumbsup" }), true);
  assert.equal(detectOptIn({ reactionType: "+1" }), true);
  assert.equal(detectOptIn({ reactionType: "love" }), true);
});

test("detectOptIn: yes / y / 👍 text fires", () => {
  assert.equal(detectOptIn({ text: "yes" }), true);
  assert.equal(detectOptIn({ text: "Yes!" }), true);
  assert.equal(detectOptIn({ text: " y " }), true);
  assert.equal(detectOptIn({ text: "👍" }), true);
  assert.equal(detectOptIn({ text: "opt in" }), true);
  assert.equal(detectOptIn({ text: "opt-in" }), true);
});

test("detectOptIn: prose containing 'yes' does NOT fire", () => {
  // Critical false-positive guard: people say "yes" inside sentences.
  assert.equal(detectOptIn({ text: "yes I'd love to come" }), false);
  assert.equal(detectOptIn({ text: "the answer is yes" }), false);
  assert.equal(detectOptIn({ text: "yes please" }), false);
});

test("detectOptIn: null / empty / unknown reaction does not fire", () => {
  assert.equal(detectOptIn({}), false);
  assert.equal(detectOptIn({ text: null }), false);
  assert.equal(detectOptIn({ text: "" }), false);
  assert.equal(detectOptIn({ reactionType: "question" }), false);
});

// ── detectOptOut ──────────────────────────────────────────────────────────

test("detectOptOut: thumbsdown reaction + 'no' text", () => {
  assert.equal(detectOptOut({ reactionType: "thumbsdown" }), true);
  assert.equal(detectOptOut({ reactionType: "dislike" }), true);
  assert.equal(detectOptOut({ text: "no" }), true);
  assert.equal(detectOptOut({ text: "nope" }), true);
  assert.equal(detectOptOut({ text: "opt-out" }), true);
});

test("detectOptOut: prose 'no thanks' does fire because pattern is loose; 'no I won't' should not", () => {
  // Only exact-match-ish "no" should count. Anything compound is prose.
  assert.equal(detectOptOut({ text: "no I won't" }), false);
  assert.equal(detectOptOut({ text: "definitely not" }), false);
});

// ── detectStop ────────────────────────────────────────────────────────────

test("detectStop: STOP alone fires", () => {
  assert.equal(detectStop("STOP"), true);
  assert.equal(detectStop("stop"), true);
  assert.equal(detectStop(" Stop ! "), true);
  assert.equal(detectStop("unsubscribe"), true);
});

test("detectStop: STOP in prose does NOT fire", () => {
  assert.equal(detectStop("stop sending these"), false);
  assert.equal(detectStop("please stop"), false);
  assert.equal(detectStop("don't stop believin"), false);
});

test("detectStop: null / empty / non-string returns false", () => {
  assert.equal(detectStop(null), false);
  assert.equal(detectStop(""), false);
  assert.equal(detectStop(undefined), false);
  assert.equal(detectStop(123), false);
});

// ── shouldRunHandshake ────────────────────────────────────────────────────

test("shouldRunHandshake: returns 'skip' when handshake already done", () => {
  const mem = { handshakeAt: new Date().toISOString(), messageCount: 5 };
  assert.equal(shouldRunHandshake(mem), "skip");
});

test("shouldRunHandshake: returns 'first_touch' for brand new group", () => {
  const mem = { messageCount: 0, handshakeAt: null };
  assert.equal(
    shouldRunHandshake(mem, { isFirstMessageInGroup: true }),
    "first_touch",
  );
});

test("shouldRunHandshake: returns 'retroactive' for group with messages but no handshake", () => {
  const mem = { messageCount: 12, handshakeAt: null };
  assert.equal(shouldRunHandshake(mem), "retroactive");
});

test("shouldRunHandshake: defaults to 'retroactive' on ambiguous state", () => {
  // messageCount=0 but caller didn't confirm first_touch — the safer
  // copy ("quick housekeeping") is the right default.
  const mem = { messageCount: 0, handshakeAt: null };
  assert.equal(shouldRunHandshake(mem), "retroactive");
});

test("shouldRunHandshake: null / missing memory returns 'skip'", () => {
  assert.equal(shouldRunHandshake(null), "skip");
  assert.equal(shouldRunHandshake(undefined), "skip");
});
