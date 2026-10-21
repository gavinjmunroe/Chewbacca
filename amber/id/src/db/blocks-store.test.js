/**
 * BLOCKING, AND THE TWO WAYS IT WAS NOT REALLY BLOCKING.
 *
 * The table existed and the check existed. What did not exist was any caller
 * outside routes/dms.js, so a block stopped direct messages and left the blocked
 * person free to send a connection request, ask for an intro, and put a push on
 * the recipient's lock screen with their own name on it -- each of which is the
 * contact somebody blocking another person is trying to stop.
 *
 * And underneath that, the check returned false on any error. A database blip
 * un-blocked everybody for its duration, silently, because "not blocked" and
 * "could not tell" were the same value.
 *
 * So the tests here are almost entirely about the unhappy paths. A block that
 * works when the database is healthy and everything is wired is not the thing
 * that was broken.
 *
 * Run with:  node --test src/db/blocks-store.test.js
 */
import test from "node:test";
import assert from "node:assert/strict";

import { blockedIdsFor, blocksInteraction, setBlock } from "./blocks-store.js";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const C = "33333333-3333-4333-8333-333333333333";

const answering = (rows) => {
  const asked = [];
  return {
    asked,
    query: async (text, values) => {
      asked.push({ text, values });
      return { rows };
    },
  };
};
const throwing = () => ({
  query: async () => {
    throw new Error("ECONNREFUSED");
  },
});

test("NOT KNOWING IS TREATED AS BLOCKED", async () => {
  /**
   * The one that matters most, and the exact inversion of what shipped. The old
   * implementation caught the error and returned false, so an unreachable
   * database meant every block in the product silently stopped applying -- with
   * nothing in any log to say so, because the messages simply went through.
   *
   * One refused request during an outage is recoverable by trying again. A
   * message arriving from somebody the recipient shut out is not.
   */
  assert.equal(await blocksInteraction(A, B, throwing()), true);
});

test("a block applies in both directions", async () => {
  // Symmetric on purpose. Letting the blocked party still RECEIVE things from
  // the blocker is both unwanted contact and a way to learn you were blocked.
  const deps = answering([{ "?column?": 1 }]);
  assert.equal(await blocksInteraction(A, B, deps), true);
  assert.equal(await blocksInteraction(B, A, deps), true);
  assert.match(deps.asked[0].text, /blocker_amber_id = \$1[\s\S]*blocker_amber_id = \$2/);
});

test("two people with no block between them can interact", async () => {
  // The check has to be able to say no, or every one of the new call sites
  // would refuse everything and the feature would read as broken.
  assert.equal(await blocksInteraction(A, C, answering([])), false);
});

test("NOBODY IS BLOCKED FROM THEMSELVES, and junk ids are not people", async () => {
  /**
   * Failing closed has an edge: if a missing or malformed counterparty read as
   * "blocked", every call that legitimately has nobody on the other side would
   * refuse. That would turn a safety control into an outage.
   */
  const deps = answering([{ x: 1 }]);
  assert.equal(await blocksInteraction(A, A, deps), false, "blocked from themselves");
  for (const bad of [null, undefined, "", "  ", "not-a-uuid", 42]) {
    assert.equal(await blocksInteraction(A, bad, deps), false, `refused on ${JSON.stringify(bad)}`);
    assert.equal(await blocksInteraction(bad, A, deps), false, `refused on ${JSON.stringify(bad)}`);
  }
  assert.deepEqual(deps.asked, [], "spent a query on an id that is not a person");
});

test("ids are compared case-insensitively, because a uuid is not case-sensitive", async () => {
  const deps = answering([]);
  await blocksInteraction(A.toUpperCase(), B, deps);
  assert.deepEqual(deps.asked[0].values, [A, B]);
});

test("THE FAN-OUT LIST RETURNS NULL WHEN IT CANNOT TELL, never an empty Set", async () => {
  /**
   * An empty Set means "nobody is blocked" and would send to everyone. The
   * notification path treats null as "send nothing", so this distinction is the
   * difference between a quiet minute and a push from somebody's blocker.
   */
  assert.equal(await blockedIdsFor(A, throwing()), null);

  const none = await blockedIdsFor(A, answering([]));
  assert.ok(none instanceof Set);
  assert.equal(none.size, 0);
});

test("the fan-out list covers both directions in one query", async () => {
  const deps = answering([{ other: B }, { other: C.toUpperCase() }]);
  const set = await blockedIdsFor(A, deps);
  assert.equal(set.size, 2);
  assert.ok(set.has(B), "someone this account blocked is missing");
  assert.ok(set.has(C), "someone who blocked this account is missing, and case was not normalized");
  assert.equal(deps.asked.length, 1, "a round trip per person on a fan-out path");
  assert.match(deps.asked[0].text, /UNION/);
});

test("an unknown account blocks nobody, and costs no query", async () => {
  const deps = answering([{ other: B }]);
  const set = await blockedIdsFor("not-a-uuid", deps);
  assert.ok(set instanceof Set);
  assert.equal(set.size, 0);
  assert.deepEqual(deps.asked, []);
});

test("UNBLOCKING REMOVES ONLY YOUR OWN ROW", async () => {
  /**
   * If both people blocked each other, one of them relenting must not reopen the
   * door on the other's behalf. The DELETE is one-directional for that reason,
   * and a symmetric one here would be a silent way to un-block yourself from
   * somebody else's list.
   */
  const deps = answering([]);
  await setBlock(A, B, false, deps);
  assert.match(deps.asked[0].text, /DELETE FROM dm_blocks/);
  assert.match(deps.asked[0].text, /blocker_amber_id = \$1::uuid AND blocked_amber_id = \$2::uuid/);
  assert.ok(!/OR/.test(deps.asked[0].text), "unblocking cleared the other person's block too");
  assert.deepEqual(deps.asked[0].values, [A, B]);
});

test("blocking twice is not an error", async () => {
  const deps = answering([]);
  assert.equal(await setBlock(A, B, true, deps), true);
  assert.match(deps.asked[0].text, /ON CONFLICT DO NOTHING/);
});

test("a failed write reports failure rather than a block that is not there", async () => {
  // The UI turns a switch on from this return value. Reporting success on a
  // write that did not land would show "blocked" over a door still open.
  assert.equal(await setBlock(A, B, true, throwing()), false);
  assert.equal(await setBlock(A, A, true, answering([])), false, "blocked themselves");
  assert.equal(await setBlock(A, "junk", true, answering([])), false);
});

// ── the hard block: the person, not the row ─────────────────────────────────

/**
 * Keyed on amber_id alone, a block was a block on a database ROW. Delete the
 * account, sign up again on the same phone, new amber_id, clean slate -- and the
 * person who blocked you never learns it happened.
 *
 * The SQL half of this was verified against a real Postgres: a handle row
 * survives its source account being deleted (source_amber_id goes null rather
 * than the row cascading away), the recreated account on the same phone hash is
 * still blocked, a stranger is not, and the BLOCKER deleting their own account
 * does take their blocks with them. What is pinned here is the query shape,
 * because the two foreign keys pointing opposite ways is the kind of thing a
 * later "tidy-up" makes symmetric without realizing it is the whole feature.
 */
test("A BLOCK COVERS THEIR HANDLES, NOT JUST THEIR ACCOUNT ROW", async () => {
  const deps = answering([]);
  await blocksInteraction(A, B, deps);
  const sql = deps.asked[0].text;
  assert.match(sql, /FROM dm_blocks/, "the account block is gone");
  assert.match(sql, /blocked_handles/, "a deleted-and-recreated account walks straight back in");
  assert.match(sql, /JOIN discovery_keys/, "handles are not matched to real accounts");
  assert.match(sql, /dk\.key_type = bh\.key_type AND dk\.key_hash = bh\.key_hash/);
});

test("the handle check runs in BOTH directions, like the account check", async () => {
  // Only checking "did I block their handle" would let somebody who blocked ME
  // by phone still receive everything I do.
  const deps = answering([]);
  await blocksInteraction(A, B, deps);
  const sql = deps.asked[0].text;
  assert.match(sql, /bh\.blocker_amber_id = \$1::uuid AND dk\.amber_id = \$2::uuid/);
  assert.match(sql, /bh\.blocker_amber_id = \$2::uuid AND dk\.amber_id = \$1::uuid/);
});

test("BLOCKING COPIES THE HASHES, and never touches a phone number", async () => {
  /**
   * INSERT ... SELECT from discovery_keys. The 16-byte HMACs are already there,
   * so nothing in this path reads, writes or compares a plaintext phone or
   * email -- which is the same standing rule lib/identity-keys.js sets for every
   * other table that answers questions about handles.
   */
  const deps = answering([]);
  await setBlock(A, B, true, deps);
  assert.equal(deps.asked.length, 2, "blocked the row without blocking the person");
  const handles = deps.asked[1].text;
  assert.match(handles, /INSERT INTO blocked_handles/);
  assert.match(handles, /FROM discovery_keys dk/);
  assert.match(handles, /ON CONFLICT DO NOTHING/, "blocking twice would error");
  assert.ok(!/phone|email/i.test(handles), "a plaintext handle reached the block path");
  assert.deepEqual(deps.asked[1].values, [A, B]);
});

test("UNBLOCKING CLEARS BY SOURCE, not by their current handles", async () => {
  /**
   * Re-reading the other account's handles at unblock time misses anybody who
   * changed their number while blocked -- leaving a row nothing can ever clear:
   * an invisible block on a phone number, with no UI that admits it exists.
   */
  const deps = answering([]);
  await setBlock(A, B, false, deps);
  assert.equal(deps.asked.length, 2);
  const handles = deps.asked[1].text;
  assert.match(handles, /DELETE FROM blocked_handles/);
  assert.match(handles, /source_amber_id = \$2::uuid/);
  assert.ok(!/discovery_keys/.test(handles), "unblock re-read their current handles");
});

test("the fan-out list sees handle blocks in both directions too", async () => {
  const deps = answering([{ other: B }]);
  await blockedIdsFor(A, deps);
  const sql = deps.asked[0].text;
  // Four sources: two account directions, two handle directions.
  assert.equal((sql.match(/UNION/g) || []).length, 3, "a direction is missing from the fan-out");
  assert.match(sql, /bh\.blocker_amber_id = \$1::uuid/, "people I blocked by handle still get pushes");
  assert.match(sql, /dk\.amber_id = \$1::uuid/, "people who blocked MY handle still get pushes");
});
