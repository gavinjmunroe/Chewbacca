/**
 * The table is only worth having if it is exact in both directions: it must
 * pair Nate with Nathan, and it must refuse to pair Nathan with Nathaniel.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { rootsOf, tokenRelation, nameRelation, variantKeysOf } from "./name-nicknames.js";

test("a short form points at every name it could be short for", () => {
  assert.deepEqual([...rootsOf("nate")].sort(), ["nathan", "nathaniel"]);
  assert.deepEqual([...rootsOf("nathan")], ["nathan"]);
  // A surname, or anything the table has never heard of, is only itself.
  assert.deepEqual([...rootsOf("kaplan")], ["kaplan"]);
  assert.deepEqual([...rootsOf("")], []);
});

test("AMBIGUITY IS KEPT: nate is both, but nathan and nathaniel are not each other", () => {
  assert.equal(tokenRelation("nate", "nathan"), "nickname");
  assert.equal(tokenRelation("nate", "nathaniel"), "nickname");
  assert.equal(tokenRelation("nathan", "nathaniel"), null);
  assert.equal(tokenRelation("nathan", "nathan"), "exact");
});

test("a nickname is not a spelling distance", () => {
  // One edit apart and unrelated; six edits apart and the same man.
  assert.equal(tokenRelation("nate", "kate"), null);
  assert.equal(tokenRelation("nate", "nathan"), "nickname");
  assert.equal(tokenRelation("jon", "ron"), null);
});

test("names match across sorted tokens, and report which kind of match it was", () => {
  assert.equal(nameRelation("kaplan nathan", "kaplan nathan"), "exact");
  assert.equal(nameRelation("kaplan nate", "kaplan nathan"), "nickname");
  assert.equal(nameRelation("kaplan nate", "harris nathan"), null);
  // Different token counts are different names. "John Smith" is not "John
  // Smith Jr" and guessing otherwise merges a father into his son.
  assert.equal(nameRelation("john smith", "john jr smith"), null);
  assert.equal(nameRelation("", ""), null);
});

test("EACH TOKEN IS USED ONCE, so two nicknames cannot both claim one name", () => {
  // "Nate Nathan" against "Nathan Nathan": a greedy pass pairs both left
  // tokens with the first right token and calls it a match. It is not one.
  assert.equal(nameRelation("nate nathan", "nathan nathan"), "nickname");
  assert.equal(nameRelation("nate nate", "nathan nathaniel"), "nickname");
  assert.equal(nameRelation("bob bob", "robert smith"), null);
});

test("variant keys put a nickname in the same bucket as its full name", () => {
  const nate = variantKeysOf("kaplan nate");
  const nathan = variantKeysOf("kaplan nathan");
  assert.ok(nate.some((k) => nathan.includes(k)), "Nate Kaplan never meets Nathan Kaplan");
  assert.ok(nate.includes("kaplan nate"), "a name must still be filed under itself");
  // A name with nothing in the table produces exactly one key.
  assert.deepEqual(variantKeysOf("maganda vanessa"), ["maganda vanessa"]);
  assert.deepEqual(variantKeysOf(""), []);
});
