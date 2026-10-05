// weft-view's pure half, against a real Tangle-built program and a real run.
//
// Fixtures (tests/fixtures/weft) were recorded on 2026-10-04 from the first
// headless Tangle build: an expense form, a sum, a human approval, a saved
// record. expense-parse.json is `weft parse` output, expense-run.json is
// GET /executions/{id}/replay for a run that was approved.
//
//   node --test tests/test_weft_view.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const view = require("../bin/lib/weft_view.js");
const fixture = (name) => JSON.parse(readFileSync(join(here, "fixtures", "weft", name), "utf8"));

const expense = fixture("expense-parse.json").project;
const run = fixture("expense-run.json");

const nodes = (parts) => parts.filter((p) => p.t === "node");
const arrows = (parts) => parts.filter((p) => p.t === "arrow");

test("groups draw as one plain-words box each, left to right", () => {
  const parts = view.layout(expense, view.newSlots());
  const boxes = nodes(parts);
  assert.equal(boxes.length, 3);
  assert.deepEqual(
    boxes.map((b) => b.label),
    ["Takes the expense form and adds the amounts up", "Asks a person to approve or reject the total", "Record"],
  );
  const xs = boxes.map((b) => b.x);
  assert.ok(xs[0] < xs[1] && xs[1] < xs[2], `boxes not in flow order: ${xs}`);
});

test("arrows between groups survive the boundary doors", () => {
  // Regression: reading only `scope` dropped every arrow between groups,
  // because the doors sit at the top level with an empty scope.
  const parts = view.layout(expense, view.newSlots());
  assert.equal(arrows(parts).length, 3);
});

test("no node types or ports reach the drawing", () => {
  const text = JSON.stringify(view.layout(expense, view.newSlots()));
  for (const word of ["HumanQuery", "ExecPython", "Passthrough", "__in", "__out", "portType"]) {
    assert.ok(!text.includes(word), `${word} leaked into the drawing`);
  }
});

test("a step added later keeps every earlier shape in its slot", () => {
  const slots = view.newSlots();
  const before = view.layout(expense, slots);
  const grown = structuredClone(expense);
  grown.nodes.push({ id: "notify", label: "tell the person", scope: [], groupBoundary: null });
  grown.edges.push({ source: "record__out", target: "notify" });
  const after = view.layout(grown, slots);
  assert.ok(after.length > before.length);
  before.forEach((shape, i) => assert.equal(after[i].t, shape.t, `slot ${i} changed kind`));
  assert.equal(after.at(-2).label, "tell the person");
});

test("a step that disappears leaves an invisible dot, not a gap", () => {
  const slots = view.newSlots();
  const full = view.layout(expense, slots);
  const smaller = structuredClone(expense);
  smaller.nodes = smaller.nodes.filter((n) => !String(n.id).startsWith("record"));
  smaller.edges = smaller.edges.filter((e) => !String(e.source).startsWith("record") && !String(e.target).startsWith("record"));
  const after = view.layout(smaller, slots);
  assert.equal(after.length, full.length);
  const gone = after[2];
  assert.equal(gone.t, "dot");
  assert.equal(gone.r, 0);
  assert.equal(gone.x, full[2].x);
});

test("an empty program draws nothing", () => {
  assert.deepEqual(view.layout({ nodes: [], edges: [], groups: [] }, view.newSlots()), []);
});

test("a real run lights the boxes, waits on the person, then finishes", () => {
  const state = view.indexProject(expense, { status: new Map() });
  const said = [];
  let waitingSeen = false;
  for (const event of run) {
    said.push(...view.applyEvent(state, event));
    if (state.status.get("review") === "waiting") waitingSeen = true;
  }
  assert.ok(waitingSeen, "the approval box never showed as waiting");
  assert.ok(said.includes("p attention"));
  assert.ok(said.includes('s "Waiting for you: Asks a person to approve or reject the total"'));
  assert.equal(said.at(-1), 's "Finished"');
  for (const box of ["intake", "review", "record"]) assert.equal(state.status.get(box), "done", box);
});

test("a group is not marked done on its first inner step", () => {
  const state = view.indexProject(expense, { status: new Map() });
  view.applyEvent(state, { kind: "node_started", node: "review.ask" });
  view.applyEvent(state, { kind: "node_completed", node: "review.ask" });
  assert.equal(state.status.get("review"), "running");
  view.applyEvent(state, { kind: "node_completed", node: "review__out" });
  assert.equal(state.status.get("review"), "done");
});

test("status colours ride on the boxes", () => {
  const status = new Map([["intake", "done"], ["review", "waiting"], ["record", "failed"]]);
  const boxes = nodes(view.layout(expense, view.newSlots(), status));
  assert.deepEqual(boxes.map((b) => b.tone), ["good", "warn", "bad"]);
  assert.match(boxes[1].label, /waiting on you/);
});

test("a failure reads as one line, not a Rust error chain", () => {
  const state = view.indexProject(expense, { status: new Map() });
  const lines = view.applyEvent(state, {
    kind: "node_failed",
    node: "record.text",
    error: "cast failed: expected String\n  at weft_engine::run\n  at tokio::task",
  });
  assert.deepEqual(lines, ['s "Record failed: cast failed: expected String"']);
});

test("narration speaks about their agent, never about weft", () => {
  const bash = (command) => ({ name: "Bash", input: { command } });
  assert.equal(view.narrate(bash("weft describe-nodes --list")), "Looking for the right pieces");
  assert.equal(view.narrate(bash("weft validate")), "Checking it fits together");
  assert.equal(view.narrate(bash(`weft run --from 'add={"raw":"1,2"}'`)), "Trying one step with a made-up case");
  assert.equal(view.narrate(bash("weft run")), "Trying it out");
  assert.equal(view.narrate(bash("ls -R src")), "");
  assert.equal(view.narrate({ name: "Task", input: { subagent_type: "node-smith" } }), "Making a piece that doesn't exist yet");
  assert.equal(view.narrate({ name: "Write", input: { file_path: "/p/src/main.weft" } }), "Adding steps");
  assert.equal(view.narrate({ name: "ToolSearch", input: {} }), "");
});

test("Tangle's own words are cut to one sentence for the pill", () => {
  assert.equal(view.firstSentence("Now the rewrite without the database. Then a test."), "Now the rewrite without the database.");
  assert.equal(view.firstSentence(""), "");
  assert.ok(view.firstSentence("x".repeat(300)).length <= 110);
});

test("quoted labels cannot break the line protocol", () => {
  assert.equal(view.quote('say "hi"\nthen go'), `"say 'hi' then go"`);
});

test("a long chain wraps into rows of three so labels stay readable", () => {
  // Regression: the first live build drew six steps in one row and cut every
  // label to "sort tasks by due d...". Fixture: that build's parse.
  const tasks = fixture("tasks-parse.json").project;
  const boxes = nodes(view.layout(tasks, view.newSlots()));
  assert.equal(boxes.length, 6);
  const rows = new Set(boxes.map((b) => b.y));
  assert.equal(rows.size, 2);
  assert.ok(boxes.every((b) => b.w >= 0.25), "boxes too narrow for two lines of label");
});

test("the end of a build clears test-run colours", () => {
  // Tangle's last test run is often a deliberate bad input, and a working
  // agent should not end the build glowing red.
  const state = view.indexProject(expense, { status: new Map() });
  view.applyEvent(state, { kind: "node_failed", node: "intake.add", error: "bad input" });
  view.clearRun(state);
  assert.ok([...state.status.values()].every((s) => s === "idle"));
});
