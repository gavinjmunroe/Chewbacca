process.env.IDENTITY_KEY_PEPPER ||= "unit-test-pepper-not-a-real-secret-0123456789";
/**
 * THE DOOR WE ARE ABOUT TO OPEN TO EVERYTHING.
 *
 * upsert_contact is the write path for Clay, Claude, Perplexity, the Chrome
 * extension and every agent after them. It used to be the only contact writer in
 * the codebase that skipped the identity resolver, which meant it created a
 * second card for anyone it did not recognize by external id and overwrote fields
 * unconditionally when it did.
 *
 * These are the three properties that had to become true before that door is
 * worth opening:
 *
 *   1. the same person pushed twice, by different routes → ONE card
 *   2. an agent cannot overwrite what the person typed
 *   3. an agent CAN fill what is blank
 *
 * Run with:  node --test src/mcp/tools/upsert-contact.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { installFakeSql } from "../../db/sql-fake-harness.js";

const sql = await installFakeSql();
const { handler } = await import("./upsert-contact.js");
const { mergeContact } = await import("../../db/store.js");
const { invalidateIdentityIndex } = await import("../../db/contact-identity.js");

const OWNER = "22222222-2222-2222-2222-222222222222";
const DID = `did:amber:${OWNER}`;

function reset() {
  sql.resetFakeSql();
  sql.registerFakeOwner(OWNER);
  invalidateIdentityIndex();
}

const live = () => sql.liveContacts(OWNER);
const push = (contact, source) => handler({ did: DID, contact, source });

test("an unlinked DID is refused rather than writing to nobody", async () => {
  reset();
  const res = await handler({
    did: "did:amber:33333333-3333-3333-3333-333333333333",
    contact: { name: "Nobody" },
  });
  assert.equal(res.isError, true);
  assert.equal(live().length, 0);
});

test("the same person pushed twice makes ONE card, not two", async () => {
  reset();
  await push({ name: "Joe Alvarez", emails: ["joe@corp.com"] }, "clay");
  await push({ name: "Joe Alvarez", emails: ["joe@corp.com"] }, "clay");
  assert.equal(live().length, 1, "a repeat push created a duplicate");
});

test("a rotated externalId still lands on the existing card", async () => {
  // The production failure this whole resolver exists for: one owner's book went
  // 2,245 -> 4,162 rows because every upstream identifier had changed. Matching
  // on external id alone reproduces it; matching on email does not.
  reset();
  await push({ name: "Joe Alvarez", emails: ["joe@corp.com"], externalId: "clay-1" }, "clay");
  await push({ name: "Joe Alvarez", emails: ["joe@corp.com"], externalId: "clay-999" }, "clay");
  assert.equal(live().length, 1, "a changed external id created a second card");
});

test("a push matches a card that arrived from a different source entirely", async () => {
  reset();
  await mergeContact(OWNER, {
    source: "apple",
    externalId: "apple-1",
    fullName: "Joe Alvarez",
    phones: ["+13105551234"],
    emails: [],
  });
  invalidateIdentityIndex();
  await push({ name: "Joe Alvarez", phoneNumbers: ["+13105551234"] }, "clay");
  assert.equal(live().length, 1, "Clay did not recognize the Apple card for the same phone");
});

test("an agent cannot overwrite a title the person set by hand", async () => {
  reset();
  await push({ name: "Joe Alvarez", emails: ["joe@corp.com"], title: "Head of Ops" }, "manual");
  invalidateIdentityIndex();
  const res = await push(
    { name: "Joe Alvarez", emails: ["joe@corp.com"], title: "Intern" },
    "clay",
  );
  const row = live()[0];
  assert.equal(row.title, "Head of Ops", "a vendor clobbered a hand-entered title");
  assert.ok(
    !res.structuredContent.appliedAsFill.includes("title"),
    "the tool should report that it did not apply the title",
  );
});

test("an agent CAN fill a title the card does not have", async () => {
  reset();
  await push({ name: "Joe Alvarez", emails: ["joe@corp.com"] }, "apple");
  invalidateIdentityIndex();
  const res = await push(
    { name: "Joe Alvarez", emails: ["joe@corp.com"], title: "Head of Ops" },
    "clay",
  );
  assert.equal(live()[0].title, "Head of Ops", "enrichment failed to fill a blank");
  assert.ok(res.structuredContent.appliedAsFill.includes("title"));
});

test("two different people are never collapsed into one", async () => {
  reset();
  await push({ name: "Joe Alvarez", emails: ["joe@corp.com"] }, "clay");
  await push({ name: "Joe Alvarez", emails: ["joseph@other.com"] }, "clay");
  // Same folded name, no shared key, nothing corroborating. Merging here would be
  // the unrecoverable mistake; two cards and a review prompt is the right answer.
  assert.equal(live().length, 2, "two unrelated people with one name were merged");
});

test("a name is required and its absence is an error, not a blank card", async () => {
  reset();
  const res = await handler({ did: DID, contact: {} });
  assert.equal(res.isError, true);
  assert.equal(live().length, 0);
});
