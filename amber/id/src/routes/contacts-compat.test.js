/**
 * Backward-compat tests for POST /v1/me/contacts payload normalization.
 *
 * Older app builds POST the device shape ({ id, phones, organization }); current
 * builds POST the server shape ({ externalId, phoneNumbers, company }). The
 * route must accept both, because device-shape payloads used to persist with
 * phone_primary / external_id / company all NULL while still returning 200.
 *
 * The assertions below mirror the exact column mapping in
 * upsertContactsForOwner (src/db/store.js) — external_id ← externalId,
 * phone_primary ← phoneNumbers[0], company ← company. The end-to-end version of
 * this (real store call, faked SQL driver) lives in
 * scripts/contacts-compat-check.js.
 *
 * Run with:  node --test src/routes/contacts-compat.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  normalizeIncomingContact,
  synthesizeExternalId,
} from "./profile.js";

test("old device shape maps id/phones/organization onto the server shape", () => {
  const out = normalizeIncomingContact({
    id: "ABCD-1234-EFGH",
    name: "Maggie Smith",
    phones: ["+13105550100", "+13105550101"],
    organization: "Acme Corp",
  });

  assert.equal(out.externalId, "ABCD-1234-EFGH");
  assert.deepEqual(out.phoneNumbers, ["+13105550100", "+13105550101"]);
  assert.equal(out.company, "Acme Corp");
  assert.deepEqual(out.emails, []);
  assert.equal(out.source, "apple");

  // What upsertContactsForOwner would write — the regression being fixed is
  // both of these coming out null for a device-shape payload.
  assert.equal(out.phoneNumbers?.[0] ?? null, "+13105550100"); // phone_primary
  assert.notEqual(out.externalId, null); // external_id
});

test("new server shape passes through unchanged", () => {
  const out = normalizeIncomingContact({
    externalId: "srv-1",
    name: "Jane Doe",
    firstName: "Jane",
    lastName: "Doe",
    phoneNumbers: ["+14155550100"],
    emails: ["jane@example.com"],
    company: "Stripe",
    source: "apple",
  });

  assert.equal(out.externalId, "srv-1");
  assert.deepEqual(out.phoneNumbers, ["+14155550100"]);
  assert.deepEqual(out.emails, ["jane@example.com"]);
  assert.equal(out.company, "Stripe");
  assert.equal(out.firstName, "Jane");
  assert.equal(out.lastName, "Doe");
});

test("server-shape keys win when a payload carries both shapes", () => {
  const out = normalizeIncomingContact({
    id: "device-id",
    externalId: "server-id",
    name: "Both Shapes",
    phones: ["+15105550000"],
    phoneNumbers: ["+15105551111"],
    organization: "Device Co",
    company: "Server Co",
  });

  assert.equal(out.externalId, "server-id");
  assert.deepEqual(out.phoneNumbers, ["+15105551111"]);
  assert.equal(out.company, "Server Co");
});

test("name-only contacts are valid and still upsert", () => {
  const out = normalizeIncomingContact({ name: "No Phone Nancy" });

  assert.notEqual(out, null);
  assert.equal(out.name, "No Phone Nancy");
  assert.deepEqual(out.phoneNumbers, []);
  assert.deepEqual(out.emails, []);
  assert.equal(out.company, null);
  assert.equal(out.source, "apple");
  // externalId is no longer null here: an id-less contact now gets a
  // deterministic key so the next sync upserts it instead of duplicating it.
  assert.match(out.externalId, /^sha256:[0-9a-f]{32}$/);
});

test("contacts without a name are skipped (unchanged rule)", () => {
  assert.equal(normalizeIncomingContact({ id: "x", phones: ["+1310555"] }), null);
  assert.equal(normalizeIncomingContact({ name: "" }), null);
  assert.equal(normalizeIncomingContact(null), null);
  assert.equal(normalizeIncomingContact("Maggie"), null);
});

test("explicit source is preserved; empty strings do not become ids", () => {
  const out = normalizeIncomingContact({
    name: "Linked Larry",
    source: "linkedin",
    id: "   ",
    organization: "",
  });

  assert.equal(out.source, "linkedin");
  assert.equal(out.company, null);
  // A blank id is still treated as absent — it just falls through to the
  // synthesized key rather than being stored as "".
  assert.match(out.externalId, /^sha256:[0-9a-f]{32}$/);
});

test("malformed phones/emails degrade to empty arrays instead of throwing", () => {
  const out = normalizeIncomingContact({
    name: "Weird Wanda",
    phones: "+13105550100", // string, not an array
    emails: { work: "w@example.com" },
  });

  assert.deepEqual(out.phoneNumbers, []);
  assert.deepEqual(out.emails, []);
});

// ── deterministic external id for id-less contacts ───────────────────────────

test("a contact with no client id gets a deterministic sha256 external id", () => {
  const out = normalizeIncomingContact({
    name: "No Id Nadia",
    phones: ["+1 (310) 555-0100"],
    organization: "Acme Corp",
  });

  assert.match(out.externalId, /^sha256:[0-9a-f]{32}$/);
  // Same contact, re-sent in the OTHER payload shape with different
  // punctuation and casing → same key, so the re-sync upserts in place.
  const again = normalizeIncomingContact({
    name: "  no id   NADIA ",
    phoneNumbers: ["+1-310-555-0100"],
    company: "acme corp",
  });
  assert.equal(again.externalId, out.externalId);
});

test("a US country-code change does NOT change the key (leading 1 is stripped)", () => {
  // A client that formats the same number differently between syncs must not
  // duplicate the row — that is the whole point of the synthesized key.
  const withCC = normalizeIncomingContact({ name: "Nadia", phoneNumbers: ["+13105550100"] });
  const without = normalizeIncomingContact({ name: "Nadia", phoneNumbers: ["3105550100"] });
  const punctuated = normalizeIncomingContact({ name: "Nadia", phoneNumbers: ["1 (310) 555-0100"] });
  assert.equal(withCC.externalId, without.externalId);
  assert.equal(withCC.externalId, punctuated.externalId);

  // The strip is 11-digit-US-specific: a genuine 11-digit non-US number and a
  // different 10-digit number still hash apart.
  const uk = normalizeIncomingContact({ name: "Nadia", phoneNumbers: ["+44 20 7946 0958"] });
  assert.notEqual(uk.externalId, withCC.externalId);
  const other = normalizeIncomingContact({ name: "Nadia", phoneNumbers: ["3105550999"] });
  assert.notEqual(other.externalId, withCC.externalId);
});

test("the synthesized id changes when identity fields change", () => {
  const base = { name: "Same Name", phoneNumbers: ["+13105550100"], company: "Acme" };
  const id = (o) => normalizeIncomingContact({ ...base, ...o }).externalId;

  assert.notEqual(id({ name: "Other Name" }), id({}));
  assert.notEqual(id({ phoneNumbers: ["+13105550999"] }), id({}));
  assert.notEqual(id({ company: "Newco" }), id({}));
  assert.notEqual(id({ source: "linkedin" }), id({}));
});

test("a real client id always wins over the synthesized one", () => {
  const withId = normalizeIncomingContact({
    id: "ABCD-1234",
    name: "Has Id Hank",
    phones: ["+13105550100"],
  });
  assert.equal(withId.externalId, "ABCD-1234");

  // An empty-string id is still treated as absent, and then synthesized.
  const blank = normalizeIncomingContact({ id: "   ", name: "Has Id Hank", phones: ["+13105550100"] });
  assert.match(blank.externalId, /^sha256:/);
});

test("synthesizeExternalId is stable for a name-only contact", () => {
  const a = synthesizeExternalId({ name: "No Phone Nancy", phone: undefined, company: null, source: "apple" });
  const b = synthesizeExternalId({ name: "  no phone   nancy ", phone: "", company: "", source: "apple" });
  assert.equal(a, b);
  assert.match(a, /^sha256:[0-9a-f]{32}$/);
});
