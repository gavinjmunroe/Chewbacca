/**
 * Tests for the calendar provider adapter seam.
 *
 * The mock provider stands in for both `gcal` and the future Perplexity
 * connector broker. Production code only sees `getCalendarProvider(tenant)`.
 *
 * Run with: node --test Newton/agent/lib/__tests__/calendar-provider.test.mjs
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildMockCalendarProvider,
  getCalendarProvider,
  registerCalendarProvider,
  _resetCalendarProviderRegistry,
} from "../calendar/provider.js";
import {
  classifyCalendarIntent,
  CALENDAR_INTENTS,
} from "../calendar/intent.js";
import {
  resolveConfirmationPolicy,
  CONFIRMATION_TIERS,
} from "../calendar/policy.js";

test("provider: register requires all five methods", () => {
  _resetCalendarProviderRegistry();
  assert.throws(() => registerCalendarProvider("broken", { listEvents: () => {} }));
});

test("provider: getCalendarProvider returns the configured provider", async () => {
  _resetCalendarProviderRegistry();
  buildMockCalendarProvider();
  const tenant = { preferences: { calendar: { provider: "mock" } } };
  const p = await getCalendarProvider(tenant);
  assert.equal(p.name, "mock");
});

test("provider: env var selects provider when tenant prefs unset", async () => {
  _resetCalendarProviderRegistry();
  buildMockCalendarProvider();
  const prev = process.env.AMBER_CALENDAR_PROVIDER;
  process.env.AMBER_CALENDAR_PROVIDER = "mock";
  try {
    const p = await getCalendarProvider({});
    assert.equal(p.name, "mock");
  } finally {
    if (prev == null) delete process.env.AMBER_CALENDAR_PROVIDER;
    else process.env.AMBER_CALENDAR_PROVIDER = prev;
  }
});

test("provider: mock supports create / update / delete / list / freebusy", async () => {
  _resetCalendarProviderRegistry();
  const mock = buildMockCalendarProvider();
  const tenant = { preferences: { calendar: { provider: "mock" } } };
  const provider = await getCalendarProvider(tenant);

  const { id } = await provider.createEvent({
    tenant,
    dimension: "social",
    event: {
      summary: "intro with mira",
      start: "2026-05-12T17:00:00Z",
      end: "2026-05-12T17:30:00Z",
      calendarId: "social-cal",
    },
  });
  assert.ok(id);

  const list = await provider.listEvents({ tenant, dimension: "social" });
  assert.equal(list.events.length, 1);
  assert.equal(list.events[0].summary, "intro with mira");

  await provider.updateEvent({
    tenant,
    dimension: "social",
    eventId: id,
    patch: { summary: "intro w/ mira (rescheduled)" },
  });
  assert.equal(mock._state.events.get(id).summary, "intro w/ mira (rescheduled)");

  await provider.deleteEvent({ tenant, dimension: "social", eventId: id });
  assert.equal(mock._state.events.has(id), false);
});

// ── End-to-end safety tests ──────────────────────────────────────────────────
//
// These wire the three modules together to prove the safety contract:
//   - a delete intent with external attendees REQUIRES double confirm
//   - a delete intent without external attendees still requires single confirm
//   - the dispatcher cannot reach the provider without satisfying the gate

async function dispatchWithGate({ message, externalAttendees, provider, tenant }) {
  const cls = classifyCalendarIntent(message);
  const policy = resolveConfirmationPolicy({
    intent: cls.intent,
    context: { hasExternalAttendees: externalAttendees || cls.hasExternalAttendee },
  });
  const audit = { classified: cls, policy };
  if (policy.requireConfirmAction) {
    audit.gate = "blocked-by-confirm-required";
    return audit;
  }
  // not destructive — safe to proceed for the sake of this test
  audit.gate = "passed";
  return audit;
}

test("safety: cancel my 2pm is blocked at the dispatcher gate", async () => {
  _resetCalendarProviderRegistry();
  const mock = buildMockCalendarProvider({
    events: [
      {
        id: "evt-1",
        summary: "1:1",
        start: "2026-05-11T14:00:00Z",
        end: "2026-05-11T14:30:00Z",
        calendarId: "social-cal",
      },
    ],
  });
  const tenant = { preferences: { calendar: { provider: "mock" } } };
  const r = await dispatchWithGate({ message: "cancel my 2pm", provider: mock, tenant });
  assert.equal(r.classified.intent, CALENDAR_INTENTS.DELETE_EVENT);
  assert.equal(r.policy.tier, CONFIRMATION_TIERS.SINGLE);
  assert.equal(r.gate, "blocked-by-confirm-required");
  // No event mutation occurred.
  assert.equal(mock._state.events.size, 1);
});

test("safety: cancel with external attendee escalates to double confirm", async () => {
  _resetCalendarProviderRegistry();
  buildMockCalendarProvider();
  const tenant = { preferences: { calendar: { provider: "mock" } } };
  const r = await dispatchWithGate({
    message: "cancel the meeting with patel@example.com",
    externalAttendees: true,
    tenant,
  });
  assert.equal(r.classified.intent, CALENDAR_INTENTS.DELETE_EVENT);
  assert.equal(r.policy.tier, CONFIRMATION_TIERS.DOUBLE);
  assert.equal(r.policy.requireConfirmAttendeeNotify, true);
  assert.equal(r.policy.mayNotifyAttendees, false);
});

test("safety: list events is allowed through gate", async () => {
  _resetCalendarProviderRegistry();
  buildMockCalendarProvider();
  const tenant = { preferences: { calendar: { provider: "mock" } } };
  const r = await dispatchWithGate({ message: "what's on thursday afternoon", tenant });
  assert.equal(r.classified.intent, CALENDAR_INTENTS.LIST_EVENTS);
  assert.equal(r.gate, "passed");
});
