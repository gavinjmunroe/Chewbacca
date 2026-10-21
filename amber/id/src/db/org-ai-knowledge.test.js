/**
 * THE BAR FOR "THIS IS A DOCUMENT" HAS TO BE HIGH, AND HERE IS WHY.
 *
 * A year of assistant history is mostly chat. A small part of it is work
 * somebody would be glad to find again: the spec written at 1am, the
 * migration plan, the competitive teardown.
 *
 * PRECISION MATTERS MORE THAN RECALL, and the asymmetry is not close.
 * Eleven real documents is a feature somebody shows a colleague. Four hundred
 * maybes is a mess somebody has to clean up, and they clean it up by deleting
 * all of it and never importing again. A false positive costs the whole
 * feature; a false negative costs one document that was already lost.
 *
 * So these tests are mostly about what must NOT become a page.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { __test } from "./org-ai-knowledge.js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const { looksLikeWork, pageKey } = __test;

/** Long enough to pass the length gate, so each test isolates one signal. */
const filler = (n) => "Some ordinary prose about the matter at hand. ".repeat(n);

test("a long chat is not a document", () => {
  /*
   * THE ONE THAT WOULD RUIN IT. A debugging session is longer than most
   * specs -- that is what makes debugging tiring -- and length alone would
   * promote every one of them. A colleague opening it finds somebody's
   * Tuesday.
   */
  const chat = filler(60);
  assert.equal(chat.length > 1200, true, "the fixture must clear the length gate");
  assert.equal(looksLikeWork(chat).ok, false, "length alone must never be enough");
  assert.equal(looksLikeWork(chat).why, "no_structure");
});

test("a short note is not a document however well formatted", () => {
  const tidy = "# Title\n\n- one\n- two\n- three\n\n## Next\n\n1. do it\n2. done\n";
  assert.equal(looksLikeWork(tidy).ok, false);
  assert.equal(looksLikeWork(tidy).why, "too_short");
});

test("a few bullets in a reply are not a document", () => {
  /*
   * The commonest shape in any export: a long answer with three bullets in
   * the middle. Counting bullets at face value would make every one of these
   * a page.
   */
  const reply = `${filler(30)}\n\n- first point\n- second point\n- third point\n\n${filler(30)}`;
  assert.equal(looksLikeWork(reply).ok, false, "three bullets is a reply, not a spec");
});

test("a structured document is a document", () => {
  const doc = [
    "# Migration plan",
    filler(8),
    "## Why",
    filler(8),
    "## Steps",
    "1. take a snapshot",
    "2. apply 091",
    "3. verify sign-in",
    "## Rollback",
    filler(8),
  ].join("\n\n");
  const v = looksLikeWork(doc);
  assert.equal(v.ok, true);
  assert.equal(v.signals.headings >= 4, true);
});

test("code counts double, because nobody pastes code casually", () => {
  const withCode =
    `${filler(20)}\n\n\`\`\`sql\nSELECT 1;\n\`\`\`\n\n` +
    "## Notes\n\n- it is idempotent\n- it is reversible\n\n" +
    `\`\`\`js\nconst x = 1;\n\`\`\`\n${filler(10)}`;
  assert.equal(looksLikeWork(withCode).ok, true);
});

test("a table counts, for the same reason", () => {
  const withTable = [
    filler(20),
    "| option | cost | risk |",
    "| --- | --- | --- |",
    "| a | low | high |",
    "| b | high | low |",
    "## Recommendation",
    filler(10),
  ].join("\n\n");
  assert.equal(looksLikeWork(withTable).ok, true);
});

test("the provenance key is stable and scoped to its provider", () => {
  /*
   * THE KEY IS THE IDEMPOTENCE. People re-upload -- they add a file, retry
   * after a failure, forget they already did it -- and without a stable key
   * the second upload doubles their wiki, recoverable only by deleting pages
   * one at a time.
   */
  assert.equal(pageKey("claude", "abc"), "ai:claude:abc");
  assert.equal(pageKey("claude", "abc"), pageKey("claude", "abc"));
  assert.notEqual(pageKey("claude", "abc"), pageKey("chatgpt", "abc"));
});

test("nothing malformed throws", () => {
  /*
   * An export is a file somebody downloaded from another product, possibly
   * years ago, possibly edited. Every one of these has to be an answer
   * rather than a stack trace, because one bad conversation must not take
   * the other four thousand down with it.
   */
  for (const bad of [null, undefined, "", 0, {}, []]) {
    assert.doesNotThrow(() => looksLikeWork(bad));
    assert.equal(looksLikeWork(bad).ok, false);
  }
});

test("an unrecognized sharing choice lands private", async () => {
  /*
   * THE ASYMMETRY THAT DECIDES THIS. A typo, a stale group id, or a value
   * from a client version that has moved on must all resolve to the
   * narrowest answer. Treating an unknown value as "company" publishes
   * somebody's private thinking on a guess, and there is no recovering from
   * that -- the colleague has already read it.
   */
  const src = readFileSync(
    fileURLToPath(new URL("./org-ai-knowledge.js", import.meta.url)),
    "utf8",
  );
  /*
   * CUT AT THE FUNCTION'S OWN CLOSING BRACE. A fixed-length slice ran past
   * it into the next function and read ITS last return, reporting correct
   * code as broken -- the same class of mistake as every other check in this
   * tree that knew one spelling of right.
   */
  const at = src.indexOf("function audienceFor");
  const fn = src.slice(at, src.indexOf("\n}", at) + 2);

  // The last statement is the fallback, and it must be the private one.
  const lastReturn = fn.slice(fn.lastIndexOf("return"));
  assert.ok(
    /people:\s*\[amberId\]/.test(lastReturn),
    "the fallback must address the importer alone, not everyone",
  );
  assert.ok(
    !/everyone:\s*true/.test(lastReturn),
    "no path that is reached by an unknown value may set everyone",
  );
});

test("the preview carries the id the choices are keyed by", () => {
  /*
   * The preview is SORTED -- strongest first -- and a second call re-derives
   * that order from the same file. Keying choices by position would survive
   * every test and then, the one time a conversation scored differently,
   * publish the wrong document to the company.
   */
  const src = readFileSync(
    fileURLToPath(new URL("./org-ai-knowledge.js", import.meta.url)),
    "utf8",
  );
  const preview = src.slice(src.indexOf("const preview ="), src.indexOf("const preview =") + 600);
  assert.ok(/id:\s*c\.convo\.id/.test(preview), "each previewed row must carry its conversation id");
  assert.ok(
    /reach\[c\.convo\.id\]/.test(src),
    "and the choice must be looked up by that same id, never by index",
  );
});
