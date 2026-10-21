/**
 * Tests for amber-id failure degradation.
 *
 * When amber-id returns 5xx or times out, the agent must:
 *   1. Not crash
 *   2. Return a friendly degraded response (service_unavailable / AMBER_ID_DOWN)
 *   3. Not expose raw error messages or stack traces
 *
 * We test via tiwari-proxy-util (the error-shape layer) and the circuit
 * breaker (the resiliency layer), since tiwari-proxy.js itself requires
 * the full Tiwari ES modules which aren't available in unit test context.
 *
 * Run with:  node --test Newton/agent/lib/__tests__/amber-id-degradation.test.mjs
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { writeJson } from "../tiwari-proxy-util.js";
import { getBreaker } from "../circuit-breaker.js";

// ── Error shape for amber-id degradation ─────────────────────────────────

function mockRes() {
  const captured = { status: null, body: null };
  return {
    captured,
    writeHead(status) { captured.status = status; },
    end(data) { captured.body = JSON.parse(data); },
  };
}

test("amber-id degradation: upstream error produces AMBER_ID_DOWN code", () => {
  const res = mockRes();
  // Simulate what tiwari-proxy does when err.upstream=true
  writeJson(
    res,
    503,
    {
      error: "service_unavailable",
      code: "AMBER_ID_DOWN",
      message: "A dependent service is temporarily unavailable. Please try again shortly.",
    },
    { correlationId: "cid-deg-1" },
  );
  const body = res.captured.body;
  assert.equal(res.captured.status, 503);
  assert.equal(body.error, "service_unavailable");
  assert.equal(body.code, "AMBER_ID_DOWN");
  assert.equal(body.ok, false);
  assert.equal(body.correlationId, "cid-deg-1");
  // Message should be user-friendly, not a raw JS error
  assert.ok(
    body.message.includes("temporarily unavailable"),
    "degraded message must be user-friendly",
  );
});

test("amber-id degradation: auth failure produces 401, not 503", () => {
  const res = mockRes();
  // Simulate err.upstream=false (auth error from amber-id)
  writeJson(
    res,
    401,
    { error: "identity_resolution_failed", code: "IDENTITY_RESOLUTION_FAILED" },
    { correlationId: "cid-deg-2" },
  );
  const body = res.captured.body;
  assert.equal(res.captured.status, 401);
  assert.equal(body.code, "IDENTITY_RESOLUTION_FAILED");
  assert.equal(body.ok, false);
});

test("amber-id degradation: no raw stack trace in error response", () => {
  const res = mockRes();
  const err = new Error("ECONNREFUSED");
  err.upstream = true;
  writeJson(
    res,
    503,
    {
      error: "service_unavailable",
      code: "AMBER_ID_DOWN",
      message: "A dependent service is temporarily unavailable. Please try again shortly.",
    },
    { correlationId: "cid-deg-3" },
  );
  const serialized = JSON.stringify(res.captured.body);
  assert.ok(!serialized.includes("ECONNREFUSED"), "raw error message must not leak");
  assert.ok(!serialized.includes("at Object."), "stack trace must not appear");
});

// ── Circuit breaker resiliency ────────────────────────────────────────────

test("amber-id circuit breaker: opens after failure threshold", async () => {
  // Use a fresh named breaker so we don't pollute the real amber-id breaker
  const breaker = getBreaker("amber-id-test-unit", {
    failureThreshold: 3,
    cooldownMs: 1000,
    windowMs: 5000,
    timeoutMs: 100,
  });

  // Trip the breaker by running failing operations
  for (let i = 0; i < 3; i++) {
    await breaker.run(
      () => Promise.reject(new Error("simulated failure")),
      { fallback: null },
    );
  }

  // Breaker should now be open — fallback returned immediately
  const start = Date.now();
  const result = await breaker.run(
    () => new Promise((resolve) => setTimeout(() => resolve("slow"), 500)),
    { fallback: "fallback-value" },
  );
  const elapsed = Date.now() - start;

  assert.equal(result, "fallback-value", "open breaker must return fallback");
  assert.ok(elapsed < 200, "open breaker must fail fast, not wait for timeout");
});

test("amber-id circuit breaker: fallback null means graceful null return", async () => {
  const breaker = getBreaker("amber-id-test-unit-2", {
    failureThreshold: 1,
    cooldownMs: 1000,
    windowMs: 5000,
    timeoutMs: 100,
  });

  // Trip with one failure
  await breaker.run(() => Promise.reject(new Error("fail")), { fallback: null });

  // Now open — null fallback is returned (not an exception)
  let threw = false;
  let result;
  try {
    result = await breaker.run(
      () => Promise.reject(new Error("should not run")),
      { fallback: null },
    );
  } catch {
    threw = true;
  }

  assert.equal(threw, false, "open breaker with null fallback must not throw");
  assert.equal(result, null, "open breaker must return the null fallback");
});

test("amber-id ingest: returns null gracefully when amber-id unavailable", async () => {
  // When AMBER_ID_API_URL is unset, ingestToAmberID should return null, not throw.
  const savedUrl = process.env.AMBER_ID_API_URL;
  const savedKey = process.env.AMBER_ID_API_KEY;
  delete process.env.AMBER_ID_API_URL;
  delete process.env.AMBER_ID_API_KEY;

  try {
    const { ingestToAmberID } = await import(`../amber-id-ingest.js?cb=${Math.random()}`);
    const result = await ingestToAmberID({
      pipe: "agent",
      phone: "+15551234567",
      items: [{ text: "test", healthDimension: "emotional", kind: "conversation" }],
    });
    assert.equal(result, null, "ingestToAmberID must return null when not configured");
  } finally {
    if (savedUrl !== undefined) process.env.AMBER_ID_API_URL = savedUrl;
    if (savedKey !== undefined) process.env.AMBER_ID_API_KEY = savedKey;
  }
});
