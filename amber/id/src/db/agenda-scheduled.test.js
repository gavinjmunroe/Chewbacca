/**
 * THE CALENDAR IS FOR THINGS THAT ARE SCHEDULED. EVERYTHING ELSE IS A NOTE.
 *
 * Run with the rest: npm test. Needs a database -- set AGENDA_TEST_DATABASE_URL
 * (or DATABASE_URL) at a scratch Postgres with db/migrations applied. Skips
 * loudly rather than passing when there is none, because a SQL test that passes
 * without SQL is worse than no test.
 *
 * ── WHAT WENT WRONG ─────────────────────────────────────────────────────────
 *
 * "I said Emily and Bo are moving in together in October, and that put it on my
 *  calendar for yesterday. Why? ... Neither is the fact that Shirley and Caleb
 *  are working with me. Neither is the fact that I'm going to Bedstuy to see a
 *  friend. These are just journals I was giving about my plans for the day."
 *
 * Three separate things had to line up, and they did:
 *
 *   1. capture writes an `events` row for any experience with a person in it
 *   2. that row's `starts_at` falls back to `observations.observed_at`
 *   3. `observed_at` itself falls back to now()
 *
 * So every note that mentioned somebody became an appointment at the moment it
 * was spoken, and `listAgendaEvents` -- which filtered on modality alone -- put
 * the lot on today.
 *
 * ── WHAT MUST NOT BE "FIXED" ────────────────────────────────────────────────
 *
 * The obvious fix is to stop writing those events, and it would be a serious
 * regression. `events` is the app's integration point: contact-rollup.js reads
 * it into contact_interaction_stats, which feeds contact_scores, which feeds
 * PeopleRank and the six dimensions. An evening with Shirley that stops
 * producing an event is an evening that stops counting toward Shirley -- and
 * nothing on any screen would say so.
 *
 * So the last test here is the important one: the rows are still there.
 */
import test from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { listAgendaEvents } from "./agenda.js";
import { insertObservation } from "./observations-store.js";
import { __injectPoolForSmokeTests } from "./sql.js";

const URL =
  process.env.AGENDA_TEST_DATABASE_URL ||
  process.env.TEST_DATABASE_URL ||
  process.env.DATABASE_URL ||
  "";

const OWNER = "1a1a1a1a-1111-4111-8111-111111111111";
const CONTACT = "2b2b2b2b-2222-4222-8222-222222222222";

/**
 * THE FUNCTION UNDER TEST TALKS TO src/db/sql.js, NOT TO OUR CLIENT.
 *
 * listAgendaEvents runs its query through the module pool, which wants Cloud SQL
 * credentials and, finding none, throws -- and the function CATCHES that and
 * returns []. So the first attempt at this test failed with an empty day and no
 * explanation, and had the assertion been "nothing scheduled shows up" instead
 * of "the pop-up does", it would have PASSED against a database it never
 * reached. A test that cannot connect must not be able to look like a pass.
 *
 * sql.js has a deliberate hook for this and its note explains why it is a
 * function and not an environment variable: "a stray environment variable
 * [would be] enough to point the whole application at a scratch database,
 * silently". Calling it is the sanctioned way in.
 */
function usePool(url) {
  const pool = new pg.Pool({ connectionString: url, max: 2 });
  __injectPoolForSmokeTests(pool);
  return pool;
}

/**
 * THIS OWNER'S ROWS, GONE. Called at the START of each test as well as the end.
 *
 * The teardown alone was not enough and the way it failed is the interesting
 * part: `t.after` hooks run in the order they are registered, `t.after(() =>
 * client.end())` was registered first, so the connection was closed before the
 * DELETEs ever ran -- and the DELETEs sat inside a `try/catch {}` that swallowed
 * the "client has been closed" error without a word. Four rows accumulated per
 * run, and by the third run the first assertion was failing with three extra
 * copies of the same event: a test that broke because of its own history rather
 * than because of the code.
 *
 * So cleanup happens FIRST, before anything is registered that could close the
 * connection, and again at the top of every test. A run cannot be poisoned by a
 * previous one, including one that crashed halfway.
 */
async function resetOwner(client) {
  await client.query("DELETE FROM events WHERE owner_id = $1", [OWNER]);
  await client.query("DELETE FROM observations WHERE owner_id = $1", [OWNER]);
  await client.query("DELETE FROM contacts WHERE owner_id = $1", [OWNER]);
  await client.query("DELETE FROM users WHERE amber_id = $1", [OWNER]);
}

/**
 * A user and one contact of theirs, because `events` has a composite foreign key
 * on (owner_id, contact_id) and the first run of this test found out the hard
 * way. Seeding is part of the test rather than a fixture file: the FK is a real
 * invariant of the table and a test that dodged it would be testing a shape the
 * database does not have.
 */
async function seedOwner(client) {
  await client.query(
    `INSERT INTO users (amber_id, phone, full_name, status)
     VALUES ($1, '+15550000000', 'Test Owner', 'active')
     ON CONFLICT (amber_id) DO NOTHING`,
    [OWNER],
  );
  await client.query(
    `INSERT INTO contacts (id, owner_id, owner_phone, full_name)
     VALUES ($1, $2, '+15550000000', 'Shirley')
     ON CONFLICT (id) DO NOTHING`,
    [CONTACT, OWNER],
  );
}

/** Midnight-to-midnight around a given instant, the way the day view asks. */
function dayWindow(at) {
  const start = new Date(at);
  start.setUTCHours(0, 0, 0, 0);
  const end = new Date(start.getTime() + 86_400_000);
  return { from: start.toISOString(), to: end.toISOString() };
}

test("the day view shows what was scheduled and not what was merely said", async (t) => {
  if (!URL) {
    t.skip("no database URL -- set AGENDA_TEST_DATABASE_URL to run this");
    return;
  }
  const client = new pg.Client({ connectionString: URL });
  await client.connect();
  const pool = usePool(URL);

  // ORDER MATTERS HERE -- see resetOwner. The cleanup hook is registered before
  // the two that close connections, because `after` hooks run in registration
  // order and a closed client cannot delete anything.
  await resetOwner(client);
  t.after(() => resetOwner(client));
  t.after(() => pool.end());
  t.after(() => client.end());

  await seedOwner(client);

  /**
   * THROUGH insertObservation AND listAgendaEvents -- THE REAL ONES.
   *
   * THE FIRST VERSION OF THIS TEST INSERTED ITS OWN `events` ROWS AND RAN ITS
   * OWN SELECT, and it was worth almost nothing. Three separate mutations proved
   * it, each one a real regression that left it green:
   *
   *   moving the day view's WHERE back onto `starts_at` -- the calendar bug
   *   itself, restored in one line.
   *
   *   projecting `e.starts_at AS starts_at` instead of `e.scheduled_at` -- the
   *   right rows with the WRONG TIME on every one of them, invisible to a test
   *   that only compared titles.
   *
   *   `ensureEventForObservation` returning null before doing anything, so
   *   capture stops writing events entirely and every interaction silently stops
   *   counting toward the person. The old test "proved the rollup is untouched"
   *   by counting rows IT had inserted itself, which is not a proof of anything.
   *
   * THE WHERE CLAUSE IS DEFENDED TWICE, AND THAT IS DELIBERATE -- worth writing
   * down, because it makes each half look dead on its own. agenda.js carries
   * both `scheduled_at IS NOT NULL` and a range on `scheduled_at`, and either
   * alone keeps the notes off the day: drop the IS NOT NULL and the range still
   * excludes them, because `NULL >= $2` is NULL under SQL's three-valued logic;
   * move the range to starts_at and the IS NOT NULL still excludes them. It
   * takes BOTH mutations together to put "Emily and Bo are moving in together in
   * October" back on the calendar. So neither line is redundant, and neither may
   * be deleted on the grounds that removing it broke no test.
   *
   * So this drives the code: two captures, one with a time stated and one
   * without, exactly as speech arrives, and then the day view is asked what it
   * has. Both halves of the fix are then real -- the note keeps its events row
   * for the rollup, and only the appointment is on the calendar.
   */
  const at = new Date();
  at.setUTCHours(14, 0, 0, 0);

  // "Emily and Bo are moving in together in October." A note. Nobody said a
  // time, so observedAt is null -- observed_at defaults to now() and
  // scheduled_at stays NULL. That is the entire distinction.
  const note = await insertObservation({
    ownerId: OWNER,
    contactId: CONTACT,
    kind: "experience",
    modality: "actual",
    body: "Emily and Bo are moving in together in October",
    observedAt: null,
  });
  assert.ok(note?.observationId, "the note was not captured at all");

  // "At two o'clock I have to be at Sephora for a pop-up." An appointment.
  const appt = await insertObservation({
    ownerId: OWNER,
    contactId: CONTACT,
    kind: "experience",
    modality: "planned",
    body: "Sephora pop-up",
    observedAt: at.toISOString(),
    eventTitle: "Sephora pop-up",
  });
  assert.ok(appt?.observationId, "the appointment was not captured at all");

  // THE ROLLUP IS UNTOUCHED, and this is the assertion that matters most --
  // now measured on rows CAPTURE wrote rather than rows this test wrote.
  // contact-rollup.js reads events into contact_interaction_stats, which feeds
  // contact_scores, PeopleRank and the six dimensions. An evening with Shirley
  // that stops producing an event is an evening that stops counting toward
  // Shirley, and nothing on any screen would say so.
  const { rows: forTheRollup } = await client.query(
    `SELECT title, scheduled_at
       FROM events
      WHERE owner_id = $1 AND deleted_at IS NULL AND starts_at <= now()
      ORDER BY created_at ASC`,
    [OWNER],
  );
  assert.equal(
    forTheRollup.length,
    2,
    "an interaction stopped counting toward the person -- see the note above",
  );
  assert.equal(
    forTheRollup.filter((r) => r.scheduled_at === null).length,
    1,
    "the note should have kept its events row with no scheduled time",
  );

  /**
   * AND NOTHING IS IN A TRANSACTION. listAgendaEvents goes through the module
   * pool, which is a different connection, so it could not see uncommitted rows
   * -- a test wrapped in BEGIN/ROLLBACK would hand it an empty database and then
   * assert about the emptiness. Real rows, deleted by resetOwner.
   */
  /**
   * AND ONE ROW WHERE THE TWO COLUMNS DISAGREE, which no capture produces and
   * which the assertion below needs to mean anything.
   *
   * Every writer in the app sets starts_at and scheduled_at from the same
   * instant when a time was stated -- capture passes observedAt to both, the
   * calendar sync passes its own start to both -- so on real rows they are
   * equal, and "SELECT e.starts_at AS starts_at" would return the right hour by
   * accident. Mutating agenda.js to project the wrong column was therefore
   * invisible, and a passing assertion about the time was proving nothing.
   *
   * This is the shape where they differ: a row written before the deploy and
   * then backfilled, or one whose event was moved. starts_at says when it was
   * heard, scheduled_at says when it happens, and the day view owes the second.
   */
  const heard = new Date(at.getTime() - 6 * 3600_000);
  await client.query(
    `INSERT INTO events (owner_id, contact_id, title, kind, modality, starts_at, scheduled_at)
     VALUES ($1, $2, 'Prospect Park date', 'experience', 'planned', $3, $4)`,
    [OWNER, CONTACT, heard.toISOString(), at.toISOString()],
  );

  const { from, to } = dayWindow(new Date());
  const onTheDay = await listAgendaEvents(OWNER, { from, to });
  assert.deepEqual(
    onTheDay.map((r) => r.title).sort(),
    ["Prospect Park date", "Sephora pop-up"],
    "the day view is holding something nobody scheduled",
  );
  /**
   * THE TIME, NOT JUST THE TITLE, and the key is startsAt rather than
   * starts_at: listAgendaEvents maps its rows to camelCase before returning
   * them. Asserting on `starts_at` reads undefined, `new Date(undefined)` is an
   * Invalid Date, and `.toISOString()` throws -- which is at least loud. The
   * quieter version of that mistake is a test comparing undefined to undefined.
   */
  for (const row of onTheDay) {
    assert.equal(
      new Date(row.startsAt).toISOString(),
      at.toISOString(),
      `${row.title} is showing when it was said, not when it happens`,
    );
  }
});

test("a calendar-synced event is scheduled by construction", async (t) => {
  if (!URL) {
    t.skip("no database URL -- set AGENDA_TEST_DATABASE_URL to run this");
    return;
  }
  const client = new pg.Client({ connectionString: URL });
  await client.connect();
  t.after(() => client.end());
  await client.query("BEGIN");
  t.after(async () => {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* already closed */
    }
  });

  /**
   * MIGRATION 048's BACKFILL, RE-RUN ON A ROW IT WOULD HAVE MISSED.
   *
   * A Google row is an appointment because a person put a time on it in Google.
   * The upsert in calendar-accounts.js writes scheduled_at itself, and the
   * migration backfilled the ones already in the table -- but a row written by
   * an OLD server binary between the migration and the deploy would have neither.
   * This is the case that would silently empty somebody's calendar, so it is
   * worth knowing the shape of it: source says what the fix is.
   */
  await seedOwner(client);
  await client.query(
    `INSERT INTO events (owner_id, title, kind, modality, starts_at, source, scheduled_at)
     VALUES ($1, 'Standup', 'meeting', 'planned', now(), 'google', NULL)`,
    [OWNER],
  );
  const { rows: before } = await client.query(
    `SELECT count(*)::int AS n FROM events
      WHERE owner_id = $1 AND source = 'google' AND scheduled_at IS NULL`,
    [OWNER],
  );
  assert.equal(before[0].n, 1, "expected the un-backfilled row");

  await client.query(
    `UPDATE events SET scheduled_at = starts_at
      WHERE scheduled_at IS NULL AND starts_at IS NOT NULL
        AND source IN ('google','microsoft')`,
  );
  const { rows: after } = await client.query(
    `SELECT count(*)::int AS n FROM events
      WHERE owner_id = $1 AND source = 'google' AND scheduled_at IS NULL`,
    [OWNER],
  );
  assert.equal(after[0].n, 0, "the backfill left a synced calendar event off the day");
});

test("observations keep the stated time apart from the heard time", async (t) => {
  if (!URL) {
    t.skip("no database URL -- set AGENDA_TEST_DATABASE_URL to run this");
    return;
  }
  const client = new pg.Client({ connectionString: URL });
  await client.connect();
  t.after(() => client.end());
  await client.query("BEGIN");
  t.after(async () => {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* already closed */
    }
  });

  /**
   * THE COLUMN EXISTS BECAUSE observed_at CANNOT ANSWER THE QUESTION.
   *
   * observed_at is NOT NULL DEFAULT now(), so the instant it is written a stated
   * time and a defaulted one are indistinguishable -- there is no value that
   * means "nobody said". scheduled_at is nullable and never defaulted, which is
   * the entire difference and the entire fix.
   */
  await seedOwner(client);
  await client.query(
    `INSERT INTO observations (owner_id, kind, modality, body, observed_at, scheduled_at)
     VALUES ($1, 'experience', 'actual', 'Shirley and Caleb are working with me', DEFAULT, NULL)`,
    [OWNER],
  );
  const { rows } = await client.query(
    `SELECT observed_at, scheduled_at FROM observations
      WHERE owner_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [OWNER],
  );
  assert.ok(rows[0].observed_at, "observed_at still defaults, as the rollup needs");
  assert.equal(rows[0].scheduled_at, null, "nobody stated a time, so nothing claims one");
});
