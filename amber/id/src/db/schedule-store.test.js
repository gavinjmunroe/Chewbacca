/**
 * A STATED TIME GOES ON THE CALENDAR. EVERYTHING ELSE WAITS AT THE TOP.
 *
 * Run with the rest: npm test. Needs a database -- set AGENDA_TEST_DATABASE_URL
 * (or DATABASE_URL) at a scratch Postgres with db/migrations applied. Skips
 * loudly rather than passing when there is none.
 *
 * ── WHY THESE ARE DATABASE TESTS ────────────────────────────────────────────
 *
 * Because nearly all of the behavior IS the SQL: which day a repeating reminder
 * falls on, whether ticking Tuesday ends a daily series, and three CHECK
 * constraints that bind the repeat columns to each other. None of that can be
 * exercised by a unit test against a mock, and this repo has already learned
 * twice that a test writing its own SQL will keep passing while the real query
 * rots (see the note in agenda-scheduled.test.js).
 */
import test from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import {
  createScheduledEvent,
  createOpenReminder,
  listOpenReminders,
  setReminderDoneOn,
  updateReminderDetail,
  updateScheduledEvent,
  deleteScheduledEvent,
  DEFAULT_NOTIFY_MINUTES,
} from "./schedule-store.js";
import { __injectPoolForSmokeTests } from "./sql.js";

const URL =
  process.env.AGENDA_TEST_DATABASE_URL ||
  process.env.TEST_DATABASE_URL ||
  process.env.DATABASE_URL ||
  "";

const OWNER = "6f6f6f6f-6666-4666-8666-666666666666";

let seq = 0;
const rid = () => `sched-test-${(seq += 1)}`;

async function withDb(t) {
  const client = new pg.Client({ connectionString: URL });
  await client.connect();
  const pool = new pg.Pool({ connectionString: URL, max: 3 });
  __injectPoolForSmokeTests(pool);
  // reset FIRST, and registered before the closers: t.after runs in
  // registration order, so an end() registered earlier means the DELETEs never
  // run and rows pile up between runs.
  const reset = async () => {
    await client.query("DELETE FROM reminder_completions WHERE owner_id = $1", [OWNER]);
    await client.query("DELETE FROM reminders WHERE owner_id = $1", [OWNER]);
    await client.query("DELETE FROM events WHERE owner_id = $1", [OWNER]);
    await client.query("DELETE FROM users WHERE amber_id = $1", [OWNER]);
  };
  await reset();
  t.after(reset);
  t.after(() => pool.end());
  t.after(() => client.end());
  await client.query(
    `INSERT INTO users (amber_id, phone, full_name, status)
     VALUES ($1,'+15550000006','Schedule Test Owner','active')
     ON CONFLICT (amber_id) DO NOTHING`,
    [OWNER],
  );
  return client;
}

const skip = (t) => {
  if (!URL) {
    t.skip("no database URL -- set AGENDA_TEST_DATABASE_URL to run this");
    return true;
  }
  return false;
};

// ── events ───────────────────────────────────────────────────────────────────

test("a spoken appointment lands on the day it was stated for, not today", async (t) => {
  if (skip(t)) return;
  const client = await withDb(t);

  // The exact utterance that produced a journal card instead of an event.
  const startsAt = "2026-09-12T10:00:00-04:00";
  const { eventId } = await createScheduledEvent({
    ownerId: OWNER,
    title: "Meeting",
    place: "Dumbo",
    startsAt,
  });
  assert.ok(eventId);

  const { rows } = await client.query(
    `SELECT title, place, starts_at, scheduled_at, all_day, repeat,
            notify_minutes_before, modality, source
       FROM events WHERE event_id = $1`,
    [eventId],
  );
  const ev = rows[0];
  assert.equal(ev.title, "Meeting");
  assert.equal(ev.place, "Dumbo");
  assert.equal(ev.repeat, "none");
  assert.equal(ev.all_day, false);
  assert.equal(ev.modality, "planned");

  /**
   * scheduled_at IS THE ONE THAT MATTERS. The day view selects on it; starts_at
   * doubles as "when you told Amber" for the relationship rollup. An event whose
   * scheduled_at were left null would exist in the database and be invisible on
   * the calendar, which is exactly the bug this replaces.
   */
  assert.equal(ev.scheduled_at.toISOString(), new Date(startsAt).toISOString());
  assert.equal(ev.starts_at.toISOString(), new Date(startsAt).toISOString());
  assert.equal(
    ev.notify_minutes_before,
    DEFAULT_NOTIFY_MINUTES,
    "an event was created with no notification at all",
  );
});

test("an end before its start is dropped, not swapped", async (t) => {
  if (skip(t)) return;
  const client = await withDb(t);
  const { eventId } = await createScheduledEvent({
    ownerId: OWNER,
    title: "Backwards",
    startsAt: "2026-09-12T10:00:00Z",
    endsAt: "2026-09-12T09:00:00Z",
  });
  const { rows } = await client.query("SELECT ends_at FROM events WHERE event_id = $1", [eventId]);
  // Guessing which of the two the user meant is how a 9am meeting becomes an
  // overnight one. The row is still written; only the bad end is discarded.
  assert.equal(rows[0].ends_at, null);
});

test("clearing an event's notification is not the same as not mentioning it", async (t) => {
  if (skip(t)) return;
  const client = await withDb(t);
  const { eventId } = await createScheduledEvent({
    ownerId: OWNER,
    title: "Quiet one",
    startsAt: "2026-09-12T10:00:00Z",
  });

  await updateScheduledEvent(eventId, OWNER, { title: "Renamed" });
  let { rows } = await client.query(
    "SELECT title, notify_minutes_before FROM events WHERE event_id = $1",
    [eventId],
  );
  assert.equal(rows[0].title, "Renamed");
  assert.equal(rows[0].notify_minutes_before, DEFAULT_NOTIFY_MINUTES, "an unrelated edit silenced the event");

  await updateScheduledEvent(eventId, OWNER, { notifyMinutesBefore: null });
  ({ rows } = await client.query(
    "SELECT notify_minutes_before FROM events WHERE event_id = $1",
    [eventId],
  ));
  assert.equal(rows[0].notify_minutes_before, null, "turning the notification off did not stick");
});

test("clearing a repeat clears its end date in the same statement", async (t) => {
  if (skip(t)) return;
  const client = await withDb(t);
  const { eventId } = await createScheduledEvent({
    ownerId: OWNER,
    title: "Standup",
    startsAt: "2026-09-12T10:00:00Z",
    repeat: "weekdays",
    repeatUntil: "2026-12-31",
  });

  /**
   * events_repeat_until_chk forbids an end date with no repeat. Setting the
   * frequency to none WITHOUT clearing the date makes the database refuse the
   * whole UPDATE -- so the user taps "Does not repeat", nothing happens, and
   * there is no error to see. The store has to move both.
   */
  const ok = await updateScheduledEvent(eventId, OWNER, { repeat: "none" });
  assert.ok(ok, "turning off a repeat was rejected by the constraint");
  const { rows } = await client.query(
    "SELECT repeat, repeat_until FROM events WHERE event_id = $1",
    [eventId],
  );
  assert.equal(rows[0].repeat, "none");
  assert.equal(rows[0].repeat_until, null);
});

test("another owner cannot edit or delete your event", async (t) => {
  if (skip(t)) return;
  await withDb(t);
  const { eventId } = await createScheduledEvent({
    ownerId: OWNER,
    title: "Mine",
    startsAt: "2026-09-12T10:00:00Z",
  });
  const stranger = "7a7a7a7a-7777-4777-8777-777777777777";
  assert.equal(await updateScheduledEvent(eventId, stranger, { title: "Theirs" }), null);
  assert.equal(await deleteScheduledEvent(eventId, stranger), false);
  assert.equal(await deleteScheduledEvent(eventId, OWNER), true);
});

// ── reminders ────────────────────────────────────────────────────────────────

test("an untimed reminder is open, and stays open across days", async (t) => {
  if (skip(t)) return;
  const client = await withDb(t);
  const id = rid();
  await createOpenReminder({ ownerId: OWNER, reminderId: id, title: "Pick up clothes" });

  const { rows } = await client.query("SELECT due_at, status FROM reminders WHERE reminder_id = $1", [id]);
  /**
   * due_at NULL is what keeps it out of the timed iMessage scheduler, whose scan
   * requires one. A reminder with no time cannot fire at a time.
   */
  assert.equal(rows[0].due_at, null);

  for (const day of ["2026-09-11", "2026-09-12", "2026-10-30"]) {
    const open = await listOpenReminders(OWNER, { onDate: day });
    assert.deepEqual(open.map((r) => r.title), ["Pick up clothes"], `gone on ${day}`);
    assert.equal(open[0].doneToday, false);
  }
});

test("ticking a one-off off finishes it for good", async (t) => {
  if (skip(t)) return;
  await withDb(t);
  const id = rid();
  await createOpenReminder({ ownerId: OWNER, reminderId: id, title: "Book a haircut" });

  assert.equal(await setReminderDoneOn(id, OWNER, { onDate: "2026-09-11", done: true }), true);
  assert.deepEqual(await listOpenReminders(OWNER, { onDate: "2026-09-11" }), []);
  assert.deepEqual(
    await listOpenReminders(OWNER, { onDate: "2026-09-12" }),
    [],
    "a one-off came back the next day",
  );
});

test("TICKING A DAILY REMINDER OFF DOES NOT END THE SERIES", async (t) => {
  if (skip(t)) return;
  await withDb(t);
  const id = rid();
  await createOpenReminder({
    ownerId: OWNER,
    reminderId: id,
    title: "Drink water",
    repeat: "daily",
  });

  /**
   * THE WHOLE REASON reminder_completions IS A TABLE.
   *
   * "If they check it off, it goes away for the day. But it's still on the next
   *  day and every other day."
   *
   * Marking status='done' on the row -- the obvious implementation -- ends the
   * habit the first time the user keeps it.
   */
  await setReminderDoneOn(id, OWNER, { onDate: "2026-09-11", done: true });

  const today = await listOpenReminders(OWNER, { onDate: "2026-09-11" });
  assert.equal(today.length, 1, "the row vanished instead of being ticked");
  assert.equal(today[0].doneToday, true, "it does not know it was ticked today");

  const tomorrow = await listOpenReminders(OWNER, { onDate: "2026-09-12" });
  assert.equal(tomorrow.length, 1);
  assert.equal(tomorrow[0].doneToday, false, "yesterday's tick carried into today");
});

test("un-ticking puts it back", async (t) => {
  if (skip(t)) return;
  await withDb(t);
  const id = rid();
  await createOpenReminder({ ownerId: OWNER, reminderId: id, title: "Stretch", repeat: "daily" });
  await setReminderDoneOn(id, OWNER, { onDate: "2026-09-11", done: true });
  await setReminderDoneOn(id, OWNER, { onDate: "2026-09-11", done: false });
  const open = await listOpenReminders(OWNER, { onDate: "2026-09-11" });
  assert.equal(open[0].doneToday, false);
});

test("weekdays, weekends and chosen days each fall on the right dates", async (t) => {
  if (skip(t)) return;
  await withDb(t);
  // 2026-09-11 is a Friday; 12 Sat, 13 Sun, 14 Mon, 16 Wed.
  const wd = rid();
  const we = rid();
  const wk = rid();
  await createOpenReminder({ ownerId: OWNER, reminderId: wd, title: "Standup prep", repeat: "weekdays" });
  await createOpenReminder({ ownerId: OWNER, reminderId: we, title: "Long run", repeat: "weekends" });
  // Monday and Wednesday. 0=Sunday, matching Date#getDay().
  await createOpenReminder({
    ownerId: OWNER,
    reminderId: wk,
    title: "Bins out",
    repeat: "weekly",
    repeatDays: [1, 3],
  });

  const titlesOn = async (d) =>
    (await listOpenReminders(OWNER, { onDate: d })).map((r) => r.title).sort();

  assert.deepEqual(await titlesOn("2026-09-11"), ["Standup prep"], "Friday");
  assert.deepEqual(await titlesOn("2026-09-12"), ["Long run"], "Saturday");
  assert.deepEqual(await titlesOn("2026-09-13"), ["Long run"], "Sunday");
  assert.deepEqual(await titlesOn("2026-09-14"), ["Bins out", "Standup prep"], "Monday");
  assert.deepEqual(await titlesOn("2026-09-16"), ["Bins out", "Standup prep"], "Wednesday");
  assert.deepEqual(await titlesOn("2026-09-15"), ["Standup prep"], "Tuesday");
});

test("a repeat stops on the day it was told to stop", async (t) => {
  if (skip(t)) return;
  await withDb(t);
  const id = rid();
  await createOpenReminder({
    ownerId: OWNER,
    reminderId: id,
    title: "Take vitamins",
    repeat: "daily",
    repeatUntil: "2026-09-30",
  });
  assert.equal((await listOpenReminders(OWNER, { onDate: "2026-09-30" })).length, 1, "the last day is inclusive");
  assert.equal((await listOpenReminders(OWNER, { onDate: "2026-10-01" })).length, 0, "it ran past its end");
});

test("A REMINDER FOR THIS WEEKEND IS NOT A REMINDER FOR TODAY", async (t) => {
  if (skip(t)) return;
  await withDb(t);
  /**
   * THE REAL ONE, and the bug that produced it.
   *
   *   "Remind me tomorrow as well to find a good place to do some solid thinking
   *    and working all day. I just need to do that for Saturday and Sunday."
   *
   * What shipped was a calendar EVENT at 9am on Saturday -- a clock time nobody
   * said, on a calendar it did not belong on, and nothing at all for Sunday.
   * What it has to be is ONE untimed reminder that appears at the top of Notes &
   * Journal on Saturday and Sunday, and on no other day: not on Friday, when it
   * was set, and not on the Monday after.
   *
   * Set on Friday 2026-09-11 for the 12th and 13th.
   */
  const id = rid();
  await createOpenReminder({
    ownerId: OWNER,
    reminderId: id,
    title: "Find a place for deep work",
    repeat: "weekends",
    startsOn: "2026-09-12",
    repeatUntil: "2026-09-13",
  });

  const on = async (d) => (await listOpenReminders(OWNER, { onDate: d })).map((r) => r.title);

  assert.deepEqual(await on("2026-09-11"), [], "Friday -- it was set today, but not FOR today");
  assert.deepEqual(await on("2026-09-12"), ["Find a place for deep work"], "Saturday");
  assert.deepEqual(await on("2026-09-13"), ["Find a place for deep work"], "Sunday");
  assert.deepEqual(await on("2026-09-14"), [], "Monday -- 'and nothing beyond'");
  assert.deepEqual(await on("2026-09-19"), [], "the NEXT Saturday. One weekend, not a habit");
  // And the past: without a lower bound this sat on every day the user could
  // scroll back to, which is the same bug pointing the other way.
  assert.deepEqual(await on("2026-09-05"), [], "the Saturday before it existed");
});

test("a reminder for tomorrow does not sit at the top of today", async (t) => {
  if (skip(t)) return;
  await withDb(t);
  // The one-off version of the same thing: no repeat, just a day it starts on.
  const id = rid();
  await createOpenReminder({
    ownerId: OWNER,
    reminderId: id,
    title: "Call the bank",
    startsOn: "2026-09-12",
  });
  assert.deepEqual(await listOpenReminders(OWNER, { onDate: "2026-09-11" }), []);
  assert.equal((await listOpenReminders(OWNER, { onDate: "2026-09-12" })).length, 1);
  // ...and it keeps waiting after that day, because a one-off is open until it
  // is ticked off, however long that takes.
  assert.equal((await listOpenReminders(OWNER, { onDate: "2026-09-20" })).length, 1);
});

test("a start date the user never gave means from now on, not from never", async (t) => {
  if (skip(t)) return;
  await withDb(t);
  // NULL starts_on is what every reminder written before migration 050 has, and
  // an AND that treated NULL as "not yet" would silently empty the strip for
  // every existing user. This is the test that a migration cannot regress.
  const id = rid();
  await createOpenReminder({ ownerId: OWNER, reminderId: id, title: "Text mom back" });
  assert.equal((await listOpenReminders(OWNER, { onDate: "2026-09-11" })).length, 1);
  assert.equal((await listOpenReminders(OWNER, { onDate: "2026-01-01" })).length, 1);
});

test("the dates handed back are dates, not the front of a Date's toString()", async (t) => {
  if (skip(t)) return;
  await withDb(t);
  /**
   * node-postgres parses a `date` column into a JS Date, so
   * String(row.repeat_until).slice(0, 10) is "Sun Sep 13" -- ten characters
   * that look like a date and are not one. The editor sends this value straight
   * back to a schema that requires ^\d{4}-\d{2}-\d{2}$, so the user's next edit
   * 400s on a field they never touched. It shipped that way.
   */
  const id = rid();
  await createOpenReminder({
    ownerId: OWNER,
    reminderId: id,
    title: "Find a place for deep work",
    repeat: "weekends",
    startsOn: "2026-09-12",
    repeatUntil: "2026-09-13",
  });
  const [r] = await listOpenReminders(OWNER, { onDate: "2026-09-12" });
  assert.equal(r.startsOn, "2026-09-12");
  assert.equal(r.repeatUntil, "2026-09-13");
});

test("editing the frequency moves all three repeat columns together", async (t) => {
  if (skip(t)) return;
  const client = await withDb(t);
  const id = rid();
  await createOpenReminder({
    ownerId: OWNER,
    reminderId: id,
    title: "Bins out",
    repeat: "weekly",
    repeatDays: [1, 3],
    repeatUntil: "2026-12-31",
  });

  /**
   * reminders_repeat_days_chk allows repeat_days ONLY on a weekly repeat. Moving
   * to daily without clearing them makes the database refuse the update, so the
   * user picks "Every day", nothing changes, and no error is shown. Same shape as
   * the event repeat_until case.
   */
  assert.ok(await updateReminderDetail(id, OWNER, { repeat: "daily" }));
  const { rows } = await client.query(
    "SELECT repeat, repeat_days, repeat_until FROM reminders WHERE reminder_id = $1",
    [id],
  );
  assert.equal(rows[0].repeat, "daily");
  assert.equal(rows[0].repeat_days, null);
  assert.equal(rows[0].repeat_until, null);
});

test("the detail a person edits round-trips", async (t) => {
  if (skip(t)) return;
  await withDb(t);
  const id = rid();
  await createOpenReminder({ ownerId: OWNER, reminderId: id, title: "Call the vet" });
  await updateReminderDetail(id, OWNER, {
    title: "Call the vet about Rosie",
    description: "Ask about the vaccination schedule",
    place: "Bergen Street Vet",
    notifyAtLocal: "09:30",
  });
  const [r] = await listOpenReminders(OWNER, { onDate: "2026-09-11" });
  assert.equal(r.title, "Call the vet about Rosie");
  assert.equal(r.description, "Ask about the vaccination schedule");
  assert.equal(r.place, "Bergen Street Vet");
  assert.equal(r.notifyAtLocal, "09:30");
});

test("a timed reminder from the old path is never listed here", async (t) => {
  if (skip(t)) return;
  const client = await withDb(t);
  // What db/self-reminders.js writes: a due_at, and the iMessage scheduler owns
  // it. This list is the UNTIMED ones, and mixing the two would put an
  // appointment at the top of Notes & Journal as well as on the calendar.
  await client.query(
    `INSERT INTO reminders (reminder_id, owner_id, status, due_at, data)
     VALUES ($1,$2,'pending',now(),'{"title":"Timed one"}'::jsonb)`,
    [rid(), OWNER],
  );
  assert.deepEqual(await listOpenReminders(OWNER, { onDate: "2026-09-11" }), []);
});

test("a junk date lists nothing rather than defaulting to today", async (t) => {
  if (skip(t)) return;
  await withDb(t);
  await createOpenReminder({ ownerId: OWNER, reminderId: rid(), title: "Anything" });
  assert.deepEqual(await listOpenReminders(OWNER, { onDate: "not-a-date" }), []);
  assert.deepEqual(await listOpenReminders(OWNER, {}), []);
});
