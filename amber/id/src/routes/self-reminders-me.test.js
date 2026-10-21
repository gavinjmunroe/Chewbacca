/**
 * /v1/me/reminders/self — the app's reminder list, its manual entry, its tick-off.
 *
 * The db layer talks to Cloud SQL directly and is covered by the smoke test and
 * by the scheduler tests. What is worth pinning HERE is the part that is pure
 * decision-making and would otherwise only be exercised in production:
 *
 *   - the wire shape. The stored row carries delivery machinery (transport,
 *     address, attempts, last_error, the requester's phone). None of that is
 *     the client's business and some of it is another user's number in the
 *     cross-person case, so the response must be the narrow projection.
 *   - the 404. Not-yours, not-found, not-a-self-reminder and already-fired all
 *     have to answer identically, or the error code becomes a way to ask
 *     whether a given reminder id exists on someone else's account.
 *   - dueAt. A reminder with an unparseable time is refused rather than stored
 *     with due_at NULL, which never matches `due_at <= now` and would sit
 *     pending forever with nothing logged.
 *
 * Run with:  node --test src/routes/self-reminders-me.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";

import { registerSelfRemindersMeRoutes } from "./self-reminders-me.js";

const PHONE = "+13105550100";
const AMBER_ID = "amber-uuid-1";
const DUE = "2026-08-19T22:00:00.000Z";

// A stored row, in full, exactly as db/self-reminders.js writes it.
const STORED = {
  reminder_id: "rem_11111111-2222-3333-4444-555555555555",
  tenant_did: "did:privy:abc",
  requester_phone: PHONE,
  recipient_input: "self",
  recipient: { transport: "apple", address: PHONE, kind: "self", needs_resolution: false },
  when: { iso: DUE, source: "parsed", input: DUE, timezone: null },
  message: "Call Sagar about the raise",
  title: "Call Sagar",
  event_at: null,
  channels: { apple: true, imessage: false },
  cc_requester: false,
  status: "pending",
  created_at: "2026-08-19T17:00:00.000Z",
  fired_at: null,
  attempts: 0,
  origin: "self_reminder",
  source: "reminders_parse",
  contact: { id: "c-77", name: "Sagar Mehta" },
};

function build(overrides = {}) {
  const app = Fastify({ logger: false });
  const calls = { listed: [], created: [], setDone: [] };
  registerSelfRemindersMeRoutes(app, {
    requireAuth: async (request) => {
      request.privyUser = { userId: "did:privy:abc", phone: PHONE };
    },
    resolveAmberIdByPhone: async () => AMBER_ID,
    getNotificationChannels: async () => ({ apple: true, imessage: false }),
    listSelfRemindersForOwner: async (ownerId, opts) => {
      calls.listed.push({ ownerId, opts });
      return [STORED];
    },
    persistSelfReminder: async (args) => {
      calls.created.push(args);
      return { ...STORED, ...{ title: args.title, message: args.body }, contact: args.contact };
    },
    setSelfReminderDone: async (id, ownerId, done) => {
      calls.setDone.push({ id, ownerId, done });
      return done ? { ...STORED, status: "done", done_at: "2026-08-19T23:00:00.000Z" } : STORED;
    },
    ...overrides,
  });
  return { app, calls };
}

test("GET returns the narrow projection and nothing else", async () => {
  const { app, calls } = build();
  const res = await app.inject({ method: "GET", url: "/v1/me/reminders/self" });
  assert.equal(res.statusCode, 200);
  const [r] = res.json().reminders;

  assert.deepEqual(r, {
    reminderId: STORED.reminder_id,
    title: "Call Sagar",
    body: "Call Sagar about the raise",
    dueAt: DUE,
    done: false,
    doneAt: null,
    createdAt: STORED.created_at,
    contact: { id: "c-77", name: "Sagar Mehta" },
  });
  // Explicit, because deepEqual on the whole object is easy to loosen later and
  // these three are the ones that actually matter: a phone number, the delivery
  // transport, and the retry bookkeeping.
  assert.equal(r.requester_phone, undefined);
  assert.equal(r.recipient, undefined);
  assert.equal(r.attempts, undefined);
  // The owner came from the session, not from the request.
  assert.equal(calls.listed[0].ownerId, AMBER_ID);
});

test("GET: a reminder about nobody has contact null, not a made-up one", async () => {
  const { app } = build({
    listSelfRemindersForOwner: async () => [{ ...STORED, contact: null }],
  });
  const res = await app.inject({ method: "GET", url: "/v1/me/reminders/self" });
  assert.equal(res.json().reminders[0].contact, null);
});

test("POST stores the reminder and echoes it back", async () => {
  const { app, calls } = build();
  const res = await app.inject({
    method: "POST",
    url: "/v1/me/reminders/self",
    payload: { title: "Pick up prescription", dueAt: DUE, contactId: "c-9", contactName: "Dr Han" },
  });
  assert.equal(res.statusCode, 201);
  assert.equal(res.json().reminder.title, "Pick up prescription");
  const [args] = calls.created;
  assert.equal(args.source, "manual");
  assert.equal(args.fireAtISO, DUE);
  assert.equal(args.ownerPhone, PHONE);
  assert.deepEqual(args.contact, { id: "c-9", name: "Dr Han" });
});

test("POST refuses a due time it cannot parse", async () => {
  const { app, calls } = build();
  const res = await app.inject({
    method: "POST",
    url: "/v1/me/reminders/self",
    payload: { title: "Sometime", dueAt: "next tuesdayish" },
  });
  assert.equal(res.statusCode, 400);
  assert.equal(res.json().error, "invalid_due_at");
  // Nothing was written. A row with due_at NULL never matches the due scan.
  assert.equal(calls.created.length, 0);
});

test("POST refuses a reminder with no time at all", async () => {
  const { app } = build();
  const res = await app.inject({
    method: "POST",
    url: "/v1/me/reminders/self",
    payload: { title: "Someday" },
  });
  assert.equal(res.statusCode, 400);
});

test("PATCH ticks one off", async () => {
  const { app, calls } = build();
  const res = await app.inject({
    method: "PATCH",
    url: `/v1/me/reminders/self/${STORED.reminder_id}`,
    payload: { done: true },
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().reminder.done, true);
  assert.deepEqual(calls.setDone[0], { id: STORED.reminder_id, ownerId: AMBER_ID, done: true });
});

test("PATCH puts one back", async () => {
  const { app, calls } = build();
  const res = await app.inject({
    method: "PATCH",
    url: `/v1/me/reminders/self/${STORED.reminder_id}`,
    payload: { done: false },
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().reminder.done, false);
  assert.equal(calls.setDone[0].done, false);
});

test("PATCH: someone else's reminder is a 404, same as one that never existed", async () => {
  const { app } = build({ setSelfReminderDone: async () => null });
  const res = await app.inject({
    method: "PATCH",
    url: `/v1/me/reminders/self/${STORED.reminder_id}`,
    payload: { done: true },
  });
  assert.equal(res.statusCode, 404);
  assert.equal(res.json().error, "reminder_not_found");
});

test("PATCH rejects an id that is not a reminder id before touching the db", async () => {
  const { app, calls } = build();
  const res = await app.inject({
    method: "PATCH",
    url: "/v1/me/reminders/self/..%2F..%2Fadmin",
    payload: { done: true },
  });
  assert.equal(res.statusCode, 400);
  assert.equal(calls.setDone.length, 0);
});

test("a session with no phone cannot resolve an owner, and says so", async () => {
  const { app } = build({
    requireAuth: async (request) => {
      request.privyUser = { userId: "did:privy:abc" };
    },
  });
  const res = await app.inject({ method: "GET", url: "/v1/me/reminders/self" });
  assert.equal(res.statusCode, 400);
  assert.equal(res.json().error, "no_phone_on_session");
});
