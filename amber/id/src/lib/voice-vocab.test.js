/**
 * The learned dictionary's substitution half.
 *
 * The property that matters is that a correction NEVER damages ordinary prose.
 * "AJ" -> "Ajay" is worthless if it also turns "major" into "majay", and the whole
 * promise of this feature is that it gets names right — so a false positive here is
 * more embarrassing than the miss it was meant to fix. Every test below is a way
 * substring replacement gets that wrong.
 *
 * Pure function, no database.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { applyVocabCorrections } from "./voice-vocab.js";
import { learnablePairs, learnableTerms } from "./transcript-diff.js";

const PAIRS = [
  { heard: "AJ", term: "Ajay" },
  { heard: "Roger", term: "Raj" },
];

test("replaces a learned mishearing as a whole word", () => {
  const r = applyVocabCorrections("I spoke to AJ today", PAIRS);
  assert.equal(r.text, "I spoke to Ajay today");
  assert.deepEqual(r.applied, [{ heard: "AJ", term: "Ajay" }]);
});

test("NEVER touches a word that merely contains the term", () => {
  for (const s of ["major surgery", "AJs car", "Rogerson called", "encourAJing"]) {
    assert.equal(applyVocabCorrections(s, PAIRS).text, s, `must not rewrite: ${s}`);
  }
});

test("matches case-insensitively and writes the canonical spelling", () => {
  assert.equal(applyVocabCorrections("aj and Aj and AJ", PAIRS).text, "Ajay and Ajay and Ajay");
});

test("respects punctuation as a word boundary", () => {
  assert.equal(applyVocabCorrections("Call AJ.", PAIRS).text, "Call Ajay.");
  assert.equal(applyVocabCorrections("(AJ)", PAIRS).text, "(Ajay)");
  assert.equal(applyVocabCorrections("AJ, Roger", PAIRS).text, "Ajay, Raj");
});

test("matches at the very start and the very end of the text", () => {
  assert.equal(applyVocabCorrections("AJ", PAIRS).text, "Ajay");
  assert.equal(applyVocabCorrections("AJ said hi", PAIRS).text, "Ajay said hi");
  assert.equal(applyVocabCorrections("say hi to AJ", PAIRS).text, "say hi to Ajay");
});

test("longest term wins, so a two-word mishearing beats a one-word one", () => {
  const pairs = [{ heard: "A", term: "Alpha" }, { heard: "A J", term: "Ajay" }];
  assert.equal(applyVocabCorrections("A J is here", pairs).text, "Ajay is here");
});

test("a term containing regex metacharacters is escaped, not interpreted", () => {
  const pairs = [{ heard: "J.R.", term: "Jay Arr" }, { heard: "C++", term: "C plus plus" }];
  assert.equal(applyVocabCorrections("J.R. called", pairs).text, "Jay Arr called");
  assert.equal(applyVocabCorrections("JxRy called", pairs).text, "JxRy called", "the dot is literal");
  assert.equal(applyVocabCorrections("we use C++ here", pairs).text, "we use C plus plus here");
});

test("empty and degenerate input is returned untouched", () => {
  assert.deepEqual(applyVocabCorrections("", PAIRS), { text: "", applied: [] });
  assert.deepEqual(applyVocabCorrections("hello", []), { text: "hello", applied: [] });
  assert.deepEqual(applyVocabCorrections(null, PAIRS), { text: "", applied: [] });
  assert.equal(applyVocabCorrections("hello", [{ heard: "", term: "x" }]).text, "hello");
});

test("`applied` reports only the pairs that actually fired", () => {
  const r = applyVocabCorrections("just AJ here", PAIRS);
  assert.deepEqual(r.applied, [{ heard: "AJ", term: "Ajay" }]);
});

test("learnablePairs keeps the heard side that learnableTerms threw away", () => {
  // "aj" is a prefix of "ajay" — the strongest respelling signal there is, and the
  // exact case this whole feature exists for.
  const pairs = learnablePairs("I met AJ today", "I met Ajay today");
  assert.deepEqual(pairs, [["AJ", "Ajay"]]);
  // The old flat contract is unchanged, because every existing caller wants it.
  assert.deepEqual(learnableTerms("I met AJ today", "I met Ajay today"), ["Ajay"]);
});

test("a factual edit is NOT learned as a respelling", () => {
  // "Roger" -> "Raj" shares only its first letter and is four edits away. Learning it
  // would bias every future transcript toward Raj whenever Roger is spoken, which is
  // the specific damage a self-training dictionary can do. plausibleRespelling
  // requires a prefix, a single edit, or three shared leading characters — and this
  // guard is why "Tuesday" -> "Thursday" is not learned either.
  assert.deepEqual(learnablePairs("I met Roger today", "I met Raj today"), []);
});

test("a rewrite that is not a word swap teaches nothing", () => {
  assert.deepEqual(learnablePairs("hello", "completely different text entirely here"), []);
  assert.deepEqual(learnablePairs("same text", "same text"), []);
});
