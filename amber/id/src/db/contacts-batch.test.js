/**
 * Tests for the batched contact write path (upsertContactsForOwner).
 *
 * src/db/sql.js is swapped for the in-memory fake (sql-fake-harness.js), which
 * records every statement and models the partial unique index on (owner_id,
 * external_id) plus the NON-partial one on contact_identity_keys — so the
 * properties that matter are directly observable: how MANY statements a big sync
 * issues, and that a re-sync converges instead of duplicating.
 *
 * WRITE-TIME DEDUP CHANGED THREE BEHAVIORS HERE, deliberately (see
 * lib/contact-identity.js). Each is called out at the test that covers it:
 *   - one INSERT shape for every row (a NULL external_id is simply not in the
 *     partial index), instead of two branches;
 *   - duplicate cards in one payload merge by field-UNION rather than
 *     last-write-wins, so no value is dropped;
 *   - a contact with no external id at all no longer duplicates on re-sync,
 *     because it matches on phone.
 *
 * Run with:  node --test src/db/contacts-batch.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { installFakeSql } from "./sql-fake-harness.js";

const sql = await installFakeSql();
const { upsertContactsForOwner } = await import("./store.js");

const OWNER = "amber_owner_1";
const OWNER_PHONE = "+13105559999";

function makeContacts(n, { withExternalId = true, prefix = "ext" } = {}) {
  return Array.from({ length: n }, (_, i) => ({
    ...(withExternalId ? { externalId: `${prefix}-${i}` } : {}),
    name: `Person ${i}`,
    firstName: "Person",
    lastName: String(i),
    phoneNumbers: [`+1310555${String(i).padStart(4, "0")}`],
    emails: [`person${i}@example.com`],
    company: "Acme Corp",
    source: "apple",
  }));
}

function sync(contacts) {
  return upsertContactsForOwner({ ownerId: OWNER, ownerPhone: OWNER_PHONE, contacts });
}

test("1,000 contacts issue a bounded number of statements, not ~2,000", async () => {
  sql.resetFakeSql();
  const { upserted, failed } = await sync(makeContacts(1000));

  assert.equal(upserted, 1000);
  assert.equal(failed, 0);

  const statements = sql.statementCalls();
  const contactInserts = statements.filter((c) => /INSERT INTO contacts\b/.test(c.text));
  const sourceInserts = statements.filter((c) =>
    /INSERT INTO contact_sources\b/.test(c.text),
  );

  // 2 contact chunks (500 rows each) + 2 provenance chunks.
  assert.equal(contactInserts.length, 2, "expected one statement per 500-row chunk");
  assert.equal(sourceInserts.length, 2, "expected one provenance statement per chunk");
  // Budget now also covers the 2-query index load and the batched key claims
  // (1,000 contacts × 3 keys ÷ 500 = 6). Still O(n / 500), not O(n).
  assert.equal(
    statements.length,
    12,
    `expected 2 index + 2 insert + 6 key-claim + 2 provenance, got ${statements.length}`,
  );
  const keyClaims = statements.filter((c) =>
    /INSERT INTO contact_identity_keys\b/.test(c.text),
  );
  assert.equal(keyClaims.length, 6);

  // All 1,000 rows landed, each owner-scoped.
  assert.equal(sql.state.contacts.size, 1000);
  assert.equal(sql.state.contactSources.size, 1000);
  for (const { row } of sql.state.contacts.values()) assert.equal(row[0], OWNER);
  for (const row of sql.state.contactSources.values()) assert.equal(row[0], OWNER);
});

test("each chunk commits in its own transaction", async () => {
  sql.resetFakeSql();
  await sync(makeContacts(1000));

  const begins = sql.state.calls.filter((c) => c.text === "BEGIN").length;
  const commits = sql.state.calls.filter((c) => c.text === "COMMIT").length;
  const rollbacks = sql.state.calls.filter((c) => c.text === "ROLLBACK").length;

  assert.equal(begins, 4); // 2 contact chunks + 2 provenance chunks
  assert.equal(commits, 4);
  assert.equal(rollbacks, 0);
});

test("re-syncing the same batch updates in place — no duplicate rows, stable ids", async () => {
  sql.resetFakeSql();
  const contacts = makeContacts(1000);

  await sync(contacts);
  const idsAfterFirst = new Map(
    [...sql.state.contacts.entries()].map(([k, v]) => [k, v.id]),
  );
  const statementsFirst = sql.statementCalls().length;

  const second = await sync(contacts);

  assert.equal(second.upserted, 1000);
  assert.equal(second.failed, 0);
  // Table size unchanged → the second run updated, it did not insert.
  assert.equal(sql.state.contacts.size, 1000);
  assert.equal(sql.state.contactSources.size, 1000);
  assert.equal(sql.state.contactsNoExternalId.length, 0);
  // Same external_id → same row id.
  for (const [key, { id }] of sql.state.contacts.entries()) {
    assert.equal(id, idsAfterFirst.get(key), `row for ${key} was replaced, not updated`);
  }
  // The second run is bounded too, but it is NOT a repeat of the first: the rows
  // resolve on their source keys, so it issues field-UNION updates and re-claims
  // (already-held) keys instead of inserting.
  const secondRun = sql.statementCalls().slice(statementsFirst);
  assert.ok(
    secondRun.length <= statementsFirst + 4,
    `second sync should stay bounded, got ${secondRun.length}`,
  );
  assert.equal(second.inserted, 0, "nothing new to insert");
  // A RE-SYNC THAT CHANGES NOTHING NOW REPORTS NOTHING CHANGED, which is
  // the point of the three-way merge: `updated`/`merged` used to increment
  // even when mergedColumnValues returned null, so every sync over-reported
  // and a no-op sync claimed to have rewritten the whole address book.
  assert.equal(second.updated, 0, "identical payload: not one UPDATE");
  assert.equal(second.unchanged, 1000, "every row resolved on its own source key");

  // Every contacts statement carries the conflict clause that makes this true.
  for (const call of sql.statementCalls()) {
    if (!/INSERT INTO contacts\b/.test(call.text)) continue;
    assert.match(call.text, /ON CONFLICT \(owner_id, external_id\)/);
    assert.match(call.text, /DO UPDATE SET/);
  }
});

test("a re-sync with changed fields overwrites the row (same SET list as before)", async () => {
  sql.resetFakeSql();
  await sync([
    {
      externalId: "ext-a",
      name: "Maggie Smith",
      phoneNumbers: ["+13105550100"],
      company: "Acme Corp",
      source: "apple",
    },
  ]);
  await sync([
    {
      externalId: "ext-a",
      name: "Maggie Smith-Jones",
      phoneNumbers: ["+13105550999", "+13105550100"],
      company: "Newco",
      source: "apple",
    },
  ]);

  assert.equal(sql.state.contacts.size, 1);
  const { row } = sql.state.contacts.get(`${OWNER}|ext-a`);
  // Column order: owner_id, owner_phone, external_id, full_name, first, last,
  // phone_primary, phones_all, emails, company, source, phone_primary_normalized
  assert.equal(row[3], "Maggie Smith-Jones");
  assert.equal(row[6], "+13105550999");
  assert.equal(row[7], "+13105550999, +13105550100");
  assert.equal(row[9], "Newco");
  assert.equal(row[11], "13105550999");
});

test("device-shape column mapping is unchanged (phone_primary / external_id / company)", async () => {
  sql.resetFakeSql();
  // What the route's normalizer hands us for an old-build device payload.
  await sync([
    {
      externalId: "ABCD-1234-EFGH",
      name: "Maggie Smith",
      firstName: null,
      lastName: null,
      phoneNumbers: ["+13105550100", "+13105550101"],
      emails: [],
      company: "Acme Corp",
      source: "apple",
    },
  ]);

  const { row } = sql.state.contacts.get(`${OWNER}|ABCD-1234-EFGH`);
  // The twelve mapped columns. Deliberately sliced rather than extended: this
  // test is about the device-shape MAPPING, and asserting the whole row means it
  // breaks every time a column is added for an unrelated reason. The 13th
  // (sync_snapshot) has its own tests in contact-sync-merge.test.js.
  assert.deepEqual(row.slice(0, 12), [
    OWNER, OWNER_PHONE, "ABCD-1234-EFGH",
    "Maggie Smith", null, null,
    "+13105550100", "+13105550100, +13105550101", null,
    "Acme Corp", "apple", "13105550100",
  ]);
});

test("contacts without externalId batch too, and get no provenance row", async () => {
  sql.resetFakeSql();
  const { upserted, failed } = await sync(makeContacts(600, { withExternalId: false }));

  assert.equal(upserted, 600);
  assert.equal(failed, 0);
  assert.equal(sql.state.contactsNoExternalId.length, 600);
  assert.equal(sql.state.contacts.size, 0);
  assert.equal(sql.state.contactSources.size, 0, "no external_id → no provenance row");

  // CHANGED: there is now ONE insert statement shape. A NULL external_id is not
  // in the partial unique index, so the ON CONFLICT clause simply cannot fire for
  // these rows and a second branch bought nothing.
  const inserts = sql
    .statementCalls()
    .filter((c) => /INSERT INTO contacts\b/.test(c.text));
  assert.equal(inserts.length, 2); // 500 + 100
  for (const call of inserts) {
    assert.match(call.text, /ON CONFLICT \(owner_id, external_id\)/);
    assert.equal(call.params[0], OWNER); // owner-scoped
  }
  // They still claim identity keys, which is what makes the NEXT sync converge.
  assert.ok(sql.state.identityKeys.size > 0);
});

test("mixed payload: both groups are written, name-only contacts included", async () => {
  sql.resetFakeSql();
  const { upserted, failed } = await sync([
    ...makeContacts(3),
    { name: "No Phone Nancy", phoneNumbers: [], emails: [] },
    { name: "No Id Ned", phoneNumbers: ["+14155550100"], emails: [] },
  ]);

  assert.equal(upserted, 5);
  assert.equal(failed, 0);
  assert.equal(sql.state.contacts.size, 3);
  assert.equal(sql.state.contactsNoExternalId.length, 2);
  // Rows are reported in the 12-column upsert order now that both groups share
  // one statement: [owner, owner_phone, external_id, full_name, ...].
  const nancy = sql.state.contactsNoExternalId.find((r) => r[3] === "No Phone Nancy");
  assert.ok(nancy, "name-only contact must still be inserted");
  assert.equal(nancy[6], null); // phone_primary
});

test("duplicate external_ids in one payload collapse by field-UNION", async () => {
  sql.resetFakeSql();
  const { upserted, failed } = await sync([
    { externalId: "dup", name: "First Write", phoneNumbers: ["+13105550001"], source: "apple" },
    { externalId: "dup", name: "Last Write", phoneNumbers: ["+13105550002"], source: "apple" },
  ]);

  // Both inputs counted, one row written — still no "cannot affect row a second
  // time". CHANGED: the collapse is a UNION, not last-write-wins. An identical
  // (source, external_id) is the source's own assertion that this is one card, so
  // the phone conflict does not split them; the first name wins and BOTH numbers
  // survive. The old behavior silently dropped "+13105550001".
  assert.equal(upserted, 2);
  assert.equal(failed, 0);
  assert.equal(sql.state.contacts.size, 1);
  const { row } = sql.state.contacts.get(`${OWNER}|dup`);
  assert.equal(row[3], "First Write");
  assert.equal(row[6], "+13105550001");
  assert.equal(row[7], "+13105550001, +13105550002", "neither number is lost");
  assert.equal(sql.state.contactSources.size, 1);
});

test("provenance failure never fails the contact write", async () => {
  sql.resetFakeSql();
  sql.state.failWhen = (text) => /INSERT INTO contact_sources\b/.test(text);

  const { upserted, failed } = await sync(makeContacts(10));

  assert.equal(upserted, 10);
  assert.equal(failed, 0);
  assert.equal(sql.state.contacts.size, 10);
  assert.equal(sql.state.contactSources.size, 0);
  sql.state.failWhen = null;
});

test("a failed chunk falls back to per-row writes: only the bad row is lost", async () => {
  sql.resetFakeSql();
  const contacts = makeContacts(5);
  // Fail the multi-row statement, and the single-row retry for one contact.
  sql.state.failWhen = (text, params) => {
    if (!/INSERT INTO contacts\b/.test(text)) return false;
    // The batch statement, by param COUNT. One row is 13 params now (the
    // baseline joined them), so this has to be a multiple test rather than
    // "more than one row's worth" -- otherwise the single-row retry below is
    // caught by it too and every contact is lost.
    if (params.length > 15) return true; // the batch statement
    return params[2] === "ext-3"; // one poison row on retry
  };

  const { upserted, failed } = await sync(contacts);
  sql.state.failWhen = null;

  assert.equal(upserted, 4, "the other four contacts must still land");
  assert.equal(failed, 1);
  assert.equal(sql.state.contacts.size, 4);
  assert.equal(sql.state.contacts.has(`${OWNER}|ext-3`), false);
  // The four that survived still get provenance rows.
  assert.equal(sql.state.contactSources.size, 4);
});

test("empty / invalid input short-circuits without touching the DB", async () => {
  sql.resetFakeSql();
  // `failures` is the per-contact reasons list -- empty here because nothing was
  // even attempted. See _noteContactFailure: a count with no name and no reason
  // is why a sync that dropped two people could not be diagnosed at all.
  const zero = {
    upserted: 0,
    failed: 0,
    failures: [],
    inserted: 0,
    merged: 0,
    updated: 0,
    // Cards left deliberately untouched. Only non-zero in insert-only mode --
    // see contacts-insert-only.test.js for why a refresh must never edit.
    unchanged: 0,
    deduped: 0,
    reviewLinked: 0,
  };
  assert.deepEqual(await sync([]), zero);
  assert.deepEqual(await sync(null), zero);
  assert.deepEqual(
    await upsertContactsForOwner({ ownerId: null, ownerPhone: OWNER_PHONE, contacts: makeContacts(2) }),
    zero,
  );
  assert.equal(sql.state.calls.length, 0);
});

test("a failed contact is named, with the reason the write gave", async () => {
  // THE POINT OF `failures`. Before it, this path incremented an integer and
  // dropped the error on the line that caught it, so the route could only log
  // "some contacts failed to upsert" -- which it did, twice, on a sync where two
  // people he had just added never appeared in Amber, with no way to learn which
  // two or why.
  sql.resetFakeSql();
  const { failed, failures } = await sync([
    { externalId: "ok-1", name: "Fine Fiona", phoneNumbers: ["+13105550100"] },
    { externalId: "bad-1", name: "Broken Bob", phoneNumbers: { 0: "+1310" } },
  ]);

  assert.equal(failed, 1);
  assert.equal(failures.length, 1);
  assert.equal(failures[0].name, "Broken Bob");
  assert.equal(failures[0].externalId, "bad-1");
  // Not the exact wording -- just that there IS a reason and it is not empty.
  assert.ok(failures[0].reason && failures[0].reason.length > 0);
  assert.ok(!/^unknown$/.test(failures[0].reason));
});

test("a malformed contact is counted as failed, not thrown", async () => {
  sql.resetFakeSql();
  const { upserted, failed } = await sync([
    { externalId: "ok-1", name: "Fine Fiona", phoneNumbers: ["+13105550100"] },
    // phoneNumbers is an object: .join is not a function → mapping throws.
    { externalId: "bad-1", name: "Broken Bob", phoneNumbers: { 0: "+1310" } },
  ]);

  assert.equal(upserted, 1);
  assert.equal(failed, 1);
  assert.equal(sql.state.contacts.size, 1);
});

test("an id-less contact re-synced twice UPDATES in place (deterministic external id)", async () => {
  sql.resetFakeSql();
  const { normalizeIncomingContact } = await import("../routes/profile.js");

  // Exactly what the route does: normalize, then upsert. No client id at all.
  const payload = [{ name: "No Id Nadia", phones: ["+13105550100"], organization: "Acme Corp" }];
  const normalize = (list) => list.map(normalizeIncomingContact).filter(Boolean);

  const first = await sync(normalize(payload));
  assert.equal(first.upserted, 1);
  assert.equal(sql.state.contacts.size, 1, "first sync inserts one row");
  const key = [...sql.state.contacts.keys()][0];
  const firstId = sql.state.contacts.get(key).id;
  assert.match(key, /\|sha256:[0-9a-f]{32}$/, "row is keyed by the synthesized id");
  // It took the ON CONFLICT branch, not the no-conflict INSERT branch.
  assert.equal(sql.state.contactsNoExternalId.length, 0);

  const second = await sync(normalize(payload));
  assert.equal(second.upserted, 1);
  assert.equal(sql.state.contacts.size, 1, "re-sync must not add a second row");
  assert.equal(sql.state.contacts.get(key).id, firstId, "same row id — updated in place");
  assert.equal(sql.state.contactsNoExternalId.length, 0);
});

test("a contact with NO external id at all no longer duplicates on re-sync", async () => {
  sql.resetFakeSql();
  // This is the payload the OLD code duplicated on every sync: external_id null,
  // so no conflict target, so a fresh INSERT each time. It now resolves on the
  // phone key instead — the same mechanism that fixes rotated identifiers.
  const idless = {
    name: "No Id Nadia",
    phoneNumbers: ["+13105550100"],
    company: "Acme Corp",
    externalId: null,
    source: "apple",
  };
  await sync([idless]);
  assert.equal(sql.state.contactsNoExternalId.length, 1);
  const firstId = sql.liveContacts(OWNER)[0].id;

  const second = await sync([idless]);
  assert.equal(sql.liveContacts(OWNER).length, 1, "re-sync must not add a row");
  assert.equal(sql.liveContacts(OWNER)[0].id, firstId, "same row, merged in place");
  assert.equal(second.unchanged, 1, "matched, and identical");
});
