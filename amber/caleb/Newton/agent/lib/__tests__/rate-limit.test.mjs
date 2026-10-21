/**
 * Tests for the tenant-scoped tool-call rate limiter.
 *
 * Run: node --test Newton/agent/lib/__tests__/rate-limit.test.mjs
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { withRateLimit, __internals } from "../middleware/rate-limit.js";

const TENANT_A = { tenant: { privyDid: "did:test:a" } };
const TENANT_B = { tenant: { privyDid: "did:test:b" } };

function passthrough() {
  return async (toolUse, ctx) => ({ ok: true, ctx });
}

test("allows calls under the limit", async () => {
  __internals.reset();
  const handler = withRateLimit("test_tool", passthrough());
  for (let i = 0; i < 10; i++) {
    const r = await handler({ name: "test_tool" }, TENANT_A);
    assert.equal(r.ok, true, `call ${i} should pass`);
  }
});

test("returns rate_limited error after bucket drained", async () => {
  __internals.reset();
  const handler = withRateLimit("test_tool", passthrough());
  // Drain bucket
  for (let i = 0; i < 60; i++) {
    await handler({ name: "test_tool" }, TENANT_A);
  }
  // 61st call should be rate-limited
  const r = await handler({ name: "test_tool" }, TENANT_A);
  assert.equal(r.error, "rate_limited");
  assert.equal(r.tool, "test_tool");
});

test("per-tenant isolation: A's drain does not affect B", async () => {
  __internals.reset();
  const handler = withRateLimit("test_tool", passthrough());
  for (let i = 0; i < 60; i++) {
    await handler({ name: "test_tool" }, TENANT_A);
  }
  // B should still be wide open
  const r = await handler({ name: "test_tool" }, TENANT_B);
  assert.equal(r.ok, true);
});

test("disabled when MEDHA_RATELIMIT_DISABLED=1", async () => {
  __internals.reset();
  const prev = process.env.MEDHA_RATELIMIT_DISABLED;
  process.env.MEDHA_RATELIMIT_DISABLED = "1";
  try {
    const handler = withRateLimit("test_tool", passthrough());
    for (let i = 0; i < 1000; i++) {
      const r = await handler({ name: "test_tool" }, TENANT_A);
      assert.equal(r.ok, true);
    }
  } finally {
    if (prev === undefined) delete process.env.MEDHA_RATELIMIT_DISABLED;
    else process.env.MEDHA_RATELIMIT_DISABLED = prev;
  }
});

test("missing tenant falls back to a shared no-tenant bucket", async () => {
  __internals.reset();
  const handler = withRateLimit("test_tool", passthrough());
  const r = await handler({ name: "test_tool" }, {});
  assert.equal(r.ok, true);
  assert.ok(__internals.buckets.has("_no_tenant_"));
});
