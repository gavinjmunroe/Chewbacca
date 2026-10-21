/**
 * Rules + hard invariants for write-time contact dedup (pure layer).
 *
 * Run with:  node --test src/lib/contact-identity.test.js
 *
 * The scenarios are the ones from the live-data audit, with the real shapes:
 *   - one person re-synced after the device reissued its contact identifiers
 *   - Apple duplicate cards inside a SINGLE payload
 *   - two "Pizza Hut" rows on different lines  (must never merge)
 *   - "Mom" and "Dad" on one household line   (must never merge)
 *   - Apple phone-only + Google email-only for one person
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  buildIdentityIndex,
  canMerge,
  clusterPayload,
  corroborators,
  emailKey,
  extractFacts,
  foldName,
  givenNamesEquivalent,
  namesCompatible,
  normalizeExternalId,
  phoneKey,
  phonesConflict,
  planPayload,
  resolveFacts,
  sourceKey,
  unionEmailStrings,
  unionPhoneStrings,
} from "./contact-identity.js";

// ── Key normalization ───────────────────────────────────────────────────────

test("phoneKey folds formatting but KEEPS the country code", () => {
  // This test used to assert the last-10 behavior, and in doing so it asserted
  // a security defect: +33612345678 (French 06) and +13612345678 (US area code
  // 361) are both real numbers and both keyed to 3612345678, so identity
  // resolution treated two strangers as one person -- and that key decided who
  // could read shared notes and who was in which circle.
  //
  // The property the old comment cared about is kept: one number written three
  // ways is still one key.
  assert.equal(phoneKey("+1 (310) 555-0100"), "13105550100");
  assert.equal(phoneKey("13105550100"), "13105550100");
  assert.equal(phoneKey("3105550100"), "13105550100");

  // The country code survives, so different countries are different people.
  assert.equal(phoneKey("+44 20 7946 0958"), "442079460958");
  assert.equal(phoneKey("+33612345678"), "33612345678");
  assert.notEqual(phoneKey("+33612345678"), phoneKey("+13612345678"),
    "the collision this function used to have");

  // 00 is the international prefix; treat it as +.
  assert.equal(phoneKey("0033612345678"), "33612345678");

  assert.equal(phoneKey("911"), null, "too short to identify a person");
  assert.equal(phoneKey(null), null);
});

test("emailKey lowercases and rejects non-addresses", () => {
  assert.equal(emailKey("  Shirley@Rytual.COM "), "shirley@rytual.com");
  assert.equal(emailKey("not-an-email"), null);
  assert.equal(emailKey("@nope.com"), null);
  assert.equal(emailKey("trailing@"), null);
});

test("normalizeExternalId folds the two Google id namespaces together", () => {
  // The OAuth scraper wrote google:people/c1; the import path wrote people/c1.
  assert.equal(normalizeExternalId("google", "google:people/c1"), "people/c1");
  assert.equal(normalizeExternalId("google", "people/c1"), "people/c1");
  assert.equal(sourceKey("google", "google:people/c1"), sourceKey("google", "people/c1"));
  // Apple ids are untouched, including the :ABPerson suffix shape.
  assert.equal(
    normalizeExternalId("apple", "54A6C7A9-0C81-4D49-8863-CD8097CB54C8:ABPerson"),
    "54A6C7A9-0C81-4D49-8863-CD8097CB54C8:ABPerson",
  );
});

// ── Name folding ────────────────────────────────────────────────────────────

test("foldName strips case, diacritics, punctuation, honorifics and suffixes", () => {
  assert.equal(foldName("José  Álvarez"), "jose alvarez");
  assert.equal(foldName("Dr. John Smith Jr."), "john smith");
  assert.equal(foldName("O'Brien, Katie"), "obrien katie");
  assert.equal(foldName("   "), null);
  // Non-Latin scripts survive: one tester's book is largely Korean.
  assert.equal(foldName("현정호"), "현정호");
  assert.equal(foldName("Kelly Park (박소은)"), "kelly park 박소은");
});

test("givenNamesEquivalent knows nicknames and short diminutives", () => {
  assert.ok(givenNamesEquivalent("katie", "katherine"));
  assert.ok(givenNamesEquivalent("bob", "robert"));
  assert.ok(givenNamesEquivalent("dan", "daniel"));
  assert.ok(!givenNamesEquivalent("john", "jonathan"), "distinct formal names stay apart");
  assert.ok(!givenNamesEquivalent("michael", "mitchell"));
});

test("namesCompatible: surnames must agree, single tokens attach", () => {
  assert.ok(namesCompatible("katie smith", "katherine smith"));
  assert.ok(namesCompatible("katie", "katie smith"));
  assert.ok(namesCompatible(null, "katie smith"), "a missing name cannot contradict");
  assert.ok(!namesCompatible("katie smith", "katie jones"), "different surname");
  assert.ok(!namesCompatible("mom", "katie smith"));
  assert.ok(!namesCompatible("dad", "mom"));
});

// ── Invariant I1: phones that both exist and differ never merge ─────────────

const rec = (o) => extractFacts(o);

test("I1 two Pizza Huts on different lines never merge, even with an identical name", () => {
  const a = rec({ name: "Pizza Hut", phoneNumbers: ["+13105558200"], source: "apple", externalId: "a1" });
  const b = rec({ name: "Pizza Hut", phoneNumbers: ["+13105558525"], source: "apple", externalId: "a2" });
  assert.ok(phonesConflict(a, b));
  const gate = canMerge(a, b);
  assert.equal(gate.ok, false);
  assert.equal(gate.reason, "phone_conflict");
});

test("I1 holds even when a corroborating signal is present", () => {
  const a = rec({ name: "Katie Smith", phoneNumbers: ["3105550001"], company: "Acme", source: "apple", externalId: "a1" });
  const b = rec({ name: "Katie Smith", phoneNumbers: ["3105550002"], company: "Acme", source: "google", externalId: "people/c1" });
  assert.deepEqual(corroborators(a, b), ["company"]);
  assert.equal(canMerge(a, b).ok, false, "a corroborator cannot override a phone conflict");
});

test("I1 does not fire when only one side has a phone", () => {
  const a = rec({ name: "Ellie Keen", phoneNumbers: ["3105554614"] });
  const b = rec({ name: "Ellie Keen", emails: ["ellie@rytual.com"] });
  assert.ok(!phonesConflict(a, b));
  assert.equal(canMerge(a, b).ok, true);
});

test("I1 sharing ONE of several phones is not a conflict", () => {
  const a = rec({ name: "Liam Rinehart", phoneNumbers: ["3105555975", "3105550000"] });
  const b = rec({ name: "Liam Rinehart", phoneNumbers: ["3105555975", "4155559999"] });
  assert.ok(!phonesConflict(a, b));
});

// ── Invariant I2: a phone match with incompatible names does not merge ──────

test("I2 a household line shared by Mom and Dad stays two rows, with a review link", () => {
  const mom = { id: "1", full_name: "Mom", phone_primary: "+13105551740", source: "apple", external_id: "m1" };
  const index = buildIdentityIndex({ contactRows: [mom] });
  const dad = rec({ name: "Dad", phoneNumbers: ["+13105551740"], source: "apple", externalId: "d1" });

  const res = resolveFacts(dad, index);
  assert.equal(res.contactId, null, "must NOT merge onto Mom");
  assert.deepEqual(res.reviewLinks, [{ candidateContactId: "1", reason: "same_phone_as" }]);
});

// ── Invariant I3: merges are field-union ───────────────────────────────────

test("I3 union keeps every phone and email, first spelling wins", () => {
  const phones = unionPhoneStrings(["+1 (310) 555-0100"], ["3105550100", "4155559999"]);
  assert.deepEqual(phones, ["+1 (310) 555-0100", "4155559999"], "same number not duplicated");
  const emails = unionEmailStrings(["Shirley@Rytual.com"], ["shirley@rytual.com", "s@other.com"]);
  assert.deepEqual(emails, ["Shirley@Rytual.com", "s@other.com"]);
});

test("I3 union keeps unparseable phone values rather than dropping them", () => {
  assert.deepEqual(unionPhoneStrings([], ["ext. 4"]), ["ext. 4"]);
});

// ── Invariant I4: same name, no corroboration → keep both, log a candidate ──

test("I4 identical name with nothing else in common does not merge and does not block", () => {
  const existing = { id: "7", full_name: "Alex Rivera", source: "apple", external_id: "x1" };
  const index = buildIdentityIndex({ contactRows: [existing] });
  const incoming = rec({ name: "Alex Rivera", source: "linkedin", externalId: "li-1" });

  const res = resolveFacts(incoming, index);
  assert.equal(res.contactId, null);
  assert.deepEqual(res.reviewLinks, [
    { candidateContactId: "7", reason: "same_name_no_corroboration" },
  ]);
});

test("same name + a corroborating signal DOES merge (rule 4)", () => {
  const existing = {
    id: "7", full_name: "Alex Rivera", company: "Rytual", source: "apple", external_id: "x1",
  };
  const index = buildIdentityIndex({ contactRows: [existing] });
  const incoming = rec({ name: "Alex Rivera", company: "Rytual", source: "google", externalId: "people/c9" });

  const res = resolveFacts(incoming, index);
  assert.equal(res.contactId, "7");
  assert.equal(res.rule, "name+company");
});

test("rule 4 accepts a shared non-freemail domain but not a freemail one", () => {
  const a = rec({ name: "Sam Patel", emails: ["sam@rytual.com"] });
  const b = rec({ name: "Sam Patel", emails: ["s.patel@rytual.com"] });
  assert.ok(corroborators(a, b).includes("email_domain"));

  const c = rec({ name: "Sam Patel", emails: ["sam@gmail.com"] });
  const d = rec({ name: "Sam Patel", emails: ["sampatel@gmail.com"] });
  assert.deepEqual(corroborators(c, d), [], "gmail.com proves nothing");
});

test("rule 4 accepts same-source duplicate cards with no phone and no email", () => {
  // Shirley's book: two identical Apple cards, neither carrying any identifier.
  const a = rec({ name: "Sabrina Kim (김서현)", source: "apple", externalId: "B35FAD15" });
  const b = rec({ name: "Sabrina Kim (김서현)", source: "apple", externalId: "891AE4C6" });
  assert.deepEqual(corroborators(a, b), ["same_source_duplicate_card"]);
});

// ── The cascade ─────────────────────────────────────────────────────────────

test("rule 1: same source + same external id resolves to the same row", () => {
  const row = { id: "42", full_name: "Anoushka Chandra", source: "apple", external_id: "AAA" };
  const index = buildIdentityIndex({ contactRows: [row] });
  const res = resolveFacts(rec({ name: "Anoushka Chandra", source: "apple", externalId: "AAA" }), index);
  assert.equal(res.contactId, "42");
  assert.equal(res.rule, "source");
});

test("rule 2: the rotated-identifier case — same phone, brand-new external id", () => {
  // Exactly the prod failure: 1,913 rows re-inserted on a second sync because
  // every Apple identifier had changed while the phone stayed the same.
  const row = {
    id: "4374",
    full_name: "Anoushka Chandra",
    phone_primary: "+13105558127",
    source: "apple",
    external_id: "54A6C7A9-0C81-4D49-8863-CD8097CB54C8:ABPerson",
  };
  const index = buildIdentityIndex({ contactRows: [row] });
  const res = resolveFacts(
    rec({
      name: "Anoushka Chandra",
      phoneNumbers: ["+1 310-555-8127"],
      source: "apple",
      externalId: "1D3F87D3-3DE7-47DC-8831-B99F2A59C8FE",
    }),
    index,
  );
  assert.equal(res.contactId, "4374", "must merge, not insert");
  assert.equal(res.rule, "phone");
});

test("rule 3: email match merges across sources", () => {
  const row = { id: "9", full_name: "Venkat Ram", emails: "venkat@rytual.com", source: "google", external_id: "otherContacts/c1" };
  const index = buildIdentityIndex({ contactRows: [row] });
  const res = resolveFacts(
    rec({ name: "Venkat Ram", emails: ["Venkat@Rytual.com"], source: "apple", externalId: "z1" }),
    index,
  );
  assert.equal(res.contactId, "9");
  assert.equal(res.rule, "email");
});

test("keys claimed by a soft-deleted contact never resurrect it as a merge target", () => {
  // The non-partial unique index keeps the key claimed; the row is not loaded
  // (it is soft-deleted), so it must not be offered as a candidate either.
  const index = buildIdentityIndex({
    contactRows: [],
    keyRows: [{ key_type: "phone", key_value: "3105550100", contact_id: "999" }],
  });
  const res = resolveFacts(rec({ name: "Gone", phoneNumbers: ["3105550100"] }), index);
  assert.equal(res.contactId, null);
});

test("a phone match wins over a name match, and the lowest id wins ties", () => {
  const index = buildIdentityIndex({
    contactRows: [
      { id: "50", full_name: "Kitty Schur", phone_primary: "3105551740" },
      { id: "20", full_name: "Kitty Schur", phone_primary: "3105551740" },
    ],
  });
  const res = resolveFacts(rec({ name: "Kitty Schur", phoneNumbers: ["3105551740"] }), index);
  assert.equal(res.contactId, "20", "deterministic: lowest id");
});

// ── Payload clustering (single-sync duplicate cards) ────────────────────────

test("clusterPayload collapses Apple duplicate cards that arrive in ONE payload", () => {
  // Shirley: 190 excess rows, all from a single sync, same name + phone, two ids.
  const payload = [
    { name: "Ruby Kim", phoneNumbers: ["+13105556512"], source: "apple", externalId: "672E5252" },
    { name: "Kenna Choi", phoneNumbers: ["+13105557867"], source: "apple", externalId: "FDD5DCB6" },
    { name: "Ruby Kim", phoneNumbers: ["3105556512"], source: "apple", externalId: "6D50D61E" },
  ];
  const clusters = clusterPayload(payload);
  assert.equal(clusters.length, 2);
  assert.equal(clusters[0].records.length, 2, "both Ruby cards in one cluster");
  assert.equal(clusters[1].records.length, 1);
});

test("clusterPayload keeps two people who share a line apart", () => {
  const clusters = clusterPayload([
    { name: "Mom", phoneNumbers: ["3105551740"], source: "apple", externalId: "m1" },
    { name: "Dad", phoneNumbers: ["3105551740"], source: "apple", externalId: "d1" },
  ]);
  assert.equal(clusters.length, 2);
});

test("clusterPayload never chains incompatible records through a middleman", () => {
  // A~B on a shared phone, B~C on a shared email, but A and C conflict on phone.
  // A blind union-find would put all three in one cluster; the gate must not.
  const clusters = clusterPayload([
    { name: "Sam Lee", phoneNumbers: ["3105550001"], source: "apple", externalId: "1" },
    { name: "Sam Lee", phoneNumbers: ["3105550001"], emails: ["sam@x.com"], source: "apple", externalId: "2" },
    { name: "Sam Lee", phoneNumbers: ["3105559999"], emails: ["sam@x.com"], source: "apple", externalId: "3" },
  ]);
  const sizes = clusters.map((c) => c.records.length).sort();
  assert.deepEqual(sizes, [1, 2]);
});

test("planPayload never sends two clusters at one existing row", () => {
  const index = buildIdentityIndex({
    contactRows: [
      { id: "1", full_name: "Jamie Fox", phone_primary: "3105550001", emails: "jamie@x.com" },
    ],
  });
  // Two records that cannot merge with each other (phone conflict) but both
  // match row 1 — one by phone, one by email.
  const { decisions } = planPayload(
    [
      { name: "Jamie Fox", phoneNumbers: ["3105550001"], source: "apple", externalId: "p1" },
      { name: "Jamie Fox", phoneNumbers: ["3105559999"], emails: ["jamie@x.com"], source: "apple", externalId: "p2" },
    ],
    index,
  );
  assert.equal(decisions.length, 2);
  assert.equal(decisions[0].contactId, "1");
  assert.equal(decisions[1].contactId, null, "second cluster must insert, not double-write row 1");
});

test("planPayload marks source hits as update and identity hits as merge", () => {
  const index = buildIdentityIndex({
    contactRows: [
      { id: "1", full_name: "A A", source: "apple", external_id: "keep" },
      { id: "2", full_name: "B B", phone_primary: "3105550002" },
    ],
  });
  const { decisions } = planPayload(
    [
      { name: "A A", source: "apple", externalId: "keep" },
      { name: "B B", phoneNumbers: ["3105550002"], source: "apple", externalId: "rotated" },
      { name: "C C", phoneNumbers: ["3105550003"], source: "apple", externalId: "new" },
    ],
    index,
  );
  assert.deepEqual(
    decisions.map((d) => d.action),
    ["update", "merge", "insert"],
  );
});
