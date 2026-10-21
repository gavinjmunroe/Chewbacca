/**
 * Place extraction for the recall side channel.
 *
 * The stakes are asymmetric and that shapes every test here. A miss costs a card
 * the user might have liked. A false positive spends a memory-wide search on a
 * phrase nobody wrote and, if it happens to match, shows a contact card for
 * someone the note never mentioned — which reads as recall and is worse than
 * showing nothing.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { peopleHintTerms, wantsPeopleHint } from "./people-hint.js";

test("a known region expands to every name that region goes by", () => {
  const terms = peopleHintTerms("help me plan a dinner in san francisco");
  // The point of the expansion: a note that says "SF" and a note that says "the
  // Bay Area" are both about this question, and one ILIKE finds neither.
  for (const expected of ["san francisco", "sf", "bay area", "oakland"]) {
    assert.ok(terms.includes(expected), `missing alias: ${expected}`);
  }
  assert.ok(terms.includes("San Francisco Bay Area"), "canonical name should be searchable too");
});

test("the abbreviation alone finds the same region", () => {
  assert.deepEqual(
    peopleHintTerms("help me plan a dinner in SF"),
    peopleHintTerms("help me plan a dinner in san francisco"),
  );
});

test("a place that is not a known region is taken from the preposition", () => {
  assert.deepEqual(peopleHintTerms("planning a dinner in williamsburg with three friends"), [
    "williamsburg",
  ]);
  assert.deepEqual(peopleHintTerms("lets get drinks near fort greene tomorrow"), ["fort greene"]);
});

test("the phrase stops at the joining word", () => {
  // Without the cut this was "williamsburg with three", which matches nothing
  // anyone has ever written and quietly disables the whole feature.
  for (const [msg, expected] of [
    ["dinner in greenpoint with sam and dev", "greenpoint"],
    ["drinks in soho on friday", "soho"],
    ["brunch near park slope tomorrow", "park slope"],
  ]) {
    assert.deepEqual(peopleHintTerms(msg), [expected], msg);
  }
});

test("an idiom that merely contains a preposition is not a place", () => {
  // These are the false positives that would search someone's whole memory for
  // "mind" or "charge" and hand back a stranger's card.
  for (const m of [
    "keep this in mind for later",
    "im in charge of the offsite",
    "i want to grab lunch in a nice place",
    "get in touch with him",
    "put it in the calendar",
    "let me know in advance",
  ]) {
    assert.deepEqual(peopleHintTerms(m), [], m);
  }
});

test("a message that names nowhere asks for nobody", () => {
  for (const m of [
    "help me plan a dinner",
    "remind me to email priya",
    "what did sam say about her job",
    "",
    "hi",
  ]) {
    assert.deepEqual(peopleHintTerms(m), [], JSON.stringify(m));
    assert.equal(wantsPeopleHint(m), false);
  }
});

test("wantsPeopleHint agrees with the terms it would search", () => {
  assert.equal(wantsPeopleHint("help me plan a dinner in san francisco"), true);
  assert.equal(wantsPeopleHint("planning a dinner in williamsburg with friends"), true);
  assert.equal(wantsPeopleHint("help me plan a dinner"), false);
});
