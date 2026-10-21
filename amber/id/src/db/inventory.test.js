/**
 * THE COUNTS BEHIND "TELL ME ABOUT MY NETWORK".
 *
 * Run with the rest: npm test. Needs a database -- set AGENDA_TEST_DATABASE_URL
 * (or DATABASE_URL) at a scratch Postgres with db/migrations applied. Skips
 * loudly rather than passing when there is none.
 *
 * WHY THESE ARE DATABASE TESTS. Every one of these numbers is a filter, and the
 * filters are the whole risk: `deleted_at` on nine tables and `disabled_at` on
 * the tenth, `status = 'resolved'` on observations, `scheduled_at IS NOT NULL`
 * on events, `status = 'active'` standing in for a soft delete on connections.
 * A mock cannot get any of them wrong, which is exactly why a mock would not
 * catch them. The number this feature exists to print is the number a wrong
 * filter quietly changes.
 *
 * AND THEY MUST AGREE WITH THE SCREEN. A count that disagrees with the list the
 * user can see is worse than no count, so several of these assert against the
 * SAME reader the app uses rather than against a hand-written expectation.
 */
import test from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { readAmberInventory } from "./inventory.js";
import { listOpenReminders, createOpenReminder } from "./schedule-store.js";
import { __injectPoolForSmokeTests } from "./sql.js";

const URL =
  process.env.AGENDA_TEST_DATABASE_URL ||
  process.env.TEST_DATABASE_URL ||
  process.env.DATABASE_URL ||
  "";

const OWNER = "7a7a7a7a-7777-4777-8777-777777777777";
const OTHER = "7b7b7b7b-7777-4777-8777-777777777777";

const skip = (t) => {
  if (!URL) {
    t.skip("no database URL -- set AGENDA_TEST_DATABASE_URL to run this");
    return true;
  }
  return false;
};

async function withDb(t) {
  const client = new pg.Client({ connectionString: URL });
  await client.connect();
  const pool = new pg.Pool({ connectionString: URL, max: 3 });
  __injectPoolForSmokeTests(pool);
  const reset = async () => {
    for (const owner of [OWNER, OTHER]) {
      await client.query("DELETE FROM circle_members WHERE circle_id IN (SELECT id FROM circles WHERE owner_id = $1)", [owner]);
      await client.query("DELETE FROM circles WHERE owner_id = $1", [owner]);
      await client.query("DELETE FROM observations WHERE owner_id = $1", [owner]);
      await client.query("DELETE FROM reminder_completions WHERE owner_id = $1", [owner]);
      await client.query("DELETE FROM reminders WHERE owner_id = $1", [owner]);
      await client.query("DELETE FROM events WHERE owner_id = $1", [owner]);
      await client.query("DELETE FROM calendar_accounts WHERE owner_id = $1", [owner]);
      await client.query("DELETE FROM conversations WHERE owner_id = $1", [owner]);
      await client.query("DELETE FROM contacts WHERE owner_id = $1", [owner]);
    }
    await client.query(
      "DELETE FROM connections WHERE a_amber_id = ANY($1::uuid[]) OR b_amber_id = ANY($1::uuid[])",
      [[OWNER, OTHER]],
    );
    await client.query(
      "DELETE FROM connection_requests WHERE requester_amber_id = ANY($1::uuid[]) OR addressee_amber_id = ANY($1::uuid[])",
      [[OWNER, OTHER]],
    );
    await client.query("DELETE FROM users WHERE amber_id = ANY($1::uuid[])", [[OWNER, OTHER]]);
  };
  await reset();
  t.after(reset);
  t.after(() => pool.end());
  t.after(() => client.end());
  await client.query(
    `INSERT INTO users (amber_id, phone, full_name, status) VALUES
       ($1,'+15550000071','Inventory Owner','active'),
       ($2,'+15550000072','Somebody Else','active')
     ON CONFLICT (amber_id) DO NOTHING`,
    [OWNER, OTHER],
  );
  return client;
}

/** One contact, returned as its id. */
async function addContact(client, owner, name, { deleted = false } = {}) {
  const { rows } = await client.query(
    `INSERT INTO contacts (owner_id, full_name, deleted_at)
     VALUES ($1, $2, $3) RETURNING id`,
    [owner, name, deleted ? new Date() : null],
  );
  return rows[0].id;
}

async function addObservation(client, owner, contactId, { status = "resolved", deleted = false } = {}) {
  await client.query(
    `INSERT INTO observations (owner_id, contact_id, kind, status, body, deleted_at)
     VALUES ($1, $2, 'fact', $3, 'something true', $4)`,
    [owner, contactId, status, deleted ? new Date() : null],
  );
}

test("an empty account counts zero of everything, and is not null", async (t) => {
  if (skip(t)) return;
  await withDb(t);
  const inv = await readAmberInventory(OWNER);
  assert.ok(inv, "a readable account came back null, which reads as a failure");
  assert.equal(inv.contacts, 0);
  assert.equal(inv.contactsWithFacts, 0);
  assert.equal(inv.circles, 0);
  assert.equal(inv.calendarAccounts, 0);
  assert.equal(inv.eventsNext7d, 0);
  assert.equal(inv.openReminders, 0);
});

test("no owner is null, not an empty account", async (t) => {
  if (skip(t)) return;
  await withDb(t);
  assert.equal(await readAmberInventory(null), null);
  assert.equal(await readAmberInventory(""), null);
});

test("a deleted contact is not in the book, and neither is somebody else's", async (t) => {
  if (skip(t)) return;
  const client = await withDb(t);
  await addContact(client, OWNER, "Live One");
  await addContact(client, OWNER, "Live Two");
  await addContact(client, OWNER, "Gone", { deleted: true });
  await addContact(client, OTHER, "Not Mine");

  const inv = await readAmberInventory(OWNER);
  assert.equal(inv.contacts, 2, "counted a deleted row or another owner's");
});

test("facts count resolved ones only, and people are counted once each", async (t) => {
  if (skip(t)) return;
  const client = await withDb(t);
  const a = await addContact(client, OWNER, "Person A");
  const b = await addContact(client, OWNER, "Person B");
  await addContact(client, OWNER, "Person C");

  // Two facts on A: A is ONE person carrying something, not two.
  await addObservation(client, OWNER, a);
  await addObservation(client, OWNER, a);
  await addObservation(client, OWNER, b);
  // Neither of these is a saved fact about anybody.
  await addObservation(client, OWNER, b, { status: "pending" });
  await addObservation(client, OWNER, b, { deleted: true });
  // AND ONE PERSON WHOSE ONLY OBSERVATION IS UNRESOLVED. Hanging the pending
  // rows off B alone hid the status filter: B already carried a resolved fact,
  // so the DISTINCT collapsed the mistake and dropping `status = 'resolved'`
  // changed nothing. D is the person the wrong query would invent.
  const d = await addContact(client, OWNER, "Person D");
  await addObservation(client, OWNER, d, { status: "pending" });

  const inv = await readAmberInventory(OWNER);
  assert.equal(inv.contacts, 4);
  assert.equal(inv.contactsWithFacts, 2, "the same person was counted twice, or a pending one counted");
  assert.equal(inv.facts, 3, "an unresolved or deleted observation was counted");
});

test("a circle counts its live members once, however many circles they are in", async (t) => {
  if (skip(t)) return;
  const client = await withDb(t);
  const a = await addContact(client, OWNER, "In Both");
  const gone = await addContact(client, OWNER, "Deleted Member", { deleted: true });
  const { rows } = await client.query(
    `INSERT INTO circles (owner_id, name) VALUES ($1,'Work'),($1,'Climbing') RETURNING id`,
    [OWNER],
  );
  for (const c of rows) {
    await client.query(`INSERT INTO circle_members (circle_id, contact_id, owner_id) VALUES ($1,$2,$3)`, [c.id, a, OWNER]);
  }
  await client.query(`INSERT INTO circle_members (circle_id, contact_id, owner_id) VALUES ($1,$2,$3)`, [rows[0].id, gone, OWNER]);

  const inv = await readAmberInventory(OWNER);
  assert.equal(inv.circles, 2);
  assert.equal(inv.circleMembers, 1, "counted one person twice, or counted a deleted contact");
});

test("only a STATED time is on the calendar, and only the next week is ahead", async (t) => {
  if (skip(t)) return;
  const client = await withDb(t);
  const soon = new Date(Date.now() + 2 * 24 * 3600 * 1000);
  const later = new Date(Date.now() + 30 * 24 * 3600 * 1000);
  const past = new Date(Date.now() - 2 * 24 * 3600 * 1000);

  const ev = async (scheduledAt, modality = "planned") =>
    client.query(
      `INSERT INTO events (owner_id, title, kind, modality, starts_at, scheduled_at, source)
       VALUES ($1,'Thing','meeting',$2,$3,$3,'capture')`,
      [OWNER, modality, scheduledAt],
    );

  await ev(soon);
  await ev(later);
  await ev(past, "actual");
  // NO scheduled_at: a note that merely mentioned somebody. Migration 048 exists
  // because these used to land on the day view as appointments.
  await client.query(
    `INSERT INTO events (owner_id, title, kind, modality, starts_at, scheduled_at, source)
     VALUES ($1,'Just talked about it','note','planned', now(), NULL, 'capture')`,
    [OWNER],
  );
  // A wish, not a plan.
  await ev(soon, "desired");

  const inv = await readAmberInventory(OWNER);
  assert.equal(inv.eventsNext7d, 1, "counted an unscheduled note, a wish, or something a month out");
  assert.equal(inv.eventsTotal, 3, "the total counted an unscheduled note or a desired event");
});

test("open reminders match the strip the user is looking at", async (t) => {
  if (skip(t)) return;
  await withDb(t);
  /**
   * ASSERTED AGAINST THE APP'S OWN READER, not against a number typed here. If
   * these two ever disagree, Amber tells somebody they have three things open
   * while the screen shows two, and the count is the thing they will believe
   * less.
   */
  await createOpenReminder({ ownerId: OWNER, reminderId: "inv-1", title: "Water the plants" });
  await createOpenReminder({ ownerId: OWNER, reminderId: "inv-2", title: "Call the bank" });

  const onScreen = await listOpenReminders(OWNER, {
    onDate: new Date().toISOString().slice(0, 10),
  });
  const inv = await readAmberInventory(OWNER);
  assert.equal(inv.openReminders, onScreen.length);
  assert.equal(inv.openReminders, 2);
});

test("a finished reminder is not still owed", async (t) => {
  if (skip(t)) return;
  const client = await withDb(t);
  await createOpenReminder({ ownerId: OWNER, reminderId: "inv-3", title: "Done thing" });
  await client.query(`UPDATE reminders SET status = 'done' WHERE reminder_id = 'inv-3'`);
  await createOpenReminder({ ownerId: OWNER, reminderId: "inv-4", title: "Still open" });

  const inv = await readAmberInventory(OWNER);
  assert.equal(inv.openReminders, 1);
});

test("a timed reminder is counted apart, and only while it is still ahead", async (t) => {
  if (skip(t)) return;
  const client = await withDb(t);
  const ahead = new Date(Date.now() + 3600 * 1000);
  const behind = new Date(Date.now() - 3600 * 1000);
  for (const [id, due] of [
    ["inv-5", ahead],
    ["inv-6", behind],
  ]) {
    await client.query(
      `INSERT INTO reminders (reminder_id, owner_id, status, due_at, data, title)
       VALUES ($1,$2,'pending',$3,'{}'::jsonb,'Timed')`,
      [id, OWNER, due],
    );
  }
  const inv = await readAmberInventory(OWNER);
  assert.equal(inv.timedRemindersAhead, 1);
  assert.equal(inv.openReminders, 0, "a timed reminder was counted as an untimed one");
});

test("a read that blows up is null, and null is not an empty account", async (t) => {
  if (skip(t)) return;
  await withDb(t);
  /**
   * THE FAILURE MODE THAT MATTERS MORE THAN THE COUNTS. A broken read that came
   * back as zeroes would put "you have no contacts yet, syncing is what starts
   * this" in front of somebody holding three thousand people. An owner id that
   * is not a uuid makes Postgres throw, which is the same path any real outage
   * takes.
   */
  assert.equal(await readAmberInventory("not-a-uuid"), null);
});

test("a disconnected calendar is not a connected one", async (t) => {
  if (skip(t)) return;
  const client = await withDb(t);
  // calendar_accounts spells its soft delete `disabled_at`, and a filter copied
  // from any other table would count this row.
  await client.query(
    `INSERT INTO calendar_accounts (owner_id, provider, account_email, disabled_at)
     VALUES ($1,'google','live@example.com', NULL),
            ($1,'microsoft','dead@example.com', now())`,
    [OWNER],
  );
  const inv = await readAmberInventory(OWNER);
  assert.equal(inv.calendarAccounts, 1);
});

test("a voice note is a note, and an Ask thread is not", async (t) => {
  if (skip(t)) return;
  const client = await withDb(t);
  await client.query(
    `INSERT INTO conversations (owner_id, kind, title) VALUES
       ($1,'note','A recording'),
       ($1,'note','Another'),
       ($1,'chat','A question I asked')`,
    [OWNER],
  );
  const inv = await readAmberInventory(OWNER);
  assert.equal(inv.voiceNotes, 2);
});

test("an Amber connection counts once from either side, and only while active", async (t) => {
  if (skip(t)) return;
  const client = await withDb(t);
  await client.query(
    `INSERT INTO connections (a_amber_id, b_amber_id, status) VALUES ($1,$2,'active')`,
    [OWNER < OTHER ? OWNER : OTHER, OWNER < OTHER ? OTHER : OWNER],
  );
  const mine = await readAmberInventory(OWNER);
  const theirs = await readAmberInventory(OTHER);
  assert.equal(mine.amberConnections, 1);
  assert.equal(theirs.amberConnections, 1, "the connection was only visible from one side");

  await client.query(`UPDATE connections SET status = 'blocked'`);
  assert.equal((await readAmberInventory(OWNER)).amberConnections, 0);
});

test("a pending request counts for the person who has to answer it", async (t) => {
  if (skip(t)) return;
  const client = await withDb(t);
  await client.query(
    `INSERT INTO connection_requests (requester_amber_id, addressee_amber_id, status)
     VALUES ($1,$2,'pending')`,
    [OTHER, OWNER],
  );
  assert.equal((await readAmberInventory(OWNER)).pendingRequests, 1);
  assert.equal(
    (await readAmberInventory(OTHER)).pendingRequests,
    0,
    "counted a request they sent as one they owe an answer to",
  );
});
