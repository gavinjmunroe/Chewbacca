/**
 * THE ANSWER HAS TO LAND SOMEWHERE.
 *
 * "Which Mei do you mean?" was asked, answered, confirmed to the user with
 * "Got it, I'll write that down for Mei" -- and applied to nothing:
 *
 *   RESOLVE_NOOP ... awaiting=which_contact contentId=undefined factId=null
 *   -- the answer attached to nothing
 *
 * The branch that handles that question required pending.fact_id, and a pending
 * row legitimately has none: the question is asked from the chat pre-check
 * before any observation is written. This asserts the fallback -- settle it by
 * (conversation, name) instead of by id -- because the failure mode is silent
 * and the user's only evidence is that their correction did nothing.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { resolvePendingItem } from "./resolve-pending.js";

const OWNER = "35a94acc-5d39-488b-9b01-a239c8255076";
const CONTACT = "9c30df26-0014-4e6a-b66e-8cb26aca1586";
const CONV = "0fadc4a4-68be-47a3-8d4f-19c264f63c8f";

const noop = async () => null;

test("a which_contact answer with NO observation id is applied by name", async () => {
  const calls = [];
  const res = await resolvePendingItem({
    ownerId: OWNER,
    pending: {
      id: 26,
      awaiting: "which_contact",
      raw_name: "Mee",
      // Exactly the shape from the log: nothing to attach to.
      content_type: undefined,
      content_id: undefined,
      fact_id: null,
    },
    resolvedId: CONTACT,
    resolvedName: "Mei Lin",
    conversationId: CONV,
    correctName: noop,
    correctTranscript: noop,
    findConversation: async () => CONV,
    resolveByName: async (owner, conv, rawName, contactId) => {
      calls.push({ owner, conv, rawName, contactId });
      return { ok: true, resolved: 2 };
    },
  });

  assert.equal(res.ok, true);
  assert.deepEqual(calls, [
    { owner: OWNER, conv: CONV, rawName: "Mee", contactId: CONTACT },
  ]);
});

test("the conversation is derived when the caller does not have one", async () => {
  // Every caller in the codebase omitted it for months, which is how the words
  // stayed wrong after a correction. The pending row is asked instead.
  let asked = false;
  await resolvePendingItem({
    ownerId: OWNER,
    pending: { id: 27, awaiting: "which_contact", raw_name: "Mee", fact_id: null },
    resolvedId: CONTACT,
    resolvedName: "Mei Lin",
    correctName: noop,
    correctTranscript: noop,
    findConversation: async () => {
      asked = true;
      return CONV;
    },
    resolveByName: async () => ({ ok: true, resolved: 1 }),
  });
  assert.equal(asked, true);
});

test("a name nobody can place does not invent a resolution", async () => {
  // No conversation and no name means there is genuinely nothing to attach to.
  // The point is that it stays a NOOP rather than reporting success.
  let called = false;
  const res = await resolvePendingItem({
    ownerId: OWNER,
    pending: { id: 28, awaiting: "which_contact", raw_name: "", fact_id: null },
    resolvedId: CONTACT,
    resolvedName: "Mei Lin",
    correctName: noop,
    correctTranscript: noop,
    findConversation: async () => null,
    resolveByName: async () => {
      called = true;
      return { ok: true, resolved: 1 };
    },
  });
  assert.equal(called, false);
  // It still answers the caller -- the confirmation copy is decided upstream --
  // but the RESOLVE_NOOP line is what tells us it landed nowhere.
  assert.equal(res.ok, true);
});
