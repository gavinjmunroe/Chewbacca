process.env.IDENTITY_KEY_PEPPER ||= "unit-test-pepper-not-a-real-secret-0123456789";
/**
 * ACCEPTANCE tests for universal write-time contact dedup.
 *
 * These are the four properties the change exists to guarantee, exercised
 * end-to-end through the real writers (upsertContactsForOwner, mergeContact,
 * upsertContact) against the in-memory SQL fake:
 *
 *   1. the same payload twice          → identical row count AND identical ids
 *   2. the same payload with every externalId ROTATED → still identical
 *      (this is the case production fails today: one owner's book went
 *       2,245 → 4,162 rows because every Apple identifier had changed)
 *   3. Apple-phone-only + Google-email-only for one person, EITHER order
 *      → one row carrying both sources' keys
 *   4. two real people who must never be merged → two rows, forever
 *
 * Run with:  node --test src/db/contact-dedup.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { installFakeSql } from "./sql-fake-harness.js";
import { identityToken, hashIdentityKey, KEY_TYPE } from "../lib/identity-keys.js";

const sql = await installFakeSql();
const { upsertContactsForOwner, mergeContact, countLiveContactsBySource } =
  await import("./store.js");
const { importContactRecords } = await import("../lib/google-contacts.js");
const { upsertContact } = await import("./user-store.js");
const { invalidateIdentityIndex } = await import("./contact-identity.js");

const OWNER = "11111111-1111-1111-1111-111111111111";
const OWNER_PHONE = "+13105559999";

function reset() {
  sql.resetFakeSql();
  invalidateIdentityIndex();
}

const sync = (contacts) =>
  upsertContactsForOwner({ ownerId: OWNER, ownerPhone: OWNER_PHONE, contacts });

const live = () => sql.liveContacts(OWNER);
const ids = () => live().map((r) => String(r.id)).sort();
const byName = (name) => live().find((r) => r.full_name === name);
// Keys are stored as HMAC(pepper, value) now, so a stored row cannot be read
// back as "phone|13105558127". The assertions below stay written in that readable
// form and are hashed the same way the store hashes them -- `tok` is the bridge.
// Comparing hash to hash is the same assertion; it just cannot be eyeballed in a
// failure message, which is why every call site keeps the plaintext literal.
//
// THE PHONE LITERALS CARRY THE COUNTRY CODE ("13105551446", not "3105551446").
// phoneKey used to normalize to the last ten digits, which made a French 06
// number and a US 361 number the same person; it now keeps the country code, and
// these literals are the normalized form, not the raw input.
const tok = (readable) => {
  const i = readable.indexOf("|");
  return identityToken(readable.slice(0, i), readable.slice(i + 1));
};
const tokens = (readables) => readables.map(tok).sort();
const keysFor = (id) =>
  [...sql.state.identityKeys.values()]
    .filter((k) => String(k.contact_id) === String(id))
    .map((k) => k.key_hash.toString("hex"))
    .sort();

// A slice of one tester's real address book shape: Apple cards, device UUID
// identifiers, phone but no email.
const appleBook = (idSuffix = "a") => [
  {
    externalId: `54A6C7A9-${idSuffix}`,
    name: "Anoushka Chandra",
    firstName: "Anoushka",
    lastName: "Chandra",
    phoneNumbers: ["+13105558127"],
    emails: [],
    source: "apple",
  },
  {
    externalId: `D0375490-${idSuffix}`,
    name: "Ellie Keen",
    phoneNumbers: ["+1 (310) 555-4614"],
    emails: [],
    source: "apple",
  },
  {
    externalId: `33CBC996-${idSuffix}`,
    name: "Kitty Schur",
    phoneNumbers: ["3105551740"],
    emails: [],
    source: "apple",
  },
];

// ── 1. Same payload twice ───────────────────────────────────────────────────

test("ACCEPTANCE 1: the same payload twice → identical row count and identical ids", async () => {
  reset();
  const payload = appleBook();

  const first = await sync(payload);
  assert.equal(first.inserted, 3);
  const idsAfterFirst = ids();
  assert.equal(idsAfterFirst.length, 3);

  const second = await sync(payload);
  assert.equal(second.inserted, 0, "nothing new");
  // A RE-SYNC THAT CHANGES NOTHING NOW REPORTS NOTHING CHANGED, which is
  // the point of the three-way merge: `updated`/`merged` used to increment
  // even when mergedColumnValues returned null, so every sync over-reported
  // and a no-op sync claimed to have rewritten the whole address book.
  assert.equal(second.updated, 0, "identical payload: nothing to write");
  assert.equal(second.unchanged, 3, "each resolved on its own source key, unchanged");
  assert.deepEqual(ids(), idsAfterFirst, "same rows, same ids");
});

test("ACCEPTANCE 1b: ten consecutive syncs stay at three rows", async () => {
  reset();
  for (let i = 0; i < 10; i++) await sync(appleBook());
  assert.equal(live().length, 3);
});

// ── 2. Rotated external ids (the prod failure) ──────────────────────────────

test("ACCEPTANCE 2: same payload with ALL externalIds rotated → still identical", async () => {
  reset();
  await sync(appleBook("first-device"));
  const idsAfterFirst = ids();
  assert.equal(idsAfterFirst.length, 3);

  // Reinstall / new device: every identifier is new, the people are not.
  const rotated = appleBook("second-device");
  assert.notEqual(rotated[0].externalId, appleBook("first-device")[0].externalId);

  const second = await sync(rotated);
  assert.equal(second.inserted, 0, "prod inserts 3 fresh rows here — this is the fix");
  // Matched on phone, and identical, so there was nothing to write. The match is
  // what this test is about and it is asserted by inserted === 0 above.
  assert.equal(second.merged, 0, "identical payload: nothing to write");
  assert.equal(second.unchanged, 3, "all three matched on phone");
  assert.deepEqual(ids(), idsAfterFirst, "same three rows, same ids");
});

test("ACCEPTANCE 2b: a rotated re-sync claims the new source key too", async () => {
  reset();
  await sync(appleBook("v1"));
  await sync(appleBook("v2"));
  const anoushka = byName("Anoushka Chandra");
  const keys = keysFor(anoushka.id);
  assert.ok(keys.includes(tok("phone|13105558127")));
  assert.ok(keys.includes(tok("source|apple:54A6C7A9-v1")));
  assert.ok(keys.includes(tok("source|apple:54A6C7A9-v2")), "the new id is claimed as well");
});

test("ACCEPTANCE 2c: reformatted phone numbers do not defeat the match", async () => {
  reset();
  await sync([
    { externalId: "x1", name: "Liam Rinehart", phoneNumbers: ["+13105555975"], source: "apple" },
  ]);
  const second = await sync([
    // New id, and the client changed its formatting between syncs.
    { externalId: "x2", name: "Liam Rinehart", phoneNumbers: ["(310) 555-5975"], source: "apple" },
  ]);
  assert.equal(live().length, 1);
  assert.equal(second.unchanged, 1, "matched on the reformatted phone, nothing changed");
});

// ── 3. Cross-source: Apple phone-only + Google email-only ───────────────────
//
// NOTE on the boundary between two rules. Rule 4 (fuzzy name) requires a
// CORROBORATING signal, and "same name, nothing else in common" is specified to
// stay two rows. So a cross-source pair with literally nothing shared but a name
// does NOT merge — that case is covered in the "no corroboration" test below. The
// acceptance case is the realistic one: the two sources agree on something (here
// the company) or share an identifier.

test("ACCEPTANCE 3: Apple phone-only then Google email-only → ONE row, both keys", async () => {
  reset();
  await sync([
    {
      externalId: "APPLE-1",
      name: "Maansi Solanky",
      phoneNumbers: ["+13105551446"],
      emails: [],
      company: "Rytual",
      source: "apple",
    },
  ]);
  const r = await mergeContact(OWNER, {
    source: "google",
    externalId: "people/c1",
    fullName: "Maansi Solanky",
    emails: ["maansi@rytual.com"],
    phones: [],
    company: "Rytual",
  });

  assert.equal(r.action, "merged");
  assert.equal(live().length, 1, "one person, one row");
  const row = live()[0];
  assert.equal(String(row.id), String(r.contactId));
  // Field union: the phone from Apple AND the email from Google.
  assert.equal(row.phone_primary, "+13105551446");
  assert.match(row.emails, /maansi@rytual\.com/);
  assert.deepEqual(keysFor(row.id), tokens([
    "email|maansi@rytual.com",
    "phone|13105551446",
    "source|apple:APPLE-1",
    "source|google:people/c1",
  ]));
});

test("ACCEPTANCE 3b: the OTHER order also yields one row with both keys", async () => {
  reset();
  await mergeContact(OWNER, {
    source: "google",
    externalId: "people/c1",
    fullName: "Maansi Solanky",
    emails: ["maansi@rytual.com"],
    phones: [],
    company: "Rytual",
  });
  const res = await sync([
    {
      externalId: "APPLE-1",
      name: "Maansi Solanky",
      phoneNumbers: ["+13105551446"],
      emails: [],
      company: "Rytual",
      source: "apple",
    },
  ]);

  assert.equal(res.merged, 1);
  assert.equal(live().length, 1);
  const row = live()[0];
  assert.match(row.emails, /maansi@rytual\.com/);
  assert.equal(row.phone_primary, "+13105551446");
  assert.deepEqual(keysFor(row.id), tokens([
    "email|maansi@rytual.com",
    "phone|13105551446",
    "source|apple:APPLE-1",
    "source|google:people/c1",
  ]));
});

test("ACCEPTANCE 3c: a shared email alone merges across sources, no name needed", async () => {
  reset();
  await sync([
    { externalId: "A1", name: "Venkat Ram", emails: ["venkat@rytual.com"], source: "apple" },
  ]);
  const r = await mergeContact(OWNER, {
    source: "google",
    externalId: "otherContacts/c9",
    fullName: "V. Ram",
    emails: ["Venkat@Rytual.com"], // same address, different case
    phones: [],
  });
  assert.equal(r.action, "merged");
  assert.equal(live().length, 1);
});

test("same name across sources with NO corroborating signal stays two rows", async () => {
  reset();
  await sync([
    { externalId: "A1", name: "Alex Rivera", phoneNumbers: ["+13105550001"], source: "apple" },
  ]);
  const r = await mergeContact(OWNER, {
    source: "google",
    externalId: "people/c2",
    fullName: "Alex Rivera",
    emails: ["arivera@gmail.com"], // freemail: proves nothing
    phones: [],
  });

  assert.equal(r.action, "created", "no corroboration → do not merge");
  assert.equal(live().length, 2, "…and do not block: both rows are kept");
  // The pair is logged for a future merge-suggestions UI.
  const candidates = [...sql.state.reviewCandidates.values()];
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].reason, "same_name_no_corroboration");
});

// ── 4. Two people who must never be merged ─────────────────────────────────

test("ACCEPTANCE 4a: same name, DIFFERENT phones → two rows, forever", async () => {
  reset();
  // The real pair from the audit: two "Pizza Hut" rows on different lines.
  const payload = [
    { externalId: "P1", name: "Pizza Hut", phoneNumbers: ["+13105558200"], source: "apple" },
    { externalId: "P2", name: "Pizza Hut", phoneNumbers: ["+13105558525"], source: "apple" },
  ];
  await sync(payload);
  assert.equal(live().length, 2);

  // Re-sync, and re-sync with rotated ids: still two.
  await sync(payload);
  await sync([
    { externalId: "P1-new", name: "Pizza Hut", phoneNumbers: ["+13105558200"], source: "apple" },
    { externalId: "P2-new", name: "Pizza Hut", phoneNumbers: ["+13105558525"], source: "apple" },
  ]);
  assert.equal(live().length, 2, "a phone conflict is never merged, on any sync");
  assert.deepEqual(
    live().map((r) => r.phone_primary).sort(),
    ["+13105558200", "+13105558525"],
    "neither row absorbed the other's number",
  );
});

test("ACCEPTANCE 4b: two people sharing ONE landline → two rows, forever", async () => {
  reset();
  const payload = [
    { externalId: "M1", name: "Mom", phoneNumbers: ["+13105551740"], source: "apple" },
    { externalId: "D1", name: "Dad", phoneNumbers: ["+13105551740"], source: "apple" },
  ];
  await sync(payload);
  assert.equal(live().length, 2, "one line, two people");

  await sync(payload);
  assert.equal(live().length, 2);

  // Rotated ids: Mom still resolves to Mom (phone + compatible name), and Dad
  // does NOT collapse into her even though he holds no phone key.
  const rotated = await sync([
    { externalId: "M2", name: "Mom", phoneNumbers: ["+13105551740"], source: "apple" },
    { externalId: "D2", name: "Dad", phoneNumbers: ["+13105551740"], source: "apple" },
  ]);
  assert.equal(live().length, 2);
  assert.equal(rotated.inserted, 0, "both matched their own row");
  assert.ok(byName("Mom"));
  assert.ok(byName("Dad"));

  // Dad matched his OWN row here (the phone bucket holds both rows, and only his
  // name is compatible with his), so nothing was refused this time — which is
  // why the review link is asserted in the next test, where Dad is genuinely new.
});

test("ACCEPTANCE 4b2: a NEW person on an already-claimed line is kept and linked", async () => {
  reset();
  await sync([
    { externalId: "M1", name: "Mom", phoneNumbers: ["+13105551740"], source: "apple" },
  ]);
  const res = await sync([
    { externalId: "M1", name: "Mom", phoneNumbers: ["+13105551740"], source: "apple" },
    { externalId: "D1", name: "Dad", phoneNumbers: ["+13105551740"], source: "apple" },
  ]);

  assert.equal(res.inserted, 1, "Dad is a new person, not a merge into Mom");
  assert.equal(live().length, 2);
  // The refused merge is recorded rather than thrown away.
  const candidates = [...sql.state.reviewCandidates.values()];
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].reason, "same_phone_as");
  assert.equal(String(candidates[0].contact_id), String(byName("Dad").id));
  assert.equal(String(candidates[0].candidate_contact_id), String(byName("Mom").id));
});

test("ACCEPTANCE 4c: the phone key is held by ONE row; the other keeps its own keys", async () => {
  reset();
  await sync([
    { externalId: "M1", name: "Mom", phoneNumbers: ["+13105551740"], source: "apple" },
    { externalId: "D1", name: "Dad", phoneNumbers: ["+13105551740"], source: "apple" },
  ]);
  const mom = byName("Mom");
  const dad = byName("Dad");
  assert.deepEqual(keysFor(mom.id), tokens(["phone|13105551740", "source|apple:M1"]));
  assert.deepEqual(keysFor(dad.id), tokens(["source|apple:D1"]), "the line is already claimed");
});

// ── Single-payload duplicate cards (the 190-row case) ──────────────────────

test("Apple duplicate cards inside ONE payload collapse to one row", async () => {
  reset();
  const res = await sync([
    { externalId: "672E5252", name: "Ruby Kim", phoneNumbers: ["+13105556512"], source: "apple" },
    { externalId: "FDD5DCB6", name: "Kenna Choi", phoneNumbers: ["+13105557867"], source: "apple" },
    { externalId: "6D50D61E", name: "Ruby Kim", phoneNumbers: ["3105556512"], source: "apple" },
  ]);
  assert.equal(live().length, 2, "three cards, two people");
  assert.equal(res.deduped, 1, "one card absorbed inside the payload");
  assert.equal(res.upserted, 3, "all three inputs accounted for");
  // Both source ids point at the surviving row.
  const ruby = byName("Ruby Kim");
  const keys = keysFor(ruby.id);
  assert.ok(keys.includes(tok("source|apple:672E5252")));
  assert.ok(keys.includes(tok("source|apple:6D50D61E")));
});

test("nameless duplicate cards with no phone and no email collapse (same-source rule)", async () => {
  reset();
  const res = await sync([
    { externalId: "B35FAD15", name: "Sabrina Kim (김서현)", source: "apple" },
    { externalId: "891AE4C6", name: "Sabrina Kim (김서현)", source: "apple" },
  ]);
  assert.equal(live().length, 1);
  assert.equal(res.deduped, 1);
});

// ── The two Google writers ─────────────────────────────────────────────────

test("the OAuth scraper and the import path write ONE row for one Google person", async () => {
  reset();
  // Path 2 (import button): bare resourceName.
  await mergeContact(OWNER, {
    source: "google",
    externalId: "people/c123",
    fullName: "Shirley Park",
    emails: ["shirley@rytual.com"],
    phones: [],
  });
  // Path 3 (OAuth scraper). Its id used to be namespaced `google:people/c123`,
  // which put the same person in a second row of the same unique index.
  const saved = await upsertContact(OWNER, {
    source: "google",
    externalId: "google:people/c123",
    name: "Shirley Park",
    emails: ["shirley@rytual.com"],
    phoneNumbers: [],
  });

  assert.ok(saved);
  assert.equal(live().length, 1, "one Google person, one row");
  assert.deepEqual(keysFor(live()[0].id), tokens([
    "email|shirley@rytual.com",
    "source|google:people/c123",
  ]));
});

// ── Field union never loses data (I3) ──────────────────────────────────────

test("an Apple re-sync does not drop an email a Google merge contributed", async () => {
  reset();
  await sync([
    { externalId: "A1", name: "Mehak Monga", phoneNumbers: ["+13105555084"], source: "apple" },
  ]);
  await mergeContact(OWNER, {
    source: "google",
    externalId: "people/c7",
    fullName: "Mehak Monga",
    emails: ["mehak@rytual.com"],
    phones: ["+13105555084"],
  });
  assert.equal(live().length, 1);

  // Apple re-syncs its own card, which has no email at all.
  await sync([
    { externalId: "A1", name: "Mehak Monga", phoneNumbers: ["+13105555084"], emails: [], source: "apple" },
  ]);
  const row = live()[0];
  assert.match(row.emails ?? "", /mehak@rytual\.com/, "the Google email survives");
});

test("a device-side rename still propagates (rule 1 is authoritative)", async () => {
  reset();
  await sync([
    { externalId: "A1", name: "Maggie Smith", phoneNumbers: ["+13105550100"], source: "apple" },
  ]);
  await sync([
    { externalId: "A1", name: "Maggie Smith-Jones", phoneNumbers: ["+13105550100"], source: "apple" },
  ]);
  assert.equal(live().length, 1);
  assert.equal(live()[0].full_name, "Maggie Smith-Jones");
});

test("an identity merge does NOT overwrite a populated field (enrichment only fills)", async () => {
  reset();
  await sync([
    { externalId: "A1", name: "Kitty Schur", phoneNumbers: ["3105551740"], company: "Acme", source: "apple" },
  ]);
  await mergeContact(OWNER, {
    source: "google",
    externalId: "people/c1",
    fullName: "Kitty Schur",
    company: "Newco", // a different source's guess must not clobber Acme
    phones: ["3105551740"],
    emails: ["kitty@acme.com"],
  });
  const row = live()[0];
  assert.equal(row.company, "Acme");
  assert.match(row.emails, /kitty@acme\.com/, "…but the new email is still added");
});

// ── Concurrency backstop ───────────────────────────────────────────────────

test("a key lost to a concurrent writer collapses instead of leaving a twin", async () => {
  reset();
  // Simulate the race: a row already holds the phone key, but this process's
  // index snapshot predates it (so resolution misses and it inserts).
  await sync([
    { externalId: "EXISTING", name: "Yasmeen Khan", phoneNumbers: ["+13105550366"], source: "apple" },
  ]);
  const existingId = String(live()[0].id);
  invalidateIdentityIndex();

  // The row (and its phone key) exist, but our index snapshot cannot see the row
  // — exactly the state after another transaction commits post-snapshot.
  sql.state.hiddenFromIndexLoad = new Set([existingId]);
  const res = await sync([
    { externalId: "NEW", name: "Yasmeen Khan", phoneNumbers: ["+13105550366"], source: "apple" },
  ]);
  sql.state.hiddenFromIndexLoad = new Set();

  assert.equal(res.inserted, 1, "it did insert, having seen nothing to match");

  // The key claim lost, so the fresh row was collapsed into the winner.
  const liveRows = live();
  assert.equal(liveRows.length, 1, "no twin survives");
  assert.equal(String(liveRows[0].id), existingId, "the pre-existing row won");
});

// ── Soft-deleted keys stay claimed (cleanup cannot be undone) ──────────────

test("a collapsed row's keys move to the survivor, so the next sync cannot recreate it", async () => {
  reset();
  const { collapseContactGroup } = await import("./store.js");
  await sync([
    { externalId: "A1", name: "Elliot Myong", phoneNumbers: ["+13105554184"], source: "apple" },
    { externalId: "A2", name: "Elliot Myong", phoneNumbers: ["+13105554184", "+14155550000"], source: "apple" },
  ]);
  // Two cards, one phone, compatible names → already one row.
  assert.equal(live().length, 1);

  // Force the two-row situation the old code produced, then collapse it the way
  // the cleanup script does.
  const survivor = live()[0];
  const { rows } = await sql.query(
    `INSERT INTO contacts (owner_id, external_id, full_name, phone_primary, phone_primary_normalized, source)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
    [OWNER, "LEGACY-DUP", "Elliot Myong", "+13105554184", "13105554184", "apple"],
  );
  const dupId = String(rows[0].id);
  await sql.query(
    `INSERT INTO contact_identity_keys (owner_id, key_type, key_hash, contact_id)
     VALUES ($1,$2,$3,$4) ON CONFLICT (owner_id, key_type, key_hash) DO NOTHING
     RETURNING key_type, key_hash, contact_id`,
    [OWNER, KEY_TYPE.SOURCE, hashIdentityKey("source", "apple:LEGACY-DUP"), dupId],
  );
  assert.equal(live().length, 2);

  const collapsed = await collapseContactGroup(OWNER, survivor.id, [dupId]);
  assert.equal(collapsed.ok, true);
  assert.equal(live().length, 1);
  // The absorbed row's source key now points at the survivor…
  const moved = [...sql.state.identityKeys.values()].find(
    (k) => k.key_hash.toString("hex") === tok("source|apple:LEGACY-DUP"),
  );
  assert.equal(String(moved.contact_id), String(survivor.id));

  // …so re-syncing the card that created it merges instead of resurrecting it.
  invalidateIdentityIndex();
  const after = await sync([
    { externalId: "LEGACY-DUP", name: "Elliot Myong", phoneNumbers: ["+13105554184"], source: "apple" },
  ]);
  assert.equal(live().length, 1, "the cleanup holds");
  assert.equal(after.inserted, 0);
});

// ── Per-source counts + import counters ────────────────────────────────────

test("countLiveContactsBySource always reports apple and google, and sums to total", async () => {
  reset();
  assert.deepEqual(await countLiveContactsBySource(OWNER), { apple: 0, google: 0, total: 0 });

  await sync([
    { externalId: "A1", name: "Apple One", phoneNumbers: ["+13105550001"], source: "apple" },
    { externalId: "A2", name: "Apple Two", phoneNumbers: ["+13105550002"], source: "apple" },
  ]);
  await mergeContact(OWNER, {
    source: "google",
    externalId: "people/c1",
    fullName: "Google One",
    emails: ["g1@rytual.com"],
    phones: [],
  });

  const counts = await countLiveContactsBySource(OWNER);
  assert.equal(counts.apple, 2);
  assert.equal(counts.google, 1);
  assert.equal(counts.total, 3);
});

test("countLiveContactsBySource excludes soft-deleted rows and is owner-scoped", async () => {
  reset();
  await sync([
    { externalId: "A1", name: "Kept", phoneNumbers: ["+13105550001"], source: "apple" },
    { externalId: "A2", name: "Absorbed", phoneNumbers: ["+13105550002"], source: "apple" },
  ]);
  const { collapseContactGroup } = await import("./store.js");
  const [a, b] = live().map((r) => String(r.id));
  await collapseContactGroup(OWNER, a, [b]);

  assert.deepEqual(await countLiveContactsBySource(OWNER), { apple: 1, google: 0, total: 1 });
  // A different owner sees nothing of this.
  assert.deepEqual(
    await countLiveContactsBySource("22222222-2222-2222-2222-222222222222"),
    { apple: 0, google: 0, total: 0 },
  );
});

test("countLiveContactsBySource reports NULL-source rows as unknown so parts sum to total", async () => {
  reset();
  await sql.query(
    `INSERT INTO contacts (owner_id, external_id, full_name) VALUES ($1,$2,$3)`,
    [OWNER, "no-src", "Sourceless"],
  );
  const counts = await countLiveContactsBySource(OWNER);
  assert.equal(counts.unknown, 1);
  assert.equal(counts.total, 1);
});

test("importContactRecords counts merged and deduped as MUTUALLY EXCLUSIVE", async () => {
  reset();
  // Someone already in the address book, from Apple.
  await sync([
    { externalId: "A1", name: "Maansi Solanky", phoneNumbers: ["+13105551446"], source: "apple" },
  ]);

  const counts = await importContactRecords(OWNER, [
    // onto the pre-existing Apple row → merged
    {
      source: "google", externalId: "people/c1", fullName: "Maansi Solanky",
      phones: ["+13105551446"], emails: ["maansi@rytual.com"],
    },
    // new person → created
    {
      source: "google", externalId: "people/c2", fullName: "Shirley Park",
      phones: [], emails: ["shirley@rytual.com"],
    },
    // a SECOND card for Shirley in the same run → deduped, NOT merged
    {
      source: "google", externalId: "people/c3", fullName: "Shirley Park",
      phones: [], emails: ["Shirley@Rytual.com"],
    },
  ]);

  assert.equal(counts.created, 1);
  assert.equal(counts.merged, 1, "only the collapse onto the pre-existing row");
  assert.equal(counts.deduped, 1, "the intra-run duplicate card");
  assert.equal(counts.failed, 0);
  assert.equal(counts.people, 2, "two humans touched");
  assert.equal(live().length, 2);
});

test("importContactRecords is idempotent across runs (updated, not created)", async () => {
  reset();
  const records = [
    {
      source: "google", externalId: "people/c1", fullName: "Shirley Park",
      phones: [], emails: ["shirley@rytual.com"],
    },
  ];
  const first = await importContactRecords(OWNER, records);
  assert.equal(first.created, 1);

  const second = await importContactRecords(OWNER, records);
  assert.equal(second.created, 0);
  // NOTE the difference from the Apple path above, and it is real rather than an
  // oversight: importContactRecords counts by mergeContact's `action`, so a
  // rule-1 resolution reports "updated" whether or not a column moved. The Apple
  // path counts by whether mergedColumnValues produced a write. Worth unifying
  // one day; not worth changing the Google import's reported numbers inside a
  // commit about the Apple merge.
  assert.equal(second.updated, 1, "same source id → the same card restated");
  assert.equal(second.deduped, 0);
  assert.equal(live().length, 1);
});


test("re-adding a web result preserves a user's corrected name and employer", async () => {
  reset();
  const record = { source: "web_search", externalId: "https://linkedin.com/in/web-person", fullName: "Original Name", company: "Original Company" };
  await mergeContact(OWNER, record);
  const row=live()[0];
  row.full_name="Corrected Name";row.company="Corrected Company";
  invalidateIdentityIndex();
  await mergeContact(OWNER, record);
  assert.equal(live().length,1);
  assert.equal(live()[0].full_name,"Corrected Name");
  assert.equal(live()[0].company,"Corrected Company");
});
