/**
 * A PROFILE THAT IS ALREADY A CONTACT MUST NOT COME WITH AN "ADD" BUTTON.
 *
 * The reported failure: one of his contacts came back from the LinkedIn pass, so
 * the same person appeared twice -- once as the card he has, once as a stranger
 * offering to create a duplicate.
 *
 * The tests that matter most here are the REFUSALS. Claiming a stranger is your
 * contact hides somebody you asked to meet behind a card for somebody else.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  markKnownWebPeople,
  normalizePersonName,
  countKnown,
} from "./web-people-known.js";

const BOOK = [
  { id: "c1", name: "Meet Patel", company: "Veecode", title: "Embedded Product" },
  { id: "c2", name: "Ajay Sathappan", company: null, title: null },
  { id: "c3", name: "José Álvarez", company: null, title: null },
];

const profile = (name, extra = {}) => ({
  name,
  title: "Hardware Engineer",
  company: null,
  url: `https://linkedin.com/in/${name.toLowerCase().replace(/\s+/g, "")}`,
  ...extra,
});

test("a contact who comes back from the web is marked as one, and put first", () => {
  const out = markKnownWebPeople(
    [profile("Saavan Patel"), profile("Meet Patel"), profile("Piyush Patel")],
    BOOK,
  );
  assert.equal(out[0].name, "Meet Patel", "the known person leads");
  assert.equal(out[0].existingContactId, "c1");
  assert.equal(out[0].existingContactName, "Meet Patel");
  assert.equal(countKnown(out), 1);
  // Everybody else is untouched and still there.
  assert.equal(out.length, 3);
  assert.equal(out[1].existingContactId, undefined);
  assert.equal(out[2].existingContactId, undefined);
});

test("a shared surname is NOT a match", () => {
  // The exact five-Patel result set. Only one of them is his contact.
  const out = markKnownWebPeople(
    ["Saavan Patel", "Piyush Patel", "Pruthvi Patel", "Manush Patel"].map((n) => profile(n)),
    BOOK,
  );
  assert.equal(countKnown(out), 0);
});

test("a shared first name is NOT a match either", () => {
  const out = markKnownWebPeople([profile("Meet Shah")], BOOK);
  assert.equal(countKnown(out), 0);
});

test("middle initials, credentials and accents do not break a real match", () => {
  const out = markKnownWebPeople(
    [profile("Meet K. Patel"), profile("Ajay Sathappan, MBA"), profile("Jose Alvarez")],
    BOOK,
  );
  assert.equal(countKnown(out), 3, out.map((p) => p.name).join(", "));
});

test("two contacts of the same name are left unmatched unless the company decides it", () => {
  const twins = [
    { id: "t1", name: "Alex Kim", company: "Stripe" },
    { id: "t2", name: "Alex Kim", company: "Anthropic" },
  ];
  // Nothing to go on: refused rather than guessed.
  assert.equal(countKnown(markKnownWebPeople([profile("Alex Kim")], twins)), 0);
  // A company that matches exactly one of them settles it.
  const decided = markKnownWebPeople([profile("Alex Kim", { company: "Stripe, Inc." })], twins);
  assert.equal(decided[0].existingContactId, "t1");
  // A company that matches neither is still refused.
  assert.equal(
    countKnown(markKnownWebPeople([profile("Alex Kim", { company: "Figma" })], twins)),
    0,
  );
});

test("normalizePersonName strips what a LinkedIn header adds", () => {
  assert.equal(normalizePersonName("Dr. Jane A. Doe, PhD"), "jane doe");
  assert.equal(normalizePersonName("  MEET   PATEL "), "meet patel");
  // An apostrophe is part of the name; a hyphen separates two of them.
  assert.equal(normalizePersonName("O'Brien-Smith"), "obrien smith");
  assert.equal(normalizePersonName("OBrien Smith"), "obrien smith", "same person, either spelling");
  assert.equal(normalizePersonName("D\u2019Angelo Russo"), "dangelo russo");
  assert.equal(normalizePersonName(""), "");
  assert.equal(normalizePersonName(null), "");
});

test("an empty book or empty list is handled without inventing anything", () => {
  assert.deepEqual(markKnownWebPeople([], BOOK), []);
  assert.equal(countKnown(markKnownWebPeople([profile("Meet Patel")], [])), 0);
  assert.deepEqual(markKnownWebPeople(null, null), []);
});

test("a contact with no name in the book cannot match a nameless profile", () => {
  const book = [{ id: "x", name: "" }];
  assert.equal(countKnown(markKnownWebPeople([{ name: "", url: "u" }], book)), 0);
});
