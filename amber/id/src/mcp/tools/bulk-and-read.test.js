process.env.IDENTITY_KEY_PEPPER ||= "unit-test-pepper-not-a-real-secret-0123456789";
/**
 * THE REST OF THE DOOR.
 *
 * upsert_contact proved an agent can put ONE person into a rolodex without
 * damaging it. These three tools are the rest of what an agent in iMessage,
 * WhatsApp, Clay or a voice prompt actually needs, and each carries a way to
 * ruin an address book that has to be closed before it ships:
 *
 *   bulk_upsert_contacts  — a batch containing the same person twice must end
 *                           as one card. Resolved concurrently it ends as two,
 *                           which is the duplicate the whole resolver exists to
 *                           prevent, arriving in bulk.
 *
 *   get_contact           — must never create. Every other path into contacts
 *                           resolves-or-inserts; a read that inserts turns
 *                           "what's her number" into a new blank person.
 *
 *   add_contact_note      — must never guess who a note is about. Two Maggies
 *                           means asking, not picking, because the cost of
 *                           picking is somebody's private note on a stranger.
 *
 * Run with:  node --test src/mcp/tools/bulk-and-read.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { installFakeSql } from "../../db/sql-fake-harness.js";

const sql = await installFakeSql();
const bulk = (await import("./bulk-upsert-contacts.js")).handler;
const getContact = (await import("./get-contact.js")).handler;
const noteTool = await import("./add-contact-note.js");
const addNote = noteTool.handler;
const { invalidateIdentityIndex } = await import("../../db/contact-identity.js");

const OWNER = "22222222-2222-2222-2222-222222222222";
const DID = `did:amber:${OWNER}`;

function reset() {
  sql.resetFakeSql();
  sql.registerFakeOwner(OWNER);
  invalidateIdentityIndex();
}

const live = () => sql.liveContacts(OWNER);
const body = (res) => res.structuredContent ?? JSON.parse(res.content[0].text);

// ── bulk_upsert_contacts ────────────────────────────────────────────────────

test("a batch writes every contact in it", async () => {
  reset();
  const res = await bulk({
    did: DID,
    source: "clay",
    contacts: [
      { name: "Ada Reyes", emails: ["ada@corp.com"] },
      { name: "Bo Tran", emails: ["bo@corp.com"] },
      { name: "Cy Okafor", phoneNumbers: ["+15550001111"] },
    ],
  });
  const out = body(res);
  assert.equal(out.received, 3);
  assert.equal(out.failed, 0, JSON.stringify(out.failures));
  assert.equal(live().length, 3);
});

test("THE SAME PERSON TWICE IN ONE BATCH IS ONE CARD", async () => {
  // The reason this tool is sequential. Two records for one person resolved at
  // the same time both see an empty rolodex and both insert.
  reset();
  await bulk({
    did: DID,
    source: "clay",
    contacts: [
      { name: "Ada Reyes", emails: ["ada@corp.com"] },
      { name: "Ada Reyes", emails: ["ada@corp.com"], company: "Corp" },
    ],
  });
  assert.equal(live().length, 1, "a batch duplicated somebody against itself");
});

test("re-running the same batch adds nobody", async () => {
  reset();
  const page = {
    did: DID,
    source: "clay",
    contacts: [
      { name: "Ada Reyes", emails: ["ada@corp.com"] },
      { name: "Bo Tran", emails: ["bo@corp.com"] },
    ],
  };
  await bulk(page);
  await bulk(page);
  assert.equal(live().length, 2, "a re-import duplicated the rolodex");
});

test("a batch dedupes against contacts that were already there", async () => {
  reset();
  await bulk({ did: DID, source: "apple", contacts: [{ name: "Ada Reyes", emails: ["ada@corp.com"] }] });
  await bulk({ did: DID, source: "clay", contacts: [{ name: "Ada Reyes", emails: ["ada@corp.com"] }] });
  assert.equal(live().length, 1);
});

test("ONE BAD RECORD COSTS ONE RECORD, not the batch", async () => {
  reset();
  const out = body(
    await bulk({
      did: DID,
      source: "clay",
      contacts: [
        { name: "Ada Reyes", emails: ["ada@corp.com"] },
        { name: "   " },
        { name: "Bo Tran", emails: ["bo@corp.com"] },
      ],
    }),
  );
  assert.equal(out.failed, 1);
  assert.equal(out.failures[0].index, 1);
  assert.equal(live().length, 2, "a bad row took good rows down with it");
});

test("every record is accounted for, by index", async () => {
  reset();
  const out = body(
    await bulk({
      did: DID,
      source: "clay",
      contacts: [{ name: "Ada Reyes" }, { name: "Bo Tran" }, { name: "Cy Okafor" }],
    }),
  );
  assert.equal(out.results.length, 3);
  assert.deepEqual(out.results.map((r) => r.index), [0, 1, 2]);
});

test("an unlinked DID writes nobody", async () => {
  reset();
  const res = await bulk({
    did: "did:amber:33333333-3333-3333-3333-333333333333",
    contacts: [{ name: "Nobody" }],
  });
  assert.equal(res.isError, true);
  assert.equal(live().length, 0);
});

test("a batch over the cap is refused rather than half-written", async () => {
  reset();
  const res = await bulk({
    did: DID,
    contacts: Array.from({ length: 501 }, (_, i) => ({ name: `Person ${i}` })),
  });
  assert.equal(res.isError, true);
  assert.equal(live().length, 0);
});

// ── get_contact ─────────────────────────────────────────────────────────────

test("a card comes back by email, and by phone", async () => {
  reset();
  await bulk({
    did: DID,
    source: "clay",
    contacts: [{ name: "Ada Reyes", emails: ["ada@corp.com"], phoneNumbers: ["+15550001111"] }],
  });

  const byEmail = body(await getContact({ did: DID, email: "ada@corp.com" }));
  assert.equal(byEmail.resolved, true);
  assert.equal(byEmail.matchedBy, "email");

  const byPhone = body(await getContact({ did: DID, phone: "(555) 000-1111" }));
  assert.equal(byPhone.resolved, true, "a differently formatted number did not match");
});

test("READING SOMEBODY WHO IS NOT THERE CREATES NOBODY", async () => {
  reset();
  const res = await getContact({ did: DID, email: "ghost@nowhere.com" });
  assert.equal(res.isError, true);
  assert.equal(live().length, 0, "a read created a contact");
});

test("a name matching two people returns both rather than picking one", async () => {
  reset();
  await bulk({
    did: DID,
    source: "clay",
    contacts: [
      { name: "Maggie Chen", emails: ["maggie@one.com"] },
      { name: "Maggie Chen", emails: ["maggie@two.com"] },
    ],
  });
  assert.equal(live().length, 2, "two same-named people with different emails should stay two");
  const out = body(await getContact({ did: DID, name: "Maggie Chen" }));
  assert.equal(out.resolved, false);
  assert.equal(out.reason, "ambiguous");
  assert.equal(out.candidates.length, 2);
});

test("asking about nobody in particular is refused", async () => {
  reset();
  const res = await getContact({ did: DID });
  assert.equal(res.isError, true);
});

// ── add_contact_note ────────────────────────────────────────────────────────

test("A NOTE IS WRITTEN AGAINST THE CONTACT THIS TOOL RESOLVED", async () => {
  // The fake has no observations table, so the store call is replaced -- which
  // is also the only way to see the argument that matters: WHICH contact id the
  // note was filed against. That is the property worth asserting; whether
  // Postgres accepted the row is the smoke script's job.
  reset();
  await bulk({ did: DID, source: "clay", contacts: [{ name: "Patrick Racy", emails: ["patrick@impala.ai"] }] });
  const [{ id: patrick }] = live();

  const seen = [];
  const original = noteTool.__deps.insertContactNote;
  noteTool.__deps.insertContactNote = async (args) => {
    seen.push(args);
    return "note-1";
  };
  try {
    const out = body(
      await addNote({
        did: DID,
        email: "patrick@impala.ai",
        note: "Moved to Austin in September.",
        source: "imessage",
      }),
    );
    assert.equal(out.written, true);
    assert.equal(out.noteId, "note-1");
    assert.equal(out.source, "imessage");
    assert.equal(seen.length, 1);
    assert.deepEqual(seen[0].participantIds, [String(patrick)]);
    assert.equal(seen[0].noteText, "Moved to Austin in September.");
    assert.equal(seen[0].status, "resolved");
  } finally {
    noteTool.__deps.insertContactNote = original;
  }
});

test("a note the store refuses is reported as a failure, not a save", async () => {
  reset();
  await bulk({ did: DID, source: "clay", contacts: [{ name: "Ada Reyes", emails: ["ada@corp.com"] }] });
  const original = noteTool.__deps.insertContactNote;
  noteTool.__deps.insertContactNote = async () => null;
  try {
    const res = await addNote({ did: DID, email: "ada@corp.com", note: "Something." });
    assert.equal(res.isError, true);
  } finally {
    noteTool.__deps.insertContactNote = original;
  }
});

test("A NOTE ABOUT SOMEBODY NOT IN THE ROLODEX CREATES NO CARD", async () => {
  reset();
  const res = await addNote({ did: DID, name: "Somebody New", note: "Said hello." });
  assert.equal(res.isError, true);
  assert.equal(live().length, 0, "a note invented a contact from a name");
});

test("A NOTE IS NEVER GUESSED ONTO ONE OF TWO PEOPLE", async () => {
  reset();
  await bulk({
    did: DID,
    source: "clay",
    contacts: [
      { name: "Maggie Chen", emails: ["maggie@one.com"] },
      { name: "Maggie Chen", emails: ["maggie@two.com"] },
    ],
  });
  const out = body(await addNote({ did: DID, name: "Maggie Chen", note: "Getting married in June." }));
  assert.equal(out.written, false);
  assert.equal(out.reason, "ambiguous");
  assert.equal(out.candidates.length, 2);
});

test("an empty note is refused", async () => {
  reset();
  await bulk({ did: DID, source: "clay", contacts: [{ name: "Ada Reyes", emails: ["ada@corp.com"] }] });
  const res = await addNote({ did: DID, email: "ada@corp.com", note: "   " });
  assert.equal(res.isError, true);
});
