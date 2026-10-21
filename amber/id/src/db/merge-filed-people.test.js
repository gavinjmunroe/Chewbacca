/**
 * mergeFiledWithStoredPeople.
 *
 * This function exists because two opposite bugs share one line of code. The
 * tests are written as the pair, because that pairing IS the specification:
 * overwriting fixes corrections and loses field-only people, unioning fixes
 * field-only people and reverts corrections.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mergeFiledWithStoredPeople } from "./store.js";

const p = (contactId, name) => ({ contactId, name, score: 0 });

test("a corrected name wins over the stale stored one", () => {
  // The note originally tagged Josh Berman; the user corrected it to Josh Segal,
  // which rewrote participant_ids. Berman must not come back.
  const out = mergeFiledWithStoredPeople([p("11", "Josh Segal")], [p("22", "Josh Berman")]);
  assert.deepEqual(
    out.map((x) => x.name),
    ["Josh Segal"],
  );
});

test("a field-only person survives even though no row references the note", () => {
  // "Sagar is starting at Stanford" writes contact columns and a fact, not a
  // participant row. Nobody in the filed list sounds like Sagar, so he is kept.
  const out = mergeFiledWithStoredPeople([p("11", "Ishaan Gupta")], [p("99", "Sagar Tiwari")]);
  assert.deepEqual(
    out.map((x) => x.name).sort(),
    ["Ishaan Gupta", "Sagar Tiwari"],
  );
});

test("filed comes first, and its identity is the one that survives a duplicate id", () => {
  const out = mergeFiledWithStoredPeople(
    [p("11", "Ishaan Gupta")],
    [p("11", "Ishan"), p("99", "Sagar Tiwari")],
  );
  assert.equal(out.length, 2);
  assert.equal(out[0].name, "Ishaan Gupta");
  assert.equal(out[1].name, "Sagar Tiwari");
});

test("the phonetic supersede is on the FIRST name only", () => {
  // Same first name, different surname = a spelling correction. Different first
  // name = a different person, and dropping them would be the original bug.
  const corrected = mergeFiledWithStoredPeople([p("1", "Bo Chen")], [p("2", "Beau Chen")]);
  assert.deepEqual(corrected.map((x) => x.name), ["Bo Chen"]);

  const different = mergeFiledWithStoredPeople([p("1", "Bo Chen")], [p("2", "Priya Chen")]);
  assert.deepEqual(different.map((x) => x.name).sort(), ["Bo Chen", "Priya Chen"]);
});

test("degenerate inputs never throw and never invent a person", () => {
  assert.deepEqual(mergeFiledWithStoredPeople([], []), []);
  assert.deepEqual(mergeFiledWithStoredPeople(null, undefined), []);
  // A stored entry with no contactId is not a card — it is a pending name, and
  // the confirmation flow owns it.
  assert.deepEqual(mergeFiledWithStoredPeople([], [{ name: "Sam", contactId: null }]), []);
  // Filed-only, stored empty: unchanged behavior from before the merge existed.
  assert.deepEqual(
    mergeFiledWithStoredPeople([p("7", "Dev Shah")], []).map((x) => x.contactId),
    ["7"],
  );
  // A nameless stored person cannot be phonetically superseded, so they are kept.
  assert.equal(mergeFiledWithStoredPeople([p("1", "Ann")], [p("2", null)]).length, 2);
});
