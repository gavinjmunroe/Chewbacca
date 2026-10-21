/**
 * Tests for guardOutbound — the single outbound persona/hygiene chokepoint.
 * Regression coverage for the <thinking> leak Medha posted to Sagar (2026-05-22).
 *
 * Run with:  node --test Newton/agent/lib/voice-guard.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { guardOutbound } from "./voice-guard.js";

test("strips a complete <thinking> block, keeps the answer after it", () => {
  const leaked =
    "<thinking>\nThe user wants a calendar event. I have no tool. Be honest.\n</thinking>\nI don't have a calendar tool connected here.";
  assert.equal(
    guardOutbound(leaked),
    "I don't have a calendar tool connected here.",
  );
});

test("strips an inline <thinking> block mid-text", () => {
  assert.equal(
    guardOutbound("Here you go. <thinking>secret reasoning</thinking> Done."),
    "Here you go.  Done.".replace(/\s+/g, " ").trim(),
  );
});

test("strips orphan/bare scaffolding tags without nuking the reply", () => {
  assert.equal(guardOutbound("answer text </thinking>"), "answer text");
  assert.equal(guardOutbound("<scratchpad> answer"), "answer");
});

test("leaves normal replies unchanged", () => {
  assert.equal(guardOutbound("just a normal reply"), "just a normal reply");
});

test("is idempotent", () => {
  const input = "<thinking>x</thinking>real answer";
  const once = guardOutbound(input);
  assert.equal(guardOutbound(once), once);
});

test("non-string input passes through", () => {
  assert.equal(guardOutbound(null), null);
  assert.equal(guardOutbound(undefined), undefined);
});
