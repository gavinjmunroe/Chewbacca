/**
 * Smoke tests for the Tab 16 additions to lib/tools/reminders.js:
 *   - list_my_reminders proxies GET /v1/me/reminders
 *   - cancel_reminder proxies DELETE /v1/me/reminders/:id
 *
 * Run with:
 *   node Newton/agent/lib/__tests__/reminders-list-cancel.test.mjs
 */

import assert from "node:assert/strict";

process.env.MEDHA_ID_URL = "https://stub.invalid";
process.env.MEDHA_ID_API_KEY = "test-key";

const { executeRemindersTool } = await import("../tools/reminders.js");

let passed = 0;
let failed = 0;
const originalFetch = global.fetch;

async function test(name, fn) {
  global.fetch = originalFetch;
  try {
    await fn();
    passed += 1;
    console.log(`  ok  ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`  FAIL ${name}`);
    console.error(err);
  } finally {
    global.fetch = originalFetch;
  }
}

function fakeResponse({ status = 200, body = "" }) {
  return {
    status,
    ok: status >= 200 && status < 300,
    async text() {
      return typeof body === "string" ? body : JSON.stringify(body);
    },
  };
}

const tenant = {
  privyDid: "did:privy:sagar-test",
  phoneNumber: "+13105551212",
};

console.log("reminders list/cancel tools");

await test("list_my_reminders requires resolved tenant", async () => {
  const out = await executeRemindersTool("list_my_reminders", {}, {});
  assert.match(out.error, /resolved tenant/);
});

await test("list_my_reminders proxies to GET /v1/me/reminders", async () => {
  let captured = null;
  global.fetch = async (url, opts) => {
    captured = { url, opts };
    return fakeResponse({
      status: 200,
      body: {
        reminders: [
          {
            reminder_id: "rem_one",
            tenant_did: tenant.privyDid,
            recipient: {
              transport: "imessage",
              address: "+1...",
              kind: "self",
            },
            when: {
              iso: "2026-06-01T00:00:00Z",
              timezone: "America/Los_Angeles",
            },
            message: "ping",
            status: "pending",
            created_at: "2026-05-27T00:00:00Z",
          },
        ],
      },
    });
  };
  const out = await executeRemindersTool(
    "list_my_reminders",
    { limit: 5 },
    { tenant },
  );
  assert.equal(out.count, 1);
  assert.equal(out.reminders[0].reminder_id, "rem_one");
  assert.equal(out.reminders[0].status, "pending");
  assert.equal(out.status, "pending");
  assert.ok(captured.url.includes("/v1/me/reminders"));
  assert.ok(captured.url.includes("limit=5"));
  assert.equal(captured.opts.method, "GET");
  assert.equal(captured.opts.headers["x-amber-phone"], tenant.phoneNumber);
  assert.equal(captured.opts.headers["x-api-key"], "test-key");
});

await test("list_my_reminders surfaces medha-id 4xx as structured error", async () => {
  global.fetch = async () =>
    fakeResponse({
      status: 400,
      body: { error: "invalid_status", message: "oops" },
    });
  const out = await executeRemindersTool(
    "list_my_reminders",
    { status: "bogus" },
    { tenant },
  );
  assert.equal(out.error, "invalid_status");
  assert.equal(out.message, "oops");
});

await test("cancel_reminder validates the reminder_id shape", async () => {
  const out = await executeRemindersTool(
    "cancel_reminder",
    { reminder_id: "not-a-real-id" },
    { tenant },
  );
  assert.match(out.error, /reminder_id is required/);
});

await test("cancel_reminder proxies to DELETE /v1/me/reminders/:id", async () => {
  let captured = null;
  global.fetch = async (url, opts) => {
    captured = { url, opts };
    return fakeResponse({
      status: 200,
      body: {
        ok: true,
        reminder: {
          reminder_id: "rem_abc12345",
          tenant_did: tenant.privyDid,
          recipient: { transport: "imessage", address: "+1...", kind: "self" },
          when: { iso: "2026-06-01T00:00:00Z" },
          message: "ping",
          status: "cancelled",
          created_at: "2026-05-27T00:00:00Z",
        },
      },
    });
  };
  const out = await executeRemindersTool(
    "cancel_reminder",
    { reminder_id: "rem_abc12345" },
    { tenant },
  );
  assert.equal(out.cancelled, true);
  assert.equal(out.reminder.status, "cancelled");
  assert.ok(captured.url.endsWith("/v1/me/reminders/rem_abc12345"));
  assert.equal(captured.opts.method, "DELETE");
});

await test("cancel_reminder maps a 404 from medha-id to a structured error", async () => {
  global.fetch = async () =>
    fakeResponse({ status: 404, body: { error: "reminder_not_found" } });
  const out = await executeRemindersTool(
    "cancel_reminder",
    { reminder_id: "rem_unknownrow" },
    { tenant },
  );
  assert.equal(out.error, "reminder_not_found");
});

await test("missing MEDHA_ID env is reported, not silently dropped", async () => {
  const prevUrl = process.env.MEDHA_ID_URL;
  const prevKey = process.env.MEDHA_ID_API_KEY;
  delete process.env.MEDHA_ID_URL;
  delete process.env.MEDHA_ID_API_KEY;
  delete process.env.AMBER_ID_API_URL;
  delete process.env.AMBER_ID_API_KEY;
  try {
    const out = await executeRemindersTool("list_my_reminders", {}, { tenant });
    assert.equal(out.error, "medha_id_unconfigured");
  } finally {
    process.env.MEDHA_ID_URL = prevUrl;
    process.env.MEDHA_ID_API_KEY = prevKey;
  }
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
