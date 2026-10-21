/**
 * THE SENTENCE HE SPOKE, AND THE ONE THE APP HEARD.
 *
 * "I want to meet a few hardware engineers" became "I want to Meet Patel a few
 * hardware engineers", because the dictionary had learned that the word "meet"
 * should be spelled as a contact's name. Everything after that obeyed a sentence
 * he never said: the LinkedIn pass searched for it and came back with five
 * people named Patel, which read as the search being biased.
 *
 * These tests are that sentence, plus the other shapes of the same bug.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { applyVocabCorrections } from "./voice-vocab.js";
import { isRiskyHeardForm } from "./voice-common-words.js";

test("the exact failure: 'meet' is never rewritten into a contact's name", () => {
  const spoken =
    "After the barbershop, I want to meet a few hardware engineers in Manhattan.";
  const { text, applied } = applyVocabCorrections(spoken, [
    { heard: "meet", term: "Meet Patel" },
  ]);
  assert.equal(text, spoken, "the transcript is untouched");
  assert.deepEqual(applied, []);
});

test("the other sentences the same bug would have destroyed", () => {
  const cases = [
    ["I'll mark it as done", { heard: "mark", term: "Mark Zhang" }],
    ["we may go on Friday", { heard: "may", term: "May Chen" }],
    ["I hope she calls back", { heard: "hope", term: "Hope Adler" }],
    ["can you grant access", { heard: "grant", term: "Grant Ellis" }],
    ["let's grab lunch", { heard: "lunch", term: "Lunch Box" }],
  ];
  for (const [sentence, pair] of cases) {
    const { text } = applyVocabCorrections(sentence, [pair]);
    assert.equal(text, sentence, sentence);
  }
});

test("a real name correction still applies — this must not become a blanket refusal", () => {
  // The dictionary's whole purpose. None of these heard forms is a word.
  const { text, applied } = applyVocabCorrections("I saw shitij and a j yesterday", [
    { heard: "shitij", term: "Kshitij" },
    { heard: "a j", term: "AJ" },
  ]);
  assert.equal(text, "I saw Kshitij and AJ yesterday");
  assert.equal(applied.length, 2);
});

test("a multi-token heard form containing a common word is still allowed", () => {
  // "meet patel" is not something anybody says by accident; the bare word is.
  assert.equal(isRiskyHeardForm("meet patel"), false);
  assert.equal(isRiskyHeardForm("meet"), true);
  const { text } = applyVocabCorrections("dinner with meet patel tonight", [
    { heard: "meet patel", term: "Meet Patel" },
  ]);
  assert.equal(text, "dinner with Meet Patel tonight");
});

test("case and padding do not get a word past the guard", () => {
  for (const v of ["Meet", "  MEET  ", "Mark", "WILL"]) {
    assert.equal(isRiskyHeardForm(v), true, v);
  }
});

test("an empty or missing heard form is refused rather than applied", () => {
  for (const v of ["", "   ", null, undefined]) {
    assert.equal(isRiskyHeardForm(v), true, String(v));
  }
});

test("initials with dots are not treated as words", () => {
  assert.equal(isRiskyHeardForm("j.r."), false);
  assert.equal(isRiskyHeardForm("de silva"), false);
});
