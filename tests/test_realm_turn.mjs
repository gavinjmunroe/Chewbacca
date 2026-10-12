// The agent turn as a typed state machine (bin/lib/realm_ui/glass/turn.mjs),
// checked the way Daniel Thomas would: invalid states can't be built, every
// failure is a named value, and the resting view doesn't grow with the work.
// Caleb, 2026-10-11 8:42pm: "Make this how daniel thomas would".
import test from "node:test";
import assert from "node:assert/strict";
import * as t from "../bin/lib/realm_ui/glass/turn.mjs";

const ev = (seq, type, payload, ts = seq * 1000) => ({
  seq,
  sessionId: "s",
  event: { type, ts, payload },
});
const run = (events, from = t.emptyAgent()) =>
  events.reduce((a, e) => t.step(a, e), from);

// One whole turn, the way realm writes it: asked, read, edit, test, settle.
const turnEvents = (n, seq = n * 10) => [
  ev(seq, "user_message", { text: `fix bug ${n}` }),
  ev(seq + 1, "status", { status: "running" }),
  ev(seq + 2, "tool_call", {
    toolUseId: `r${n}`,
    name: "Read",
    input: { file_path: "/w/src/a.ts" },
  }),
  ev(seq + 3, "tool_result", { toolUseId: `r${n}`, content: "..." }),
  ev(seq + 4, "tool_call", {
    toolUseId: `e${n}`,
    name: "Edit",
    input: { file_path: "/w/src/a.ts", old_string: "a", new_string: "b" },
  }),
  ev(seq + 5, "tool_result", { toolUseId: `e${n}`, content: "ok" }),
  ev(seq + 6, "tool_call", {
    toolUseId: `t${n}`,
    name: "Bash",
    input: { command: "node --test tests/a.mjs" },
  }),
  ev(seq + 7, "tool_result", {
    toolUseId: `t${n}`,
    content: "# pass 4\n# fail 0",
  }),
  ev(seq + 8, "assistant_text", {
    text: `Fixed bug ${n}. It was an off by one.`,
  }),
  ev(seq + 9, "status", { status: "idle" }),
];

// ------------------------------------------------- 1. invalid states can't be drawn

test("a turn walks asked, reading, changing, proved, done from realm's events", () => {
  const seen = [];
  let a = t.emptyAgent();
  for (const e of turnEvents(1)) {
    a = t.step(a, e);
    if (a.turn && seen[seen.length - 1] !== a.turn.phase)
      seen.push(a.turn.phase);
    assert.equal(a.refused, null, `${e.event.type} was refused`);
  }
  assert.deepEqual(seen, ["asked", "reading", "changing", "proved", "done"]);
  assert.equal(t.word(a.turn), "Done");
  assert.equal(a.turn.tests.counts.passed, 4);
});

test("the invalid states throw at construction, so they can't reach the screen", () => {
  assert.throws(() => t.Turn.changing("x", { path: "" }), /needs the file/);
  assert.throws(() => t.Turn.changing("x", null), /needs the file/);
  assert.throws(() => t.Turn.proved("x", { command: "" }), /needs the tests/);
  assert.throws(() => t.Turn.reading("x", "  "), /needs what/);
  assert.throws(
    () => t.Turn.needsYou("x", "", t.Turn.asked("x")),
    /needs the question/,
  );
  assert.throws(
    () => t.Turn.needsYou("x", "ok?", t.Turn.done("x")),
    /working turn/,
  );
  assert.throws(
    () => t.Turn.done("x", { review: { files: [] } }),
    /review needs a file/,
  );
  assert.throws(
    () => t.Turn.done("x", { review: { files: [{ path: "a", hunks: [] }] } }),
    /with a hunk/,
  );
  assert.throws(() => t.Turn.failed("x", { name: "made-up" }), /named fault/);
});

test("a Keep with no hunk can't exist: a review of hunks with no changed line is null", () => {
  const ctx = { kind: "context", text: "same" };
  assert.equal(t.reviewOf("/w", []), null);
  assert.equal(t.reviewOf("/w", [{ path: "a.ts", hunks: [] }]), null);
  assert.equal(
    t.reviewOf("/w", [{ path: "a.ts", hunks: [{ lines: [ctx] }] }]),
    null,
  );
  const r = t.reviewOf("/w", [
    {
      path: "a.ts",
      hunks: [{ lines: [ctx, { kind: "add", text: "x" }] }, { lines: [ctx] }],
    },
    { path: "b.ts", hunks: [] },
  ]);
  assert.deepEqual(
    r.files.map((f) => [f.path, f.hunks.length]),
    [["a.ts", 1]],
  );
});

test("an edit with no path is not a changing turn with no file", () => {
  const a = run([
    ev(1, "user_message", { text: "go" }),
    ev(2, "tool_call", {
      toolUseId: "x",
      name: "Edit",
      input: { old_string: "a", new_string: "b" },
    }),
  ]);
  assert.equal(a.turn.phase, "asked");
});

test("Done is never drawn while realm or the tab says the turn is running", () => {
  const imported = {
    id: "s1",
    title: "TTS logo",
    status: "idle",
    providerSessionId: "p1",
    updatedAt: 1,
  };
  // Before the tab is read: nothing, rather than realm's stale "idle".
  assert.equal(t.tileTurn(imported, undefined, undefined, false), null);
  assert.equal(
    t.word(
      t.tileTurn(imported, undefined, { state: "running", lastAt: 5 }, true),
    ),
    "Starting",
  );
  // The tab couldn't be read: a named fault, never Done.
  const unread = t.tileTurn(imported, undefined, { state: "unreadable", lastAt: null, detail: "EACCES" }, true);
  assert.equal(unread.phase, "failed");
  assert.equal(unread.fault.name, "tab-unreadable");
  assert.equal(unread.fault.detail, "EACCES");
  // No transcript on this Mac at all (a Codex session): realm's status speaks.
  assert.equal(t.word(t.tileTurn(imported, undefined, null, true)), "Done");
  assert.equal(
    t.word(
      t.tileTurn(
        { ...imported, status: "running" },
        undefined,
        { state: "done" },
        true,
      ),
    ),
    "Starting",
  );
  // A live realm turn wins, and only the engine's settle reaches done.
  const mid = run(turnEvents(1).slice(0, 6));
  assert.equal(
    t.word(t.tileTurn(imported, mid, { state: "done" }, true)),
    "Changing",
  );
});

test("a settled turn moves nowhere: a late event is refused as a value, not applied", () => {
  const done = run(turnEvents(1));
  const late = t.step(
    done,
    ev(200, "tool_call", {
      toolUseId: "z",
      name: "Edit",
      input: { file_path: "/w/a.ts", old_string: "a", new_string: "b" },
    }),
  );
  assert.equal(late.turn, done.turn);
  assert.equal(late.refused, "done -> changing");
  for (const p of ["done", "failed"]) assert.deepEqual(t.NEXT[p], []);
  for (const p of t.PHASES) assert.ok(p in t.NEXT, p);
});

test("needs-you pauses the working turn and resumes it, and never forgets it", () => {
  const a = run([
    ...turnEvents(1).slice(0, 5),
    ev(60, "permission_request", {
      requestId: "q",
      toolName: "Bash",
      title: "Run rm -rf build?",
    }),
  ]);
  assert.equal(a.turn.phase, "needs-you");
  assert.equal(a.turn.question, "Run rm -rf build?");
  assert.equal(a.turn.resume.phase, "changing");
  const b = t.step(a, ev(61, "permission_response", { requestId: "q" }));
  assert.equal(b.turn.phase, "changing");
});

test("match is exhaustive: a missing arm or an unknown phase throws, no default hides it", () => {
  const all = Object.fromEntries(t.PHASES.map((p) => [p, () => p]));
  assert.equal(t.match(t.Turn.asked("x"), all), "asked");
  const { proved: _p, ...missing } = all;
  assert.throws(
    () => t.match(t.Turn.asked("x"), missing),
    /no arm for "proved"/,
  );
  assert.throws(
    () => t.match(t.Turn.asked("x"), { ...all, paused: () => 0 }),
    /"paused" is not a phase/,
  );
  assert.throws(
    () => t.match({ phase: "paused" }, all),
    /"paused" is not a phase/,
  );
});

test("no switch in the glass layer has a default branch over a turn's phase", async () => {
  const { readFileSync, readdirSync } = await import("node:fs");
  const dir = new URL("../bin/lib/realm_ui/glass/", import.meta.url);
  for (const name of readdirSync(dir)) {
    if (!/\.(tsx|mjs)$/.test(name)) continue;
    const src = readFileSync(new URL(name, dir), "utf8");
    assert.doesNotMatch(
      src,
      /switch\s*\([^)]*\.phase\)/,
      `${name} switches on .phase; use match()`,
    );
  }
});

// ------------------------------------------------- 3. errors are values

test("every fault has a name, what happened and the one thing to do", () => {
  const names = Object.keys(t.FAULTS);
  for (const n of [
    "engine-down",
    "file-unreadable",
    "git-refused",
    "timed-out",
    "tab-unreadable",
    "stalled",
    "agent-error",
  ])
    assert.ok(names.includes(n), n);
  for (const n of names) {
    const f = t.fault(n, "detail");
    assert.ok(f.what.endsWith("."), n);
    assert.ok(
      f.fix.length > 4 && f.fix.split(/[.!?]\s/).length <= 2,
      `${n}: one thing to do`,
    );
  }
  assert.throws(() => t.fault("unnamed"), /no words/);
});

test("an agent error becomes a failed turn carrying realm's own fix when it names one", () => {
  const a = run([
    ev(1, "user_message", { text: "go" }),
    ev(2, "error", {
      message: "401 Unauthorized",
      failure: "auth",
      fix: { title: "Sign in", hint: "Run claude login.", command: null },
    }),
  ]);
  assert.equal(a.turn.phase, "failed");
  // realm says it's an auth failure: the named signed-out state, its fix kept.
  assert.equal(a.turn.fault.name, "signed-out");
  assert.equal(a.turn.fault.fix, "Run claude login.");
  assert.equal(a.turn.fault.detail, "401 Unauthorized");
});

test("settle: a call that never answers is a timed-out fault, never a spinner forever", async () => {
  const never = new Promise(() => {});
  const r = await t.settle(never, "engine-down", 20);
  assert.equal(r.ok, false);
  assert.equal(r.fault.name, "timed-out");
  const bad = await t.settle(
    Promise.reject(new Error("ECONNREFUSED")),
    "engine-down",
    1000,
  );
  assert.equal(bad.fault.name, "engine-down");
  assert.equal(bad.fault.detail, "ECONNREFUSED");
  const good = await t.settle(Promise.resolve(7), "engine-down", 1000);
  assert.deepEqual({ ...good }, { ok: true, value: 7 });
});

// ------------------------------------------------- 4. context rot

const fleet = (agents, turns) => {
  const sessions = [];
  const states = {};
  for (let i = 0; i < agents; i++) {
    const id = `s${i}`;
    sessions.push({
      id,
      title: `Agent ${i} on a long task title that goes on`,
      status: "idle",
      agentKind: "claude",
      updatedAt: i,
    });
    let a = t.emptyAgent();
    for (let n = 0; n < turns; n++)
      for (const e of turnEvents(n)) a = t.step(a, e);
    // The last agent is mid-turn and two are waiting on him.
    if (i === 0) a = run(turnEvents(turns).slice(0, 5), a);
    if (i === 1 || i === 2)
      a = run(
        [
          ...turnEvents(turns).slice(0, 5),
          ev(99999, "permission_request", { title: `May agent ${i} push?` }),
        ],
        a,
      );
    states[id] = a;
  }
  return { sessions, states };
};
const size = (v) =>
  JSON.stringify(v, (k, x) => (k === "turn" ? undefined : x)).length;

test("20 agents with 200 turns each rest in the same view as 9 agents with 6", () => {
  const big = fleet(20, 200);
  const small = fleet(9, 6);
  const B = t.restingView(big.sessions, big.states, {}, true);
  const S = t.restingView(small.sessions, small.states, {}, true);
  assert.equal(B.tiles.length, t.MAX_TILES);
  assert.equal(B.tiles.length, S.tiles.length);
  assert.equal(B.waiting.length, S.waiting.length);
  assert.equal(B.moreAgents, 11);
  // Every tile is one line, and the whole view is within a fixed budget.
  for (const tile of B.tiles)
    assert.ok(
      tile.line.length <= t.FOLD_CHARS && !tile.line.includes("\n"),
      tile.line,
    );
  assert.ok(size(B) <= size(S) + 16, `${size(B)} vs ${size(S)}`);
  // Needing him comes first, then working, then the rest.
  assert.deepEqual(
    B.tiles.slice(0, 3).map((x) => x.tone),
    ["needs", "needs", "running"],
  );
});

test("a focused agent holds its current turn whole and its last 5 turns as one line each", () => {
  const { states } = fleet(1, 200);
  const f = t.focusView(states.s0);
  assert.equal(f.turn.phase, "changing");
  assert.equal(f.folded.length, t.FOLD_KEEP);
  assert.equal(f.earlier, 200 - t.FOLD_KEEP);
  assert.match(f.folded[0], /^fix bug 199: done$/);
  for (const line of f.folded) assert.ok(line.length <= t.FOLD_CHARS);
  // Nothing inside an agent grows with turns: only the edit still in flight.
  assert.deepEqual(Object.keys(states.s0.inflight), ["e200"]);
  assert.ok(
    JSON.stringify(states.s0).length < 2000,
    String(JSON.stringify(states.s0).length),
  );
});

test("a transcript that can't be read is a named state, not the same null as no transcript", async () => {
  const { mkdtempSync, mkdirSync, writeFileSync, chmodSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { tabTruth, transcriptFinder } = await import("../bin/lib/realm_ui/tab_truth.mjs");
  const projects = mkdtempSync(join(tmpdir(), "turn-truth-"));
  mkdirSync(join(projects, "p"));
  const id = "11111111-2222-3333-4444-555555555555";
  const file = join(projects, "p", `${id}.jsonl`);
  writeFileSync(file, '{"type":"user","timestamp":"2026-10-11T20:00:00Z","message":{"content":"hi"}}\n');
  chmodSync(file, 0o000);
  const find = transcriptFinder(projects);
  try {
    const truth = tabTruth(id, find);
    assert.equal(truth.state, "unreadable");
    assert.match(truth.detail, /EACCES/);
    assert.equal(t.turnFromTruth(truth, "x").fault.name, "tab-unreadable");
    assert.equal(tabTruth("99999999-2222-3333-4444-555555555555", find), null);
  } finally {
    chmodSync(file, 0o644);
  }
});

test("inside one turn, past beats fold to one line each and 200 tool calls rest at five lines", () => {
  let a = run([ev(1, "user_message", { text: "refactor everything" })]);
  for (let i = 0; i < 200; i++) {
    a = t.step(a, ev(10 + i * 2, "tool_call", { toolUseId: `c${i}`, name: "Edit", input: { file_path: `/w/src/f${i}.ts`, old_string: "a", new_string: "b" } }));
    a = t.step(a, ev(11 + i * 2, "tool_result", { toolUseId: `c${i}`, content: "ok" }));
  }
  a = t.step(a, ev(900, "tool_call", { toolUseId: "b", name: "Bash", input: { command: "git status", description: "Check the tree" } }));
  a = t.step(a, ev(901, "tool_result", { toolUseId: "b", content: "x\n".repeat(5000) + "clean" }));
  const f = t.focusView(a);
  // The current beat is the command, whole, with only its last lines.
  assert.equal(f.turn.phase, "reading");
  assert.equal(f.turn.command.tail.length, 10);
  assert.equal(f.turn.command.tail[9], "clean");
  assert.deepEqual(f.trail, ["Changed f199.ts", "Changed f198.ts", "Changed f197.ts", "Changed f196.ts", "Changed f195.ts"]);
  assert.equal(f.trailEarlier, 195);
  assert.ok(JSON.stringify(a).length < 3000, String(JSON.stringify(a).length));
  // A new turn starts a clean trail and folds this one to a single line.
  const b = t.step(a, ev(1000, "user_message", { text: "now the docs" }));
  assert.deepEqual(b.trail, []);
  assert.equal(b.folded[0], "refactor everything: reading");
});

test("a failing test run keeps its verdict and its first failing lines, nothing else", () => {
  const a = run([
    ev(1, "user_message", { text: "go" }),
    ev(2, "tool_call", { toolUseId: "t", name: "Bash", input: { command: "pytest -q" } }),
    ev(3, "tool_result", { toolUseId: "t", isError: true, content: "FAILED a::b\n".repeat(50) + "3 passed, 2 failed" }),
  ]);
  assert.equal(t.word(a.turn), "Tests failed");
  assert.deepEqual(a.turn.tests.counts, { passed: 3, failed: 2 });
  assert.equal(a.turn.tests.failing.length, 6);
});

test("a match() that misses a phase doesn't compile (turn.d.mts), like a Rust match", async (t2) => {
  const { existsSync, mkdtempSync, writeFileSync, copyFileSync, readdirSync } = await import("node:fs");
  const { execFileSync } = await import("node:child_process");
  const { tmpdir, homedir } = await import("node:os");
  const { join } = await import("node:path");
  const pnpm = join(homedir(), "code/vendor/realm/node_modules/.pnpm");
  const dir = existsSync(pnpm) ? readdirSync(pnpm).find((d) => d.startsWith("typescript@")) : null;
  const tsc = dir ? join(pnpm, dir, "node_modules/typescript/bin/tsc") : null;
  if (!tsc || !existsSync(tsc)) return t2.skip("no typescript in a realm checkout");
  const work = mkdtempSync(join(tmpdir(), "turn-tsc-"));
  copyFileSync(new URL("../bin/lib/realm_ui/glass/turn.d.mts", import.meta.url), join(work, "turn.d.mts"));
  const arms = (drop) =>
    ["asked", "reading", "changing", "proved", "needs-you", "done", "failed"]
      .filter((p) => p !== drop)
      .map((p) => `"${p}": () => 1,`)
      .join(" ");
  const check = (name, src) => {
    writeFileSync(join(work, name), `import { match, Turn } from "./turn.mjs";\ndeclare const t: ReturnType<typeof Turn.asked>;\n${src}\n`);
    try {
      execFileSync(process.execPath, [tsc, "--noEmit", "--strict", "--module", "nodenext", "--moduleResolution", "nodenext", "--target", "es2022", join(work, name)], { encoding: "utf8" });
      return "";
    } catch (e) {
      return String(e.stdout);
    }
  };
  assert.equal(check("whole.mts", `match(t, { ${arms("")} });`), "");
  assert.match(check("missing.mts", `match(t, { ${arms("proved")} });`), /Property '"?proved"?' is missing/);
});

test("nothing in the glass layer swallows an error", async () => {
  const { readFileSync, readdirSync } = await import("node:fs");
  const root = new URL("../bin/lib/realm_ui/", import.meta.url);
  const files = [
    ...readdirSync(new URL("glass/", root)).filter((n) => /\.(tsx|mjs)$/.test(n)).map((n) => `glass/${n}`),
    "glass_routes.mjs",
    "tab_truth.mjs",
  ];
  const bad = [];
  for (const f of files) {
    const src = readFileSync(new URL(f, root), "utf8");
    const lines = src.split("\n");
    lines.forEach((line, i) => {
      // A promise catch that answers with nothing, unless it says why that's expected.
      if (/\.catch\(\s*\(\)\s*=>\s*(\{\s*\}|false|null|undefined|\[\][^)]*)\s*\)/.test(line) && !/Expected:/.test(line))
        bad.push(`${f}:${i + 1}: ${line.trim()}`);
    });
    // A catch block with no statement in it, unless its comment says why.
    for (const m of src.matchAll(/catch\s*(\([^)]*\))?\s*\{([^{}]*)\}/g)) {
      const inner = m[2].replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, "").trim();
      if (!inner && !/Expected:/.test(m[2])) {
        const at = src.slice(0, m.index).split("\n").length;
        bad.push(`${f}:${at}: empty catch`);
      }
    }
  }
  assert.deepEqual(bad, []);
});

// ------------------------------------------------- 5. zero cost at rest

test("at rest is decided from the view: settled agents rest, one working one doesn't", () => {
  const settled = fleet(20, 3);
  for (const id of ["s0", "s1", "s2"]) settled.states[id] = run(turnEvents(9), settled.states[id]);
  assert.equal(t.atRest(t.restingView(settled.sessions, settled.states, {}, true)), true);
  assert.equal(t.atRest(t.restingView(fleet(20, 3).sessions, fleet(20, 3).states, {}, true)), false);
});

test("nothing in the layer's stylesheet loops except the live-work signal", async () => {
  const { readFileSync } = await import("node:fs");
  const css = readFileSync(new URL("../bin/lib/realm_ui/glass/glass.css", import.meta.url), "utf8");
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*infinite[^{}]*)\}/g))
    assert.match(m[1], /running|live|working/, `loops at rest: ${m[1].trim()}`);
});

test("every timing constant in the layer carries its evidence, measured or said to be a guess", async () => {
  const { readFileSync } = await import("node:fs");
  for (const f of ["GlassLayer.tsx", "turn.mjs"]) {
    const src = readFileSync(new URL(`../bin/lib/realm_ui/glass/${f}`, import.meta.url), "utf8");
    const lines = src.split("\n");
    lines.forEach((line, i) => {
      const m = /^(?:export )?const ([A-Z_]+_(?:MS|KEEP|CHARS|TILES)) =/.exec(line);
      if (!m) return;
      const above = [];
      // A block of constants shares the comment over its first line.
      for (let j = i - 1; j >= 0 && (/^\s*\/\//.test(lines[j]) || /^(?:export )?const [A-Z_]+ =/.test(lines[j])); j--)
        above.unshift(lines[j]);
      assert.match(above.join(" "), /[Mm]easured|[Gg]uessed|never measured|report\.md|design\.md/, `${f}: ${m[1]} has no evidence`);
    });
  }
});

test("pace: a burst of focus reports becomes the first and the newest, a second apart", () => {
  let clock = 0;
  const timers = [];
  const timer = { setTimeout: (fn, ms) => (timers.push({ fn, at: clock + ms }), timers.length - 1), clearTimeout: (i) => (timers[i] = null) };
  const p = t.pace(1000, timer, () => clock);
  const sent = [];
  for (let i = 0; i < 340; i++) {
    clock = i * 176; // 340 reorders in 60 s, as measured
    p.push(() => sent.push(i));
    for (const [k, tm] of timers.entries()) if (tm && tm.at <= clock) (timers[k] = null), tm.fn();
  }
  clock = 61000;
  for (const [k, tm] of timers.entries()) if (tm && tm.at <= clock) (timers[k] = null), tm.fn();
  assert.ok(sent.length <= 61, `${sent.length} reports`);
  assert.equal(sent[0], 0);
  assert.equal(sent[sent.length - 1], 339);
});

test("a tab the server had no answer for is drawn from realm's status, not hidden", () => {
  const sessions = [
    { id: "a", title: "Codex tab", status: "idle", providerSessionId: "fake-01M4", updatedAt: 2 },
    { id: "b", title: "Claude tab", status: "idle", providerSessionId: "11111111-2222-3333-4444-555555555555", updatedAt: 1 },
  ];
  // Before any answer: neither is drawn (realm's idle may be stale).
  assert.equal(t.restingView(sessions, {}, {}, false).tiles.length, 0);
  // The answer names only the Claude id; GlassLayer fills the rest with null.
  const truths = { "fake-01M4": null, "11111111-2222-3333-4444-555555555555": { state: "running", lastAt: 9 } };
  const v = t.restingView(sessions, {}, truths, true);
  assert.deepEqual(v.tiles.map((x) => [x.title, x.word]), [["Claude tab", "Starting"], ["Codex tab", "Done"]]);
});

test("realm's idle between the message and the first running is not the turn settling", () => {
  const a = run([
    ev(1, "user_message", { text: "fix it" }),
    ev(2, "init", { providerSessionId: "x" }),
    ev(3, "status", { status: "idle" }),
    ev(4, "status", { status: "running" }),
    ev(5, "tool_call", { toolUseId: "r", name: "Read", input: { file_path: "/w/a.ts" } }),
  ]);
  assert.equal(a.turn.phase, "reading");
  assert.equal(a.refused, null);
  assert.equal(t.word(t.step(a, ev(6, "status", { status: "idle" })).turn), "Done");
});
