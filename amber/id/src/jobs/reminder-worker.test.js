/**
 * Tests for the reminder delivery worker.
 *
 * Run with:  node --test src/jobs/reminder-worker.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { tickReminderWorker } from "./reminder-worker.js";

function silentLog() {
  return { info: () => {}, warn: () => {}, error: () => {} };
}

function makeFakeStore(rows = []) {
  const map = new Map();
  for (const r of rows) map.set(r.reminder_id, { ...r });
  return {
    map,
    listDueReminders: async () =>
      [...map.values()].filter((r) => r.status === "pending"),
    markReminderFired: async (id) => {
      const row = map.get(id);
      if (!row) return null;
      const updated = { ...row, status: "fired", fired_at: "x" };
      map.set(id, updated);
      return updated;
    },
    markReminderAttemptFailed: async (id, { reason, maxAttempts = 5 }) => {
      const row = map.get(id);
      if (!row) return null;
      const attempts = (Number(row.attempts) || 0) + 1;
      const updated = { ...row, attempts, last_error: reason };
      if (attempts >= maxAttempts) updated.status = "failed";
      map.set(id, updated);
      return updated;
    },
    markReminderResolved: async (id, recipient) => {
      const row = map.get(id);
      if (!row) return null;
      const updated = { ...row, recipient, recipient_resolved_at: "x" };
      map.set(id, updated);
      return updated;
    },
  };
}

function mockFetch(handler) {
  return async (url, opts) => handler(url, opts);
}

test("ticks no-op when no due rows", async () => {
  const store = makeFakeStore();
  const out = await tickReminderWorker({
    ...store,
    fetch: mockFetch(() => {
      throw new Error("should not be called");
    }),
    config: { platformUrl: "https://x", adminToken: "t" },
    log: silentLog(),
  });
  assert.equal(out.ok, true);
  assert.equal(out.fetched, 0);
  assert.equal(out.fired, 0);
  assert.equal(out.failed, 0);
});

test("fires an imessage reminder against /admin/send-message and marks fired", async () => {
  const store = makeFakeStore([
    {
      reminder_id: "rem_imessagedue",
      tenant_did: "did:privy:x",
      status: "pending",
      recipient: { transport: "imessage", address: "+13105551212" },
      message: "ping",
      when: { iso: "2026-01-01T00:00:00Z" },
      attempts: 0,
    },
  ]);
  let called = null;
  const out = await tickReminderWorker({
    ...store,
    fetch: mockFetch(async (url, opts) => {
      called = { url, opts };
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ ok: true }),
      };
    }),
    config: { platformUrl: "https://medha.test", adminToken: "secret" },
    log: silentLog(),
  });
  assert.equal(out.fired, 1);
  assert.equal(out.failed, 0);
  assert.ok(called.url.endsWith("/admin/send-message"));
  const body = JSON.parse(called.opts.body);
  assert.equal(body.to, "+13105551212");
  assert.equal(body.text, "ping");
  assert.equal(called.opts.headers["x-admin-token"], "secret");
  assert.equal(store.map.get("rem_imessagedue").status, "fired");
});

test("marks unsupported transport terminal failure on first attempt", async () => {
  const store = makeFakeStore([
    {
      reminder_id: "rem_slacknotyet",
      tenant_did: "did:privy:x",
      status: "pending",
      recipient: { transport: "slack", address: "@shirley" },
      message: "ping",
      when: { iso: "2026-01-01T00:00:00Z" },
      attempts: 0,
    },
  ]);
  const out = await tickReminderWorker({
    ...store,
    fetch: mockFetch(() => {
      throw new Error("should not be called");
    }),
    config: { platformUrl: "https://medha.test", adminToken: "secret" },
    log: silentLog(),
  });
  assert.equal(out.failed, 1);
  assert.equal(store.map.get("rem_slacknotyet").status, "failed");
  assert.match(
    store.map.get("rem_slacknotyet").last_error,
    /unsupported_transport:slack/,
  );
});

test("network failure retries: row stays pending, attempts increments", async () => {
  const store = makeFakeStore([
    {
      reminder_id: "rem_netfailures",
      tenant_did: "did:privy:x",
      status: "pending",
      recipient: { transport: "imessage", address: "+13105551212" },
      message: "ping",
      when: { iso: "2026-01-01T00:00:00Z" },
      attempts: 0,
    },
  ]);
  const out = await tickReminderWorker({
    ...store,
    fetch: mockFetch(async () => {
      const err = new Error("getaddrinfo ENOTFOUND");
      err.code = "ENOTFOUND";
      throw err;
    }),
    config: { platformUrl: "https://medha.test", adminToken: "secret" },
    log: silentLog(),
  });
  assert.equal(out.failed, 1);
  assert.equal(store.map.get("rem_netfailures").status, "pending");
  assert.equal(store.map.get("rem_netfailures").attempts, 1);
});

test("platform 4xx fails terminally", async () => {
  const store = makeFakeStore([
    {
      reminder_id: "rem_platform400",
      tenant_did: "did:privy:x",
      status: "pending",
      recipient: { transport: "imessage", address: "+13105551212" },
      message: "ping",
      when: { iso: "2026-01-01T00:00:00Z" },
      attempts: 0,
    },
  ]);
  await tickReminderWorker({
    ...store,
    fetch: mockFetch(async () => ({
      ok: false,
      status: 400,
      text: async () => "bad request",
    })),
    config: { platformUrl: "https://medha.test", adminToken: "secret" },
    log: silentLog(),
  });
  assert.equal(store.map.get("rem_platform400").status, "failed");
});

test("malformed row (missing recipient) marks terminal failure immediately", async () => {
  const store = makeFakeStore([
    {
      reminder_id: "rem_malformedrow",
      tenant_did: "did:privy:x",
      status: "pending",
      recipient: { transport: "imessage" },
      message: "ping",
      when: { iso: "2026-01-01T00:00:00Z" },
      attempts: 0,
    },
  ]);
  await tickReminderWorker({
    ...store,
    fetch: mockFetch(() => {
      throw new Error("should not be called");
    }),
    config: { platformUrl: "https://medha.test", adminToken: "secret" },
    log: silentLog(),
  });
  assert.equal(store.map.get("rem_malformedrow").status, "failed");
});

// --- Tab 31: cross-person reminders (@handle resolution + cc fyi) ---

function handleReminder(overrides = {}) {
  return {
    reminder_id: "rem_handle",
    tenant_did: "did:privy:owner",
    requester_phone: "+15550100002",
    recipient_input: "@shirley",
    recipient: {
      transport: "slack",
      address: "@shirley",
      kind: "handle",
      needs_resolution: true,
    },
    message: "send the deck",
    cc_requester: false,
    status: "pending",
    when: { iso: "2026-01-01T00:00:00Z" },
    attempts: 0,
    ...overrides,
  };
}

test("resolves @handle to a contact phone, rewrites the row, and delivers via imessage", async () => {
  const store = makeFakeStore([handleReminder()]);
  let called = null;
  const out = await tickReminderWorker({
    ...store,
    resolveHandle: async (did, handle) => {
      assert.equal(did, "did:privy:owner");
      assert.equal(handle, "@shirley");
      return {
        id: "contact_shirley",
        name: "Shirley Park",
        phoneNumbersNormalized: ["+13105550199"],
      };
    },
    fetch: mockFetch(async (url, opts) => {
      called = { url, opts };
      return { ok: true, status: 200, text: async () => "{}" };
    }),
    config: { platformUrl: "https://medha.test", adminToken: "secret" },
    log: silentLog(),
  });
  assert.equal(out.fired, 1);
  assert.equal(out.failed, 0);
  // Delivered to the resolved phone over the admin send endpoint.
  const body = JSON.parse(called.opts.body);
  assert.equal(body.to, "+13105550199");
  assert.equal(body.text, "send the deck");
  // Row rewritten + fired, with the resolution persisted.
  const row = store.map.get("rem_handle");
  assert.equal(row.status, "fired");
  assert.equal(row.recipient.kind, "contact_phone");
  assert.equal(row.recipient.address, "+13105550199");
  assert.equal(row.recipient.needs_resolution, false);
  assert.equal(row.recipient.resolved_contact_id, "contact_shirley");
  assert.equal(row.recipient_resolved_at, "x");
});

test("falls back to raw phoneNumbers when the contact has no normalized list", async () => {
  const store = makeFakeStore([handleReminder()]);
  let body = null;
  await tickReminderWorker({
    ...store,
    resolveHandle: async () => ({
      id: "c1",
      name: "Shirley",
      phoneNumbers: ["(310) 555-0144"],
    }),
    fetch: mockFetch(async (url, opts) => {
      body = JSON.parse(opts.body);
      return { ok: true, status: 200, text: async () => "{}" };
    }),
    config: { platformUrl: "https://medha.test", adminToken: "secret" },
    log: silentLog(),
  });
  assert.equal(body.to, "+13105550144");
});

test("unknown @handle fails terminally as failed_unknown_handle, no send", async () => {
  const store = makeFakeStore([handleReminder()]);
  const out = await tickReminderWorker({
    ...store,
    resolveHandle: async () => null,
    fetch: mockFetch(() => {
      throw new Error("should not be called");
    }),
    config: { platformUrl: "https://medha.test", adminToken: "secret" },
    log: silentLog(),
  });
  assert.equal(out.failed, 1);
  const row = store.map.get("rem_handle");
  assert.equal(row.status, "failed");
  assert.match(row.last_error, /failed_unknown_handle:@shirley/);
});

test("matched contact with no phone fails terminally", async () => {
  const store = makeFakeStore([handleReminder()]);
  await tickReminderWorker({
    ...store,
    resolveHandle: async () => ({
      id: "c1",
      name: "Shirley",
      phoneNumbers: [],
    }),
    fetch: mockFetch(() => {
      throw new Error("should not be called");
    }),
    config: { platformUrl: "https://medha.test", adminToken: "secret" },
    log: silentLog(),
  });
  const row = store.map.get("rem_handle");
  assert.equal(row.status, "failed");
  assert.match(row.last_error, /unresolvable_handle_no_phone/);
});

test("transient resolver error keeps the row pending for retry", async () => {
  const store = makeFakeStore([handleReminder()]);
  await tickReminderWorker({
    ...store,
    resolveHandle: async () => {
      throw new Error("firestore unavailable");
    },
    fetch: mockFetch(() => {
      throw new Error("should not be called");
    }),
    config: { platformUrl: "https://medha.test", adminToken: "secret" },
    log: silentLog(),
  });
  const row = store.map.get("rem_handle");
  assert.equal(row.status, "pending");
  assert.equal(row.attempts, 1);
  assert.match(row.last_error, /handle_resolution_error/);
});

test("cc_requester sends an fyi to the requester after a non-self delivery", async () => {
  const store = makeFakeStore([
    handleReminder({ reminder_id: "rem_cc", cc_requester: true }),
  ]);
  const sends = [];
  await tickReminderWorker({
    ...store,
    resolveHandle: async () => ({
      id: "c1",
      name: "Shirley",
      phoneNumbersNormalized: ["+13105550199"],
    }),
    fetch: mockFetch(async (url, opts) => {
      sends.push(JSON.parse(opts.body));
      return { ok: true, status: 200, text: async () => "{}" };
    }),
    config: { platformUrl: "https://medha.test", adminToken: "secret" },
    log: silentLog(),
  });
  // Two sends: the reminder to Shirley, then the fyi back to the requester.
  assert.equal(sends.length, 2);
  assert.equal(sends[0].to, "+13105550199");
  assert.equal(sends[1].to, "+15550100002");
  assert.match(sends[1].text, /just reminded @shirley/);
  assert.equal(store.map.get("rem_cc").status, "fired");
});

test("a failed cc fyi does not un-fire the reminder", async () => {
  const store = makeFakeStore([
    {
      reminder_id: "rem_ccfail",
      tenant_did: "did:privy:owner",
      requester_phone: "+15550100002",
      recipient: {
        transport: "imessage",
        address: "+13105550199",
        kind: "phone",
      },
      message: "ping",
      cc_requester: true,
      status: "pending",
      when: { iso: "2026-01-01T00:00:00Z" },
      attempts: 0,
    },
  ]);
  let n = 0;
  const out = await tickReminderWorker({
    ...store,
    fetch: mockFetch(async () => {
      n += 1;
      // First send (the reminder) succeeds; the second (cc) fails.
      if (n === 1) return { ok: true, status: 200, text: async () => "{}" };
      return { ok: false, status: 500, text: async () => "boom" };
    }),
    config: { platformUrl: "https://medha.test", adminToken: "secret" },
    log: silentLog(),
  });
  assert.equal(out.fired, 1);
  assert.equal(out.failed, 0);
  assert.equal(store.map.get("rem_ccfail").status, "fired");
});

test("cc is skipped when the requester is the recipient", async () => {
  const store = makeFakeStore([
    {
      reminder_id: "rem_ccself",
      tenant_did: "did:privy:owner",
      requester_phone: "+15550100002",
      recipient: {
        transport: "imessage",
        address: "+15550100002",
        kind: "phone",
      },
      message: "ping yourself",
      cc_requester: true,
      status: "pending",
      when: { iso: "2026-01-01T00:00:00Z" },
      attempts: 0,
    },
  ]);
  const sends = [];
  await tickReminderWorker({
    ...store,
    fetch: mockFetch(async (url, opts) => {
      sends.push(JSON.parse(opts.body));
      return { ok: true, status: 200, text: async () => "{}" };
    }),
    config: { platformUrl: "https://medha.test", adminToken: "secret" },
    log: silentLog(),
  });
  // Only the reminder send — no duplicate fyi to the same person.
  assert.equal(sends.length, 1);
  assert.equal(store.map.get("rem_ccself").status, "fired");
});
