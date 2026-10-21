/**
 * Tests for the per-turn stream settle budget (Tab 14, item 192).
 *
 * Run with:  node --test Newton/agent/lib/__tests__/stream-budget.test.mjs
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  classifyTurn,
  computeStreamBudget,
  TURN_CLASS,
} from "../stream-budget.js";

test("calendar / scheduling text classifies as a heavy tool turn", () => {
  assert.equal(
    classifyTurn("schedule a meeting with Sagar tomorrow"),
    TURN_CLASS.HEAVY_TOOL,
  );
  assert.equal(
    classifyTurn("when am I free this week?"),
    TURN_CLASS.HEAVY_TOOL,
  );
  assert.equal(
    classifyTurn("draft an email to my advisor"),
    TURN_CLASS.HEAVY_TOOL,
  );
  assert.equal(
    classifyTurn("research the latest on Neuralink"),
    TURN_CLASS.HEAVY_TOOL,
  );
});

test("a quick reminder / contact lookup classifies as a light tool turn", () => {
  assert.equal(
    classifyTurn("remind me to call mom at 5"),
    TURN_CLASS.LIGHT_TOOL,
  );
  assert.equal(classifyTurn("what's Kevin's number?"), TURN_CLASS.LIGHT_TOOL);
});

test("plain chatter classifies as a conversation turn", () => {
  assert.equal(classifyTurn("hey how are you"), TURN_CLASS.CONVERSATION);
  assert.equal(classifyTurn("thanks!"), TURN_CLASS.CONVERSATION);
  assert.equal(classifyTurn(""), TURN_CLASS.CONVERSATION);
  assert.equal(classifyTurn(undefined), TURN_CLASS.CONVERSATION);
});

test("computeStreamBudget returns the matching class budget", () => {
  const heavy = computeStreamBudget("schedule a meeting");
  assert.equal(heavy.turnClass, TURN_CLASS.HEAVY_TOOL);
  assert.equal(heavy.noOutputMs, 40_000);
  assert.equal(heavy.hardCapMs, 60_000);

  const convo = computeStreamBudget("hi there");
  assert.equal(convo.turnClass, TURN_CLASS.CONVERSATION);
  assert.ok(
    convo.noOutputMs < heavy.noOutputMs,
    "convo settles faster than heavy",
  );
});

test("invariant: hardCap is always strictly greater than no-output settle", () => {
  for (const text of [
    "schedule a meeting", // heavy
    "remind me later", // light
    "hello", // conversation
  ]) {
    const b = computeStreamBudget(text);
    assert.ok(
      b.hardCapMs > b.noOutputMs,
      `hardCap (${b.hardCapMs}) must exceed noOutput (${b.noOutputMs}) for "${text}"`,
    );
  }
});

test("heavy-tool floor preserves the historically-safe 40s / 60s window", () => {
  // The first in-app calendar turn produced its segment at ~16s and a 12s
  // settle truncated it. The heavy floor must stay at the proven-safe value.
  const b = computeStreamBudget("book time with the team next week");
  assert.equal(b.noOutputMs, 40_000);
  assert.equal(b.hardCapMs, 60_000);
});
