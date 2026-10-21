/**
 * Unit tests for src/lib/person-mentions.js.
 * Run with: node --test src/lib/person-mentions.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  firstNameToken,
  findMentionedContacts,
  filterEntriesMentioningContact,
} from "./person-mentions.js";

test("firstNameToken prefers firstName over name", () => {
  assert.equal(
    firstNameToken({ firstName: "Shirley", name: "Shirley Park" }),
    "Shirley",
  );
});

test("firstNameToken falls back to first whitespace token of name", () => {
  assert.equal(firstNameToken({ name: "Alinna Chen" }), "Alinna");
});

test("firstNameToken rejects too-short tokens", () => {
  assert.equal(firstNameToken({ firstName: "Al" }), null);
  assert.equal(firstNameToken({ firstName: "" }), null);
  assert.equal(firstNameToken({ name: "" }), null);
});

test("firstNameToken handles non-object input", () => {
  assert.equal(firstNameToken(null), null);
  assert.equal(firstNameToken(undefined), null);
  assert.equal(firstNameToken("Shirley"), null);
});

test("findMentionedContacts matches whole-word, case-insensitive", () => {
  const contacts = [
    { id: "1", firstName: "Shirley" },
    { id: "2", firstName: "Alinna" },
  ];
  const hits = findMentionedContacts(
    "Shirley shipped the page; alinna was on PTO",
    contacts,
  );
  assert.equal(hits.length, 2);
});

test("findMentionedContacts does not match substring inside another word", () => {
  const contacts = [
    { id: "1", firstName: "Al" },
    { id: "2", firstName: "Ann" },
  ];
  const hits = findMentionedContacts(
    "Caleb is at school. Annie said hi.",
    contacts,
  );
  // Both names below the 3-char threshold should never produce hits.
  assert.equal(hits.length, 0);
});

test("findMentionedContacts only returns each contact once", () => {
  const contacts = [{ id: "1", firstName: "Shirley" }];
  const hits = findMentionedContacts("Shirley Shirley Shirley", contacts);
  assert.equal(hits.length, 1);
});

test("findMentionedContacts gracefully handles empty inputs", () => {
  assert.deepEqual(findMentionedContacts("", [{ firstName: "Shirley" }]), []);
  assert.deepEqual(findMentionedContacts("Shirley", []), []);
});

test("filterEntriesMentioningContact picks up body mentions even when with is empty", () => {
  const now = Date.now();
  const entries = [
    {
      id: "e1",
      body: "Shirley shipped the new landing page",
      written_at: new Date(now).toISOString(),
    },
    {
      id: "e2",
      body: "Alinna started writing again",
      written_at: new Date(now).toISOString(),
    },
  ];
  const hits = filterEntriesMentioningContact(
    entries,
    { firstName: "Shirley" },
    { lookbackDays: 30, now },
  );
  assert.equal(hits.length, 1);
  assert.equal(hits[0].id, "e1");
});

test("filterEntriesMentioningContact picks up explicit with array tag", () => {
  const now = Date.now();
  const entries = [
    {
      id: "e3",
      body: "good convo today",
      with: ["Shirley"],
      written_at: new Date(now).toISOString(),
    },
  ];
  const hits = filterEntriesMentioningContact(
    entries,
    { firstName: "Shirley" },
    { now },
  );
  assert.equal(hits.length, 1);
});

test("filterEntriesMentioningContact respects lookbackDays cutoff", () => {
  const now = Date.now();
  const stale = now - 90 * 24 * 60 * 60 * 1000;
  const entries = [
    {
      id: "old",
      body: "Shirley once said something memorable",
      written_at: new Date(stale).toISOString(),
    },
    {
      id: "new",
      body: "Shirley shipped today",
      written_at: new Date(now).toISOString(),
    },
  ];
  const hits = filterEntriesMentioningContact(
    entries,
    { firstName: "Shirley" },
    { lookbackDays: 30, now },
  );
  assert.equal(hits.length, 1);
  assert.equal(hits[0].id, "new");
});
