/**
 * THE ROUTES BEHIND THE STRIP AND THE TWO EDITORS.
 *
 * The store is tested against a real Postgres in db/schedule-store.test.js.
 * These are about the ROUTE: who is allowed in, what a malformed body does, and
 * whether the values the client sends arrive at the store unmangled -- the
 * wiring, which is where this repo's reminder bugs have actually lived.
 */
import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { registerScheduleRoutes } from "./schedule.js";

const PHONE = "+13105550100";
const AMBER_ID = "6f1a3c88-0000-4000-8000-000000000001";
const REM = "rem_11111111-2222-4333-8444-555555555555";
const EVT = "2c9a1f10-3b44-4c55-9d66-7e8899aabbcc";

function build({ authed = true, owner = AMBER_ID, phone = PHONE, listReturns = [] } = {}) {
  const calls = { listed: [], done: [], patchedReminder: [], patchedEvent: [], deleted: [] };
  const app = Fastify({ logger: false });
  registerScheduleRoutes(app, {
    requireAuth: async (request) => {
      if (authed) request.privyUser = { userId: "did:amber:x", phone };
    },
    resolveAmberIdByPhone: async () => owner,
    listOpenReminders: async (o, args) => {
      calls.listed.push({ o, args });
      return listReturns;
    },
    setReminderDoneOn: async (id, o, args) => {
      calls.done.push({ id, o, args });
      return true;
    },
    updateReminderDetail: async (id, o, patch) => {
      calls.patchedReminder.push({ id, o, patch });
      return id;
    },
    deleteReminder: async (id, o) => {
      calls.deleted.push({ kind: "reminder", id, o });
      return true;
    },
    updateScheduledEvent: async (id, o, patch) => {
      calls.patchedEvent.push({ id, o, patch });
      return id;
    },
    deleteScheduledEvent: async (id, o) => {
      calls.deleted.push({ kind: "event", id, o });
      return true;
    },
  });
  return { app, calls };
}

const get = (app, url) => app.inject({ method: "GET", url });
const post = (app, url, payload) => app.inject({ method: "POST", url, payload });
const patch = (app, url, payload) => app.inject({ method: "PATCH", url, payload });
const del = (app, url) => app.inject({ method: "DELETE", url });

test("the day the client asked for is the day the store is asked for", async () => {
  const { app, calls } = build({ listReturns: [{ id: REM, title: "Drink water" }] });
  const res = await get(app, "/v1/me/open-reminders?onDate=2026-09-11");
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().reminders.length, 1);
  // A DAY IS A TIMEZONE QUESTION and the client is the one who knows the answer.
  // Anything that quietly substituted the server's today would put a Sydney
  // user's reminders on the wrong day for most of their waking life.
  assert.equal(calls.listed[0].args.onDate, "2026-09-11");
  assert.equal(calls.listed[0].o, AMBER_ID);
});

test("a request with no date is refused rather than guessed at", async () => {
  const { app, calls } = build();
  const res = await get(app, "/v1/me/open-reminders");
  assert.equal(res.statusCode, 400);
  assert.equal(calls.listed.length, 0, "the store was asked anyway");
});

test("a date that is not a date is refused by the schema", async () => {
  const { app, calls } = build();
  for (const bad of ["today", "2026-9-1", "2026-09-11T10:00:00Z", ""]) {
    const res = await get(app, `/v1/me/open-reminders?onDate=${encodeURIComponent(bad)}`);
    assert.equal(res.statusCode, 400, `accepted ${JSON.stringify(bad)}`);
  }
  assert.equal(calls.listed.length, 0);
});

test("signed out is 401, and a session with no phone is 400", async () => {
  const out = build({ authed: false });
  assert.equal((await get(out.app, "/v1/me/open-reminders?onDate=2026-09-11")).statusCode, 401);
  assert.equal(out.calls.listed.length, 0);

  const noPhone = build({ phone: null });
  assert.equal((await get(noPhone.app, "/v1/me/open-reminders?onDate=2026-09-11")).statusCode, 400);
  assert.equal(noPhone.calls.listed.length, 0);
});

test("an unresolvable owner never reaches the store", async () => {
  const { app, calls } = build({ owner: null });
  const res = await get(app, "/v1/me/open-reminders?onDate=2026-09-11");
  assert.equal(res.statusCode, 400);
  assert.equal(calls.listed.length, 0, "a null owner was passed through to a query");
});

test("ticking off defaults to done, and un-ticking has to say so", async () => {
  const { app, calls } = build();
  await post(app, `/v1/me/open-reminders/${REM}/complete`, { onDate: "2026-09-11" });
  assert.equal(calls.done[0].args.done, true, "the common case needs a body field");

  await post(app, `/v1/me/open-reminders/${REM}/complete`, { onDate: "2026-09-11", done: false });
  assert.equal(calls.done[1].args.done, false);
});

test("ticking off without a date is refused", async () => {
  const { app, calls } = build();
  const res = await post(app, `/v1/me/open-reminders/${REM}/complete`, { done: true });
  assert.equal(res.statusCode, 400);
  assert.equal(calls.done.length, 0);
});

test("the reminder editor passes every field through unmangled", async () => {
  const { app, calls } = build();
  const body = {
    title: "Bins out",
    description: "Recycling too",
    place: "Front step",
    repeat: "weekly",
    repeatDays: [1, 3],
    repeatUntil: "2026-12-31",
    notifyAtLocal: "07:30",
  };
  const res = await patch(app, `/v1/me/open-reminders/${REM}`, body);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(calls.patchedReminder[0].patch, body);
  assert.equal(calls.patchedReminder[0].id, REM);
});

test("a field name nobody recognizes is rejected, not silently dropped", async () => {
  // An edit the user watched fail to happen is the one failure an editor cannot
  // have, and a silently ignored typo is exactly that.
  const { app, calls } = build();
  const res = await patch(app, `/v1/me/open-reminders/${REM}`, { frequency: "daily" });
  assert.equal(res.statusCode, 400);
  assert.equal(calls.patchedReminder.length, 0);
});

test("a repeat the app does not understand is rejected", async () => {
  const { app, calls } = build();
  assert.equal((await patch(app, `/v1/me/open-reminders/${REM}`, { repeat: "fortnightly" })).statusCode, 400);
  assert.equal((await patch(app, `/v1/me/calendar-events/${EVT}`, { repeat: "sometimes" })).statusCode, 400);
  assert.equal(calls.patchedReminder.length, 0);
  assert.equal(calls.patchedEvent.length, 0);
});

test("a weekday outside 0-6 is rejected", async () => {
  const { app } = build();
  assert.equal((await patch(app, `/v1/me/open-reminders/${REM}`, { repeatDays: [1, 9] })).statusCode, 400);
  assert.equal((await patch(app, `/v1/me/open-reminders/${REM}`, { repeatDays: [-1] })).statusCode, 400);
});

test("clearing an event's notification survives the schema as null", async () => {
  /**
   * null IS A CHOICE -- "no notification" -- and it is not the same as omitting
   * the field. A schema that only accepted an integer would turn "turn it off"
   * into a 400 the user reads as the app refusing to save.
   */
  const { app, calls } = build();
  const res = await patch(app, `/v1/me/calendar-events/${EVT}`, { notifyMinutesBefore: null });
  assert.equal(res.statusCode, 200);
  assert.equal("notifyMinutesBefore" in calls.patchedEvent[0].patch, true);
  assert.equal(calls.patchedEvent[0].patch.notifyMinutesBefore, null);
});

test("a notification lead beyond four weeks is rejected", async () => {
  const { app } = build();
  assert.equal((await patch(app, `/v1/me/calendar-events/${EVT}`, { notifyMinutesBefore: 999999 })).statusCode, 400);
  assert.equal((await patch(app, `/v1/me/calendar-events/${EVT}`, { notifyMinutesBefore: -1 })).statusCode, 400);
});

test("the event editor passes its fields through, and deletes are owner-scoped", async () => {
  const { app, calls } = build();
  await patch(app, `/v1/me/calendar-events/${EVT}`, {
    title: "Quarterly review",
    startsAt: "2026-09-12T14:00:00-04:00",
    endsAt: "2026-09-12T15:00:00-04:00",
    place: "Dumbo",
    allDay: false,
  });
  assert.equal(calls.patchedEvent[0].id, EVT);
  assert.equal(calls.patchedEvent[0].o, AMBER_ID);
  assert.equal(calls.patchedEvent[0].patch.place, "Dumbo");

  await del(app, `/v1/me/calendar-events/${EVT}`);
  await del(app, `/v1/me/open-reminders/${REM}`);
  assert.deepEqual(
    calls.deleted.map((d) => [d.kind, d.o]),
    [
      ["event", AMBER_ID],
      ["reminder", AMBER_ID],
    ],
    "a delete ran without the owner it must be scoped to",
  );
});

test("a store that says no becomes a 404, not a silent success", async () => {
  const app = Fastify({ logger: false });
  registerScheduleRoutes(app, {
    requireAuth: async (request) => {
      request.privyUser = { userId: "did:amber:x", phone: PHONE };
    },
    resolveAmberIdByPhone: async () => AMBER_ID,
    setReminderDoneOn: async () => false,
    updateReminderDetail: async () => null,
    updateScheduledEvent: async () => null,
    deleteReminder: async () => false,
    deleteScheduledEvent: async () => false,
  });
  assert.equal(
    (await post(app, `/v1/me/open-reminders/${REM}/complete`, { onDate: "2026-09-11" })).statusCode,
    404,
  );
  assert.equal((await patch(app, `/v1/me/open-reminders/${REM}`, { title: "x" })).statusCode, 404);
  assert.equal((await patch(app, `/v1/me/calendar-events/${EVT}`, { title: "x" })).statusCode, 404);
  assert.equal((await del(app, `/v1/me/open-reminders/${REM}`)).statusCode, 404);
  assert.equal((await del(app, `/v1/me/calendar-events/${EVT}`)).statusCode, 404);
});

test("a store that throws is a 404 rather than a 500", async () => {
  // Every one of these is a user action on a row that may have gone away. A
  // stack trace reaching the phone as a 500 is a crash dialog for "somebody
  // deleted it".
  const app = Fastify({ logger: false });
  registerScheduleRoutes(app, {
    requireAuth: async (request) => {
      request.privyUser = { userId: "did:amber:x", phone: PHONE };
    },
    resolveAmberIdByPhone: async () => AMBER_ID,
    updateScheduledEvent: async () => {
      throw new Error("connection reset");
    },
  });
  assert.equal((await patch(app, `/v1/me/calendar-events/${EVT}`, { title: "x" })).statusCode, 404);
});

/**
 * POST /v1/me/calendar-events -- the manual way onto the calendar.
 *
 *   "there should be an add event manually for calendar button that opens up
 *    that UI for making a calendar event"
 *
 * Every event before this arrived by being said out loud. That path is fine
 * until it is not: when migrations 049 and 050 turned out to be unapplied, every
 * INSERT threw and there was no second way to put anything on the calendar. The
 * point of a form is to not share a failure mode with a parser, so what is
 * pinned here is mostly the failure behavior.
 */
function buildScheduleApp({ authed = true, createScheduledEvent } = {}) {
  const app = Fastify({ logger: false });
  registerScheduleRoutes(app, {
    requireAuth: async (request) => {
      if (authed) request.privyUser = { userId: "did:amber:x", phone: PHONE };
    },
    resolveAmberIdByPhone: async () => AMBER_ID,
    createScheduledEvent,
  });
  return app;
}

test("A MANUAL EVENT LANDS, and comes back with the id the sheet needs", async () => {
  const seen = [];
  const app = buildScheduleApp({
    createScheduledEvent: async (args) => {
      seen.push(args);
      return { eventId: "evt-1" };
    },
  });
  const res = await app.inject({
    method: "POST",
    url: "/v1/me/calendar-events",
    payload: {
      title: "Meet with Vega on Google Meet",
      startsAt: "2026-09-14T16:00:00.000Z",
      notifyMinutesBefore: 60,
    },
  });
  assert.equal(res.statusCode, 201);
  assert.equal(res.json().id, "evt-1");
  assert.equal(seen[0].title, "Meet with Vega on Google Meet");
  assert.equal(seen[0].notifyMinutesBefore, 60);
  assert.ok(seen[0].ownerId, "the event was created without an owner");
  await app.close();
});

test("AN EVENT WITH NO TIME NEVER REACHES THE STORE", async () => {
  /**
   * A stated time is the whole distinction between an event and a reminder, and
   * a create route that accepted a blank one would land rows on today by
   * accident -- the exact bug migration 048 was written to end.
   *
   * THE STORE SUCCEEDS HERE, on purpose. The first version of this test used a
   * store that always threw, so the handler's catch returned 400 whatever the
   * schema did -- deleting `required` entirely changed nothing and every test
   * stayed green. The only way to test the schema is to make everything behind
   * it work.
   */
  const seen = [];
  const app = buildScheduleApp({
    createScheduledEvent: async (a) => {
      seen.push(a);
      return { eventId: "evt-should-not-happen" };
    },
  });
  for (const payload of [
    { title: "No time at all" },
    { startsAt: "2026-09-14T16:00:00.000Z" },
    { title: "", startsAt: "2026-09-14T16:00:00.000Z" },
    {},
  ]) {
    const res = await app.inject({ method: "POST", url: "/v1/me/calendar-events", payload });
    assert.notEqual(res.statusCode, 201, `accepted ${JSON.stringify(payload)}`);
  }
  assert.deepEqual(seen, [], "an event with no title or no time reached the database");
  await app.close();
});

test("a time the store cannot read is a named 400, not a 500", async () => {
  // createScheduledEvent is the last line of defense: the schema only checks
  // that startsAt is a non-empty string, and "sometime tuesday" is one.
  const app = buildScheduleApp({
    createScheduledEvent: async () => {
      throw new Error("createScheduledEvent: startsAt must be a valid instant");
    },
  });
  const res = await app.inject({
    method: "POST",
    url: "/v1/me/calendar-events",
    payload: { title: "Bad time", startsAt: "sometime tuesday" },
  });
  assert.equal(res.statusCode, 400);
  assert.match(res.json().message, /start time/i, "did not say what was wrong with it");
  await app.close();
});

test("A FAILED CREATE SAYS SO, which is the entire reason this route exists", async () => {
  /**
   * The write outage was invisible because every layer returned something that
   * looked like nothing-to-do. A create path that 500s with an empty body, or
   * worse reports success, would rebuild that exact hole in a new place.
   */
  const app = buildScheduleApp({
    createScheduledEvent: async () => {
      throw new Error('column "description" does not exist');
    },
  });
  const res = await app.inject({
    method: "POST",
    url: "/v1/me/calendar-events",
    payload: { title: "Anything", startsAt: "2026-09-14T16:00:00.000Z" },
  });
  assert.equal(res.statusCode, 400);
  assert.equal(res.json().error, "could_not_create");
  assert.ok(res.json().message, "failed with no message for the user");
  await app.close();
});

test("a store that returns nothing is a failure, not a success with no id", async () => {
  const app = buildScheduleApp({ createScheduledEvent: async () => null });
  const res = await app.inject({
    method: "POST",
    url: "/v1/me/calendar-events",
    payload: { title: "Anything", startsAt: "2026-09-14T16:00:00.000Z" },
  });
  assert.notEqual(res.statusCode, 201);
  assert.equal(res.json().error, "could_not_create");
  await app.close();
});

test("creating is behind the session, like every other verb here", async () => {
  const seen = [];
  const app = buildScheduleApp({
    authed: false,
    createScheduledEvent: async (a) => {
      seen.push(a);
      return { eventId: "evt-1" };
    },
  });
  const res = await app.inject({
    method: "POST",
    url: "/v1/me/calendar-events",
    payload: { title: "Anything", startsAt: "2026-09-14T16:00:00.000Z" },
  });
  assert.ok(res.statusCode === 401 || res.statusCode === 400);
  assert.deepEqual(seen, [], "wrote an event for an unauthenticated caller");
  await app.close();
});
