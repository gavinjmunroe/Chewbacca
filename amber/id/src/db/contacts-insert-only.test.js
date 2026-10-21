/**
 * A REFRESH ADDS PEOPLE AND CHANGES NOBODY.
 *
 * "I noticed that when I did the refresh, it reset the names of the contacts I
 *  had edited in my Amber contact book. That should not be the case... It should
 *  not change anything in Amber. Nothing from Apple should change Amber after
 *  the initial sync. It should only provide inserts, no edits, only inserts."
 *
 * The old behavior was indefensible and this file is the guard against it
 * coming back. An Apple re-sync resolves every card by rule 1 -- same source,
 * same external id, "the source restating a card it owns" -- which
 * mergedColumnValues treats as AUTHORITATIVE, so the phone's name overwrote the
 * name he had typed in Amber. Every refresh silently undid his editing, and
 * nothing logged it.
 *
 * The properties pinned here:
 *
 *   a name edited in Amber survives a re-sync that carries the old name
 *   a phone edited in Amber is not re-primaried by the device's order
 *   a company / city typed in Amber is not blanked or replaced
 *   genuinely NEW people are still inserted (that is the whole point of a refresh)
 *   the first sync still merges, because that is when a duplicate-ridden
 *     address book gets tidied and there is nothing of his to protect yet
 *
 * The in-memory sql fake records every statement, so "no UPDATE was issued" is
 * directly observable rather than inferred.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { installFakeSql } from "./sql-fake-harness.js";

const sql = await installFakeSql();
const { upsertContactsForOwner } = await import("./store.js");

const OWNER = "amber_owner_1";
const OWNER_PHONE = "+13105559999";
const NAME = 3; // index of full_name in UPSERT_COLUMN_ORDER
const PHONE_PRIMARY = 6;
const PHONES_ALL = 7;
const COMPANY = 9;

function appleCard(over = {}) {
  return {
    externalId: "APPLE-1",
    name: "Margaret Okafor",
    firstName: "Margaret",
    lastName: "Okafor",
    phoneNumbers: ["+13105550100"],
    emails: ["margaret@example.com"],
    company: "Bluebird",
    source: "apple",
    ...over,
  };
}

function first(contacts, mode) {
  return upsertContactsForOwner({
    ownerId: OWNER,
    ownerPhone: OWNER_PHONE,
    contacts,
    ...(mode ? { mode } : {}),
  });
}

function stored(externalId = "APPLE-1") {
  return sql.state.contacts.get(`${OWNER}|${externalId}`)?.row ?? null;
}

/** Statements that would MODIFY an existing contact row. */
function contactUpdates() {
  return sql
    .statementCalls()
    .filter((c) => /UPDATE contacts\b/.test(c.text) || /UPDATE contacts AS c SET/.test(c.text));
}

test("a name edited in Amber survives a re-sync carrying the device's old name", async () => {
  sql.resetFakeSql();
  // The initial sync, as it happens today.
  await first([appleCard()], "merge");
  assert.equal(stored()[NAME], "Margaret Okafor");

  // He renames her in Amber. (Whatever the editor does, the row now says this.)
  await upsertContactsForOwner({
    ownerId: OWNER,
    ownerPhone: OWNER_PHONE,
    contacts: [appleCard({ name: "Maggie" })],
    mode: "merge",
  });
  assert.equal(stored()[NAME], "Maggie", "precondition: the edit landed");

  // THE REFRESH. The phone still says "Margaret Okafor" -- it knows nothing
  // about what he typed in Amber -- and this is the moment that used to undo it.
  sql.resetFakeSqlCalls?.();
  const before = contactUpdates().length;
  const res = await upsertContactsForOwner({
    ownerId: OWNER,
    ownerPhone: OWNER_PHONE,
    contacts: [appleCard()],
    mode: "insert_only",
  });

  assert.equal(stored()[NAME], "Maggie", "the refresh must not rename her back");
  assert.equal(res.inserted, 0);
  assert.equal(res.unchanged, 1);
  assert.equal(res.merged, 0);
  assert.equal(res.updated, 0);
  // Not merely "the value is the same" -- no write was attempted at all.
  assert.equal(contactUpdates().length, before, "no UPDATE should be issued");
});

test("an edited phone order and an edited company also survive", async () => {
  sql.resetFakeSql();
  await first([appleCard({ phoneNumbers: ["+13105550100"], company: "Bluebird" })], "merge");

  // The Amber-side edits: a different primary number and a corrected company.
  await upsertContactsForOwner({
    ownerId: OWNER,
    ownerPhone: OWNER_PHONE,
    contacts: [
      appleCard({ phoneNumbers: ["+13105550199", "+13105550100"], company: "Bluebird Labs" }),
    ],
    mode: "merge",
  });
  const edited = stored();
  assert.equal(edited[PHONE_PRIMARY], "+13105550199", "precondition");
  assert.equal(edited[COMPANY], "Bluebird Labs", "precondition");

  // The device still has the old primary first and the old company.
  await upsertContactsForOwner({
    ownerId: OWNER,
    ownerPhone: OWNER_PHONE,
    contacts: [appleCard({ phoneNumbers: ["+13105550100"], company: "Bluebird" })],
    mode: "insert_only",
  });

  const after = stored();
  assert.equal(after[PHONE_PRIMARY], "+13105550199");
  assert.equal(after[COMPANY], "Bluebird Labs");
  assert.equal(after[PHONES_ALL], edited[PHONES_ALL]);
});

test("new people ARE inserted by a refresh — that is what a refresh is for", async () => {
  sql.resetFakeSql();
  await first([appleCard()], "merge");

  const res = await upsertContactsForOwner({
    ownerId: OWNER,
    ownerPhone: OWNER_PHONE,
    contacts: [
      appleCard(), // already here
      appleCard({
        externalId: "APPLE-2",
        name: "Ravi Menon",
        firstName: "Ravi",
        lastName: "Menon",
        phoneNumbers: ["+13105550222"],
        emails: ["ravi@example.com"],
      }),
    ],
    mode: "insert_only",
  });

  assert.equal(res.inserted, 1, "the new person lands");
  assert.equal(res.unchanged, 1, "the existing one is left alone");
  assert.equal(stored("APPLE-2")[NAME], "Ravi Menon");
  assert.equal(stored()[NAME], "Margaret Okafor");
});

test("a person deleted from the phone is NOT removed from Amber", async () => {
  // Insert-only cuts both ways, and this direction matters just as much: a
  // contact he deleted off his phone but wants to keep in Amber (or one Apple
  // simply stopped handing over -- Limited Access does exactly that) must not
  // disappear because a payload did not mention them.
  sql.resetFakeSql();
  await first([appleCard(), appleCard({ externalId: "APPLE-2", name: "Ravi Menon" })], "merge");

  await upsertContactsForOwner({
    ownerId: OWNER,
    ownerPhone: OWNER_PHONE,
    contacts: [appleCard()],
    mode: "insert_only",
  });

  assert.ok(stored("APPLE-2"), "an unmentioned contact stays");
  assert.equal(stored("APPLE-2")[NAME], "Ravi Menon");
});

test("the first sync still merges, because there is nothing of his to protect yet", async () => {
  sql.resetFakeSql();
  // Two cards for one person in the same payload, which is what a real address
  // book looks like. Merging is what collapses them.
  const res = await first(
    [
      appleCard({ externalId: "A", name: "Margaret Okafor", emails: [] }),
      appleCard({ externalId: "B", name: "Margaret Okafor", phoneNumbers: ["+13105550100"] }),
    ],
    "merge",
  );
  assert.ok(res.deduped >= 1, "duplicates in one payload still collapse on a first sync");
  assert.equal(res.unchanged, 0, "unchanged is an insert-only concept");
});

test("the default mode is unchanged, so every other caller behaves exactly as before", async () => {
  sql.resetFakeSql();
  await first([appleCard()]);
  const res = await first([appleCard({ name: "Renamed By Device" })]);
  // No mode passed -> merging -> a rule-1 restatement is authoritative. This is
  // the OLD behavior, and it is still right for the Clay / Google / web-ingest
  // writers that pass no mode: those are sources restating their own records,
  // and nobody has hand-edited them in Amber.
  assert.equal(stored()[NAME], "Renamed By Device");
  assert.equal(res.unchanged, 0);
});

test("the conflict clause itself cannot overwrite a name in insert-only mode", async () => {
  // BELT AND BRACES, and the reason is in the comment on
  // CONTACTS_INSERT_ONLY_TAIL: skipping the merge in JavaScript is only half of
  // insert-only. If the planner ever fails to match an existing card and plans
  // it as an insert, the normal tail's `DO UPDATE SET full_name = EXCLUDED…`
  // would rename the row regardless. The statement has to be safe on its own.
  sql.resetFakeSql();
  await first([appleCard()], "merge");

  const statements = () =>
    sql.statementCalls().filter((c) => /INSERT INTO contacts\b/.test(c.text));
  const beforeCount = statements().length;

  await upsertContactsForOwner({
    ownerId: OWNER,
    ownerPhone: OWNER_PHONE,
    // Same external id, different name -- a collision by construction.
    contacts: [appleCard({ name: "Should Not Win" })],
    mode: "insert_only",
  });

  const issued = statements().slice(beforeCount);
  for (const st of issued) {
    assert.ok(
      !/DO UPDATE SET\s+full_name/.test(st.text),
      "insert-only must never issue a conflict clause that assigns full_name",
    );
  }
  assert.equal(stored()[NAME], "Margaret Okafor");
});
