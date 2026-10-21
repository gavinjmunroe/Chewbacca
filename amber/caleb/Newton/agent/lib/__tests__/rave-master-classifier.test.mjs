/**
 * Tests for the Rave Master message classifier.
 *
 * Run with:
 *   node --test Newton/agent/lib/__tests__/rave-master-classifier.test.mjs
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  classifyEventMessage,
  EVENT_SLOTS,
} from "../rave-master/classifier.js";

test("ticket-related messages classify as ticket", () => {
  for (const t of [
    "I have an extra ticket for Friday",
    "Did you get the wristband?",
    "StubHub still hasn't released the GA ticket",
    "Will-call opens at 4",
  ]) {
    const c = classifyEventMessage(t);
    assert.ok(c, `expected match for "${t}"`);
    assert.equal(c.primary, "ticket");
  }
});

test("payment messages classify as payment", () => {
  for (const t of [
    "Venmo me $80",
    "Cash app the rest",
    "You owe me 40",
    "Just paid you",
  ]) {
    const c = classifyEventMessage(t);
    assert.ok(c, t);
    assert.equal(c.primary, "payment");
  }
});

test("meetup messages classify as meetup", () => {
  for (const t of [
    "meet up at the north brown lot at 8",
    "come to my car",
    "same place as yesterday",
    "where are you guys",
    "find us by the yellow star",
  ]) {
    const c = classifyEventMessage(t);
    assert.ok(c, t);
    assert.equal(c.primary, "meetup");
  }
});

test("transport messages classify as transport", () => {
  const c = classifyEventMessage("ordering an Uber back to the airbnb");
  assert.ok(c);
  assert.equal(c.primary, "transport");
});

test("lodging messages classify as lodging", () => {
  const c = classifyEventMessage("The Airbnb host wants check-in by 9");
  assert.ok(c);
  assert.equal(c.primary, "lodging");
});

test("safety messages classify as safety", () => {
  const c = classifyEventMessage("I lost the group and my phone has no service");
  assert.ok(c);
  assert.equal(c.primary, "safety");
});

test("substance-only mentions are flagged but NOT a slot match", () => {
  const c = classifyEventMessage("molly is hitting hard");
  assert.ok(c);
  assert.equal(c.isSubstanceContext, true);
  // No procurement-style event slot was matched — just safety context.
  assert.equal(c.primary, null);
});

test("totally unrelated chatter returns null", () => {
  assert.equal(classifyEventMessage("just watching the game"), null);
  assert.equal(classifyEventMessage(""), null);
  assert.equal(classifyEventMessage(null), null);
});

test("EVENT_SLOTS matches the canonical taxonomy", () => {
  assert.deepEqual(
    EVENT_SLOTS,
    ["ticket", "payment", "meetup", "transport", "lodging", "supply", "safety", "music"],
  );
});

test("text is truncated to 500 chars in the snapshot", () => {
  const long = "uber " + "x".repeat(2000);
  const c = classifyEventMessage(long);
  assert.ok(c);
  assert.ok(c.text.length <= 500);
});
