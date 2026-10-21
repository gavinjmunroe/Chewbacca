/**
 * The label said "spoke" for a number that meant "anything at all touched this
 * person", and somebody read it and correctly did not believe it. These assert
 * that the verb never claims more than the channel supports.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { sinceLabel } from "./relationship-label.js";

const NOW = Date.parse("2026-09-28T00:00:00Z");
const ago = (days) => new Date(NOW - days * 86_400_000).toISOString();

test("THE VERB MATCHES THE CHANNEL", () => {
  assert.equal(sinceLabel(ago(30), "email", NOW), "emailed 1 month ago");
  assert.equal(sinceLabel(ago(21), "calendar", NOW), "met 21 days ago");
  assert.equal(sinceLabel(ago(2), "message", NOW), "messaged 2 days ago");
  assert.equal(sinceLabel(ago(400), "note", NOW), "noted 1 year ago");
});

test("AN UNKNOWN CHANNEL NEVER GUESSES A VERB", () => {
  // This is the whole bug: a number with no channel behind it used to be
  // rendered as "spoke", which is a specific claim about a specific activity.
  assert.equal(sinceLabel(ago(30), null, NOW), "last contact 1 month ago");
  assert.equal(sinceLabel(ago(30), undefined, NOW), "last contact 1 month ago");
  assert.equal(sinceLabel(ago(30), "carrier-pigeon", NOW), "last contact 1 month ago");
  for (const label of [
    sinceLabel(ago(30), null, NOW),
    sinceLabel(ago(0), null, NOW),
    sinceLabel(ago(1), null, NOW),
  ]) {
    assert.ok(!String(label).includes("spoke"), `"${label}" still claims speech`);
  }
});

test("counts are pluralized, because \"1 months ago\" reads as a bug", () => {
  assert.equal(sinceLabel(ago(60), "email", NOW), "emailed 2 months ago");
  assert.equal(sinceLabel(ago(2), "email", NOW), "emailed 2 days ago");
  assert.equal(sinceLabel(ago(730), "email", NOW), "emailed 2 years ago");
});

test("today and yesterday read as english", () => {
  assert.equal(sinceLabel(ago(0), "email", NOW), "emailed today");
  assert.equal(sinceLabel(ago(1), "email", NOW), "emailed yesterday");
  assert.equal(sinceLabel(ago(0), null, NOW), "last contact today");
});

test("no timestamp is not a label", () => {
  assert.equal(sinceLabel(null, "email", NOW), null);
  assert.equal(sinceLabel(undefined, null, NOW), null);
  assert.equal(sinceLabel("not a date", "email", NOW), null);
});
