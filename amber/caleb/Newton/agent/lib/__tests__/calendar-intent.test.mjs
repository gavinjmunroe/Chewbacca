/**
 * Tests for the calendar intent classifier.
 *
 * Run with: node --test Newton/agent/lib/__tests__/calendar-intent.test.mjs
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  classifyCalendarIntent,
  CALENDAR_INTENTS,
} from "../calendar/intent.js";

test("intent: empty / non-calendar messages return unknown", () => {
  assert.equal(classifyCalendarIntent("").intent, CALENDAR_INTENTS.UNKNOWN);
  assert.equal(classifyCalendarIntent("hello").intent, CALENDAR_INTENTS.UNKNOWN);
  assert.equal(
    classifyCalendarIntent("what's the weather").intent,
    CALENDAR_INTENTS.UNKNOWN,
  );
});

test("intent: destructive verb tripwire always wins", () => {
  for (const msg of [
    "cancel my 2pm",
    "please delete the meeting with Mira",
    "remove tomorrow's coffee",
    "drop the 3pm with Patel",
    "cancel it",
  ]) {
    const r = classifyCalendarIntent(msg);
    assert.equal(r.intent, CALENDAR_INTENTS.DELETE_EVENT, msg);
    assert.equal(r.destructive, true, msg);
    assert.ok(r.destructiveTripwire, msg);
  }
});

test("intent: tripwire fires even if classifier might prefer create", () => {
  // crafted to also contain a create-shaped word
  const r = classifyCalendarIntent("schedule a cancel for tomorrow at 4pm");
  assert.equal(r.intent, CALENDAR_INTENTS.DELETE_EVENT);
});

test("intent: reschedule shapes", () => {
  for (const msg of [
    "move my 2pm to 4pm",
    "push the coffee to Friday",
    "reschedule the 1:1 with Sagar",
    "bump tomorrow's call to next week",
    "shift the standup to 10am tomorrow",
  ]) {
    const r = classifyCalendarIntent(msg);
    assert.equal(r.intent, CALENDAR_INTENTS.RESCHEDULE_EVENT, msg);
    assert.equal(r.destructive, true, msg);
  }
});

test("intent: read availability vs list events", () => {
  assert.equal(
    classifyCalendarIntent("am I free Tuesday at 4").intent,
    CALENDAR_INTENTS.READ_AVAILABILITY,
  );
  assert.equal(
    classifyCalendarIntent("what's on Thursday afternoon").intent,
    CALENDAR_INTENTS.LIST_EVENTS,
  );
  assert.equal(
    classifyCalendarIntent("what do i have tomorrow").intent,
    CALENDAR_INTENTS.LIST_EVENTS,
  );
});

test("intent: create vs update", () => {
  assert.equal(
    classifyCalendarIntent("add a 1:1 tomorrow at 3").intent,
    CALENDAR_INTENTS.CREATE_EVENT,
  );
  assert.equal(
    classifyCalendarIntent("schedule a coffee with Mira tomorrow at 9am").intent,
    CALENDAR_INTENTS.CREATE_EVENT,
  );
  // update verb without create-anchor
  const updateResult = classifyCalendarIntent(
    "rename my Thursday meeting to design review",
  );
  assert.equal(updateResult.intent, CALENDAR_INTENTS.UPDATE_EVENT);
  assert.equal(updateResult.destructive, true);
});

test("intent: coordinate intents", () => {
  for (const msg of [
    "find me an hour with Sagar next week, mornings, intellectual",
    "30-min with patel@example.com next Tuesday or Wednesday afternoon",
    "set up with patel@example.com next Tuesday afternoon",
    "coordinate a meeting with the design team Thursday",
  ]) {
    const r = classifyCalendarIntent(msg);
    assert.equal(r.intent, CALENDAR_INTENTS.COORDINATE_SCHEDULING, msg);
    assert.equal(r.destructive, false, msg);
  }
});

test("intent: external attendee detection", () => {
  const r = classifyCalendarIntent(
    "schedule a 1:1 with patel@example.com next Tuesday at 3pm",
  );
  assert.equal(r.hasExternalAttendee, true);
});

test("intent: requireCalendarContext=false relaxes the gate", () => {
  const r = classifyCalendarIntent("rename it", { requireCalendarContext: false });
  assert.equal(r.intent, CALENDAR_INTENTS.UPDATE_EVENT);
});

test("intent: classifier accuracy on a 20-sample fixture", () => {
  const samples = [
    ["am I free tuesday at 4", CALENDAR_INTENTS.READ_AVAILABILITY],
    ["what's on thursday", CALENDAR_INTENTS.LIST_EVENTS],
    ["what do I have tomorrow", CALENDAR_INTENTS.LIST_EVENTS],
    ["add coffee with mira tomorrow at 9am", CALENDAR_INTENTS.CREATE_EVENT],
    ["schedule a workout block monday 7am", CALENDAR_INTENTS.CREATE_EVENT],
    ["block 90 min for deep work tomorrow", CALENDAR_INTENTS.CREATE_EVENT],
    ["move my 2pm to 4pm", CALENDAR_INTENTS.RESCHEDULE_EVENT],
    ["push the coffee to friday", CALENDAR_INTENTS.RESCHEDULE_EVENT],
    ["cancel my 2pm", CALENDAR_INTENTS.DELETE_EVENT],
    ["delete the meeting with mira", CALENDAR_INTENTS.DELETE_EVENT],
    ["remove the standup", CALENDAR_INTENTS.DELETE_EVENT],
    ["drop the 3pm", CALENDAR_INTENTS.DELETE_EVENT],
    ["find me an hour with sagar next week intellectual", CALENDAR_INTENTS.COORDINATE_SCHEDULING],
    ["30 min with patel@example.com next tuesday afternoon", CALENDAR_INTENTS.COORDINATE_SCHEDULING],
    ["sync with engineering this thursday", CALENDAR_INTENTS.COORDINATE_SCHEDULING],
    ["rename my thursday meeting to design review", CALENDAR_INTENTS.UPDATE_EVENT],
    ["change location of my 3pm to zoom", CALENDAR_INTENTS.UPDATE_EVENT],
    ["is caleb free tuesday at 4", CALENDAR_INTENTS.READ_AVAILABILITY],
    ["reschedule the 1:1 with sagar", CALENDAR_INTENTS.RESCHEDULE_EVENT],
    ["what's next on my calendar", CALENDAR_INTENTS.LIST_EVENTS],
  ];
  let correct = 0;
  for (const [msg, expected] of samples) {
    const r = classifyCalendarIntent(msg);
    if (r.intent === expected) correct++;
  }
  // Per docs §10: ≥95% accuracy on the unit fixture.
  assert.ok(correct / samples.length >= 0.95, `accuracy ${correct}/${samples.length}`);
});
