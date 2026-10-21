/**
 * Tests for the Google-contacts import filter and the import counters.
 *
 * Two rules under test:
 *   1. A contact the user SAVED is never junk — whatever it carries, or does not
 *      carry. It went in their address book on purpose.
 *   2. An `otherContacts` entry with NO name and NO phone is a Google-harvested
 *      mail address, not a contact. One real address book had 162 of them (14% of
 *      all rows) — unrankable, and they crowd out real people.
 *
 * Run with:  node --test src/lib/google-contacts.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { isJunk, normalizePerson } from "./google-contacts.js";

const person = ({ name, emails = [], phones = [] } = {}) => ({
  resourceName: "otherContacts/c123",
  ...(name ? { names: [{ displayName: name, metadata: { primary: true } }] } : {}),
  emailAddresses: emails.map((value) => ({ value })),
  phoneNumbers: phones.map((value) => ({ value })),
});

test("otherContacts with no name and no phone is dropped, even with a real email", () => {
  const c = normalizePerson(person({ emails: ["lori_lauff@ipsd.org"] }), "other");
  assert.equal(c.fullName, null);
  assert.equal(isJunk(c), true);
});

test("a blank/whitespace name does not count as a name", () => {
  const c = normalizePerson(person({ name: "   ", emails: ["x@example.com"] }), "other");
  assert.equal(isJunk(c), true);
});

test("otherContacts WITH a name is kept", () => {
  const c = normalizePerson(person({ name: "Adaptive Realty Inc.", emails: ["x@appfolio.us"] }), "other");
  assert.equal(isJunk(c), false);
});

test("otherContacts with a phone but no name is kept", () => {
  const c = normalizePerson(person({ phones: ["+13105550100"] }), "other");
  assert.equal(isJunk(c), false);
});

test("the SAVED bucket is untouched — a nameless saved contact is still the user's", () => {
  const c = normalizePerson(person({ emails: ["deliberately@saved.com"] }), "saved");
  assert.equal(c.fullName, null);
  assert.equal(isJunk(c), false);
});

// A saved contact is NEVER junk. These two cases used to be dropped by the
// reachability rules, which applied to both buckets — the bug being fixed.
test("a saved contact with a name but NO phone and NO email is kept", () => {
  const c = normalizePerson(person({ name: "Nagu Mama" }), "saved");
  assert.equal(isJunk(c), false, "the user typed this in on purpose");
});

test("a saved contact whose only address is a machine/bulk sender is kept", () => {
  const c = normalizePerson(
    person({ name: "Newsletter Guy", emails: ["no-reply@mailer.example.com"] }),
    "saved",
  );
  assert.equal(isJunk(c), false);
});

test("a saved contact with nothing at all — no name, no phone, no email — is kept", () => {
  const c = normalizePerson(person({}), "saved");
  assert.equal(isJunk(c), false, "saved means saved; no heuristic overrules it");
});

test("the harvested bucket still applies the reachability rules", () => {
  // No name and no phone → junk (the primary harvested rule).
  assert.equal(isJunk(normalizePerson(person({ emails: ["x@y.com"] }), "other")), true);
  // Nothing to reach them by at all → junk.
  assert.equal(isJunk(normalizePerson(person({ name: "Ghost" }), "other")), true);
  // Named, but the only address is a bulk sender → junk.
  assert.equal(
    isJunk(normalizePerson(person({ name: "Bulk", emails: ["no-reply@mailer.example.com"] }), "other")),
    true,
  );
  // Named with a real email → kept.
  assert.equal(
    isJunk(normalizePerson(person({ name: "Jane", emails: ["jane@example.com"] }), "other")),
    false,
  );
});

test("a real person from otherContacts (name + email) survives the new rule", () => {
  const c = normalizePerson(
    person({ name: "Kevin Cong", emails: ["kevin@bluemodernadvisory.com"] }),
    "other",
  );
  assert.equal(isJunk(c), false);
  assert.equal(c.externalId, "otherContacts/c123");
});
