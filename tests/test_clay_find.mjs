// clay_find.js picks exactly one visible control for a recipe action, or
// says why it could not. Two matches stop the run rather than pressing
// whichever came first.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { pick, matches } = require("../bin/lib/clay_find.js");

const candidate = (text, extra = {}) => ({ index: extra.index ?? 0, text, placeholder: "", visible: true, ...extra });

test("exact text, whitespace collapsed", () => {
  assert.deepEqual(pick([candidate("Find  leads\n", { index: 3 })], { text: "Find leads" }), { ok: true, index: 3 });
});

test("invisible candidates never match", () => {
  assert.deepEqual(pick([candidate("Save", { visible: false })], { text: "Save" }), { ok: false, reason: "missing" });
});

test("two visible matches is ambiguous, never a guess", () => {
  const got = pick([candidate("Save", { index: 1 }), candidate("Save", { index: 2 })], { text: "Save" });
  assert.equal(got.ok, false);
  assert.equal(got.reason, "ambiguous");
  assert.equal(got.count, 2);
});

test("prefix, contains and regex", () => {
  assert.ok(matches("Run column >", { text: "Run column", match: "prefix" }));
  assert.ok(matches("Find work email (7)", { text: "Find work email", match: "contains" }));
  assert.ok(matches("Save and run 10 rows", { text_re: "^Save and run \\d+ rows$" }));
  assert.ok(!matches("Save", { text: "Save and run", match: "prefix" }));
  assert.ok(!matches("Save and run 10 rows", { text: "Save" }));
});

test("placeholder narrows", () => {
  const got = pick(
    [candidate("", { placeholder: "Search" }), candidate("", { index: 5, placeholder: "I'm looking for..." })],
    { placeholder: "I'm looking for" });
  assert.deepEqual(got, { ok: true, index: 5 });
});

test("no text constraint matches any visible candidate", () => {
  assert.deepEqual(pick([candidate("", { index: 7 })], { css: "input[value=custom]" }), { ok: true, index: 7 });
});
