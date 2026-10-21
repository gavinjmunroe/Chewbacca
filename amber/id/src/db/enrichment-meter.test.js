/**
 * A LIMIT THAT CAN BE OVERSHOT IS NOT A LIMIT.
 *
 * Every test here is about the moment money is spent, so the ones that matter
 * are the refusals:
 *
 *   a request bigger than what is left   -> refused, not partially allowed
 *   a limit of zero                      -> "disabled", not "out of budget"
 *   a limit that is NULL in the column   -> the default, which is NOT zero
 *   a contact enriched last week         -> refused, with a time to come back
 *
 * Pure decision logic. No database.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { decide, DEFAULT_LIMITS } from "./enrichment-meter.js";

const LIMITS = { dailyUnits: 10, monthlyUnits: 100, cooldownHours: 24 };
const NOW = Date.parse("2026-09-27T12:00:00Z");
const hoursAgo = (h) => new Date(NOW - h * 3_600_000).toISOString();

test("a request inside budget is allowed", () => {
  const v = decide({ spentDay: 3, spentMonth: 20, cost: 1, limits: LIMITS, now: NOW });
  assert.equal(v.allowed, true);
  assert.deepEqual(v.remaining, { day: 7, month: 80 });
});

test("a request that would EXCEED the limit is refused, not trimmed", () => {
  // One unit left, a ten-unit request. Checking "is anything left" would let
  // this through and overshoot by nine on the most expensive call of the day.
  const v = decide({ spentDay: 9, spentMonth: 0, cost: 10, limits: LIMITS, now: NOW });
  assert.equal(v.allowed, false);
  assert.equal(v.reason, "daily_limit");
});

test("the request that exactly fills the budget is allowed", () => {
  assert.equal(decide({ spentDay: 9, cost: 1, limits: LIMITS, now: NOW }).allowed, true);
  assert.equal(decide({ spentDay: 10, cost: 1, limits: LIMITS, now: NOW }).allowed, false);
});

test("the monthly limit binds even when the daily one does not", () => {
  const v = decide({ spentDay: 0, spentMonth: 100, cost: 1, limits: LIMITS, now: NOW });
  assert.equal(v.reason, "monthly_limit");
});

test("zero means off, and says so rather than saying out of budget", () => {
  const v = decide({ spentDay: 0, spentMonth: 0, cost: 1, limits: { dailyUnits: 0, monthlyUnits: 100 }, now: NOW });
  assert.equal(v.allowed, false);
  assert.equal(v.reason, "enrichment_disabled");
});

test("an unset limit falls back to the service default, not to zero", () => {
  const v = decide({ spentDay: 0, spentMonth: 0, cost: 1, limits: {}, now: NOW });
  assert.equal(v.allowed, true);
  assert.equal(v.remaining.day, DEFAULT_LIMITS.dailyUnits);
  // And the same when the field is explicitly null, which is what the column
  // holds for "use the default".
  assert.equal(decide({ limits: { dailyUnits: null, monthlyUnits: null }, now: NOW }).allowed, true);
});

test("a contact enriched inside the cooldown is refused, with a time to come back", () => {
  const v = decide({ spentDay: 0, limits: LIMITS, contactLastAt: hoursAgo(6), now: NOW });
  assert.equal(v.allowed, false);
  assert.equal(v.reason, "recently_enriched");
  assert.equal(v.retryAfterHours, 18);
});

test("a contact enriched before the cooldown expired is allowed again", () => {
  const v = decide({ spentDay: 0, limits: LIMITS, contactLastAt: hoursAgo(25), now: NOW });
  assert.equal(v.allowed, true);
});

test("being over budget is reported even while the cooldown is what refuses", () => {
  // The client shows one message; whoever is debugging wants both facts.
  const v = decide({ spentDay: 10, limits: LIMITS, contactLastAt: hoursAgo(1), now: NOW });
  assert.equal(v.reason, "recently_enriched");
  assert.equal(v.remaining.day, 0);
});

test("junk in does not become permission out", () => {
  assert.equal(decide().allowed, true); // defaults, nothing spent
  assert.equal(decide({ contactLastAt: "not a date", limits: LIMITS, now: NOW }).allowed, true);
  assert.equal(decide({ spentDay: 1e9, limits: LIMITS, now: NOW }).allowed, false);
});
