/**
 * The point of these tests is the accented and non-Latin cases. Everything
 * else is the behavior `\b` already had, held in place so the swap is safe.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { nameBoundaryRegex, mentionsName, replaceName } from "./name-boundary.js";

test("an accented name matches, the bug \\b could not fix", () => {
  assert.equal(mentionsName("Dinner with José tomorrow", "José"), true);
  assert.equal(mentionsName("Talked to Zoë about it", "Zoë"), true);
  assert.equal(mentionsName("Müller sent the deck", "Müller"), true);
  assert.equal(mentionsName("Nuñez is hiring", "Nuñez"), true);
  assert.equal(mentionsName("saw 李 at the office", "李"), true);
});

test("an accented name is still rewritten end to end", () => {
  assert.equal(
    replaceName("Jose moved to SF and Jose likes it", "Jose", "José"),
    "José moved to SF and José likes it",
  );
  assert.equal(replaceName("José moved to SF", "José", "Jose"), "Jose moved to SF");
});

test("it does not match inside a longer word", () => {
  assert.equal(mentionsName("Samantha called", "Sam"), false);
  assert.equal(mentionsName("Josée called", "José"), false);
  assert.equal(mentionsName("transfer complete", "sf"), false);
  assert.equal(replaceName("Samantha and Sam", "Sam", "Raj"), "Samantha and Raj");
});

test("punctuation, quotes and line ends are boundaries", () => {
  assert.equal(mentionsName("José, Ravi and I met", "José"), true);
  assert.equal(mentionsName('he said "José"', "José"), true);
  assert.equal(mentionsName("José", "José"), true);
  assert.equal(mentionsName("met José.", "José"), true);
  assert.equal(mentionsName("(José)", "José"), true);
});

test("a hyphen or apostrophe inside the name is matched literally", () => {
  assert.equal(mentionsName("Jean-Luc is here", "Jean-Luc"), true);
  assert.equal(mentionsName("O'Brien is here", "O'Brien"), true);
  // A hyphen is not a letter, so the halves are separately whole words. That is
  // the same thing `\b` did and the mention features rely on it.
  assert.equal(mentionsName("Jean-Luc is here", "Jean"), true);
});

test("regex metacharacters in a name cannot break the pattern", () => {
  assert.equal(mentionsName("call C++ dev", "C++"), true);
  assert.equal(mentionsName("who is a.b", "a.b"), true);
  assert.equal(mentionsName("who is axb", "a.b"), false);
  assert.doesNotThrow(() => nameBoundaryRegex("(", "gi"));
});

test("case is ignored in both directions", () => {
  assert.equal(mentionsName("JOSÉ called", "josé"), true);
  assert.equal(replaceName("SAM called", "sam", "Raj"), "Raj called");
});

test("a multi-word name matches as a phrase", () => {
  assert.equal(mentionsName("met José Ramírez today", "José Ramírez"), true);
  assert.equal(mentionsName("met José Ramírezes today", "José Ramírez"), false);
});

test("empty and nullish inputs never throw and never match", () => {
  assert.equal(nameBoundaryRegex(""), null);
  assert.equal(nameBoundaryRegex(null), null);
  assert.equal(nameBoundaryRegex("   "), null);
  assert.equal(mentionsName("anything", ""), false);
  assert.equal(mentionsName(null, "Sam"), false);
  assert.equal(replaceName(null, "Sam", "Raj"), "");
  assert.equal(replaceName("Sam", "", "Raj"), "Sam");
});

test("a global regex is fresh on every build, so lastIndex cannot leak", () => {
  const a = nameBoundaryRegex("Sam", "gi");
  assert.equal(a.test("Sam and Sam"), true);
  const b = nameBoundaryRegex("Sam", "gi");
  assert.equal(b.lastIndex, 0);
  assert.equal(b.test("Sam and Sam"), true);
});
