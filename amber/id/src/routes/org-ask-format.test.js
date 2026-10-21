/**
 * The answer is rendered as text, so markdown in it is literal garbage on
 * somebody's screen. This is the net under the prompt.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { plainText } from "./org-ask.js";

test("emphasis markers are removed and the words survive", () => {
  assert.equal(plainText("**Sagar Tiwari** has gone quiet."), "Sagar Tiwari has gone quiet.");
  assert.equal(plainText("*43 days* ago"), "43 days ago");
  assert.equal(plainText("***both***"), "both");
  assert.equal(plainText("_quiet_ since March"), "quiet since March");
});

test("headings, bullets and fences are removed", () => {
  assert.equal(plainText("## Going quiet\nSagar"), "Going quiet\nSagar");
  assert.equal(plainText("- Sagar Tiwari\n- Brian Vance"), "Sagar Tiwari\nBrian Vance");
  assert.equal(plainText("* Sagar\n* Brian"), "Sagar\nBrian");
  assert.equal(plainText("```\nSagar\n```"), "Sagar");
  assert.equal(plainText("`pnptc.com`"), "pnptc.com");
});

test("ordinary prose is not touched", () => {
  const prose =
    "Karthik met Brian Vance on 3 October, and nobody here has spoken to Plug and Play since July.";
  assert.equal(plainText(prose), prose);
});

test("a lone asterisk or underscore in real text is left alone", () => {
  // An unmatched marker is not emphasis, and eating it would corrupt the words.
  assert.equal(plainText("5 * 3 meetings"), "5 * 3 meetings");
  assert.equal(plainText("the file is named a_b_c"), "the file is named a_b_c");
});

test("nothing in, nothing out", () => {
  assert.equal(plainText(null), "");
  assert.equal(plainText(""), "");
});
