/**
 * AN OPEN REMINDER DOES NOT DISAPPEAR AT MIDNIGHT.
 *
 * Run with the rest: npm test. Needs a database -- set AGENDA_TEST_DATABASE_URL
 * (or DATABASE_URL) at a scratch Postgres with db/migrations applied. Skips
 * loudly rather than passing when there is none.
 *
 * ── WHAT WENT WRONG ─────────────────────────────────────────────────────────
 *
 *   "Reminders that should persist across days are anything with an open tag
 *    that didn't get completed. If it's something like 'text mom about the trip'
 *    and that wasn't completed, then that should persist. Have a little checkbox
 *    for each reminder, and if that's checked, then that goes away."
 *
 * listScheduledReminders windowed on `due_at >= from AND due_at < to`, so a
 * reminder was visible on exactly the day it was due and on no other day ever.
 * Miss it once and it was gone -- not deleted, not done, just invisible, which
 * for a reminder is the same thing as broken.
 *
 * ── WHY THIS IS A DATABASE TEST AND NOT A UNIT TEST ─────────────────────────
 *
 * Because all of the behavior is in the SQL. The predicate, the three-valued
 * logic around a NULL status, and above all the ORDER BY -- which exists because
 * of an interaction with the LIMIT that no amount of reading the function body
 * makes visible. Every previous attempt in this repo to test query behavior by
 * driving its own hand-written SQL left real regressions green (see the note in
 * agenda-scheduled.test.js), so this calls the function the route calls.
 */
import test from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { listScheduledReminders } from "./agenda.js";
import { __injectPoolForSmokeTests } from "./sql.js";

const URL =
  process.env.AGENDA_TEST_DATABASE_URL ||
  process.env.TEST_DATABASE_URL ||
  process.env.DATABASE_URL ||
  "";

const OWNER = "4d4d4d4d-4444-4444-8444-444444444444";

const DAY = 86_400_000;

function usePool(url) {
  const pool = new pg.Pool({ connectionString: url, max: 2 });
  __injectPoolForSmokeTests(pool);
  return pool;
}

async function resetOwner(client) {
  await client.query("DELETE FROM reminders WHERE owner_id = $1", [OWNER]);
  await client.query("DELETE FROM users WHERE amber_id = $1", [OWNER]);
}

async function seedOwner(client) {
  await client.query(
    `INSERT INTO users (amber_id, phone, full_name, status)
     VALUES ($1, '+15550000004', 'Carryover Test Owner', 'active')
     ON CONFLICT (amber_id) DO NOTHING`,
    [OWNER],
  );
}

let seq = 0;
async function reminder(client, { text, dueAt, status = "pending" }) {
  seq += 1;
  const id = `carryover-${seq}`;
  await client.query(
    `INSERT INTO reminders (reminder_id, owner_id, status, due_at, data)
     VALUES ($1, $2, $3, $4, $5::jsonb)`,
    [id, OWNER, status, dueAt.toISOString(), JSON.stringify({ text })],
  );
  return id;
}

/** The window the route builds for a day, as two instants. */
function dayWindow(at) {
  const start = new Date(at);
  start.setUTCHours(0, 0, 0, 0);
  return {
    from: start.toISOString(),
    to: new Date(start.getTime() + DAY).toISOString(),
  };
}

async function withDb(t) {
  const client = new pg.Client({ connectionString: URL });
  await client.connect();
  const pool = usePool(URL);
  // resetOwner FIRST, and registered before the connection-closing hooks: t.after
  // runs in registration order, so an end() registered earlier means the DELETEs
  // never run and rows pile up between runs. That exact mistake cost an afternoon
  // in agenda-scheduled.test.js.
  await resetOwner(client);
  t.after(() => resetOwner(client));
  t.after(() => pool.end());
  t.after(() => client.end());
  await seedOwner(client);
  return client;
}

test("an open reminder from a past day comes back with today", async (t) => {
  if (!URL) {
    t.skip("no database URL -- set AGENDA_TEST_DATABASE_URL to run this");
    return;
  }
  const client = await withDb(t);

  const now = new Date();
  const lastWeek = new Date(now.getTime() - 6 * DAY);
  await reminder(client, { text: "Text mom about the trip", dueAt: lastWeek });

  const today = dayWindow(now);
  const rows = await listScheduledReminders(OWNER, { ...today, includeOverdue: true });

  assert.deepEqual(
    rows.map((r) => r.title),
    ["Text mom about the trip"],
    "an open reminder from last week did not travel forward",
  );
  assert.equal(rows[0].carriedOver, true, "it came back unflagged, so the client would print a wrong time");
  assert.equal(rows[0].done, false);
});

test("...and stops the moment it is ticked off", async (t) => {
  if (!URL) {
    t.skip("no database URL");
    return;
  }
  const client = await withDb(t);

  const now = new Date();
  const yesterday = new Date(now.getTime() - DAY);
  await reminder(client, { text: "Already handled", dueAt: yesterday, status: "done" });
  await reminder(client, { text: "Also handled", dueAt: yesterday, status: "completed" });
  await reminder(client, { text: "Still open", dueAt: yesterday });

  const rows = await listScheduledReminders(OWNER, {
    ...dayWindow(now),
    includeOverdue: true,
  });
  assert.deepEqual(
    rows.map((r) => r.title),
    ["Still open"],
    "a finished reminder followed the user around, which is the opposite of the point",
  );
});

test("a past day shows that day, not the backlog", async (t) => {
  if (!URL) {
    t.skip("no database URL");
    return;
  }
  const client = await withDb(t);

  const now = new Date();
  const twoDaysAgo = new Date(now.getTime() - 2 * DAY);
  const tenDaysAgo = new Date(now.getTime() - 10 * DAY);
  await reminder(client, { text: "Older open thing", dueAt: tenDaysAgo });
  await reminder(client, { text: "Due that day", dueAt: twoDaysAgo });

  // Which is what the ROUTE does: includeOverdue is false for any window that
  // does not contain now. Asserting it here as well, because the flag is the
  // whole guard against the calendar turning into one long to-do list.
  const rows = await listScheduledReminders(OWNER, {
    ...dayWindow(twoDaysAgo),
    includeOverdue: false,
  });
  assert.deepEqual(
    rows.map((r) => r.title),
    ["Due that day"],
    "scrolling back to a past day dragged the whole backlog onto it",
  );
});

test("with includeOverdue off, the result is exactly what it always was", async (t) => {
  if (!URL) {
    t.skip("no database URL");
    return;
  }
  const client = await withDb(t);

  const now = new Date();
  const start = new Date(now);
  start.setUTCHours(0, 0, 0, 0);
  await reminder(client, { text: "Open, yesterday", dueAt: new Date(start.getTime() - DAY) });
  await reminder(client, { text: "Nine", dueAt: new Date(start.getTime() + 9 * 3600_000) });
  await reminder(client, { text: "Three", dueAt: new Date(start.getTime() + 15 * 3600_000) });

  const rows = await listScheduledReminders(OWNER, { ...dayWindow(now), includeOverdue: false });
  assert.deepEqual(
    rows.map((r) => r.title),
    ["Nine", "Three"],
    "the old behavior changed for a caller that did not ask for the new one",
  );
  assert.equal(rows.every((r) => r.carriedOver === false), true);
});

test("THE LIMIT TAKES THE DAY FIRST, NOT THE BACKLOG", async (t) => {
  if (!URL) {
    t.skip("no database URL");
    return;
  }
  const client = await withDb(t);

  /**
   * THE BUG THIS EXISTS FOR, and it is invisible from reading the function.
   *
   * due_at ASC is oldest-first, and every carried-over reminder is older than
   * everything on the day. Someone with a real backlog would hit the LIMIT on
   * old reminders alone and get NONE of today's meetings -- the cap silently
   * eating the actual day. ORDER BY (due_at >= from) DESC puts the day first so
   * it always survives the cut.
   *
   * limit is set to 5 here rather than seeding 200 rows: the failure is about
   * which rows the cap keeps, and a small cap reproduces it exactly while
   * keeping the test fast.
   */
  const now = new Date();
  const start = new Date(now);
  start.setUTCHours(0, 0, 0, 0);

  for (let i = 0; i < 8; i += 1) {
    await reminder(client, {
      text: `Backlog ${i}`,
      dueAt: new Date(start.getTime() - (i + 1) * DAY),
    });
  }
  await reminder(client, { text: "Today at nine", dueAt: new Date(start.getTime() + 9 * 3600_000) });
  await reminder(client, { text: "Today at five", dueAt: new Date(start.getTime() + 17 * 3600_000) });

  const rows = await listScheduledReminders(OWNER, {
    ...dayWindow(now),
    includeOverdue: true,
    limit: 5,
  });

  const titles = rows.map((r) => r.title);
  assert.ok(
    titles.includes("Today at nine") && titles.includes("Today at five"),
    `the backlog ate the day: got ${JSON.stringify(titles)}`,
  );
  assert.equal(rows.length, 5, "the cap stopped being respected");
});

test("the flag is computed against the window, not against today", async (t) => {
  if (!URL) {
    t.skip("no database URL");
      return;
  }
  const client = await withDb(t);

  // A reminder due at 9am today is NOT carried over when the window is today,
  // even though 9am may already have passed. Overdue-within-the-day is still
  // today's business, and marking it "carried over" would hide its own time.
  const now = new Date();
  const start = new Date(now);
  start.setUTCHours(0, 0, 0, 0);
  await reminder(client, { text: "Earlier today", dueAt: new Date(start.getTime() + 60_000) });

  const rows = await listScheduledReminders(OWNER, { ...dayWindow(now), includeOverdue: true });
  assert.equal(rows.length, 1);
  assert.equal(
    rows[0].carriedOver,
    false,
    "something due earlier today was labeled as coming from another day",
  );
});
