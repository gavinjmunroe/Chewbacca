/**
 * Thirty raw source labels, a handful of origins somebody would actually name.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { foldSource, originsOf, originRank, ORIGIN_ORDER } from "./contact-origin.js";

test("the code paths fold into the place the human came from", () => {
  for (const l of ["apple", "ios", "imessage", "imessage_dm", "imessage_addcontact"]) {
    assert.equal(foldSource(l), "apple", `${l} should be apple`);
  }
  for (const l of ["google", "gmail", "google-contacts"]) {
    assert.equal(foldSource(l), "google");
  }
  assert.equal(foldSource("clay-smoke-test"), "clay");
  assert.equal(foldSource("peoplerank_enrich"), "enrichment");
});

test("MCP IS ONE BUCKET, because the data does not say which assistant called", () => {
  for (const l of ["mcp", "claude", "gpt", "openai", "anthropic", "perplexity"]) {
    assert.equal(foldSource(l), "mcp", `${l} should read as mcp`);
  }
});

test("an unrecognized label is kept, not buried in 'other'", () => {
  // A source nobody folded yet is still a real answer to "where did this come
  // from", and hiding it would hide exactly the thing worth noticing.
  assert.equal(foldSource("some-new-integration"), "some-new-integration");
  assert.equal(foldSource("  APPLE  "), "apple");
  assert.equal(foldSource(""), null);
  assert.equal(foldSource(null), null);
});

test("APPLE FIRST, GOOGLE SECOND, everything else after", () => {
  assert.deepEqual(ORIGIN_ORDER.slice(0, 2), ["apple", "google"]);
  assert.ok(originRank("apple") < originRank("google"));
  assert.ok(originRank("google") < originRank("clay"));
  assert.ok(originRank("enrichment") < originRank("something-unknown"));
  assert.deepEqual(originsOf(["clay", "google", "apple"]), ["apple", "google", "clay"]);
});

test("one person from two code paths of the same source is one origin", () => {
  assert.deepEqual(originsOf(["imessage", "apple", "ios"]), ["apple"]);
  assert.deepEqual(originsOf(["gmail", "google"]), ["google"]);
});

test("nothing in, nothing out", () => {
  assert.deepEqual(originsOf([]), []);
  assert.deepEqual(originsOf(null), []);
  assert.deepEqual(originsOf([null, "", undefined]), []);
});
