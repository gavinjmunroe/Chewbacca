/**
 * The pair key is the load-bearing invariant of the whole DM schema.
 *
 * dm_threads has UNIQUE (a_amber_id, b_amber_id) plus CHECK (a < b). If this
 * function ever returned the pair in call order rather than sorted order, the
 * CHECK would reject half of all inserts and the UNIQUE would stop preventing
 * duplicate threads for the same two people — you would get one thread when A
 * opens it and a second when B does, each holding half the conversation.
 *
 * The SQL paths in this store are exercised against a real database, not here:
 * the in-memory sql-fake models the contact write path only, and a fake that
 * pretended to implement DISTINCT ON and json_agg would be testing the fake.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { pairKey, DM_REACTION_KINDS } from "./dm-store.js";
import { REACTION_KINDS as NOTE_REACTION_KINDS } from "./note-media-store.js";
import { REACTION_KINDS } from "../lib/reaction-kinds.js";

const A = "00000000-0000-0000-0000-00000000000a";
const B = "ffffffff-ffff-ffff-ffff-ffffffffffff";

test("the pair is sorted, so call order cannot create two threads", () => {
  assert.deepEqual(pairKey(A, B), { a: A, b: B });
  assert.deepEqual(pairKey(B, A), { a: A, b: B });
});

test("a < b always holds, which is what the CHECK constraint requires", () => {
  for (const [x, y] of [
    [A, B],
    [B, A],
    ["11111111-1111-1111-1111-111111111111", "22222222-2222-2222-2222-222222222222"],
    ["22222222-2222-2222-2222-222222222222", "11111111-1111-1111-1111-111111111111"],
  ]) {
    const pair = pairKey(x, y);
    assert.ok(pair, `${x} ${y}`);
    assert.ok(pair.a < pair.b, `${pair.a} < ${pair.b}`);
  }
});

test("case and whitespace are normalized, so one person is not two", () => {
  // Postgres renders uuids lower-case; a client echoing an upper-case one back
  // must land on the same thread, not a second one.
  assert.deepEqual(pairKey(A.toUpperCase(), `  ${B}  `), { a: A, b: B });
});

test("you cannot open a thread with yourself", () => {
  assert.equal(pairKey(A, A), null);
  assert.equal(pairKey(A, A.toUpperCase()), null);
});

test("anything that is not a uuid is refused rather than coerced", () => {
  for (const bad of [null, undefined, "", "   ", "nope", 42, {}, [], A.slice(0, -1)]) {
    assert.equal(pairKey(bad, B), null, String(bad));
    assert.equal(pairKey(A, bad), null, String(bad));
  }
});

test("the reaction set matches note_reactions, so the client shares one glyph map", () => {
  // COMPARED AGAINST THE SHARED LIST, not against a copy of it typed here.
  //
  // This used to spell the five kinds out, which made it a SECOND copy of the
  // thing it was checking -- so adding a sixth meant editing the store, the
  // other two stores, three CHECK constraints and this literal, and the test
  // failed for the one reason that was not a bug. The three stores now import
  // lib/reaction-kinds.js and this asserts they all point at it.
  assert.deepEqual([...DM_REACTION_KINDS], [...REACTION_KINDS]);
  assert.deepEqual([...NOTE_REACTION_KINDS], [...REACTION_KINDS]);
  // Frozen: a kind added here without the matching CHECK constraint would fail
  // at insert time, in production, on a tap.
  assert.ok(Object.isFrozen(DM_REACTION_KINDS));
});
