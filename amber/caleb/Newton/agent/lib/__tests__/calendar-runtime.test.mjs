/**
 * Tests for the iMessage calendar-runtime pre-pass.
 *
 * Run with: node --test Newton/agent/lib/__tests__/calendar-runtime.test.mjs
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  maybeHandleCalendarMessage,
  isCalendarRuntimeEnabled,
} from "../calendar/runtime.js";
import { CALENDAR_INTENTS } from "../calendar/intent.js";
import { CONFIRMATION_TIERS } from "../calendar/policy.js";

function makeCaptureReply() {
  const captured = [];
  return {
    captured,
    reply: async (msg) => {
      captured.push(msg);
    },
  };
}

function mockProvider({ events = [] } = {}) {
  return async () => ({
    name: "mock",
    listEvents: async () => ({ events }),
    freeBusy: async () => ({ busy: [] }),
    createEvent: async () => {
      throw new Error("provider.createEvent must not be called from pre-pass");
    },
    updateEvent: async () => {
      throw new Error("provider.updateEvent must not be called from pre-pass");
    },
    deleteEvent: async () => {
      throw new Error("provider.deleteEvent must not be called from pre-pass");
    },
  });
}

const camber = {
  privyDid: "did:privy:caleb",
  role: "hiring",
  phoneNumber: "+15551111111",
  loopSenderPhone: "+15550000001",
};
const samber = {
  privyDid: "did:privy:sagar",
  role: "selling",
  phoneNumber: "+15552222222",
  loopSenderPhone: "+15550000002",
};

test("flag off: pre-pass is a no-op and existing behavior is preserved", async () => {
  const { reply, captured } = makeCaptureReply();
  const outcome = await maybeHandleCalendarMessage({
    tenant: camber,
    text: "cancel my 2pm with Mira",
    reply,
    env: {}, // AMBER_CALENDAR_RUNTIME_ENABLED unset
    providerLoader: mockProvider(),
  });
  assert.equal(outcome.handled, false);
  assert.equal(outcome.reason, "runtime flag off");
  assert.equal(captured.length, 0, "no reply sent when flag is off");
});

test("flag off via explicit AMBER_CALENDAR_RUNTIME_ENABLED=false stays disabled", async () => {
  const { reply, captured } = makeCaptureReply();
  const outcome = await maybeHandleCalendarMessage({
    tenant: camber,
    text: "what's on Thursday",
    reply,
    env: { AMBER_CALENDAR_RUNTIME_ENABLED: "false" },
    providerLoader: mockProvider(),
  });
  assert.equal(outcome.handled, false);
  assert.equal(captured.length, 0);
});

test("flag off + owner asks calendar question: deterministic explanation, no LLM fall-through", async () => {
  // Smoke regression: prior behavior was that the owner asked "what's
  // on my calendar" with the flag off, fell through to the LLM, and got
  // a confidently-wrong answer. The owner now gets an explicit
  // "feature flag is off, set AMBER_CALENDAR_RUNTIME_ENABLED=1" reply.
  const { reply, captured } = makeCaptureReply();
  const outcome = await maybeHandleCalendarMessage({
    tenant: camber,
    text: "what's on my calendar tomorrow",
    isOwner: true,
    reply,
    env: {},
    providerLoader: mockProvider(),
  });
  assert.equal(outcome.handled, true);
  assert.equal(outcome.enabled, false);
  assert.equal(captured.length, 1);
  assert.match(captured[0], /AMBER_CALENDAR_RUNTIME_ENABLED/);
  assert.match(captured[0], /off/i);
});

test("flag off + NON-owner asks calendar question: stays silent (no flag leak)", async () => {
  // Feature flags are operator state. A non-owner contact must never
  // see "set AMBER_CALENDAR_RUNTIME_ENABLED=1" in a reply.
  const { reply, captured } = makeCaptureReply();
  const outcome = await maybeHandleCalendarMessage({
    tenant: camber,
    text: "is Caleb free Thursday",
    isOwner: false,
    reply,
    env: {},
    providerLoader: mockProvider(),
  });
  assert.equal(outcome.handled, false);
  assert.equal(captured.length, 0);
});

test("flag on: unknown intent falls through to existing assistant", async () => {
  const { reply, captured } = makeCaptureReply();
  const outcome = await maybeHandleCalendarMessage({
    tenant: camber,
    text: "what's the weather like",
    reply,
    env: { AMBER_CALENDAR_RUNTIME_ENABLED: "1" },
    providerLoader: mockProvider(),
  });
  assert.equal(outcome.handled, false);
  assert.equal(outcome.reason, "non-calendar intent");
  assert.equal(captured.length, 0);
});

test("flag on: read availability answered via provider seam", async () => {
  const { reply, captured } = makeCaptureReply();
  const outcome = await maybeHandleCalendarMessage({
    tenant: camber,
    text: "am I free Tuesday at 4pm",
    reply,
    env: { AMBER_CALENDAR_RUNTIME_ENABLED: "1" },
    providerLoader: mockProvider({ events: [] }),
  });
  assert.equal(outcome.handled, true);
  assert.equal(outcome.intent, CALENDAR_INTENTS.READ_AVAILABILITY);
  assert.equal(outcome.tier, CONFIRMATION_TIERS.NONE);
  assert.equal(outcome.destructive, false);
  assert.equal(captured.length, 1);
  assert.match(captured[0], /open|already on|coming up/i);
});

test("flag on: list_events renders top events from provider", async () => {
  const { reply, captured } = makeCaptureReply();
  const outcome = await maybeHandleCalendarMessage({
    tenant: samber,
    text: "what's on tomorrow",
    reply,
    env: { AMBER_CALENDAR_RUNTIME_ENABLED: "1" },
    providerLoader: mockProvider({
      events: [
        { summary: "Pipeline review", start: { dateTime: "2026-05-12T15:00" } },
        { summary: "Investor sync", start: { dateTime: "2026-05-12T17:00" } },
      ],
    }),
  });
  assert.equal(outcome.handled, true);
  assert.equal(outcome.intent, CALENDAR_INTENTS.LIST_EVENTS);
  assert.match(captured[0], /Pipeline review/);
  assert.match(captured[0], /Investor sync/);
});

// Per Caleb's no-confirmation-prompts policy (2026-05-27), destructive
// calendar intents no longer trigger a confirmation gate. The three tests
// below were inverted: previously they asserted the gate fires; now they
// assert the runtime passes through to the LLM tool path so the user gets
// the action done, not a "Reply yes" prompt.
test("flag on: destructive 'cancel' passes through to LLM tool path (no gate)", async () => {
  const { reply, captured } = makeCaptureReply();
  const outcome = await maybeHandleCalendarMessage({
    tenant: camber,
    text: "cancel my 2pm with Mira",
    reply,
    env: { AMBER_CALENDAR_RUNTIME_ENABLED: "1" },
    providerLoader: mockProvider(),
  });
  assert.equal(outcome.handled, false, "should NOT be handled by runtime");
  assert.equal(outcome.intent, CALENDAR_INTENTS.DELETE_EVENT);
  assert.equal(outcome.tier, CONFIRMATION_TIERS.NONE);
  assert.equal(captured.length, 0, "no confirmation reply should be sent");
});

test("flag on: create_event with external attendee still passes through (no confirm)", async () => {
  const { reply, captured } = makeCaptureReply();
  const outcome = await maybeHandleCalendarMessage({
    tenant: samber,
    text: "schedule a 30min intro with mira@acme.io tomorrow at 3pm",
    reply,
    env: { AMBER_CALENDAR_RUNTIME_ENABLED: "1" },
    providerLoader: mockProvider(),
  });
  assert.equal(outcome.handled, false, "should pass through, not gate");
  assert.ok(
    outcome.intent === CALENDAR_INTENTS.CREATE_EVENT ||
      outcome.intent === CALENDAR_INTENTS.COORDINATE_SCHEDULING,
    `expected create/coordinate, got ${outcome.intent}`,
  );
  assert.equal(outcome.tier, CONFIRMATION_TIERS.NONE);
  assert.equal(captured.length, 0);
});

test("flag on: reschedule with external attendees still passes through (no confirm)", async () => {
  const { reply, captured } = makeCaptureReply();
  const outcome = await maybeHandleCalendarMessage({
    tenant: camber,
    text: "move my Thursday 1:1 with mira@acme.io to Friday at 4pm",
    reply,
    env: { AMBER_CALENDAR_RUNTIME_ENABLED: "1" },
    providerLoader: mockProvider(),
  });
  assert.equal(outcome.handled, false);
  assert.equal(outcome.intent, CALENDAR_INTENTS.RESCHEDULE_EVENT);
  assert.equal(outcome.tier, CONFIRMATION_TIERS.NONE);
  assert.equal(captured.length, 0);
});

test("Camber (hiring) and Samber (selling) use the same code path", async () => {
  const text = "cancel my 2pm";
  const env = { AMBER_CALENDAR_RUNTIME_ENABLED: "1" };

  const camberCapture = makeCaptureReply();
  const samberCapture = makeCaptureReply();

  const a = await maybeHandleCalendarMessage({
    tenant: camber,
    text,
    reply: camberCapture.reply,
    env,
    providerLoader: mockProvider(),
  });
  const b = await maybeHandleCalendarMessage({
    tenant: samber,
    text,
    reply: samberCapture.reply,
    env,
    providerLoader: mockProvider(),
  });

  // Same engine: same intent, same tier, same destructive flag.
  assert.equal(a.intent, b.intent);
  assert.equal(a.tier, b.tier);
  assert.equal(a.destructive, b.destructive);
  // But the loaded profile differs because amber-id role differs.
  assert.equal(a.profileRole, "hiring");
  assert.equal(b.profileRole, "selling");
});

test("per-tenant override: runtimeEnabled=true beats unset env", () => {
  const tenant = {
    ...camber,
    preferences: { calendar: { runtimeEnabled: true } },
  };
  assert.equal(isCalendarRuntimeEnabled(tenant, {}), true);
});

test("per-tenant override: runtimeEnabled=false beats env=on", () => {
  const tenant = {
    ...camber,
    preferences: { calendar: { runtimeEnabled: false } },
  };
  assert.equal(
    isCalendarRuntimeEnabled(tenant, {
      AMBER_CALENDAR_RUNTIME_ENABLED: "1",
    }),
    false,
  );
});

test("provider error is swallowed into a graceful reply, not an exception", async () => {
  const { reply, captured } = makeCaptureReply();
  const brokenLoader = async () => ({
    name: "broken",
    listEvents: async () => {
      throw new Error("gcal unreachable");
    },
    freeBusy: async () => ({ busy: [] }),
    createEvent: async () => ({}),
    updateEvent: async () => ({}),
    deleteEvent: async () => ({}),
  });
  const outcome = await maybeHandleCalendarMessage({
    tenant: camber,
    text: "what's on today",
    reply,
    env: { AMBER_CALENDAR_RUNTIME_ENABLED: "1" },
    providerLoader: brokenLoader,
  });
  assert.equal(outcome.handled, true);
  assert.equal(captured.length, 1);
  assert.match(captured[0], /couldn't reach the calendar/i);
});
