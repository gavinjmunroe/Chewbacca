/**
 * WHAT /v1/reminders/parse DOES BESIDES PARSING.
 *
 * Each of these is a bug the owner hit with a real utterance, so each one is
 * asserted on the ROUTE rather than on a helper: the failure in every case was
 * a wiring failure, and a unit test on either end would have passed.
 *
 *   1. A STATED TIME GOES ON THE CALENDAR. "Anything with a stated time becomes
 *      an event on the calendar... even though they said 'remind.'" An utterance
 *      with no clock time is an open reminder instead, with no due_at.
 *   2. "no, 7:30 AM" MOVES the thing he just set. It used to be acknowledged in
 *      chat and dropped, leaving the 7:30 PM row in place -- and now that a
 *      timed thing is an EVENT, a correction that failed to move it would put a
 *      duplicate appointment on the calendar, which is worse.
 *   3. A correction id we did not offer moves nothing. The model supplies that
 *      id, and a hallucinated one must not be able to reschedule anything.
 *   4. Something that names somebody writes an observation against them, so the
 *      intention reaches PeopleRank instead of being thrown away.
 */

import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";

import { registerRemindersParseRoutes, parseReminders } from "./reminders-parse.js";

const PHONE = "+13105550100";
const AMBER_ID = "6f1a3c88-0000-4000-8000-000000000001";
const CONTACT_ID = "9c30df26-0014-4e6a-b66e-8cb26aca1586";
const NOW = new Date("2026-08-19T17:00:00.000Z");
const OLD_ID = "rem_11111111-2222-4333-8444-555555555555";

function build({
  parsed,
  recent = [],
  contact = null,
  updateReturns = undefined,
  recentEvents = [],
  moveReturns = undefined,
}) {
  const calls = {
    persisted: [],
    updated: [],
    observations: [],
    parseArgs: [],
    events: [],
    moved: [],
    openReminders: [],
  };
  const app = Fastify({ logger: false });
  registerRemindersParseRoutes(app, {
    requireAuth: async (request) => {
      request.privyUser = { userId: "did:amber:x", phone: PHONE };
    },
    parseReminders: async (args) => {
      calls.parseArgs.push(args);
      return parsed;
    },
    resolveAmberIdByPhone: async () => AMBER_ID,
    getNotificationChannels: async () => ({ apple: true, imessage: false }),
    listRecentSelfReminders: async () => recent,
    findContactByName: async () => contact,
    persistSelfReminder: async (args) => {
      calls.persisted.push(args);
      return { ...args, reminder_id: "rem_new-0000-4000-8000-000000000009" };
    },
    updateSelfReminder: async (id, owner, patch) => {
      calls.updated.push({ id, owner, patch });
      return updateReturns === undefined
        ? { reminder_id: id, status: "pending" }
        : updateReturns;
    },
    recordReminderObservation: async (args) => {
      calls.observations.push(args);
      return "obs-1";
    },
    createScheduledEvent: async (args) => {
      calls.events.push(args);
      return { eventId: "2c9a1f10-0000-4000-8000-00000000000e" };
    },
    updateScheduledEvent: async (id, owner, patch) => {
      calls.moved.push({ id, owner, patch });
      return moveReturns === undefined ? id : moveReturns;
    },
    listRecentCorrectableEvents: async () => recentEvents,
    createOpenReminder: async (args) => {
      calls.openReminders.push(args);
      return "rem_open-0000-4000-8000-000000000001";
    },
  });
  return { app, calls };
}

const post = (app, text) =>
  app.inject({
    method: "POST",
    url: "/v1/reminders/parse",
    payload: { text, nowISO: NOW.toISOString(), tzOffsetMinutes: -420 },
  });

/** An id in the shape listRecentCorrectableEvents hands out for an event. */
const OLD_EVENT_ID = "evt_2c9a1f10-3b44-4c55-9d66-7e8899aabbcc";

/** What normalizeItem produces for "call Sagar at 7:30am": a stated time. */
const timedItem = (over = {}) => ({
  kind: "event",
  title: "Call Sagar",
  body: "Call Sagar",
  description: null,
  place: null,
  allDay: false,
  startsAtISO: "2026-08-20T14:30:00.000Z",
  endsAtISO: null,
  repeat: "none",
  repeatUntilISO: null,
  personName: "Sagar",
  correctsId: null,
  ...over,
});

/** And for "remind me to call Sagar": no time at all. */
const untimedItem = (over = {}) => ({
  ...timedItem(),
  kind: "reminder",
  body: "Reminder: call Sagar",
  startsAtISO: null,
  ...over,
});

const CORRECTED = [timedItem({ correctsId: OLD_EVENT_ID })];

test("A STATED TIME GOES ON THE CALENDAR, not into the reminders list", async () => {
  const { app, calls } = build({ parsed: [timedItem({ personName: null })] });
  const res = await post(app, "I have a meeting tomorrow at 10 a.m. in Dumbo");
  assert.equal(res.statusCode, 200);

  // The bug this replaces: three explicit appointments in one afternoon, none
  // of which reached the calendar, because the event route required a NAMED
  // PERSON and a solo appointment could never satisfy it.
  assert.equal(calls.events.length, 1);
  assert.equal(calls.events[0].startsAt, "2026-08-20T14:30:00.000Z");
  assert.equal(calls.openReminders.length, 0, "a timed thing was filed as a reminder");
  assert.equal(calls.persisted.length, 1, "the event's own notification was not scheduled");
  assert.deepEqual(res.json().reminders, []);
  assert.equal(res.json().events.length, 1);
});

test("no stated time makes an OPEN reminder, with no due_at to fire at", async () => {
  const { app, calls } = build({ parsed: [untimedItem({ personName: null })] });
  const res = await post(app, "remind me to pick up my clothes sometime this week");
  assert.equal(calls.events.length, 0);
  assert.equal(calls.openReminders.length, 1);
  // persistSelfReminder is the TIMED path and it must not be reached: it builds
  // a row for a scheduler that scans on due_at, and this has none.
  assert.equal(calls.persisted.length, 0);
  assert.equal(res.json().reminders.length, 1);
  assert.deepEqual(res.json().events, []);
});

test("a correction MOVES the event it corrects instead of adding a second one", async () => {
  const { app, calls } = build({
    parsed: CORRECTED,
    recentEvents: [
      { id: OLD_EVENT_ID, title: "Call Sagar", fireAt: "2026-08-20T02:30:00.000Z" },
    ],
  });
  const res = await post(app, "no, 7:30 in the morning");
  assert.equal(res.statusCode, 200);

  // The event moved...
  assert.equal(calls.moved.length, 1);
  assert.equal(calls.moved[0].id, "2c9a1f10-3b44-4c55-9d66-7e8899aabbcc");
  assert.equal(calls.moved[0].owner, AMBER_ID);
  assert.equal(calls.moved[0].patch.startsAt, "2026-08-20T14:30:00.000Z");
  // ...and NOTHING was created. Two rows is the bug, and on a calendar it is a
  // worse bug than it was on a reminder: two appointments twelve hours apart,
  // one wrong, neither distinguishable from the other.
  assert.equal(calls.events.length, 0);

  const [e] = res.json().events;
  assert.equal(e.corrected, true);
});

test("a correctsId we never offered moves nothing, and still books the event", async () => {
  const { app, calls } = build({ parsed: CORRECTED, recentEvents: [] }); // nothing correctable
  const res = await post(app, "remind me to call Sagar at 7:30am");
  assert.equal(calls.moved.length, 0);
  assert.equal(calls.events.length, 1);
  assert.equal(res.json().events[0].corrected, false);
});

test("a correction whose event vanished mid-flight falls back to creating one", async () => {
  // Deleted or edited away between the list and the update. Having nothing at
  // all is the one outcome the user did not ask for.
  const { app, calls } = build({
    parsed: CORRECTED,
    recentEvents: [
      { id: OLD_EVENT_ID, title: "Call Sagar", fireAt: "2026-08-20T02:30:00.000Z" },
    ],
    moveReturns: null,
  });
  const res = await post(app, "no, 7:30 in the morning");
  assert.equal(calls.moved.length, 1);
  assert.equal(calls.events.length, 1);
  assert.equal(res.json().events[0].corrected, false);
});

test("an untimed reminder about somebody carries the contact and writes ONE observation", async () => {
  const { app, calls } = build({
    parsed: [untimedItem()],
    contact: { id: CONTACT_ID, name: "Sagar Tiwari" },
  });
  const res = await post(app, "remind me to call Sagar back");

  const [r] = res.json().reminders;
  assert.deepEqual(r.contact, { id: CONTACT_ID, name: "Sagar Tiwari" });
  // On the stored row too, which is what the card at the top of Notes & Journal
  // reads.
  assert.equal(calls.openReminders[0].contactId, CONTACT_ID);

  // An intention to call somebody is evidence about that relationship, and it
  // used to be thrown away. Losing it on the way to the new untimed path would
  // be the same loss a second time.
  assert.equal(calls.observations.length, 1);
  assert.equal(calls.observations[0].contactId, CONTACT_ID);
  assert.equal(calls.observations[0].ownerId, AMBER_ID);
});

test("a correction does NOT write a second observation for the same intention", async () => {
  const { app, calls } = build({
    parsed: CORRECTED,
    recent: [{ reminder_id: OLD_ID, title: "Call Sagar", when: { iso: "2026-08-20T02:30:00.000Z" } }],
    contact: { id: CONTACT_ID, name: "Sagar Tiwari" },
  });
  await post(app, "no, 7:30 in the morning");
  assert.equal(calls.observations.length, 0);
});

/**
 * ── THE WEEKEND REMINDER ─────────────────────────────────────────────────────
 *
 *   "I said a reminder that gave a clear time and frequency. I just wanted to be
 *    reminded on Saturday and Sunday to go find a place for some deep thinking
 *    and some deep work. It scheduled something tomorrow at 9 am to do deep
 *    work, and it didn't do anything for Sunday."
 *
 * Three separate failures in one utterance: a clock time nobody said, a calendar
 * entry for something that was never an appointment, and one of the two days
 * silently dropped. The first two are decided by normalizeItem, which is why
 * these drive the REAL parseReminders through a stubbed model rather than
 * handing the route a pre-shaped item -- the route tests above cannot see a
 * validation layer they bypass.
 */
const modelSaying = (items) => async () => ({
  ok: true,
  json: async () => ({ content: [{ type: "text", text: JSON.stringify({ items }) }] }),
});

const parseWith = (items) =>
  parseReminders({
    text: "remind me tomorrow and Sunday to find a place for deep work",
    nowISO: NOW.toISOString(),
    tzOffsetMinutes: -420,
    apiKey: "test-key",
    fetchImpl: modelSaying(items),
  });

test("a two-day reminder keeps both days, and never becomes an appointment", async () => {
  const [item, ...rest] = await parseWith([
    {
      kind: "reminder",
      title: "Find a place for deep work",
      body: "Reminder: find a place for deep work",
      description: "Go to a park",
      startsAtISO: null,
      endsAtISO: null,
      allDay: false,
      place: null,
      repeat: "weekends",
      repeatDays: null,
      startsOnISO: "2026-08-22",
      repeatUntilISO: "2026-08-23",
      personName: null,
      correctsId: null,
    },
  ]);
  assert.equal(rest.length, 0, "one utterance, one reminder -- not one per day");
  assert.equal(item.kind, "reminder");
  assert.equal(item.startsAtISO, null, "a day is not a time");
  assert.equal(item.repeat, "weekends");
  assert.equal(item.startsOnISO, "2026-08-22");
  assert.equal(item.repeatUntilISO, "2026-08-23", "one weekend, not every weekend");
});

test("'working all day' does not turn a reminder into an all-day event", async () => {
  // The model still gets the last word on what it emits, so this pins the half
  // that is ours: an item that says reminder AND allDay is contradictory, and a
  // stated time is the only thing that makes an event.
  const [item] = await parseWith([
    {
      kind: "reminder",
      title: "Find a place for deep work",
      body: "Reminder: find a place for deep work",
      startsAtISO: null,
      allDay: false,
      repeat: "weekends",
      startsOnISO: "2026-08-22",
      repeatUntilISO: "2026-08-23",
    },
  ]);
  assert.equal(item.kind, "reminder");
  assert.equal(item.allDay, false);
});

test("chosen weekdays survive only on a weekly repeat", async () => {
  /**
   * reminders_repeat_days_chk allows repeat_days ONLY when repeat = 'weekly'.
   * A model that helpfully attaches [6,0] to a "weekends" item would make the
   * INSERT fail its CHECK -- and the user's reminder would not exist at all,
   * with nothing on screen to say so.
   */
  const [weekly] = await parseWith([
    { kind: "reminder", title: "Bins out", startsAtISO: null, repeat: "weekly", repeatDays: [3, 1, 1, 99] },
  ]);
  assert.deepEqual(weekly.repeatDays, [1, 3], "deduped, sorted, junk dropped");

  const [weekend] = await parseWith([
    { kind: "reminder", title: "Long run", startsAtISO: null, repeat: "weekends", repeatDays: [0, 6] },
  ]);
  assert.equal(weekend.repeatDays, null);
});

test("a start date that is not a plain date is dropped, not coerced", async () => {
  // "tomorrow" resolved by nobody, or a full timestamp, would land in a `date`
  // column as whatever Postgres made of it. Null means "from now on", which is
  // the safe end of the two: shown too early beats never shown.
  for (const bad of ["tomorrow", "2026-08-22T09:00:00-07:00", "22/08/2026", "", null, 20260822]) {
    const [item] = await parseWith([
      { kind: "reminder", title: "Deep work", startsAtISO: null, repeat: "none", startsOnISO: bad },
    ]);
    assert.equal(item.startsOnISO, null, `accepted ${JSON.stringify(bad)}`);
  }
});

test("the day a reminder starts on reaches the row that gets written", async () => {
  // The wiring half. Everything above is about the shape of the item; this is
  // about it surviving the trip to the store, which is where this repo's
  // reminder bugs have actually lived.
  const { app, calls } = build({
    parsed: [
      untimedItem({
        title: "Find a place for deep work",
        personName: null,
        repeat: "weekends",
        repeatDays: null,
        startsOnISO: "2026-08-22",
        repeatUntilISO: "2026-08-23",
      }),
    ],
  });
  await post(app, "remind me tomorrow and Sunday to find a place for deep work");

  assert.equal(calls.openReminders.length, 1);
  assert.equal(calls.events.length, 0, "it went on the calendar");
  const row = calls.openReminders[0];
  assert.equal(row.repeat, "weekends");
  assert.equal(row.startsOn, "2026-08-22");
  assert.equal(row.repeatUntil, "2026-08-23");
});

test("the model's own label is overruled by whether a time was actually stated", async () => {
  /**
   * THE SAFETY NET, IN BOTH DIRECTIONS, and it has to salvage rather than drop.
   * A model that says "event" and gives no time has described a reminder --
   * dropping it would lose the user's reminder entirely, which is the one
   * outcome they did not ask for. A model that says "reminder" and gives a time
   * has described an event, because a stated time is the whole rule.
   */
  const [demoted] = await parseWith([
    { kind: "event", title: "Deep work", startsAtISO: null, allDay: false, repeat: "none" },
  ]);
  assert.equal(demoted.kind, "reminder", "an event with no time was thrown away");
  assert.equal(demoted.title, "Deep work");

  const [promoted] = await parseWith([
    {
      kind: "reminder",
      title: "Call Sagar",
      startsAtISO: "2026-08-22T19:30:00-07:00",
      allDay: false,
      repeat: "none",
    },
  ]);
  assert.equal(promoted.kind, "event");
  assert.equal(promoted.startsAtISO, "2026-08-22T19:30:00-07:00");
});
