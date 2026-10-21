/**
 * Tests for the lightweight circuit breaker.
 *
 * Run with:  node --test Newton/agent/lib/__tests__/circuit-breaker.test.mjs
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { getBreaker } from "../circuit-breaker.js";

test("breaker: opens after threshold failures, fails fast", async () => {
  const b = getBreaker(`t-${Math.random()}`, {
    failureThreshold: 3,
    cooldownMs: 50,
    timeoutMs: 100,
  });

  let calls = 0;
  const failingFn = async () => {
    calls++;
    throw new Error("boom");
  };

  // Three failures to trip
  for (let i = 0; i < 3; i++) {
    const r = await b.run(failingFn, { fallback: "fb" });
    assert.equal(r, "fb");
  }
  assert.equal(b.status().state, "open");

  // After open: no further fn calls
  const before = calls;
  const r = await b.run(failingFn, { fallback: "fb" });
  assert.equal(r, "fb");
  assert.equal(calls, before, "fn must not be invoked while open");
});

test("breaker: half-open admits a probe and closes on success", async () => {
  const b = getBreaker(`half-${Math.random()}`, {
    failureThreshold: 2,
    cooldownMs: 30,
    timeoutMs: 100,
  });
  await b.run(async () => { throw new Error("a"); }, { fallback: null });
  await b.run(async () => { throw new Error("b"); }, { fallback: null });
  assert.equal(b.status().state, "open");

  await new Promise((r) => setTimeout(r, 50));
  const result = await b.run(async () => "ok", { fallback: null });
  assert.equal(result, "ok");
  assert.equal(b.status().state, "closed");
});

test("breaker: timeout counts as failure", async () => {
  const b = getBreaker(`to-${Math.random()}`, {
    failureThreshold: 2,
    cooldownMs: 50,
    timeoutMs: 30,
  });
  // Fn that hangs longer than timeout
  const hang = async () => new Promise((res) => setTimeout(res, 200));
  await b.run(hang, { fallback: null });
  await b.run(hang, { fallback: null });
  assert.equal(b.status().state, "open");
});
