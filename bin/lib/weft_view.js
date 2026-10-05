// weft-view's pure half: a weft program's parsed graph and its live run
// events in, Kyber lines out. No sockets, no processes, no clock, so a
// recorded parse and a recorded SSE stream are a test.
//
// What it is for: somebody who has never seen code watches an agent get built
// and then run, on the HUD, with no editor window. So the drawing is weft's
// "Simplified view" and less: one box per step with its plain-words label,
// arrows for what feeds what, and a colour for where the run is. No ports,
// no node types, no wiring detail.

"use strict";

// Kyber's Diagram animates by POSITION in the parts array: shape i at time t
// morphs into shape i at t+1, and a longer array is padded with zeroes. So a
// node inserted mid-array makes every later shape morph into its neighbour,
// and an appended one grows out of the top-left corner. Slots are therefore
// append-only and keyed: a step keeps its index for the life of the view, and
// a step that disappears leaves an invisible dot behind instead of a gap.
function newSlots() {
  return { keys: [], last: new Map() };
}

function slotFor(slots, key) {
  let index = slots.keys.indexOf(key);
  if (index === -1) {
    slots.keys.push(key);
    index = slots.keys.length - 1;
  }
  return index;
}

// "spend_credit" -> "Spend credit". Only used when Tangle left a step without
// a `_label`, which its own rules say never happens; this is the floor.
function humanize(id) {
  const words = String(id).replace(/[_-]+/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").trim();
  return words ? words[0].toUpperCase() + words.slice(1).toLowerCase() : String(id);
}

// The box a node is drawn as. A node inside a group is drawn as its outermost
// group: a non-technical viewer gets the group's name ("Charge their credit")
// rather than the four plumbing steps inside it.
// A group's boundary nodes (`review__in`, `review__out`) sit at the top level
// with an empty scope and name their group in `groupBoundary.groupId`, so the
// arrows between groups run door to door. Reading only `scope` dropped every
// arrow between groups (seen 2026-10-04 on Tangle's first build: three boxes
// stacked in one column, nothing connecting them).
function boxOf(node) {
  if (node.scope && node.scope.length) return node.scope[0];
  if (node.groupBoundary && node.groupBoundary.groupId) return node.groupBoundary.groupId;
  return node.id;
}

// Tangle gives every group a one-line description and usually no label. The
// description is the plainer of the two, so it wins when it fits the box: a
// chip shows two lines of about 22 characters at the panel's width.
const LABEL_FITS = 46;

function groupLabel(group, id) {
  if (group && group.label) return group.label;
  const said = group && typeof group.description === "string" ? group.description.trim() : "";
  if (said && said.length <= LABEL_FITS) return said;
  return humanize(id);
}

// Steps and arrows at the top level of the program.
function topLevel(project) {
  const nodes = Array.isArray(project.nodes) ? project.nodes : [];
  const groups = new Map();
  for (const g of Array.isArray(project.groups) ? project.groups : []) {
    if (g && g.id) groups.set(g.id, g);
  }
  const boxes = new Map();
  const nodeBox = new Map();
  for (const node of nodes) {
    if (!node || !node.id) continue;
    const box = boxOf(node);
    nodeBox.set(node.id, box);
    // A group's boundary nodes are its doors, not steps.
    if (node.groupBoundary) continue;
    if (!boxes.has(box)) {
      const label = box === node.id ? node.label || humanize(box) : groupLabel(groups.get(box), box);
      boxes.set(box, { id: box, label });
    }
  }
  const arrows = new Map();
  for (const edge of Array.isArray(project.edges) ? project.edges : []) {
    const from = nodeBox.get(edge.source);
    const to = nodeBox.get(edge.target);
    if (!from || !to || from === to || !boxes.has(from) || !boxes.has(to)) continue;
    arrows.set(`${from}>${to}`, { from, to });
  }
  return { boxes: [...boxes.values()], arrows: [...arrows.values()] };
}

// Left to right in the order things happen: a box's column is the longest
// path to it from a box nothing feeds. Loops exist in weft, so the walk is
// capped at one pass per box rather than trusting the graph to be acyclic.
function columns(boxes, arrows) {
  const column = new Map(boxes.map((b) => [b.id, 0]));
  for (let pass = 0; pass < boxes.length; pass += 1) {
    let moved = false;
    for (const { from, to } of arrows) {
      const want = column.get(from) + 1;
      if (want > column.get(to) && want < boxes.length) {
        column.set(to, want);
        moved = true;
      }
    }
    if (!moved) break;
  }
  return column;
}

const PER_BAND = 3;

const TONE = { running: "warn", waiting: "warn", done: "good", failed: "bad" };

// The parts array for Kyber's Diagram, from the graph and the run state.
//
// `status` maps a box id to idle | running | waiting | done | failed.
function layout(project, slots, status = new Map()) {
  const { boxes, arrows } = topLevel(project);
  const column = columns(boxes, arrows);
  const nColumns = Math.max(1, ...[...column.values()].map((c) => c + 1));
  const rows = new Map();
  // Rows keep the order boxes first appeared in, so a box added later lands
  // below the ones already there instead of reshuffling them. Slots are handed
  // out in program order first: assigning them inside the sort comparator
  // gave out slot 0 to whichever box the sort happened to ask about first.
  for (const box of boxes) slotFor(slots, `n:${box.id}`);
  const ordered = [...boxes].sort((a, b) => slotFor(slots, `n:${a.id}`) - slotFor(slots, `n:${b.id}`));
  for (const box of ordered) {
    const c = column.get(box.id);
    if (!rows.has(c)) rows.set(c, []);
    rows.get(c).push(box);
  }
  // Long chains wrap into bands of PER_BAND columns. Six in one row on the
  // 560-point panel cut every label to "sort tasks by due d..." (first live
  // build, 2026-10-04); three across leaves two readable lines per box.
  const across = Math.min(nColumns, PER_BAND);
  const bands = Math.ceil(nColumns / PER_BAND);
  const tallest = Math.max(1, ...[...rows.values()].map((r) => r.length));
  const w = Math.min(0.8 / across, 0.26);
  const h = Math.min(0.7 / (tallest * bands), 0.22);
  const at = new Map();
  for (const [c, list] of rows) {
    const band = Math.floor(c / PER_BAND);
    list.forEach((box, r) => {
      at.set(box.id, {
        band,
        x: ((c % PER_BAND) + 0.5) / across,
        y: (band + (r + 0.5) / list.length) / bands,
      });
    });
  }

  const shapes = new Map();
  for (const box of boxes) {
    const p = at.get(box.id);
    const state = status.get(box.id) || "idle";
    const label = state === "waiting" ? `${box.label} (waiting on you)` : box.label;
    const shape = { t: "node", x: round(p.x), y: round(p.y), w: round(w), h: round(h), label };
    if (TONE[state]) shape.tone = TONE[state];
    shapes.set(`n:${box.id}`, shape);
  }
  for (const { from, to } of arrows) {
    const a = at.get(from);
    const b = at.get(to);
    // Side to side within a band; bottom to top when the flow wraps to the
    // next band, so the arrow does not cut back across the row it left.
    const wraps = a.band !== b.band;
    shapes.set(`e:${from}>${to}`, {
      t: "arrow",
      x: round(wraps ? a.x : a.x + w / 2),
      y: round(wraps ? a.y + h / 2 : a.y),
      x2: round(wraps ? b.x : b.x - w / 2),
      y2: round(wraps ? b.y - h / 2 : b.y),
    });
  }
  // Assign slots for anything new, in a stable order: boxes, then arrows.
  for (const key of shapes.keys()) slotFor(slots, key);

  return slots.keys.map((key) => {
    const shape = shapes.get(key);
    if (shape) {
      slots.last.set(key, shape);
      return shape;
    }
    // Gone. An invisible dot where it was holds the slot, so nothing after
    // it morphs into the wrong shape.
    const was = slots.last.get(key) || { x: 0.5, y: 0.5 };
    return { t: "dot", x: was.x, y: was.y, r: 0 };
  });
}

function round(n) {
  return Math.round(n * 1000) / 1000;
}

// One quoted string for the line protocol: the parser splits on whitespace
// and reads a double-quoted run as one token.
function quote(text) {
  return `"${String(text).replace(/\s+/g, " ").replace(/"/g, "'").trim()}"`;
}

// The first useful line of a failure, for the pill. A Rust error chain is
// for the run log, not for somebody watching.
function plainError(error) {
  const text = typeof error === "string" ? error : JSON.stringify(error || "");
  const first = text.split("\n").find((l) => l.trim()) || "something went wrong";
  return first.length > 90 ? `${first.slice(0, 87)}...` : first;
}

// Live events from `/events/project/{id}` -> state changes and HUD lines.
//
// `state` is { status: Map<boxId, string>, labels: Map<boxId, string>,
// boxOf: Map<nodeId, boxId> }. Returns the lines to send; mutates `state`.
function applyEvent(state, event) {
  const lines = [];
  const box = event.node ? state.boxOf.get(event.node) || event.node : null;
  const label = box ? state.labels.get(box) || humanize(box) : "";
  switch (event.kind) {
    case "execution_started":
      for (const id of state.status.keys()) state.status.set(id, "idle");
      lines.push("p acting");
      break;
    case "node_started":
    case "node_resumed":
      if (box) state.status.set(box, "running");
      if (label) lines.push(`s ${quote(label)} step=true`);
      break;
    case "node_suspended":
      if (box) state.status.set(box, "waiting");
      lines.push("p attention");
      if (label) lines.push(`s ${quote(`Waiting for you: ${label}`)}`);
      break;
    case "node_completed":
      // A plain step is done when it completes. A group is done when its out
      // door does: marking it done on its first inner step would flash green
      // while the rest of it is still working.
      if (box && (box === event.node || state.outDoors.has(event.node))) state.status.set(box, "done");
      break;
    case "node_failed":
      if (box) state.status.set(box, "failed");
      lines.push(`s ${quote(`${label} failed: ${plainError(event.error)}`)}`);
      break;
    case "node_skipped":
    case "node_cancelled":
      if (box && box === event.node) state.status.set(box, "idle");
      break;
    case "execution_completed":
      for (const [id, s] of state.status) if (s === "running") state.status.set(id, "done");
      lines.push("p done", `s ${quote("Finished")}`);
      break;
    case "execution_failed":
      lines.push("p failed", `s ${quote("It stopped on an error")}`);
      break;
    case "execution_cancelled":
      lines.push("p dormant", `s ${quote("Stopped")}`);
      break;
    default:
      return lines;
  }
  return lines;
}

// Rebuild the id maps after every parse, so events name the right boxes.
function indexProject(project, state) {
  const { boxes } = topLevel(project);
  state.labels = new Map(boxes.map((b) => [b.id, b.label]));
  state.boxOf = new Map();
  state.outDoors = new Set();
  for (const node of Array.isArray(project.nodes) ? project.nodes : []) {
    if (!node || !node.id) continue;
    state.boxOf.set(node.id, boxOf(node));
    if (node.groupBoundary && node.groupBoundary.role === "Out") state.outDoors.add(node.id);
  }
  for (const id of state.labels.keys()) if (!state.status.has(id)) state.status.set(id, "idle");
  return state;
}

// Tangle's first box lands about a minute in (62 s on the first measured
// build, 2026-10-04), and somebody watching a blank panel for a minute
// concludes it is broken. Its tool calls come every two seconds or so (85 in
// 180 s), so each one becomes a phrase on the pill. Phrases are about what is
// happening to THEIR agent, never about weft: "Looking for the right pieces",
// not "weft describe-nodes --list".

const WEFT_VERBS = [
  [/^weft describe-nodes/, "Looking for the right pieces"],
  [/^weft (validate|parse)/, "Checking it fits together"],
  [/^weft build/, "Putting it together"],
  [/^weft run\b.*--from/, "Trying one step with a made-up case"],
  [/^weft run/, "Trying it out"],
  [/^weft test-node/, "Testing one step on its own"],
  [/^weft (events|executions|logs|follow|status|ps)/, "Reading what happened"],
  [/^weft freeze/, "Saving a case that worked"],
  [/^weft diff/, "Comparing with the last good run"],
  [/^weft (checkpoint|branch|tree)/, "Saving this version"],
];

const HELPERS = {
  "node-smith": "Making a piece that doesn't exist yet",
  "prompt-engineer": "Writing the instructions for the AI step",
  "red-teamer": "Trying to break it before you use it",
  "run-digger": "Working out why a run went wrong",
  "frontend-builder": "Building a page for it",
  deployer: "Getting it ready to go live",
};

// One phrase for one tool call, or "" for plumbing nobody needs to see.
function narrate(block) {
  const name = (block && block.name) || "";
  const input = (block && block.input) || {};
  if (name === "Bash") {
    const command = String(input.command || "").trim();
    for (const [pattern, phrase] of WEFT_VERBS) if (pattern.test(command)) return phrase;
    return "";
  }
  if (name === "Task" || name === "Agent") {
    return HELPERS[input.subagent_type] || "Handing one part to a helper";
  }
  if (name === "Edit" || name === "Write" || name === "MultiEdit") {
    const file = String(input.file_path || "");
    if (file.endsWith(".weft")) return "Adding steps";
    if (/\/nodes\//.test(file)) return "Making a new kind of step";
    if (/\/assets\//.test(file)) return "Writing what one step does";
    if (/\/front\//.test(file)) return "Building a page for it";
    return "";
  }
  if (name === "Skill" && /^weft/.test(String(input.skill || ""))) return "Reading up on how to build this";
  if (name === "Read" || name === "Grep" || name === "Glob") return "Looking at what's there";
  return "";
}

// Tangle's own words, cut to one line for the pill. It talks "like a
// coworker" by its own rules, so its first sentence is usually the best
// narration there is.
function firstSentence(text) {
  const line = String(text || "").replace(/\s+/g, " ").trim();
  if (!line) return "";
  const end = line.search(/[.!?](\s|$)/);
  const sentence = end === -1 ? line : line.slice(0, end + 1);
  return sentence.length > 110 ? `${sentence.slice(0, 107)}...` : sentence;
}

// After a build, the colours on screen belong to Tangle's test runs, and the
// last one is often a deliberate bad input (a task with no due date, on the
// first live build). Left up, a working agent ends the build glowing red.
function clearRun(state) {
  for (const id of state.status.keys()) state.status.set(id, "idle");
}

module.exports = {
  clearRun,
  newSlots,
  layout,
  applyEvent,
  indexProject,
  humanize,
  quote,
  topLevel,
  columns,
  narrate,
  firstSentence,
};
