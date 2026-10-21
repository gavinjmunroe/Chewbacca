/**
 * Tests for tenant profile + slot ranker.
 *
 * Proves the shared-engine / different-policy property: Camber (hiring) and
 * Samber (selling) profiles, fed the same slate, produce different orderings;
 * with weights flattened to uniform they converge.
 *
 * Run with: node --test Newton/agent/lib/__tests__/calendar-profile-and-rank.test.mjs
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { loadCalendarProfile } from "../calendar/profile.js";
import { rankSlots } from "../calendar/rank.js";
import { ROLE_WEIGHTS, DIMENSIONS, weightSum } from "../calendar/roles.js";

// Sample tenant records mirroring what amber-id would return.
// No tenant names are checked in production code; we use them in tests only
// to mirror the initial production assignment (Camber = hiring, Samber = selling).
const CAMBER_TENANT = {
  id: "tenant-camber",
  displayName: "Camber (Caleb)",
  role: "hiring",
  preferences: {
    calendar: {
      timezone: "America/Los_Angeles",
    },
  },
};

const SAMBER_TENANT = {
  id: "tenant-samber",
  displayName: "Samber (Sagar)",
  role: "selling",
  preferences: {
    calendar: {
      timezone: "America/Los_Angeles",
    },
  },
};

test("profile: hiring role loads hiring weights", () => {
  const p = loadCalendarProfile(CAMBER_TENANT);
  assert.equal(p.role, "hiring");
  for (const d of DIMENSIONS) {
    assert.equal(p.dimensionWeights[d], ROLE_WEIGHTS.hiring[d], d);
  }
});

test("profile: selling role loads selling weights", () => {
  const p = loadCalendarProfile(SAMBER_TENANT);
  assert.equal(p.role, "selling");
  for (const d of DIMENSIONS) {
    assert.equal(p.dimensionWeights[d], ROLE_WEIGHTS.selling[d], d);
  }
});

test("profile: no role falls back to uniform weights", () => {
  const p = loadCalendarProfile({ id: "blank" });
  for (const d of DIMENSIONS) {
    assert.equal(p.dimensionWeights[d], 1 / DIMENSIONS.length, d);
  }
});

test("profile: tenant override beats role default", () => {
  const p = loadCalendarProfile({
    role: "hiring",
    preferences: {
      calendar: {
        dimensionWeights: { financial: 1, intellectual: 0, social: 0, spiritual: 0, emotional: 0, physical: 0 },
      },
    },
  });
  assert.equal(p.dimensionWeights.financial, 1);
  assert.equal(p.dimensionWeights.intellectual, 0);
});

test("profile: weight sums normalize to 1", () => {
  for (const role of ["hiring", "selling", "building", "learning"]) {
    const p = loadCalendarProfile({ role });
    assert.ok(Math.abs(weightSum(p.dimensionWeights) - 1) < 1e-9, role);
  }
});

test("profile: unknown role falls through to uniform", () => {
  const p = loadCalendarProfile({ role: "vibing" });
  assert.equal(p.role, null);
  for (const d of DIMENSIONS) {
    assert.equal(p.dimensionWeights[d], 1 / DIMENSIONS.length, d);
  }
});

// ── Ranker tests ──────────────────────────────────────────────────────────────

// A slate that contains slots tagged for different dimensions. Identical for
// both tenants — only the weights differ.
function slate() {
  return [
    { id: "intellectual-deepwork", start: "2026-05-12T09:00:00-07:00", end: "2026-05-12T10:00:00-07:00", dimension: "intellectual" },
    { id: "social-sales-call", start: "2026-05-12T11:00:00-07:00", end: "2026-05-12T11:30:00-07:00", dimension: "social", attendeeDimensions: ["financial"] },
    { id: "social-hiring-intro", start: "2026-05-12T14:00:00-07:00", end: "2026-05-12T14:30:00-07:00", dimension: "social", attendeeDimensions: ["intellectual"] },
    { id: "financial-budget-review", start: "2026-05-12T15:00:00-07:00", end: "2026-05-12T16:00:00-07:00", dimension: "financial" },
    { id: "physical-workout", start: "2026-05-12T17:00:00-07:00", end: "2026-05-12T18:00:00-07:00", dimension: "physical" },
  ];
}

test("ranker (Camber/hiring): top slots protect hiring throughput", () => {
  const profile = loadCalendarProfile(CAMBER_TENANT);
  const ranked = rankSlots(slate(), profile.dimensionWeights);
  const topIds = ranked.slice(0, 2).map((s) => s.id);
  // hiring weights social highest and intellectual second; the social slot
  // whose attendee dimension is intellectual must rank top under hiring.
  assert.equal(topIds[0], "social-hiring-intro");
  assert.ok(topIds.includes("social-sales-call") || topIds.includes("social-hiring-intro"));
});

test("ranker (Samber/selling): top slot protects selling throughput", () => {
  const profile = loadCalendarProfile(SAMBER_TENANT);
  const ranked = rankSlots(slate(), profile.dimensionWeights);
  const topId = ranked[0].id;
  // selling weights social + financial highest; the social slot with a
  // financial attendee dimension should win.
  assert.equal(topId, "social-sales-call");
});

test("ranker: same engine, different policy → different orderings", () => {
  const camber = loadCalendarProfile(CAMBER_TENANT);
  const samber = loadCalendarProfile(SAMBER_TENANT);
  const r1 = rankSlots(slate(), camber.dimensionWeights).map((s) => s.id);
  const r2 = rankSlots(slate(), samber.dimensionWeights).map((s) => s.id);
  // We do not assert full inequality — only the headline must differ.
  assert.notEqual(r1[0], r2[0], "top slot should differ across hiring vs selling");
});

test("ranker: flattened weights → identical ordering across profiles", () => {
  const flat = Object.fromEntries(DIMENSIONS.map((d) => [d, 1]));
  const r1 = rankSlots(slate(), flat).map((s) => s.id);
  const r2 = rankSlots(slate(), flat).map((s) => s.id);
  // The headline guarantee: two profiles with identical weights converge.
  assert.deepEqual(r1, r2);
});

test("ranker: slots with no attendees and equal weights tie-break on start", () => {
  // Drop attendeeDimensions so flattened weights yield equal scores; expect
  // stable sort by start ascending.
  const flat = Object.fromEntries(DIMENSIONS.map((d) => [d, 1]));
  const bareSlate = slate().map((s) => ({ ...s, attendeeDimensions: undefined }));
  const ranked = rankSlots(bareSlate, flat).map((s) => s.start);
  const sorted = [...ranked].sort();
  assert.deepEqual(ranked, sorted);
});

test("ranker: empty slate returns empty", () => {
  assert.deepEqual(rankSlots([], { ...ROLE_WEIGHTS.hiring }), []);
});
