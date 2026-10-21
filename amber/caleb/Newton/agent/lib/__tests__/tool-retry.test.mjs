/**
 * Tests for the read-only tool retry middleware (Tab 14, item 193).
 *
 * Run with:  node --test Newton/agent/lib/__tests__/tool-retry.test.mjs
 */

import { test, before, after } from "node:test";
import assert from "node:assert/strict";

import {
  withToolRetry,
  RETRYABLE_READ_TOOLS,
  __internals,
} from "../middleware/tool-retry.js";

before(() => __internals.setBackoff([0, 0])); // no real waits in tests
after(() => __internals.resetBackoff());

test("a write tool is a pure pass-through (never retried)", () => {
  assert.equal(RETRYABLE_READ_TOOLS.has("schedule_event"), false);
  const fn = () => "x";
  // For a non-allowlisted tool, withToolRetry returns the SAME function ref.
  assert.equal(withToolRetry("schedule_event", fn), fn);
});

test("a read tool recovers on a transient throw, then succeeds", async () => {
  let calls = 0;
  const handler = withToolRetry("list_events", async () => {
    calls++;
    if (calls === 1) throw new Error("socket hang up");
    return { ok: true, events: [] };
  });
  const result = await handler({ name: "list_events" }, {});
  assert.deepEqual(result, { ok: true, events: [] });
  assert.equal(calls, 2);
});

test("a read tool recovers on a transient RESULT envelope", async () => {
  let calls = 0;
  const handler = withToolRetry("gmail_search", async () => {
    calls++;
    if (calls < 3) return { error: "upstream_unavailable" };
    return { ok: true, messages: [] };
  });
  const result = await handler({ name: "gmail_search" }, {});
  assert.deepEqual(result, { ok: true, messages: [] });
  assert.equal(calls, 3);
});

test("exhausting retries returns a structured tool_unavailable envelope", async () => {
  let calls = 0;
  const handler = withToolRetry("drive_search", async () => {
    calls++;
    throw new Error("ETIMEDOUT");
  });
  const result = await handler({ name: "drive_search" }, {});
  assert.equal(result.error, "tool_unavailable");
  assert.equal(result.tool, "drive_search");
  assert.ok(result.message.length > 0);
  assert.equal(calls, 3); // 1 + 2 backoff attempts
});

test("exhausting retries on a transient RESULT returns the last envelope", async () => {
  const handler = withToolRetry("get_availability", async () => ({
    error: "rate_limited",
    message: "slow down",
  }));
  const result = await handler({ name: "get_availability" }, {});
  assert.equal(result.error, "rate_limited");
});

test("a NON-transient throw is surfaced unchanged (no retry)", async () => {
  let calls = 0;
  const handler = withToolRetry("list_events", async () => {
    calls++;
    throw new Error("auth_required: reconnect Google");
  });
  await assert.rejects(
    () => handler({ name: "list_events" }, {}),
    /auth_required/,
  );
  assert.equal(calls, 1);
});

test("a NON-transient error envelope is returned immediately (no retry)", async () => {
  let calls = 0;
  const handler = withToolRetry("list_events", async () => {
    calls++;
    return { error: "not_found", message: "no such calendar" };
  });
  const result = await handler({ name: "list_events" }, {});
  assert.equal(result.error, "not_found");
  assert.equal(calls, 1);
});

test("a clean success returns on the first attempt with no retry", async () => {
  let calls = 0;
  const handler = withToolRetry("summarize_week", async () => {
    calls++;
    return { ok: true };
  });
  const result = await handler({ name: "summarize_week" }, {});
  assert.deepEqual(result, { ok: true });
  assert.equal(calls, 1);
});

test("transient detection helpers behave", () => {
  assert.equal(__internals.isTransientThrow(new Error("fetch failed")), true);
  assert.equal(__internals.isTransientThrow({ name: "AbortError" }), true);
  assert.equal(__internals.isTransientThrow(new Error("bad input")), false);
  assert.equal(__internals.isTransientResult({ error: "timeout" }), true);
  assert.equal(__internals.isTransientResult({ error: "not_found" }), false);
  assert.equal(__internals.isTransientResult({ ok: true }), false);
});

test("withToolRetry rejects a non-function handler", () => {
  assert.throws(() => withToolRetry("list_events", null), TypeError);
});
