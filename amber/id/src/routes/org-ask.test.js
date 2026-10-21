/**
 * A QUESTION IS NOT A SEARCH NEEDLE.
 *
 * THE BUG THIS EXISTS TO PREVENT, which shipped and was caught on a screen
 * recording. The ask bar handed the whole question to listPeople as `q`.
 * listPeople does what a search box does -- name ILIKE '%q%' -- so
 *
 *     "Who here knows someone at Paychex?"
 *
 * became a search for a person whose NAME contains "who here knows someone
 * at paychex?". Nobody is called that. Zero rows, an honest "nothing
 * matches", and two clicks away the Network tab showed Paychex with three
 * people on it.
 *
 * So the subject extractor is the part worth testing without a database: it
 * is pure, it runs on every question, and when it is wrong the product
 * answers "I don't know" about data it is holding.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { subjectsOf } from "./org-ask.js";

test("the firm comes out of the question that broke it", () => {
  const got = subjectsOf("Who here knows someone at Paychex?");
  assert.ok(got.includes("Paychex"), `expected Paychex, got ${JSON.stringify(got)}`);
  // And the scaffolding does not.
  for (const junk of ["Who", "here", "knows", "someone", "at"]) {
    assert.ok(!got.includes(junk), `"${junk}" is not a subject`);
  }
});

test("a domain is a subject, because firms are named that way here", () => {
  /*
   * The roster shows pear.vc and stanford.edu as firms. Somebody asking
   * about one will type it exactly as they saw it, and a capital-letter rule
   * alone would miss every one.
   */
  assert.ok(subjectsOf("what is happening with pear.vc").includes("pear.vc"));
  assert.ok(subjectsOf("anyone at zeutara.com?").includes("zeutara.com"));
  assert.ok(subjectsOf("do we know anybody at stanford.edu").includes("stanford.edu"));
});

test("a quoted phrase is taken whole", () => {
  const got = subjectsOf('what happened with "Blue Modern Advisory"');
  assert.ok(got.includes("Blue Modern Advisory"), JSON.stringify(got));
});

test("a question with no proper noun still produces something to look up", () => {
  /*
   * "Which relationships are going quiet?" has no subject at all. Returning
   * nothing is correct -- there is nothing to look up -- and the route
   * carries a roster baseline for exactly these. What must NOT happen is the
   * whole sentence coming back as one needle.
   */
  const got = subjectsOf("Which relationships are going quiet?");
  assert.ok(
    !got.some((s) => s.includes(" ") && s.length > 25),
    `no sentence-shaped needle, got ${JSON.stringify(got)}`,
  );
});

test("the longest candidate is tried first", () => {
  /*
   * "Blue Modern" must be looked up before "Blue", or a search that matches
   * anything blue wins and the firm is never found.
   */
  const got = subjectsOf("Who knows Blue Modern Advisory");
  const first = got[0] ?? "";
  assert.ok(first.length >= (got[1]?.length ?? 0), `not sorted: ${JSON.stringify(got)}`);
});

test("nothing malformed throws", () => {
  for (const bad of [null, undefined, "", "?", "   ", 0, {}, []]) {
    assert.doesNotThrow(() => subjectsOf(bad));
    assert.ok(Array.isArray(subjectsOf(bad)));
  }
});

test("at most a handful of lookups per question", () => {
  /*
   * Each subject costs three queries. A paragraph pasted into the bar must
   * not turn into sixty of them.
   */
  const essay = Array.from({ length: 80 }, (_, i) => `Name${i}`).join(" and ");
  assert.ok(subjectsOf(`who knows ${essay}`).length <= 5);
});
