/**
 * Smoke tests for lib/middleware/auth-bounce.js
 *
 * Run with: node Newton/agent/lib/__tests__/auth-bounce.test.mjs
 *
 * Exits non-zero on failure. Mirrors the pattern used by sibling
 * *.test.mjs files in this directory — plain assertions over node:assert.
 */

import assert from "node:assert/strict";
import { withAuthBounce, __internals } from "../middleware/auth-bounce.js";

// Ensure no real medha-id endpoint is consulted during the test.
delete process.env.MEDHA_ID_URL;
delete process.env.MEDHA_ID_API_KEY;
delete process.env.AMBER_ID_API_URL;
delete process.env.AMBER_ID_API_KEY;

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`  ok  ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`  FAIL ${name}`);
    console.error(err);
  }
}

console.log("auth-bounce");

await test("pass-through: unmatched tool name runs inner", async () => {
  let ran = false;
  const inner = async () => {
    ran = true;
    return { ok: true };
  };
  const guarded = withAuthBounce("web_search", inner);
  const out = await guarded(
    { name: "web_search", input: {} },
    { tenant: { privyDid: "did:test" } },
  );
  assert.equal(ran, true);
  assert.deepEqual(out, { ok: true });
});

await test("fail-open: gated tool with no tenant DID runs inner", async () => {
  let ran = false;
  const inner = async () => {
    ran = true;
    return { ok: true };
  };
  const guarded = withAuthBounce("gcal_create_event", inner);
  const out = await guarded({ name: "gcal_create_event", input: {} }, {});
  assert.equal(ran, true, "inner should run when no DID is resolvable");
  assert.deepEqual(out, { ok: true });
});

await test("short-circuit: gated tool with DID but no connection returns connection_required", async () => {
  let ran = false;
  const inner = async () => {
    ran = true;
    return { ok: true };
  };
  const guarded = withAuthBounce("gcal_create_event", inner);
  const out = await guarded(
    { name: "gcal_create_event", input: {} },
    { tenant: { privyDid: "did:privy:test123" } },
  );
  assert.equal(ran, false, "inner must not run when connection is missing");
  assert.equal(out.error, "connection_required");
  assert.equal(out.service, "google_calendar");
  assert.equal(out.service_label, "Google Calendar");
  assert.equal(
    out.magic_link,
    null,
    "with no MEDHA_ID_URL configured, magic_link falls back to null",
  );
  assert.ok(out.message.includes("Google Calendar"));
});

await test("findRequirement: gcal_ + event_ + gmail_ + linkedin_ + apple_", () => {
  assert.equal(
    __internals.findRequirement("gcal_create_event")?.service,
    "google_calendar",
  );
  assert.equal(
    __internals.findRequirement("event_create")?.service,
    "google_calendar",
  );
  assert.equal(__internals.findRequirement("gmail_send")?.service, "gmail");
  assert.equal(
    __internals.findRequirement("linkedin_search")?.service,
    "linkedin",
  );
  assert.equal(
    __internals.findRequirement("apple_push_contact")?.service,
    "apple",
  );
  assert.equal(__internals.findRequirement("web_search"), null);
  assert.equal(__internals.findRequirement(""), null);
  assert.equal(__internals.findRequirement(null), null);
});

await test("withAuthBounce: throws TypeError on non-function handler", () => {
  assert.throws(() => withAuthBounce("x", null), TypeError);
  assert.throws(() => withAuthBounce("x", "not a fn"), TypeError);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
