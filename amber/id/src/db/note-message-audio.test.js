/**
 * AUDIO ATTACHED TO ONE MESSAGE OF A NOTE.
 *
 * The query function is injected, so nothing here touches a database. What is
 * asserted is the part that cannot be seen by using the app once: that the
 * message has to belong to the caller AND to the thread before a key is minted,
 * that the client never names the object, and that the note's own clip and a
 * follow-up's clip cannot be mistaken for one another.
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  reserveMessageAudioUpload,
  getMessageAudioRow,
  markMessageAudioReady,
  deleteMessageAudio,
  getMessageAudioForConversation,
} from "./note-media-store.js";
import { _resetOptionalColumns } from "./optional-column.js";

const OWNER = "11111111-2222-3333-4444-555555555555";
const OTHER = "99999999-8888-7777-6666-555555555555";
const CONV = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

function recorder(handlers = []) {
  const calls = [];
  const queryImpl = async (sql, params) => {
    const flat = sql.replace(/\s+/g, " ").trim();
    calls.push({ sql: flat, params });
    for (const h of handlers) {
      if (h.match.test(flat)) return h.result;
    }
    return { rows: [], rowCount: 0 };
  };
  return { calls, queryImpl };
}

const ownsOk = { match: /SELECT 1 FROM conversation_messages/i, result: { rows: [{ "?column?": 1 }], rowCount: 1 } };
const insertedKey = (key) => ({
  match: /INSERT INTO media_assets/i,
  result: { rows: [{ storage_key: key }], rowCount: 1 },
});

test("the message must belong to the caller and the thread before anything is minted", async () => {
  // No row back from the ownership check: nothing is inserted at all.
  const { calls, queryImpl } = recorder([]);
  const key = await reserveMessageAudioUpload(OWNER, CONV, "42", { queryImpl });
  assert.equal(key, null);
  assert.equal(calls.length, 1, "it stops at the check");
  assert.match(calls[0].sql, /SELECT 1 FROM conversation_messages/i);
  assert.deepEqual(calls[0].params, [OWNER, CONV, "42"]);
  // The check tests the OWNER and the CONVERSATION, not just the id -- otherwise
  // a guessed bigserial would attach audio to somebody else's message.
  assert.match(calls[0].sql, /owner_id = \$1/);
  assert.match(calls[0].sql, /conversation_id = \$2/);
});

test("the server mints the key; the client never names the object", async () => {
  const { calls, queryImpl } = recorder([ownsOk, insertedKey("notes/x/y/m7-uuid.m4a")]);
  const key = await reserveMessageAudioUpload(OWNER, CONV, "7", { queryImpl });
  assert.equal(key, "notes/x/y/m7-uuid.m4a", "the key comes back from the row, not the caller");
  const insert = calls.find((c) => /INSERT INTO media_assets/i.test(c.sql));
  assert.ok(insert);
  // Owner-scoped prefix, this conversation, and this message: a key cannot be
  // walked out of the caller's own space.
  const minted = insert.params[3];
  assert.ok(minted.startsWith(`notes/${OWNER}/${CONV}/m7-`), minted);
  assert.match(minted, /\.m4a$/);
  // Idempotent on the message, so a retried reserve cannot leave two pending rows.
  assert.match(insert.sql, /ON CONFLICT \(message_id\) WHERE message_id IS NOT NULL AND deleted_at IS NULL/i);
});

test("a malformed message id reserves nothing", async () => {
  const { calls, queryImpl } = recorder([ownsOk, insertedKey("k")]);
  for (const bad of ["", "0", "-1", "abc", "1; DROP TABLE", null, undefined, 1.5]) {
    assert.equal(await reserveMessageAudioUpload(OWNER, CONV, bad, { queryImpl }), null, String(bad));
  }
  assert.equal(calls.length, 0, "nothing reaches a ::bigint cast");
});

test("every read and write is scoped to the owner, the thread and the message", async () => {
  const { calls, queryImpl } = recorder([
    { match: /SELECT owner_id, conversation_id, message_id/i, result: { rows: [{ status: "ready" }], rowCount: 1 } },
  ]);
  await getMessageAudioRow(OWNER, CONV, "5", { queryImpl });
  await markMessageAudioReady(OWNER, CONV, "5", { durationMs: 1000, byteSize: 10, peaks: [1, 2] }, { queryImpl });
  await deleteMessageAudio(OWNER, CONV, "5", { queryImpl });
  assert.equal(calls.length, 3);
  for (const c of calls) {
    assert.match(c.sql, /owner_id = \$1/, c.sql);
    assert.match(c.sql, /conversation_id = \$2/, c.sql);
    assert.match(c.sql, /message_id = \$3::bigint/, c.sql);
  }
});

test("the size stored is the one passed in, clamped, never a negative or absurd value", async () => {
  const { calls, queryImpl } = recorder([]);
  await markMessageAudioReady(OWNER, CONV, "5", { durationMs: -50, byteSize: -9, peaks: [] }, { queryImpl });
  const [dur, size] = calls[0].params.slice(3, 5);
  assert.equal(dur, 0);
  assert.equal(size, 0);
  await markMessageAudioReady(
    OWNER,
    CONV,
    "5",
    { durationMs: 60 * 60 * 1000, byteSize: 5, peaks: [] },
    { queryImpl },
  );
  assert.ok(calls[1].params[3] <= 5 * 60 * 1000, "clamped to the maximum clip length");
});

test("a thread's clips come back keyed by message, ready ones only", async () => {
  _resetOptionalColumns();
  const { calls, queryImpl } = recorder([
    {
      match: /SELECT message_id, duration_ms/i,
      result: {
        rows: [
          { message_id: "11", duration_ms: 4200, byte_size: 900, peaks: [3, 9, 3] },
          { message_id: "12", duration_ms: 800, byte_size: 100, peaks: [] },
        ],
        rowCount: 2,
      },
    },
  ]);
  const out = await getMessageAudioForConversation(OWNER, CONV, { queryImpl });
  assert.deepEqual(Object.keys(out), ["11", "12"]);
  assert.deepEqual(out["11"], { durationMs: 4200, byteSize: 900, peaks: [3, 9, 3] });
  // status = 'ready' is in the SQL, not filtered afterwards: a pending row is an
  // upload that never finished, and a player drawn for it cannot work.
  assert.match(calls[0].sql, /status = 'ready'/);
  // One query for the whole thread.
  assert.equal(calls.length, 1);
});

test("before the migration lands, a thread simply has no clips", async () => {
  _resetOptionalColumns();
  const undefinedColumn = Object.assign(new Error('column "message_id" does not exist'), {
    code: "42703",
  });
  let attempts = 0;
  const queryImpl = async (sql) => {
    attempts += 1;
    if (/message_id IS NOT NULL/.test(sql)) throw undefinedColumn;
    return { rows: [], rowCount: 0 };
  };
  const out = await getMessageAudioForConversation(OWNER, CONV, { queryImpl });
  assert.deepEqual(out, {}, "no clips, rather than a broken thread");
  assert.equal(attempts, 2, "it tried the real query, then the variant without the column");
  _resetOptionalColumns();
});

test("a different owner's id cannot be passed off as a uuid", async () => {
  const { calls, queryImpl } = recorder([]);
  assert.equal(await reserveMessageAudioUpload("not-a-uuid", CONV, "5", { queryImpl }), null);
  assert.equal(await getMessageAudioRow(OTHER, "not-a-uuid", "5", { queryImpl }), null);
  assert.equal(calls.length, 0);
});
