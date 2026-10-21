/**
 * Tests for lib/proactive-prefs.js — the gating layer for scheduled
 * outbound messages (check-ins, context/health nudges, dormant-contact
 * outreach).
 *
 * Run with:
 *   node --test Newton/agent/lib/__tests__/proactive-prefs.test.mjs
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  isCheckinSchedulerEnabled,
  isContextNudgeEnabled,
  isOutreachEnabled,
  anyScheduledEnabled,
  describeProactiveGates,
} from "../proactive-prefs.js";

const EMPTY_TENANT = { displayName: "Camber" };

// ── Defaults ────────────────────────────────────────────────────────────

test("default: every proactive surface is OFF (opt-in)", () => {
  // Default flipped to OFF in the phantom-checkin fix (Tab 1 / Tab 10).
  // Check-ins are now per-tenant opt-in via preferences.proactive.checkins
  // or the AMBER_PROACTIVE_CHECKINS env override.
  const env = {};
  assert.equal(isCheckinSchedulerEnabled(EMPTY_TENANT, env), false);
  assert.equal(isContextNudgeEnabled(EMPTY_TENANT, env), false);
  assert.equal(isOutreachEnabled(EMPTY_TENANT, env), false);
});

test("default: anyScheduledEnabled is false (everything quiet by default)", () => {
  assert.equal(anyScheduledEnabled(EMPTY_TENANT, {}), false);
});

// ── Env override ────────────────────────────────────────────────────────

test("env can enable check-ins globally", () => {
  for (const v of ["1", "true", "on", "yes"]) {
    assert.equal(
      isCheckinSchedulerEnabled(EMPTY_TENANT, { AMBER_PROACTIVE_CHECKINS: v }),
      true,
    );
  }
});

test("env can enable context-nudge globally", () => {
  for (const v of ["1", "true", "on", "yes"]) {
    assert.equal(
      isContextNudgeEnabled(EMPTY_TENANT, { AMBER_PROACTIVE_CONTEXT_NUDGE: v }),
      true,
    );
  }
});

test("env can enable outreach globally", () => {
  assert.equal(
    isOutreachEnabled(EMPTY_TENANT, { AMBER_PROACTIVE_OUTREACH: "1" }),
    true,
  );
});

test("env junk values fall back to defaults", () => {
  assert.equal(
    isContextNudgeEnabled(EMPTY_TENANT, {
      AMBER_PROACTIVE_CONTEXT_NUDGE: "maybe",
    }),
    false,
  );
});

// ── Per-tenant preference wins over env ─────────────────────────────────

test("tenant preference overrides env (disable)", () => {
  const tenant = { preferences: { proactive: { checkins: false } } };
  assert.equal(
    isCheckinSchedulerEnabled(tenant, { AMBER_PROACTIVE_CHECKINS: "1" }),
    false,
  );
});

test("tenant preference overrides env (enable)", () => {
  const tenant = { preferences: { proactive: { contextNudge: true } } };
  assert.equal(
    isContextNudgeEnabled(tenant, { AMBER_PROACTIVE_CONTEXT_NUDGE: "0" }),
    true,
  );
});

test("tenant preference for outreach is respected", () => {
  const off = { preferences: { proactive: { outreach: false } } };
  const on = { preferences: { proactive: { outreach: true } } };
  assert.equal(isOutreachEnabled(off, {}), false);
  assert.equal(isOutreachEnabled(on, {}), true);
});

// ── anyScheduledEnabled: short-circuit for fully-quiet tenants ─────────

test("anyScheduledEnabled false when everything is off", () => {
  const tenant = {
    preferences: {
      proactive: { checkins: false, contextNudge: false, outreach: false },
    },
  };
  assert.equal(anyScheduledEnabled(tenant, {}), false);
});

test("anyScheduledEnabled true when at least one surface is on", () => {
  const tenant = {
    preferences: {
      proactive: { checkins: false, contextNudge: false, outreach: true },
    },
  };
  assert.equal(anyScheduledEnabled(tenant, {}), true);
});

// ── describeProactiveGates: snapshot for logging ───────────────────────

test("describeProactiveGates returns a flat boolean snapshot", () => {
  const tenant = {
    preferences: {
      proactive: { checkins: true, contextNudge: false, outreach: true },
    },
  };
  assert.deepEqual(describeProactiveGates(tenant, {}), {
    checkins: true,
    contextNudge: false,
    outreach: true,
  });
});

// ── Null/missing tenants don't crash ───────────────────────────────────

test("null tenant falls back to env / defaults without throwing", () => {
  assert.equal(isCheckinSchedulerEnabled(null, {}), false);
  assert.equal(isContextNudgeEnabled(null, {}), false);
  assert.equal(isOutreachEnabled(null, {}), false);
});
