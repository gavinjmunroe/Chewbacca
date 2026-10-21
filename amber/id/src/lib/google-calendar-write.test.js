import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { createGoogleCalendarEvent } from "./google-calendar-write.js";
import { registerScheduleRoutes } from "../routes/schedule.js";
const owner = "11111111-1111-4111-8111-111111111111";
const accountId = "22222222-2222-4222-8222-222222222222";
const requestId = "33333333-3333-4333-8333-333333333333";
const input = { ownerId: owner, accountId, requestId, title: "Test", description: "Note", startsAt: "2026-10-01T10:00:00-07:00", endsAt: "2026-10-01T10:30:00-07:00" };
const response = (data, status = 200) => ({ ok: status < 300, status, json: async () => data });
function fixture() {
  const events = new Map(); const mirrors = new Map(); let posts = 0; let loseReply = false; let failMirror = false;
  const deps = {
    readAccounts: async id => { assert.equal(id, owner); return [{ id: accountId, owner_id: owner, provider: "google", account_email: "test@example.com" }]; },
    accessToken: async () => "test-token",
    upsert: async (id, account, event) => { assert.equal(id, owner); assert.equal(account, accountId); if (failMirror) return null; mirrors.set(event.externalId, event); return { eventId: "local-id" }; },
    fetch: async (url, options) => {
      assert.equal(options.headers.authorization, "Bearer test-token");
      if (url.endsWith("calendarList/primary")) return response({ id: "test@example.com", accessRole: "owner" });
      if (options.method === "POST") {
        posts++; const event = JSON.parse(options.body);
        assert.equal(event.attendees, undefined); assert.match(event.id, /^[0-9a-v]{64}$/);
        if (events.has(event.id)) return response({}, 409);
        events.set(event.id, event);
        if (loseReply) throw Error("timeout");
        return response(event, 201);
      }
      return response(events.get(url.split("/").pop()));
    },
  };
  return { deps, events, mirrors, posts: () => posts, loseReply: () => { loseReply = true; }, failMirror: v => { failMirror = v; } };
}
test("writes Google before mirroring with the inbound-sync key and normalized instants", async () => {
  const f = fixture(); const result = await createGoogleCalendarEvent(input, f.deps);
  assert.equal(result.destination, "google"); assert.equal(result.replayed, false);
  assert.equal(f.mirrors.get(result.googleEventId).startsAt, "2026-10-01T17:00:00.000Z");
  assert.equal(f.events.size, 1); assert.equal(f.mirrors.size, 1);
});
test("lost response and concurrent retries converge to one event and one Amber mirror", async () => {
  const f = fixture(); f.loseReply();
  await assert.rejects(createGoogleCalendarEvent(input, f.deps), { code: "google_unconfirmed" });
  const replies = await Promise.all([createGoogleCalendarEvent(input, f.deps), createGoogleCalendarEvent(input, f.deps)]);
  assert.ok(replies.every(r => r.replayed)); assert.equal(f.events.size, 1); assert.equal(f.mirrors.size, 1);
});
test("Google success with failed local sync retries without duplicating Google", async () => {
  const f = fixture(); f.failMirror(true);
  await assert.rejects(createGoogleCalendarEvent(input, f.deps), { code: "google_saved_amber_pending" });
  f.failMirror(false); assert.equal((await createGoogleCalendarEvent(input, f.deps)).replayed, true);
  assert.equal(f.events.size, 1); assert.equal(f.mirrors.size, 1);
});
test("same request ID with different details, or cancelled Google event, is a conflict", async () => {
  const f = fixture(); const result = await createGoogleCalendarEvent(input, f.deps);
  await assert.rejects(createGoogleCalendarEvent({ ...input, title: "Changed" }, f.deps), { code: "google_action_conflict" });
  f.events.get(result.googleEventId).status = "cancelled";
  await assert.rejects(createGoogleCalendarEvent(input, f.deps), { code: "google_action_conflict" });
  assert.equal(f.events.size, 1);
});
test("account belonging to another owner is never refreshed or written", async () => {
  const f = fixture(); f.deps.readAccounts = async () => [{ id: accountId, owner_id: "other", provider: "google" }];
  f.deps.accessToken = () => assert.fail("must not refresh another owner's token");
  await assert.rejects(createGoogleCalendarEvent(input, f.deps), { code: "google_not_connected" });
});
test("missing token, read-only grant, and Google 403 never claim a save", async () => {
  const f = fixture();
  await assert.rejects(createGoogleCalendarEvent(input, { ...f.deps, accessToken: async () => null }), { code: "google_reconnect" });
  await assert.rejects(createGoogleCalendarEvent(input, { ...f.deps, fetch: async () => response({ id: "primary", accessRole: "reader" }) }), { code: "google_not_writable" });
  await assert.rejects(createGoogleCalendarEvent(input, { ...f.deps, fetch: async () => response({}, 403) }), { code: "google_reconnect" });
  assert.equal(f.mirrors.size, 0);
});
test("bad dates and request identities are rejected before external writes", async () => {
  const f = fixture();
  for (const patch of [{ endsAt: input.startsAt }, { startsAt: "2026-10-01T10:00:00" }, { title: " " }, { requestId: "bad" }])
    await assert.rejects(createGoogleCalendarEvent({ ...input, ...patch }, f.deps));
  assert.equal(f.posts(), 0);
});
test("route authenticates, validates, binds server owner, and exposes confirmed destination", async () => {
  const app = Fastify(); let calls = 0;
  registerScheduleRoutes(app, { requireAuth: async req => { req.privyUser = { userId: "test", phone: "+12025550101" }; }, resolveAmberIdByPhone: async () => owner,
    createGoogleCalendarEvent: async args => { calls++; assert.equal(args.ownerId, owner); return { eventId: "test", destination: "google" }; } });
  const send = payload => app.inject({ method: "POST", url: "/v1/me/google-calendar-events", payload });
  try {
    assert.equal((await send({ ...input, ownerId: "attacker" })).json().destination, "google");
    assert.equal((await send({ ...input, accountId: "invalid" })).statusCode, 400);
    assert.equal(calls, 1);
  } finally { await app.close(); }
  const unauth = Fastify(); registerScheduleRoutes(unauth, { requireAuth: async () => {}, createGoogleCalendarEvent: () => assert.fail("must not create") });
  try { assert.equal((await unauth.inject({ method: "POST", url: "/v1/me/google-calendar-events", payload: input })).statusCode, 401); } finally { await unauth.close(); }
});
