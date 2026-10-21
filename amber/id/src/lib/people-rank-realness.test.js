/**
 * Tests for the PeopleRank realness classifier (item 157).
 *
 * Run with:  node --test src/lib/people-rank-realness.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  classifyRealness,
  filterRealContacts,
  realnessMultiplier,
} from "./people-rank-realness.js";

test("a named person is real with full confidence", () => {
  const r = classifyRealness({ name: "Shirley Park", company: "Rytual" });
  assert.equal(r.isReal, true);
  assert.equal(r.confidence, 1);
  assert.equal(r.reason, "named_person");
});

test("an SMS shortcode is dropped", () => {
  const r = classifyRealness({ name: "262966" });
  assert.equal(r.isReal, false);
  assert.equal(r.reason, "sms_shortcode");
});

test("a no-reply / verification automation name is dropped", () => {
  assert.equal(classifyRealness({ name: "VerificationCode" }).isReal, false);
  assert.equal(classifyRealness({ name: "no-reply@stripe.com" }).isReal, false);
  assert.equal(
    classifyRealness({ name: "Appointment Reminder" }).isReal,
    false,
  );
  assert.equal(classifyRealness({ name: "Scam Likely" }).isReal, false);
});

test("an automation mailbox local part is dropped even as a plain name", () => {
  assert.equal(classifyRealness({ name: "support@acme.com" }).isReal, false);
  assert.equal(classifyRealness({ name: "notifications@x.com" }).isReal, false);
});

test("a full phone number used as a name is kept but low-confidence", () => {
  const r = classifyRealness({ name: "+1 (310) 555-1212" });
  assert.equal(r.isReal, true);
  assert.equal(r.reason, "phone_as_name");
  assert.ok(r.confidence < 0.5);
});

test("an unnamed contact with a handle is kept at low confidence", () => {
  const r = classifyRealness({ name: "", phoneNumbers: ["+13105550000"] });
  assert.equal(r.isReal, true);
  assert.equal(r.reason, "unnamed_with_handle");
  assert.ok(r.confidence < 0.5);
});

test("an unnamed contact with no handle at all is dropped", () => {
  const r = classifyRealness({ name: "  " });
  assert.equal(r.isReal, false);
  assert.equal(r.reason, "no_name_no_handle");
});

test("a name with letters and a number reads as a real person", () => {
  // "John 2" or "Apt 4 Mike" still a person, not a shortcode.
  assert.equal(classifyRealness({ name: "John 2" }).isReal, true);
  assert.equal(classifyRealness({ name: "Mike (work)" }).isReal, true);
});

test("filterRealContacts splits kept vs dropped and preserves order", () => {
  const contacts = [
    { id: "a", name: "Alice" },
    { id: "code", name: "262966" },
    { id: "b", name: "Bob" },
    { id: "noreply", name: "no-reply@svc.com" },
  ];
  const { kept, dropped } = filterRealContacts(contacts);
  assert.deepEqual(
    kept.map((c) => c.id),
    ["a", "b"],
  );
  assert.deepEqual(
    dropped.map((c) => c.id),
    ["code", "noreply"],
  );
});

test("realnessMultiplier returns 1 for a clear person (no score change)", () => {
  assert.equal(realnessMultiplier({ name: "Dana Lee" }), 1);
  assert.ok(realnessMultiplier({ name: "262966" }) < 0.5);
});
