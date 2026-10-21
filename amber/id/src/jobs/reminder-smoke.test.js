/**
 * SMOKE TEST: a self-reminder from the words the user says to the text that
 * arrives on their phone, with nothing stubbed except the network and the DB.
 *
 * This wires the REAL modules together — the parse route, buildSelfReminderRow,
 * and the scheduler tick — so it catches the class of bug that unit tests on each
 * piece cannot: a field one side writes and the other side never reads. The
 * notification payloads had exactly that bug (a noteId that was always empty),
 * which is why this exists as its own file.
 *
 * Run with:  node --test src/jobs/reminder-smoke.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";

import { registerRemindersParseRoutes } from "../routes/reminders-parse.js";
import { buildSelfReminderRow, SELF_REMINDER_MAX_ATTEMPTS } from "../db/self-reminders.js";
import { DEFAULT_NOTIFY_MINUTES } from "../db/schedule-store.js";
import { tickReminderScheduler } from "./reminder-scheduler.js";

const PHONE = "+13105550100";
const AMBER_ID = "amber-uuid-1";
const NOW = new Date("2026-08-19T17:00:00.000Z");
const FIRE_AT = new Date("2026-08-19T22:00:00.000Z"); // 5pm local, later today

/**
 * The parser is an LLM call in production. Here it returns a fixed item, so the
 * test is about the PIPELINE, not about time parsing (which reminders.test.js
 * already covers).
 *
 * IT IS AN EVENT NOW, AND THAT IS THE POINT OF THIS FIXTURE.
 *
 *   "Anything with a stated time becomes an event on the calendar. ... If they
 *    say, 'Remind me to pick up my clothes at 3 pm today,' then that immediately
 *    becomes a scheduled event in the calendar, even though they said 'remind.'"
 *
 * "Call Sagar at 5" has a clock time, so it goes on the calendar -- and the row
 * this file has always been about is now the EVENT'S NOTIFICATION rather than a
 * reminder. Everything downstream of buildSelfReminderRow is unchanged: same
 * table, same scheduler, same transport switch, which is exactly what this smoke
 * test exists to hold together. Only what the row is FOR has moved.
 */
const PARSED = [
  {
    kind: "event",
    title: "Call Sagar",
    body: "Call Sagar about the raise",
    description: null,
    place: null,
    allDay: false,
    startsAtISO: FIRE_AT.toISOString(),
    endsAtISO: null,
    repeat: "none",
    repeatUntilISO: null,
    personName: null,
    correctsId: null,
  },
];

function buildParseApp({ channels, spy }) {
  const app = Fastify({ logger: false });
  registerRemindersParseRoutes(app, {
    requireAuth: async (request) => {
      request.privyUser = { userId: "did:amber:x", phone: PHONE };
    },
    parseReminders: async () => PARSED,
    resolveAmberIdByPhone: async () => AMBER_ID,
    getNotificationChannels: async () => channels,
    persistSelfReminder: async (args) => {
      const row = buildSelfReminderRow(args);
      spy.rows.push(row);
      return row;
    },
    // The DB is the one thing stubbed. What matters here is the row that comes
    // out the other side, not where the event landed.
    createScheduledEvent: async () => ({ eventId: "evt-1" }),
    createOpenReminder: async () => "rem_open_1",
  });
  return app;
}

const parse = (app) =>
  app.inject({
    method: "POST",
    url: "/v1/reminders/parse",
    payload: { text: "remind me to call Sagar at 5", nowISO: NOW.toISOString(), tzOffsetMinutes: -420 },
  });

test("iMessage OFF: a row IS written, and the scheduler will not text it", async () => {
  const spy = { rows: [] };
  const app = buildParseApp({ channels: { apple: true, imessage: false }, spy });
  const res = await parse(app);
  assert.equal(res.statusCode, 200);
  // A TIMED THING IS AN EVENT, so the reminders array is empty and the events
  // array holds it. The app schedules its own lock-screen notification from the
  // response; that channel is delivered on-device either way.
  assert.deepEqual(res.json().reminders, []);
  assert.equal(res.json().events.length, 1);

  // THE ROW EXISTS NOW, and it used to not. It was written only when the owner
  // had iMessage on, which made a reminder's existence a side effect of a
  // notification preference: the app had nothing to list or tick off, and a
  // reinstall lost every reminder the user had ever set.
  assert.equal(spy.rows.length, 1);
  const row = spy.rows[0];
  assert.equal(row.origin, "self_reminder");
  assert.equal(row.status, "pending");

  // AND IT MUST NOT BE DELIVERABLE. listDueSelfReminders scans for
  //   data->'recipient'->>'transport' = 'imessage'
  // so a row written with that transport would be texted at fire time — on top
  // of the lock-screen notification the phone has already delivered. The
  // transport names the channel the user actually chose, so this row is stored
  // and never scanned.
  assert.equal(row.recipient.transport, "apple");
  assert.equal(row.recipient.kind, "self");
  assert.equal(row.channels.apple, true);
  assert.equal(row.channels.imessage, false);
});

test("iMessage OFF: the due scan's own filter is what excludes the apple row", async () => {
  // The assertion above is on the field; this one is on the PREDICATE, so the
  // two cannot drift apart. Written against the same shape listDueSelfReminders
  // queries, because a SQL string is the one thing a unit test cannot execute.
  const spy = { rows: [] };
  await parse(buildParseApp({ channels: { apple: true, imessage: false }, spy }));
  const appleRow = spy.rows[0];
  const spy2 = { rows: [] };
  await parse(buildParseApp({ channels: { apple: true, imessage: true }, spy: spy2 }));
  const imessageRow = spy2.rows[0];

  const scanned = [appleRow, imessageRow].filter(
    (r) => r.origin === "self_reminder" && r.recipient.transport === "imessage",
  );
  assert.deepEqual(
    scanned.map((r) => r.reminder_id),
    [imessageRow.reminder_id],
  );
});

test("iMessage ON: a server row is written, addressed to the caller's OWN number", async () => {
  const spy = { rows: [] };
  const app = buildParseApp({ channels: { apple: true, imessage: true }, spy });
  const res = await parse(app);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json().reminders, []);
  assert.equal(res.json().events.length, 1);
  assert.equal(spy.rows.length, 1);
  const row = spy.rows[0];
  assert.equal(row.status, "pending");
  assert.equal(row.origin, "self_reminder");
  // Tagged, so no reader ever shows the user an alert about their own event as
  // though it were a second thing they set. See listScheduledReminders.
  assert.equal(row.kind, "event_notification");
  assert.equal(row.event_id, "evt-1");
  // transport and kind are exactly what listDueSelfReminders filters on
  //   data->>'origin' = 'self_reminder' AND data->'recipient'->>'transport' = 'imessage'
  // so if either drifts, rows are written and then never delivered, silently.
  assert.equal(row.recipient.transport, "imessage");
  assert.equal(row.recipient.kind, "self");
  assert.equal(row.recipient.address, PHONE);
  assert.ok(row.message && row.message.length > 0);

  // THE SEAM. createReminder stores this object as `data` and derives the two
  // indexed columns from it: due_at from when.iso, owner_id from tenant_did. If
  // either input is missing the row is unschedulable — due_at NULL never matches
  // `due_at <= now`, so it would sit pending forever with nothing logged.
  /**
   * TEN MINUTES BEFORE THE EVENT, NOT AT IT.
   *
   * "Calendar events get a notification 10 minutes before they occur."
   *
   * This used to assert the row fired AT the reminder's own time, which was
   * right when the row WAS the reminder. It is now the event's alert, so the
   * lead is the thing worth pinning -- and it is asserted as a subtraction from
   * FIRE_AT rather than as a literal instant, so the test still means "ten
   * minutes before" if the fixture's hour ever moves.
   */
  assert.equal(
    new Date(row.when.iso).getTime(),
    FIRE_AT.getTime() - DEFAULT_NOTIFY_MINUTES * 60_000,
  );
  // And event_at carries the real thing, so the text can say what it is about.
  assert.equal(new Date(row.event_at).toISOString(), FIRE_AT.toISOString());
  assert.ok(row.tenant_did, "tenant_did is what owner_id is resolved from");
});

// ── The other half: the row the route wrote is the row the scheduler delivers ──

function dueFrom(row) {
  return [{ ownerId: AMBER_ID, reminder: row }];
}

async function rowForDelivery() {
  const spy = { rows: [] };
  const app = buildParseApp({ channels: { apple: true, imessage: true }, spy });
  await parse(app);
  return spy.rows[0];
}

test("the scheduler texts the owner's own number and deletes the row", async () => {
  const row = await rowForDelivery();
  const sends = [];
  const deleted = [];
  const out = await tickReminderScheduler({
    log: { info() {}, warn() {} },
    listDueSelfReminders: async () => dueFrom(row),
    getUserPhoneByAmberId: async (id) => (id === AMBER_ID ? PHONE : null),
    send: async (args) => {
      sends.push(args);
      return { ok: true };
    },
    deleteReminderById: async (id) => {
      deleted.push(id);
      return 1;
    },
    now: new Date(FIRE_AT.getTime() + 1000),
  });
  assert.equal(out.sent, 1);
  assert.equal(out.failed, 0);
  assert.equal(sends.length, 1);
  assert.equal(sends[0].to, PHONE);
  assert.match(sends[0].text, /Sagar/);
  // Delete-on-complete: the same id the route generated.
  assert.deepEqual(deleted, [row.reminder_id]);
});

test("the destination is re-resolved from owner_id, never taken from the row", async () => {
  // The isolation guarantee. If a row's stored address were ever wrong or
  // tampered with, the text still goes to the number the OWNER id resolves to.
  const row = await rowForDelivery();
  const tampered = {
    ...row,
    recipient: { ...row.recipient, address: "+15555550123" },
  };
  const sends = [];
  await tickReminderScheduler({
    log: { info() {}, warn() {} },
    listDueSelfReminders: async () => [{ ownerId: AMBER_ID, reminder: tampered }],
    getUserPhoneByAmberId: async () => PHONE,
    send: async (a) => {
      sends.push(a);
      return { ok: true };
    },
    deleteReminderById: async () => 1,
    now: new Date(FIRE_AT.getTime() + 1000),
  });
  assert.equal(sends[0].to, PHONE, "must text the owner's resolved number, not the stored one");
});

test("a send failure records an attempt and does NOT delete or double-send", async () => {
  const row = await rowForDelivery();
  const deleted = [];
  const failures = [];
  const out = await tickReminderScheduler({
    log: { info() {}, warn() {} },
    listDueSelfReminders: async () => dueFrom(row),
    getUserPhoneByAmberId: async () => PHONE,
    send: async () => ({ ok: false, reason: "loop_down" }),
    deleteReminderById: async (id) => {
      deleted.push(id);
      return 1;
    },
    recordSelfReminderFailure: async (id, reason) => {
      failures.push({ id, reason });
      return { attempts: 1 };
    },
    now: new Date(FIRE_AT.getTime() + 1000),
  });
  assert.equal(out.sent, 0);
  assert.equal(out.failed, 1);
  assert.equal(deleted.length, 0, "a failed send must not delete the reminder");
  assert.equal(failures.length, 1);
});

test("nothing due is a quiet no-op, not an error", async () => {
  const out = await tickReminderScheduler({
    log: { info() {}, warn() {} },
    listDueSelfReminders: async () => [],
    now: NOW,
  });
  assert.deepEqual(out, { ok: true, fetched: 0, sent: 0, failed: 0 });
});

test("a retry ceiling exists, so a permanently broken row cannot loop forever", () => {
  assert.ok(Number.isInteger(SELF_REMINDER_MAX_ATTEMPTS));
  assert.ok(SELF_REMINDER_MAX_ATTEMPTS >= 1 && SELF_REMINDER_MAX_ATTEMPTS <= 10);
});
