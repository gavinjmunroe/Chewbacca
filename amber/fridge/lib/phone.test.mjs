/**
 * Run: node --test lib/phone.test.mjs  (after tsc, or via tsx)
 *
 * The cases that matter are the ones people hit with their thumbs: pasting a
 * number that is already formatted, pasting one with the country code on it,
 * and backspacing. A formatter that cannot be backspaced to empty is the one
 * everybody complains about.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { formatUsPhone, digitsOf, toE164, isCompleteUsPhone } from "./phone.js";

test("it formats as you type, at every length", () => {
  assert.equal(formatUsPhone(""), "");
  assert.equal(formatUsPhone("6"), "+1-(6");
  assert.equal(formatUsPhone("630"), "+1-(630");
  assert.equal(formatUsPhone("6308"), "+1-(630)-8");
  assert.equal(formatUsPhone("630815"), "+1-(630)-815");
  assert.equal(formatUsPhone("6308159"), "+1-(630)-815-9");
  assert.equal(formatUsPhone("5550100001"), "+1-(555)-010-0001");
});

test("BACKSPACE ALWAYS DRAINS THE FIELD", () => {
  // Feed the formatted string back in, minus its last character, the way a
  // real backspace does. If any step stops shrinking, the field is a trap.
  let s = formatUsPhone("5550100001");
  const seen = new Set();
  for (let i = 0; i < 40 && s !== ""; i += 1) {
    assert.ok(!seen.has(s), `stuck at ${s}`);
    seen.add(s);
    s = formatUsPhone(s.slice(0, -1));
  }
  assert.equal(s, "", "the field never emptied");
});

test("a number that is already formatted, however it was written, comes back the same", () => {
  const want = "+1-(555)-010-0001";
  for (const typed of [
    "5550100001",
    "15550100001",
    "+15550100001",
    "+1 (555) 010-0001",
    "555-010-0001",
    "(555) 010 0001",
    "+1-(555)-010-0001",
    "1 555 010 0001",
  ]) {
    assert.equal(formatUsPhone(typed), want, typed);
  }
});

test("a LEADING 1 is an area code until there is proof otherwise", () => {
  // Somebody typing 1-1-2... has not yet said whether that 1 is a country code.
  assert.equal(digitsOf("1"), "1");
  assert.equal(digitsOf("163"), "163");
  // Eleven digits starting with 1 is unambiguous.
  assert.equal(digitsOf("15550100001"), "5550100001");
});

test("extra digits are dropped rather than accepted", () => {
  assert.equal(digitsOf("555010000112345"), "5550100001");
  assert.equal(formatUsPhone("555010000112345"), "+1-(555)-010-0001");
});

test("letters and junk never reach the field", () => {
  assert.equal(formatUsPhone("abc630def815ghi9796"), "+1-(555)-010-0001");
  assert.equal(formatUsPhone("..."), "");
  assert.equal(formatUsPhone(null), "");
  assert.equal(formatUsPhone(undefined), "");
});

test("E.164 is null until the number is whole", () => {
  assert.equal(toE164("630815979"), null);
  assert.equal(toE164("5550100001"), "+15550100001");
  assert.equal(toE164("+1 (555) 010-0001"), "+15550100001");
  assert.equal(isCompleteUsPhone("630815979"), false);
  assert.equal(isCompleteUsPhone("+1-(555)-010-0001"), true);
});
