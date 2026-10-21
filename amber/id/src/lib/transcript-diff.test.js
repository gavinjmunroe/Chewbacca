/**
 * Tests for the correction learner.
 *
 * The bar here is asymmetric on purpose: learning the WRONG term is worse than learning
 * nothing, because every learned term is fed into the transcription biasing prompt and
 * competes for a 224-token budget with the user's real contact names. So most of these
 * tests assert that something is NOT learned.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { learnableTerms } from "./transcript-diff.js";

test("learns the name the user actually corrected", () => {
  // The motivating case: said "AJ", meant "Ajay".
  assert.deepEqual(
    learnableTerms("Met with AJ about the deal", "Met with Ajay about the deal"),
    ["Ajay"],
  );
});

test("learns a respelling that is not a pure prefix", () => {
  assert.deepEqual(
    learnableTerms("Call Kaushik tomorrow", "Call Koushik tomorrow"),
    ["Koushik"],
  );
  assert.deepEqual(learnableTerms("saw Matt today", "saw Matthew today"), ["Matthew"]);
});

test("learns more than one correction in a single edit", () => {
  const got = learnableTerms(
    "AJ and Shirly went to the office",
    "Ajay and Shirley went to the office",
  );
  assert.deepEqual(got, ["Ajay", "Shirley"]);
});

test("does NOT learn ordinary lowercase word changes", () => {
  // Fixing a normal word is not a name correction and must not enter the dictionary.
  assert.deepEqual(learnableTerms("this is grate", "this is great"), []);
  assert.deepEqual(learnableTerms("we should of gone", "we should have gone"), []);
});

test("does NOT learn a factual edit between two real words", () => {
  // Tuesday -> Thursday is the user changing a FACT. Biasing future transcripts toward
  // "Thursday" would be actively wrong.
  assert.deepEqual(learnableTerms("meeting on Tuesday", "meeting on Thursday"), []);
  assert.deepEqual(learnableTerms("send it to Bob", "send it to Alice"), []);
});

test("does NOT learn from pure insertions or deletions", () => {
  assert.deepEqual(learnableTerms("met Ajay", "met Ajay yesterday at noon"), []);
  assert.deepEqual(learnableTerms("met Ajay yesterday", "met Ajay"), []);
});

test("does NOT learn from a wholesale rewrite", () => {
  // No reliable per-word intent to extract; guessing produces noise.
  assert.deepEqual(
    learnableTerms(
      "AJ",
      "Completely different text about something else entirely with many more words here",
    ),
    [],
  );
});

test("does NOT learn stopwords even if capitalised", () => {
  assert.deepEqual(learnableTerms("The thing", "That thing"), []);
});

test("is a no-op when nothing changed, or when input is empty", () => {
  assert.deepEqual(learnableTerms("Met with Ajay", "Met with Ajay"), []);
  assert.deepEqual(learnableTerms("", "Ajay"), []);
  assert.deepEqual(learnableTerms("Ajay", ""), []);
  assert.deepEqual(learnableTerms(null, undefined), []);
});

test("strips trailing punctuation from the learned term", () => {
  assert.deepEqual(learnableTerms("I saw AJ.", "I saw Ajay."), ["Ajay"]);
});

test("caps how much one edit can teach", () => {
  const before = "AJ Shirly Kaushik Matt Jon Rob Dave";
  const after = "Ajay Shirley Koushik Matthew Jonathan Robert David";
  const got = learnableTerms(before, after, { max: 3 });
  assert.equal(got.length, 3, "one edit must not flood the dictionary");
});

test("deduplicates a name corrected twice in one edit", () => {
  assert.deepEqual(
    learnableTerms("AJ called and AJ left", "Ajay called and Ajay left"),
    ["Ajay"],
  );
});

test("handles non-ASCII names", () => {
  assert.deepEqual(learnableTerms("met Jose today", "met José today"), ["José"]);
  assert.deepEqual(learnableTerms("met Bjorn today", "met Björn today"), ["Björn"]);
});
