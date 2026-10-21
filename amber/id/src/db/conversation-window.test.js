/**
 * YESTERDAY'S NOTES ARE STILL THERE. THEY WERE NEVER ASKED FOR.
 *
 * Run with the rest: npm test. Needs a database -- set AGENDA_TEST_DATABASE_URL
 * (or DATABASE_URL) at a scratch Postgres with db/migrations applied. Skips
 * loudly rather than passing when there is none.
 *
 * ── WHAT WENT WRONG ─────────────────────────────────────────────────────────
 *
 * "My notes and journals from yesterday are not showing up either. In some
 *  cases, that needs to show up all the time."
 *
 * Home's Notes & Journal list is single-day by design, and that design is fine:
 * a week-old note sitting above this morning's reminder would be absurd. What
 * was not fine is how the day was chosen. The client asked for the 30 most
 * recent threads with no window at all and then sorted them into days itself --
 * so a day was visible only if it happened to fall inside those 30.
 *
 * Every Ask conversation is a row in the same table (`kind = 'chat'`). Thirty
 * threads is one busy day. After that, yesterday's notes are in the database,
 * intact, and permanently invisible -- which reads exactly like "my notes did
 * not save", and is the one failure mode this app cannot have.
 *
 * ── WHY A BIGGER LIMIT IS NOT THE FIX ───────────────────────────────────────
 *
 * Because there is no number that is enough. 200 buys a heavier user a week;
 * 2000 buys them a month and costs everybody the round trip. The question was
 * wrong, not the number: a day view should ask for A DAY.
 *
 * The first test below is the proof, and it is written to FAIL on any
 * limit-raising fix: it buries the note under more chat threads than the cap.
 */
import test from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { listRecentConversations, appendMessage } from "./csql-conversation-store.js";
import { __injectPoolForSmokeTests } from "./sql.js";

const URL =
  process.env.AGENDA_TEST_DATABASE_URL ||
  process.env.TEST_DATABASE_URL ||
  process.env.DATABASE_URL ||
  "";

const OWNER = "3c3c3c3c-3333-4333-8333-333333333333";

/** See the note in agenda-scheduled.test.js: the hook, not an env var. */
function usePool(url) {
  const pool = new pg.Pool({ connectionString: url, max: 2 });
  __injectPoolForSmokeTests(pool);
  return pool;
}

async function resetOwner(client) {
  await client.query(
    `DELETE FROM conversation_messages WHERE conversation_id IN
       (SELECT conversation_id FROM conversations WHERE owner_id = $1)`,
    [OWNER],
  );
  await client.query("DELETE FROM conversations WHERE owner_id = $1", [OWNER]);
  await client.query("DELETE FROM users WHERE amber_id = $1", [OWNER]);
}

async function seedOwner(client) {
  await client.query(
    `INSERT INTO users (amber_id, phone, full_name, status)
     VALUES ($1, '+15550000001', 'Window Test Owner', 'active')
     ON CONFLICT (amber_id) DO NOTHING`,
    [OWNER],
  );
}

/**
 * A thread whose newest message lands at a given instant.
 *
 * KIND IS 'note' OR 'chat', and the database is what said so: the first version
 * of this used 'voice_note' and `conversations_kind_check` rejected it, which is
 * the constraint doing exactly its job. The allowed set is chat | note | space,
 * and the two that matter here are the point of the whole test -- a note and an
 * Ask conversation are rows in the SAME table, competing for the same cap.
 *
 * WRITTEN THROUGH appendMessage, which is what the app calls -- it creates the
 * conversation row itself when no id is passed. Inserting both rows by hand
 * would let this test pass against a schema the app does not actually write,
 * which is the mistake the agenda test made and had to be rescued from.
 *
 * The timestamps are then back-dated with two UPDATEs, which is unavoidable:
 * nothing in the app can produce a message dated yesterday, and yesterday is
 * the entire subject.
 */
async function threadAt(client, { kind, title, at }) {
  const row = await appendMessage(OWNER, { role: "user", content: title });
  const id = row?.conversation_id ?? row?.conversationId;
  assert.ok(id, "appendMessage did not return a conversation id");
  await client.query(
    `UPDATE conversations SET kind = $2, title = $3, updated_at = $4 WHERE conversation_id = $1`,
    [id, kind, title, at.toISOString()],
  );
  await client.query(
    `UPDATE conversation_messages SET created_at = $2 WHERE conversation_id = $1`,
    [id, at.toISOString()],
  );
  return id;
}

function dayWindow(at) {
  const start = new Date(at);
  start.setUTCHours(0, 0, 0, 0);
  return {
    from: start.toISOString(),
    to: new Date(start.getTime() + 86_400_000).toISOString(),
  };
}

test("a note from yesterday comes back however much happened today", async (t) => {
  if (!URL) {
    t.skip("no database URL -- set AGENDA_TEST_DATABASE_URL to run this");
    return;
  }
  const client = new pg.Client({ connectionString: URL });
  await client.connect();
  const pool = usePool(URL);
  await resetOwner(client);
  t.after(() => resetOwner(client));
  t.after(() => pool.end());
  t.after(() => client.end());
  await seedOwner(client);

  const now = new Date();
  const yesterday = new Date(now.getTime() - 86_400_000);
  yesterday.setUTCHours(13, 0, 0, 0);

  await threadAt(client, {
    kind: "note",
    title: "Emily and Bo are moving in together in October",
    at: yesterday,
  });

  /**
   * AND BURIED UNDER MORE OF TODAY THAN ANY CAP WILL HOLD.
   *
   * 45 is past the route's own 30 and past anything a "just raise the limit"
   * patch would plausibly choose. Each is a `chat` -- an Ask conversation --
   * because that is the real competition: the notes list and the Ask history
   * are the same table, which is the part that made thirty so easy to exceed.
   */
  const today = new Date(now);
  today.setUTCHours(9, 0, 0, 0);
  for (let i = 0; i < 45; i += 1) {
    await threadAt(client, {
      kind: "chat",
      title: `Ask thread ${i}`,
      at: new Date(today.getTime() + i * 60_000),
    });
  }

  // THE OLD CALL, for the record: unwindowed, capped, and yesterday is gone.
  const unwindowed = await listRecentConversations(OWNER, { limit: 30 });
  assert.equal(
    unwindowed.filter((r) => r.kind === "note").length,
    0,
    "the premise of this test is wrong -- the note was reachable without a window",
  );

  // THE FIX: ask for the day.
  const { from, to } = dayWindow(yesterday);
  const onYesterday = await listRecentConversations(OWNER, { limit: 200, from, to });
  assert.deepEqual(
    onYesterday.map((r) => r.title),
    ["Emily and Bo are moving in together in October"],
    "yesterday's note is in the database and still did not come back",
  );
});

test("the window is the message time, which is the column the reader sees", async (t) => {
  if (!URL) {
    t.skip("no database URL -- set AGENDA_TEST_DATABASE_URL to run this");
    return;
  }
  const client = new pg.Client({ connectionString: URL });
  await client.connect();
  const pool = usePool(URL);
  await resetOwner(client);
  t.after(() => resetOwner(client));
  t.after(() => pool.end());
  t.after(() => client.end());
  await seedOwner(client);

  /**
   * THE SECOND BUG, AND IT IS SUBTLER THAN THE CAP.
   *
   * The query ordered and cut on `conversations.updated_at`. The client buckets
   * notes into days on `last_at` -- the newest MESSAGE's timestamp. Two
   * different columns, so the rows that survived the cut were not the rows the
   * client would have shown: retitle a thread, edit its participants, touch it
   * in any way that moves updated_at without adding a message, and it displaces
   * a thread that had something to say on the day being looked at.
   *
   * This is that shape: a note whose message is yesterday, whose row was touched
   * today. It belongs to yesterday, because that is the day its words are from
   * and the day the list will print it under.
   */
  const now = new Date();
  const yesterday = new Date(now.getTime() - 86_400_000);
  yesterday.setUTCHours(11, 0, 0, 0);

  const id = await threadAt(client, {
    kind: "note",
    title: "Going to Bedstuy to see a friend",
    at: yesterday,
  });
  // Touched today, message still yesterday.
  await client.query(
    `UPDATE conversations SET updated_at = now(), title = 'Bedstuy' WHERE conversation_id = $1`,
    [id],
  );

  const y = dayWindow(yesterday);
  const onYesterday = await listRecentConversations(OWNER, { limit: 200, ...y });
  assert.equal(
    onYesterday.length,
    1,
    "a note was filed under the day its row was touched, not the day it was spoken",
  );

  const t2 = dayWindow(now);
  const onToday = await listRecentConversations(OWNER, { limit: 200, ...t2 });
  assert.equal(
    onToday.length,
    0,
    "touching a thread today dragged yesterday's note onto today",
  );
});

test("no window is exactly the old behavior", async (t) => {
  if (!URL) {
    t.skip("no database URL -- set AGENDA_TEST_DATABASE_URL to run this");
    return;
  }
  const client = new pg.Client({ connectionString: URL });
  await client.connect();
  const pool = usePool(URL);
  await resetOwner(client);
  t.after(() => resetOwner(client));
  t.after(() => pool.end());
  t.after(() => client.end());
  await seedOwner(client);

  /**
   * THE PART THAT MUST NOT HAVE CHANGED. Several callers list threads with no
   * window at all -- the Ask history among them -- and an optional parameter
   * that quietly alters the default answer is worse than a new endpoint.
   *
   * Newest first, capped, nothing dropped for being outside a window nobody
   * named.
   */
  const base = new Date();
  base.setUTCHours(8, 0, 0, 0);
  for (let i = 0; i < 5; i += 1) {
    await threadAt(client, {
      kind: "chat",
      title: `thread ${i}`,
      at: new Date(base.getTime() + i * 3_600_000),
    });
  }

  const all = await listRecentConversations(OWNER, { limit: 20 });
  assert.equal(all.length, 5, "an unwindowed list lost rows");
  assert.deepEqual(
    all.map((r) => r.title),
    ["thread 4", "thread 3", "thread 2", "thread 1", "thread 0"],
    "an unwindowed list is no longer newest-first",
  );

  const capped = await listRecentConversations(OWNER, { limit: 2 });
  assert.deepEqual(
    capped.map((r) => r.title),
    ["thread 4", "thread 3"],
    "the cap no longer takes the newest",
  );
});
