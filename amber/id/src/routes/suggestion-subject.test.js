/**
 * A CHIP ABOUT THE WRONG PERSON.
 *
 * "Add a reminder to meet with Vega on Google Meet on Monday at noon" came back
 * offering "Add a note about Sagar". Sagar is a real contact, his id validated,
 * every check in generateSuggestions passed -- and he had nothing to do with the
 * sentence. He was simply in `people`, because he was in the recent history.
 *
 * Validating the id was never the same as validating the subject. The id check
 * stops the model inventing a person. Nothing stopped it picking a real one at
 * random, which is both the likelier mistake and the one that reads, to the
 * person holding the phone, as Amber not listening.
 *
 * Run with:  node --test src/routes/suggestion-subject.test.js
 */
import test from "node:test";
import assert from "node:assert/strict";

import { turnMentions } from "./chat.js";

const THE_MESSAGE =
  "Add a reminder to meet with Vega on Google meets on Monday at noon. Set the reminder for 11am on Monday";
const THE_ANSWER = "Noon Monday with Vega, and a nudge an hour before.";

test("THE SAGAR CHIP: a contact the turn never mentions is not a subject", () => {
  assert.equal(turnMentions("Sagar Rao", THE_MESSAGE, THE_ANSWER), false);
  assert.equal(turnMentions("Sagar", THE_MESSAGE, THE_ANSWER), false);
  // And the person it IS about still passes, or the fix would just delete chips.
  assert.equal(turnMentions("Vega", THE_MESSAGE, THE_ANSWER), true);
  assert.equal(turnMentions("Vega Sharma", THE_MESSAGE, ""), true);
});

test("the answer counts, not only the question", () => {
  /**
   * "What did she say about the raise?" names nobody. If the answer resolves it
   * to Priya, then the turn IS about Priya and a note chip is right. Matching
   * the message alone would drop every chip on a pronoun, which is a large share
   * of real questions.
   */
  assert.equal(turnMentions("Priya Raman", "what did she say about the raise?", ""), false);
  assert.equal(
    turnMentions("Priya Raman", "what did she say about the raise?", "Priya said she would think about it."),
    true,
  );
});

test("case and surname do not matter, because labels are written loosely", () => {
  assert.equal(turnMentions("neel patel", "Catching up with Neel tomorrow", ""), true);
  assert.equal(turnMentions("Neel Patel", "catching up with NEEL tomorrow", ""), true);
});

test("A SHORT FIRST NAME DOES NOT MATCH HALF THE DICTIONARY", () => {
  /**
   * The failure mode of a loose match is worse than the one being fixed: a
   * substring test on a two-letter name fires on nearly every sentence, and the
   * chip comes back wrong AND now has a test claiming it is right.
   */
  assert.equal(turnMentions("Al Fenwick", "I want to go to the gym and lift", ""), false);
  assert.equal(turnMentions("Jo Kim", "the job posting looks good", ""), false);
  assert.equal(turnMentions("An Le", "can you plan an evening for me", ""), false);
  // Full name present is always enough, however short.
  assert.equal(turnMentions("Jo Kim", "dinner with Jo Kim on Friday", ""), true);
});

test("a first name must be a whole word, not a fragment of a longer one", () => {
  // "Vega" inside "Vegas" is a different thing entirely, and a Las Vegas trip
  // should not offer to write a note about a person named Vega.
  assert.equal(turnMentions("Vega Sharma", "booking the Las Vegas trip", ""), false);
  assert.equal(turnMentions("Mark Liu", "the market is down", ""), false);
});

test("nothing to match on is not a match", () => {
  assert.equal(turnMentions("", THE_MESSAGE, THE_ANSWER), false);
  assert.equal(turnMentions(null, THE_MESSAGE, THE_ANSWER), false);
  assert.equal(turnMentions("Vega", "", ""), false);
  assert.equal(turnMentions("Vega", null, null), false);
});

test("A NAME THAT IS NOT A VALID REGEX MUST NOT CRASH THE CHIPS", () => {
  /**
   * The first token goes into `new RegExp`. Contact names come from an address
   * book import and are not sanitized anywhere, so a leading bracket or star is
   * a syntax error at construction -- which throws inside generateSuggestions
   * and takes down every chip on the turn, not just this one.
   *
   * THESE SPECIFIC STRINGS, and not the obvious "J.R. (work)". A dot or a
   * balanced group is still a VALID regex: it matches the wrong thing quietly
   * but never throws, so a test built on those passes with the escaping deleted
   * and proves nothing. It has to be a pattern that will not compile.
   */
  assert.doesNotThrow(() => turnMentions("[Bob Chen", "lunch with Bob", ""), "unterminated class");
  assert.doesNotThrow(() => turnMentions("*Ann Lee", "call Ann", ""), "nothing to repeat");
  assert.doesNotThrow(() => turnMentions("(work) Priya", "email Priya", ""), "unbalanced group");
  assert.doesNotThrow(() => turnMentions("J.R. (work)", "talking to J.R. today", ""));
  // And an escaped name still matches itself, so the escaping did not just
  // trade a crash for a matcher that never fires.
  assert.equal(turnMentions("O'Brien Casey", "lunch with O'Brien Casey", ""), true);
  assert.equal(turnMentions("Anne-Marie Diaz", "dinner with Anne-Marie", ""), true);
});
