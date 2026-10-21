/**
 * Tests for PeopleRank contact de-duplication + merge (item 158).
 *
 * Run with:  node --test src/lib/people-rank-dedup.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { dedupeContacts, mergeContactCluster } from "./people-rank-dedup.js";

const DAY = 86400000;

test("two rows sharing a phone merge into one", () => {
  const { contacts, mergedCount, aliasMap } = dedupeContacts([
    { id: "apple", name: "Shirley Park", phoneNumbers: ["+1 310 555 0000"] },
    { id: "gmail", name: "Shirley", phoneNumbers: ["3105550000"] },
  ]);
  assert.equal(contacts.length, 1);
  assert.equal(mergedCount, 1);
  // The more complete row (full name) survives.
  assert.equal(contacts[0].name, "Shirley Park");
  assert.deepEqual(contacts[0].mergedFrom, ["gmail"]);
  assert.equal(aliasMap.gmail, "apple");
});

test("two rows sharing an email merge", () => {
  const { contacts, mergedCount } = dedupeContacts([
    { id: "a", name: "Marcus Lee", emails: ["Marcus@Globex.com"] },
    { id: "b", name: "M. Lee", emails: ["marcus@globex.com"] },
  ]);
  assert.equal(contacts.length, 1);
  assert.equal(mergedCount, 1);
});

test("same name with NO shared handle does NOT merge (namesakes stay apart)", () => {
  const { contacts, mergedCount } = dedupeContacts([
    { id: "a", name: "John Smith", phoneNumbers: ["+13105550001"] },
    { id: "b", name: "John Smith", phoneNumbers: ["+13105550002"] },
  ]);
  assert.equal(contacts.length, 2);
  assert.equal(mergedCount, 0);
});

test("same name AND a shared handle merges", () => {
  const { contacts } = dedupeContacts([
    { id: "a", name: "John Smith", phoneNumbers: ["+13105550001"] },
    {
      id: "b",
      name: "John Smith",
      phoneNumbers: ["+13105550001"],
      emails: ["js@x.com"],
    },
  ]);
  assert.equal(contacts.length, 1);
});

test("merge takes max signals, latest touch, and unions handles", () => {
  const now = Date.now();
  const merged = mergeContactCluster([
    {
      id: "a",
      name: "Dana Lee",
      relationshipScore: 0.3,
      messageFrequency: 2,
      lastContactedAt: new Date(now - 30 * DAY),
      phoneNumbers: ["+13105550000"],
      emails: ["dana@a.com"],
      company: "Acme",
    },
    {
      id: "b",
      name: "Dana Lee",
      relationshipScore: 0.9,
      messageFrequency: 5,
      lastContactedAt: new Date(now - 1 * DAY),
      phoneNumbers: ["+13105550000", "+13105559999"],
      emails: ["dana@b.com"],
      title: "CTO",
    },
  ]);
  assert.equal(merged.relationshipScore, 0.9);
  assert.equal(merged.messageFrequency, 5);
  assert.equal(merged.lastContactedAt.getTime(), now - 1 * DAY);
  assert.deepEqual([...merged.phoneNumbers].sort(), [
    "+13105550000",
    "+13105559999",
  ]);
  assert.equal(merged.emails.length, 2);
  // Scalar identity backfilled from siblings.
  assert.equal(merged.company, "Acme");
  assert.equal(merged.title, "CTO");
});

test("transitive merge: a~b by phone, b~c by email collapses to one", () => {
  const { contacts } = dedupeContacts([
    { id: "a", name: "X", phoneNumbers: ["+13105550000"] },
    {
      id: "b",
      name: "X",
      phoneNumbers: ["+13105550000"],
      emails: ["x@x.com"],
    },
    { id: "c", name: "X", emails: ["x@x.com"] },
  ]);
  assert.equal(contacts.length, 1);
  assert.equal((contacts[0].mergedFrom || []).length, 2);
});

test("distinct people are left untouched, order preserved", () => {
  const { contacts, mergedCount } = dedupeContacts([
    { id: "a", name: "Alice", phoneNumbers: ["+13105550001"] },
    { id: "b", name: "Bob", phoneNumbers: ["+13105550002"] },
    { id: "c", name: "Cara", emails: ["cara@x.com"] },
  ]);
  assert.equal(mergedCount, 0);
  assert.deepEqual(
    contacts.map((c) => c.id),
    ["a", "b", "c"],
  );
});

test("empty / single inputs are no-ops", () => {
  assert.deepEqual(dedupeContacts([]).contacts, []);
  const one = dedupeContacts([{ id: "a", name: "Solo" }]);
  assert.equal(one.contacts.length, 1);
  assert.equal(one.mergedCount, 0);
});
