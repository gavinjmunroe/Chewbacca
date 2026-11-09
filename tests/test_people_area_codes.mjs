// The area-code layer under `people who`: which numbers count, which places
// they name, and that the word "la" inside "Dallas" names nothing.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { areaCodeOf, regionsFor } = require("../bin/lib/people/area-codes.js");

test("US numbers in every shape give their area code", () => {
  assert.equal(areaCodeOf("+16265550100"), "626");
  assert.equal(areaCodeOf("(213) 555-0100"), "213");
  assert.equal(areaCodeOf("1-512-555-0100"), "512");
  assert.equal(areaCodeOf("5125550100"), "512");
});

test("non-US and malformed numbers are not guessed at", () => {
  assert.equal(areaCodeOf("+44 20 7946 0958"), null);
  assert.equal(areaCodeOf("+91 98765 43210"), null);
  assert.equal(areaCodeOf("555-0100"), null);
  assert.equal(areaCodeOf(""), null);
  assert.equal(areaCodeOf(null), null);
  assert.equal(areaCodeOf("0125550100"), null);
});

test("places resolve on whole words", () => {
  assert.deepEqual(
    regionsFor("LA").map((r) => r.name),
    ["Los Angeles"],
  );
  assert.deepEqual(
    regionsFor("Dallas").map((r) => r.name),
    ["Dallas"],
  );
  assert.deepEqual(
    regionsFor("Atlanta").map((r) => r.name),
    ["Atlanta"],
  );
  assert.deepEqual(
    regionsFor("orange county").map((r) => r.name),
    ["Orange County"],
  );
  assert.deepEqual(
    regionsFor("new york city").map((r) => r.name),
    ["New York City"],
  );
  assert.deepEqual(regionsFor("Madison"), []);
});
