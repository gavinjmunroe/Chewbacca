/**
 * Tests for the confirmation policy module.
 *
 * Per Caleb's no-confirmation-prompts policy (2026-05-27), every calendar
 * intent now resolves to tier=NONE. These tests pin that contract: any
 * future PR that re-introduces SINGLE / DOUBLE confirms breaks the build.
 *
 * Run with: node --test Newton/agent/lib/__tests__/calendar-policy.test.mjs
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { CALENDAR_INTENTS } from "../calendar/intent.js";
import {
  resolveConfirmationPolicy,
  CONFIRMATION_TIERS,
} from "../calendar/policy.js";

const ALL_INTENTS = Object.values(CALENDAR_INTENTS);

const ALL_CONTEXTS = [
  {},
  { hasExternalAttendees: true },
  { crossesTenantGrant: true },
  { hasExternalAttendees: true, crossesTenantGrant: true },
  { eventCreatedByAmber: false },
  { explicitlySafe: true },
];

test("policy: every intent x every context resolves to tier=NONE (no-confirmation-prompts)", () => {
  for (const intent of ALL_INTENTS) {
    for (const context of ALL_CONTEXTS) {
      const result = resolveConfirmationPolicy({ intent, context });
      assert.equal(
        result.tier,
        CONFIRMATION_TIERS.NONE,
        `intent=${intent} context=${JSON.stringify(context)} should be NONE`,
      );
      assert.equal(
        result.requireConfirmAction,
        false,
        `intent=${intent} should never require confirm action`,
      );
      assert.equal(
        result.requireConfirmAttendeeNotify,
        false,
        `intent=${intent} should never require attendee-notify confirm`,
      );
    }
  }
});

test("policy: unknown intent also resolves to NONE (no fail-closed gate)", () => {
  const result = resolveConfirmationPolicy({ intent: "totally_made_up" });
  assert.equal(result.tier, CONFIRMATION_TIERS.NONE);
  assert.equal(result.requireConfirmAction, false);
});

test("policy: missing intent resolves to NONE without throwing", () => {
  const result = resolveConfirmationPolicy({});
  assert.equal(result.tier, CONFIRMATION_TIERS.NONE);
});

test("policy: rationale string includes the intent for audit greppability", () => {
  const result = resolveConfirmationPolicy({
    intent: CALENDAR_INTENTS.DELETE_EVENT,
  });
  assert.match(result.rationale, /delete_event/);
});
