/**
 * Typed-name matching over an address book. Pure; no DB, no model.
 *
 * Run with:  node --test src/lib/contact-name-match.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  boundedEditDistance,
  coverToken,
  editBudget,
  fuzzyFindContactsByName,
  nameMatch,
  normalizeName,
  tokenize,
} from "./contact-name-match.js";

const BOOK = [
  { id: "1", name: "Sagar Tiwari GOAT" },
  { id: "2", name: "Adrian Fabbro" },
  { id: "3", name: "Aidan Catholic Family Frat Dude USC" },
  { id: "4", name: "Sagarika Menon" },
  { id: "5", name: "Anna Klein" },
  { id: "6", name: "Dana Ruiz" },
  { id: "7", name: "José-María O'Brien" },
];

test("normalizeName folds accents, drops punctuation, collapses spaces", () => {
  assert.equal(normalizeName("José-María  O'Brien"), "jose maria o brien");
  assert.equal(normalizeName("  Sagar   TIWARI "), "sagar tiwari");
  assert.equal(normalizeName(null), "");
  assert.deepEqual(tokenize("Sagar Tiwari GOAT"), ["sagar", "tiwari", "goat"]);
});

test("boundedEditDistance is exact within budget and bails out past it", () => {
  assert.equal(boundedEditDistance("tieari", "tiwari", 2), 1);
  assert.equal(boundedEditDistance("abc", "abc", 0), 0);
  assert.equal(boundedEditDistance("kitten", "sitting", 3), 3);
  // Over budget returns max+1 rather than the true distance — a sentinel, not
  // an answer, which is all a caller comparing against the budget needs.
  assert.ok(boundedEditDistance("kitten", "sitting", 1) > 1);
  assert.ok(boundedEditDistance("a", "abcdefgh", 2) > 2);
});

test("short tokens must match exactly", () => {
  // A 1-edit budget on three letters matches half a phone book: ana/anna/dana/
  // ann/and. The budget is 0 below four characters on purpose.
  assert.equal(editBudget(3), 0);
  assert.equal(editBudget(5), 1);
  assert.equal(editBudget(8), 2);
  assert.equal(editBudget(12), 3);
  assert.equal(nameMatch("ana", "Anna Klein"), null);
  assert.equal(nameMatch("ana", "Dana Ruiz"), null);
  assert.ok(nameMatch("anna", "Anna Klein"));
});

test("a typed prefix counts, one character does not", () => {
  assert.equal(coverToken("tiw", ["tiwari"]).kind, "prefix");
  assert.equal(coverToken("a", ["adrian"]), null);
  // Exact beats prefix beats fuzzy.
  assert.equal(coverToken("sagar", ["sagar", "sagarika"]).cost, 0);
});

test("THE BUG: a typo in the surname still finds the person", () => {
  // "Sagar tieari" returned "No one named Sagar Tieari showed up in your
  // contacts" while Sagar Tiwari GOAT was sitting in the address book.
  const hits = fuzzyFindContactsByName("Sagar tieari", BOOK);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].name, "Sagar Tiwari GOAT");
  assert.ok(hits[0].score > 0.8);
  assert.equal(hits[0].exactName, false);
});

test("extra tokens on the CONTACT are free — real phone books are full of them", () => {
  // "Aidan Catholic Family Frat Dude USC" must be findable as "Aidan".
  assert.equal(fuzzyFindContactsByName("aidan", BOOK)[0].name, "Aidan Catholic Family Frat Dude USC");
  assert.equal(fuzzyFindContactsByName("sagar tiwari", BOOK)[0].name, "Sagar Tiwari GOAT");
});

test("a query token with no counterpart is not a match", () => {
  // Otherwise "Sagar Mehta" would happily return Sagar Tiwari.
  assert.equal(nameMatch("sagar mehta", "Sagar Tiwari GOAT"), null);
  assert.deepEqual(fuzzyFindContactsByName("zzzz qqqq", BOOK), []);
});

test("exact matches rank above fuzzy ones", () => {
  const hits = fuzzyFindContactsByName("adrian fabbro", BOOK);
  assert.equal(hits[0].name, "Adrian Fabbro");
  assert.equal(hits[0].exactName, true);
  assert.equal(hits[0].score, 1);
  // And a misspelling of the same person still lands, just lower.
  const fuzzy = fuzzyFindContactsByName("adrien fabro", BOOK);
  assert.equal(fuzzy[0].name, "Adrian Fabbro");
  assert.ok(fuzzy[0].score < 1);
});

test("accents and punctuation do not have to be typed", () => {
  assert.equal(fuzzyFindContactsByName("jose maria", BOOK)[0].name, "José-María O'Brien");
  // Nobody types the apostrophe. It normalizes to a token break, so "obrien"
  // reaches "brien" on the edit budget and the person is still found.
  assert.equal(fuzzyFindContactsByName("jose maria obrien", BOOK)[0].name, "José-María O'Brien");
  assert.equal(fuzzyFindContactsByName("JOSE MARIA O'BRIEN", BOOK)[0].score, 1);
});

test("limit and minScore are honored, and ties break predictably", () => {
  const many = Array.from({ length: 30 }, (_, i) => ({ id: String(i), name: `Sagar Number${i}` }));
  const hits = fuzzyFindContactsByName("sagar", many, { limit: 5 });
  assert.equal(hits.length, 5);
  // Same score for all: sorted by name, not by insertion order.
  assert.deepEqual(
    hits.map((h) => h.name),
    [...hits.map((h) => h.name)].sort((a, b) => a.localeCompare(b)),
  );
  assert.deepEqual(fuzzyFindContactsByName("sagar", BOOK, { minScore: 1.01 }), []);
});

test("the row is handed back untouched so callers keep their own fields", () => {
  const rows = [{ id: "9", name: "Sagar Tiwari", phone: "+13105550100", title: "CTO" }];
  const [hit] = fuzzyFindContactsByName("sagar tiwari", rows);
  assert.equal(hit.phone, "+13105550100");
  assert.equal(hit.title, "CTO");
  assert.equal(hit.score, 1);
});

test("bad input never throws", () => {
  for (const bad of [null, undefined, "", 42]) {
    assert.deepEqual(fuzzyFindContactsByName(bad, BOOK), []);
    assert.deepEqual(fuzzyFindContactsByName("sagar", bad), []);
  }
  assert.equal(nameMatch("sagar", null), null);
  assert.equal(nameMatch("", "Sagar Tiwari"), null);
});
