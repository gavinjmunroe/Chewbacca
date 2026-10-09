// clay_find.js picks exactly one visible control for a recipe action, or
// says why it could not. Two matches stop the run rather than pressing
// whichever came first.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { pick, matches, refuse, sectionOf } = require("../bin/lib/clay_find.js");

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

test("a press is refused off this run's own table, by whole path segment", () => {
  const want = { table: "t_new1", text: null };
  assert.equal(refuse("/workspaces/1/workbooks/wb_1/tables/t_new1", "Run 8", want), null);
  assert.equal(refuse("/workspaces/1/workbooks/wb_9/tables/t_theirs", "Run 8", want), "wrong table");
  assert.equal(refuse("/workspaces/1/workbooks/wb_1/tables/t_new12", "Run 8", want), "wrong table");
  assert.equal(refuse("/workspaces/1/home", "Run 8", want), "wrong table");
  assert.equal(refuse("/workspaces/1/home", "Save", { table: null, text: null }), null);
});
test("a press is refused when the control no longer says what the card showed", () => {
  const want = { table: null, text: "Run 8 empty or out-of-date rows" };
  assert.equal(refuse("/x", "Run 8 empty or out-of-date rows", want), null);
  assert.equal(refuse("/x", "Run 312 empty or out-of-date rows", want), "changed");
});

// The 2026-10-09 dry run stopped on "Found 2 matches for People": Clay's Find
// leads flyout had grown a "Create a workflow (Beta)" section with its own
// People button below the "Search directly" one.
test("section narrows to the control under its label", () => {
  const people = [
    candidate("People", { index: 1, section: "Search directly" }),
    candidate("People", { index: 6, section: "Create a workflow Beta" }),
  ];
  assert.deepEqual(pick(people, { text: "People", section: "Search directly" }), { ok: true, index: 1 });
  assert.deepEqual(pick(people, { text: "People", section: "Create a workflow" }), { ok: true, index: 6 });
  assert.deepEqual(pick([candidate("People", { section: "" })], { text: "People", section: "Search directly" }),
    { ok: false, reason: "missing" });
});

// Plain objects stand in for the flyout: one flat list of a label, buttons,
// an empty separator, a second label, more buttons.
function flatList(items) {
  const nodes = items.map(([tagName, innerText]) => ({ tagName, innerText }));
  nodes.forEach((n, i) => { n.previousElementSibling = nodes[i - 1] || null; });
  return nodes;
}

test("a control's section is the nearest earlier labelled sibling of another kind", () => {
  const nodes = flatList([
    ["DIV", "Search directly"], ["BUTTON", "People"], ["BUTTON", "Companies"],
    ["DIV", ""], ["DIV", "Create a workflow\nBeta"], ["BUTTON", "People"],
  ]);
  assert.equal(sectionOf(nodes[1]), "Search directly");
  assert.equal(sectionOf(nodes[2]), "Search directly");
  assert.equal(sectionOf(nodes[5]), "Create a workflow Beta");
  assert.equal(sectionOf(flatList([["BUTTON", "Save"]])[0]), "");
});
