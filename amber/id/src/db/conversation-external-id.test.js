/**
 * A PHOTON SPACE ID IS NOT A UUID.
 *
 * conversations.conversation_id is a uuid. Photon hands us `spc-8f2a...`. Both
 * sides of the iMessage history path pushed that through asUuid(), got null, and
 * carried on without erroring:
 *
 *   loadRecentMessages  returned [] before querying anything. Every time.
 *   appendMessage       fell through to the "no space" branch and INSERTed a
 *                       brand new conversation. Every single message.
 *
 * So iMessage has never had durable history -- Amber answered from an in-process
 * Map capped at twelve turns that dies on redeploy -- and the table collected one
 * orphaned one-message thread per inbound text.
 *
 * The resolution now lives in ONE function, because the defect was not that
 * either call site was wrong on its own. It was that they were wrong DIFFERENTLY,
 * and two independently-correct-looking implementations of "which row is this
 * space" is exactly how that happens again.
 *
 * The SQL half -- that the upsert returns the same id five times, that two owners
 * on one space get two threads, that many NULL external_ids per owner stay legal
 * under the partial unique index -- was verified against a real Postgres. What is
 * here is the routing decision, which is where a regression would actually land.
 *
 * Run with:  node --test src/db/conversation-external-id.test.js
 */
import test from "node:test";
import assert from "node:assert/strict";

import { resolveConversationId } from "./observations-compat.js";

const OWNER = "11111111-1111-4111-8111-111111111111";
const CONV = "2f8ab477-ac0a-4c46-b4a9-9c6138c2021a";
const SPACE = "spc-8f2a3b1c";

/** A client that records what it was asked and answers with `rows`. */
function fakeClient(rows = []) {
  const asked = [];
  return {
    asked,
    query: async (text, values) => {
      asked.push({ text, values });
      return { rows };
    },
  };
}

test("A PHOTON SPACE RESOLVES TO ITS THREAD instead of to nothing", async () => {
  // The regression, in one line. null here is [] from the reader and a fresh
  // conversation from the writer -- the two symptoms that made iMessage amnesiac.
  const c = fakeClient([{ conversation_id: CONV }]);
  assert.equal(await resolveConversationId(OWNER, SPACE, c), CONV);
  assert.equal(c.asked.length, 1);
  assert.deepEqual(c.asked[0].values, [OWNER, SPACE]);
  assert.match(c.asked[0].text, /external_id/);
});

test("a space with no thread yet is null, not an invented id", async () => {
  // The first message from a new space. appendMessage creates the row; the
  // READER must say "nothing here" rather than guessing an id.
  const c = fakeClient([]);
  assert.equal(await resolveConversationId(OWNER, SPACE, c), null);
});

test("A REAL UUID NEVER TOUCHES THE DATABASE", async () => {
  /**
   * The app's own threads already pass a conversation_id. Sending those through
   * the external_id lookup would be a query per message that can only ever miss,
   * and worse, it would return null for a thread that plainly exists.
   */
  const c = fakeClient([{ conversation_id: "should-not-be-read" }]);
  assert.equal(await resolveConversationId(OWNER, CONV, c), CONV);
  assert.deepEqual(c.asked, [], "an app conversation id was looked up as an external id");
});

test("the lookup is scoped to the owner, because a group space is shared", async () => {
  // One Photon space id legitimately maps to a different thread for every
  // participant. A lookup on external_id alone would hand one person another
  // person's conversation.
  const c = fakeClient([{ conversation_id: CONV }]);
  await resolveConversationId(OWNER, SPACE, c);
  assert.equal(c.asked[0].values[0], OWNER);
  assert.match(c.asked[0].text, /owner_id/);
});

test("a deleted thread is not resurrected by an inbound text", async () => {
  const c = fakeClient([{ conversation_id: CONV }]);
  await resolveConversationId(OWNER, SPACE, c);
  assert.match(c.asked[0].text, /deleted_at IS NULL/);
});

test("nothing to resolve is null, and costs no query", async () => {
  for (const [owner, space] of [
    [null, SPACE],
    [OWNER, null],
    [OWNER, ""],
    [OWNER, "   "],
    ["not-a-uuid", SPACE],
  ]) {
    const c = fakeClient([{ conversation_id: CONV }]);
    assert.equal(await resolveConversationId(owner, space, c), null, `${owner} / ${space}`);
    assert.deepEqual(c.asked, [], `spent a query on ${owner} / ${space}`);
  }
});

test("a space id with surrounding whitespace is the same space", async () => {
  // Webhook payloads are not always tidy, and " spc-8f2a" writing a second row
  // would split one thread in two without anything looking wrong.
  const c = fakeClient([{ conversation_id: CONV }]);
  await resolveConversationId(OWNER, `  ${SPACE}\n`, c);
  assert.equal(c.asked[0].values[1], SPACE);
});
