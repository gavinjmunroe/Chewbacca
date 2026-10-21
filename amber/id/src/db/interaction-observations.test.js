/**
 * WHO GETS A ROW WHEN TWO PEOPLE USE THE APP TOGETHER.
 *
 * The SQL is not the interesting part; the policy is, and it is the part that
 * has to hold: both sides or neither, one row per exchange rather than one per
 * message, nothing for somebody who is not in the other's address book, and
 * never a row about yourself.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { observeDmMessage, __setImplForTests } from "./interaction-observations.js";

const ME = "11111111-1111-4111-8111-111111111111";
const THEM = "22222222-2222-4222-8222-222222222222";

/** Cards for everybody, no open window, and a record of what was written. */
function harness({ cards = "both", open = null } = {}) {
  const calls = { inserted: [], appended: [], cardLookups: [] };
  const restore = __setImplForTests({
    contactCardFor: async (ownerId, subjectId) => {
      calls.cardLookups.push([ownerId, subjectId]);
      if (cards === "both") return { id: `card-of-${subjectId.slice(0, 4)}`, name: "Someone" };
      if (cards === "sender-only") {
        return ownerId === ME ? { id: "card-them", name: "Maggie" } : null;
      }
      return null;
    },
    openWindowRow: async () => open,
    appendLine: async (id, line) => {
      calls.appended.push({ id, line });
    },
    insertObservation: async (args) => {
      calls.inserted.push(args);
      return { observationId: "obs" };
    },
  });
  return { calls, restore };
}

test("one message writes one row on EACH side, each against its own owner", async () => {
  const { calls, restore } = harness();
  try {
    const n = await observeDmMessage({
      senderAmberId: ME,
      recipientAmberId: THEM,
      text: "I got the job",
    });
    assert.equal(n, 2);
    assert.deepEqual(
      calls.inserted.map((o) => o.ownerId),
      [ME, THEM],
    );
    // Each row is filed against the OTHER person's card, never the owner's own.
    assert.equal(calls.inserted[0].contactId, `card-of-${THEM.slice(0, 4)}`);
    assert.equal(calls.inserted[1].contactId, `card-of-${ME.slice(0, 4)}`);
    // 'dm' is what contact-rollup's INTERACTION_STREAM excludes so the exchange
    // is not counted twice. If this string changes, that must change with it.
    assert.equal(calls.inserted[0].source, "dm");
    // Quiet by design: chat is the highest-volume, lowest-density evidence in
    // the app, and salience is what stops it burying a stated fact.
    assert.ok(calls.inserted[0].salience < 0.5);
    assert.equal(calls.inserted[0].modality, "actual");
  } finally {
    restore();
  }
});

test("the two sides read differently, because who said it is part of what was said", async () => {
  const { calls, restore } = harness();
  try {
    await observeDmMessage({ senderAmberId: ME, recipientAmberId: THEM, text: "I'm moving to Denver" });
    assert.match(calls.inserted[0].body, /^Message I sent/);
    assert.match(calls.inserted[1].body, /^Message they sent me/);
  } finally {
    restore();
  }
});

test("a second message in the same hour APPENDS instead of adding a row", async () => {
  const { calls, restore } = harness({ open: { observation_id: "obs-1", body: "earlier" } });
  try {
    const n = await observeDmMessage({ senderAmberId: ME, recipientAmberId: THEM, text: "and another thing" });
    assert.equal(n, 2);
    assert.equal(calls.inserted.length, 0);
    assert.equal(calls.appended.length, 2);
  } finally {
    restore();
  }
});

test("a side with no contact card for the other person gets nothing", async () => {
  const { calls, restore } = harness({ cards: "sender-only" });
  try {
    const n = await observeDmMessage({ senderAmberId: ME, recipientAmberId: THEM, text: "hello" });
    assert.equal(n, 1);
    assert.deepEqual(
      calls.inserted.map((o) => o.ownerId),
      [ME],
    );
  } finally {
    restore();
  }
});

test("nothing is written for an empty message, a self-message, or a bad id", async () => {
  const { calls, restore } = harness();
  try {
    assert.equal(await observeDmMessage({ senderAmberId: ME, recipientAmberId: THEM, text: "   " }), 0);
    assert.equal(await observeDmMessage({ senderAmberId: ME, recipientAmberId: ME, text: "hi" }), 0);
    assert.equal(await observeDmMessage({ senderAmberId: "not-a-uuid", recipientAmberId: THEM, text: "hi" }), 0);
    assert.equal(calls.inserted.length + calls.appended.length, 0);
    // And it never even asks the database about a message it will not write.
    assert.equal(calls.cardLookups.length, 0);
  } finally {
    restore();
  }
});

test("one side failing does not cost the other side its row", async () => {
  const calls = { inserted: [] };
  const restore = __setImplForTests({
    contactCardFor: async (ownerId) => ({ id: `card-${ownerId.slice(0, 4)}`, name: null }),
    openWindowRow: async () => null,
    appendLine: async () => {},
    insertObservation: async (args) => {
      if (args.ownerId === ME) throw new Error("owner one is having a bad day");
      calls.inserted.push(args);
      return { observationId: "obs" };
    },
  });
  try {
    const n = await observeDmMessage({ senderAmberId: ME, recipientAmberId: THEM, text: "still fine" });
    assert.equal(n, 1);
    assert.deepEqual(
      calls.inserted.map((o) => o.ownerId),
      [THEM],
    );
  } finally {
    restore();
  }
});
