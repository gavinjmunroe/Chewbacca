// Realm on the glass: the agent-following model and the glass routes.
//
// bin/lib/realm_ui/glass/model.mjs decides what the stage beside the
// conversation shows, from realm's own session events; glass_routes.mjs is
// realm-ui's file view, voice channel and hunk Reject. Caleb, 2026-10-11:
// "the layout follows the agent ... Nothing sits on screen with nothing on it",
// and every write is a press that says what it changes first.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  writeFileSync,
  readFileSync,
  realpathSync,
  mkdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import * as m from "../bin/lib/realm_ui/glass/model.mjs";
import {
  hunkPatch,
  rejectHunk,
  underHome,
  handleGlass,
  glassState,
  secretPath,
  FOCUS_FRESH_MS,
} from "../bin/lib/realm_ui/glass_routes.mjs";
import {
  turnFrom,
  tabTruth,
  transcriptFinder,
  idsFrom,
  STALE_MS,
} from "../bin/lib/realm_ui/tab_truth.mjs";

const ev = (seq, type, payload, ts = seq * 1000) => ({
  seq,
  sessionId: "s",
  event: { type, ts, payload },
});

test("a test command is told from an ordinary one", () => {
  for (const c of [
    "pytest -q",
    "python3 tests/test_realm_ui.py",
    "npx vitest run settings",
    "node --test tests/x.mjs",
    "swift test --filter A",
    "pnpm test",
    "bash tests/run.sh hud",
    "go test ./...",
  ]) {
    assert.ok(m.isTestCommand(c), c);
  }
  for (const c of [
    "npx tsc --noEmit",
    "git status",
    "ls tests",
    "npm run build",
  ])
    assert.ok(!m.isTestCommand(c), c);
});

test("test counts read pytest, vitest, node --test and unittest", () => {
  assert.deepEqual(m.testCounts("== 3 passed, 1 failed in 0.2s =="), {
    passed: 3,
    failed: 1,
  });
  assert.deepEqual(m.testCounts("Tests  4 passed (4)"), {
    passed: 4,
    failed: 0,
  });
  assert.deepEqual(m.testCounts("# pass 12\n# fail 0\n"), {
    passed: 12,
    failed: 0,
  });
  assert.deepEqual(m.testCounts("Ran 9 tests in 0.1s\n\nFAILED (failures=2)"), {
    passed: 7,
    failed: 2,
  });
  assert.equal(m.testCounts("hello"), null);
});

test("an edit is lit at the lines it wrote, inside a window of context", () => {
  const text =
    Array.from({ length: 60 }, (_, i) => `line ${i + 1}`).join("\n") + "\n";
  const r = m.litRange(text, "line 30\nline 31\n");
  assert.deepEqual(r, { start: 30, end: 31 });
  const w = m.excerpt(text, r, { context: 3, max: 28 });
  assert.equal(w.first, 27);
  assert.deepEqual(w.lines, [
    "line 27",
    "line 28",
    "line 29",
    "line 30",
    "line 31",
    "line 32",
    "line 33",
    "line 34",
  ]);
  assert.equal(m.litRange(text, "not there"), null);
});

test("an edit is lit wherever it is, read before or after it landed", () => {
  const edit = { before: "a = 1\n", after: "a = 2\nb = 3\n" };
  const old = "x\na = 1\ny\n";
  const now = "x\na = 2\nb = 3\ny\n";
  assert.deepEqual(m.editRange(old, edit, false), { range: { start: 2, end: 2 }, landed: false });
  // Read after the edit landed while the call is still open: the written lines.
  assert.deepEqual(m.editRange(now, edit, false), { range: { start: 2, end: 3 }, landed: true });
  assert.deepEqual(m.editRange(now, edit, true), { range: { start: 2, end: 3 }, landed: true });
  // Read before the write while the call says done: the lines it replaces.
  assert.deepEqual(m.editRange(old, edit, true), { range: { start: 2, end: 2 }, landed: false });
  assert.deepEqual(m.editRange("nothing", edit, true), { range: null, landed: true });
});

test("the stage follows one turn: file while editing, command while running, then only the diff", () => {
  let s = m.emptyStage();
  s = m.reduce(s, ev(1, "user_message", { text: "fix it", attachments: [] }));
  assert.deepEqual(
    m.visible(s, 1000),
    [],
    "nothing on screen with nothing on it",
  );
  s = m.reduce(
    s,
    ev(2, "tool_call", {
      toolUseId: "e1",
      name: "Edit",
      input: { file_path: "a.ts", old_string: "x", new_string: "y" },
      parentToolUseId: null,
    }),
  );
  assert.deepEqual(m.visible(s, 2000), ["file"]);
  assert.equal(s.file.done, false);
  s = m.reduce(
    s,
    ev(3, "tool_result", { toolUseId: "e1", content: "ok", isError: false }),
  );
  assert.equal(s.file.done, true);
  s = m.reduce(
    s,
    ev(4, "tool_call", {
      toolUseId: "b1",
      name: "Bash",
      input: { command: "npx tsc --noEmit" },
      parentToolUseId: null,
    }),
  );
  assert.deepEqual(m.visible(s, 4000), ["file", "command"]);
  s = m.reduce(
    s,
    ev(
      5,
      "tool_result",
      { toolUseId: "b1", content: "", isError: false },
      5000,
    ),
  );
  assert.deepEqual(
    m.visible(s, 5000 + m.COMMAND_LINGER_MS - 1),
    ["file", "command"],
    "a finished command lingers",
  );
  assert.deepEqual(
    m.visible(s, 5000 + m.COMMAND_LINGER_MS + 1),
    ["file"],
    "then folds away",
  );
  s = m.reduce(s, ev(6, "status", { status: "idle" }));
  s = m.reduce(
    s,
    ev(7, "turn_changes", {
      checkpointId: "c",
      settledAt: 6,
      root: "/r",
      afterTree: "a".repeat(40),
      files: [{ path: "a.ts" }],
    }),
  );
  assert.deepEqual(
    m.visible(s, 9000),
    ["review"],
    "settled: the diff arrives and the rest goes",
  );
});

test("tests show only when run, and stay as the verdict beside the diff", () => {
  let s = m.reduce(m.emptyStage(), ev(1, "user_message", { text: "go" }));
  s = m.reduce(
    s,
    ev(2, "tool_call", {
      toolUseId: "t1",
      name: "Bash",
      input: { command: "pnpm vitest run settings" },
    }),
  );
  assert.deepEqual(m.visible(s, 2000), ["tests"]);
  s = m.reduce(
    s,
    ev(3, "tool_result", {
      toolUseId: "t1",
      content: "Tests  4 passed (4)",
      isError: false,
    }),
  );
  assert.deepEqual(s.tests.counts, { passed: 4, failed: 0 });
  s = m.reduce(s, ev(4, "status", { status: "idle" }));
  assert.deepEqual(m.visible(s, 99999), ["tests"]);
});

test("a status that did not change returns the same stage, so nothing re-renders", () => {
  const s = m.reduce(m.emptyStage(), ev(1, "status", { status: "idle" }));
  assert.equal(m.reduce(s, ev(2, "status", { status: "idle" })), s);
  assert.equal(
    m.reduce(s, ev(3, "assistant_delta", { messageId: "x", delta: "hi" })),
    s,
  );
});

test("tiles say what each agent is doing in words", () => {
  assert.equal(m.tileState({ status: "waiting_permission" }).word, "Needs you");
  assert.equal(m.tileState({ status: "running" }).tone, "running");
  assert.equal(m.tileState({ status: "error" }).word, "Failed");
  assert.equal(
    m.nowLine(
      ev(1, "tool_call", {
        name: "Edit",
        input: { file_path: "/x/web/lib/orgs.ts" },
      }),
    ),
    "Editing orgs.ts",
  );
  assert.equal(
    m.nowLine(
      ev(1, "tool_call", {
        name: "Bash",
        input: { command: "pytest", description: "" },
      }),
    ),
    "Testing: pytest",
  );
});

test("voice only fills or opens: palette, find, @ a file, else the reply draft", () => {
  assert.deepEqual(m.voiceIntent("open the command palette"), {
    kind: "palette",
    query: "",
  });
  assert.deepEqual(m.voiceIntent("palette dark mode"), {
    kind: "palette",
    query: "dark mode",
  });
  assert.deepEqual(m.voiceIntent("Open orgs.ts."), {
    kind: "palette",
    query: "orgs.ts",
  });
  assert.deepEqual(m.voiceIntent("find getOrgMembership"), {
    kind: "find",
    query: "getOrgMembership",
  });
  assert.deepEqual(m.voiceIntent("at orgs.ts"), {
    kind: "mention",
    name: "orgs.ts",
  });
  assert.deepEqual(m.voiceIntent("now add a test for the zero limit"), {
    kind: "draft",
    text: "now add a test for the zero limit",
  });
});

function repo() {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "glass-")));
  const git = (...a) =>
    execFileSync(
      "git",
      [
        "-c",
        "user.email=t@t",
        "-c",
        "user.name=t",
        "-c",
        "commit.gpgsign=false",
        ...a,
      ],
      { cwd: dir },
    );
  mkdirSync(join(dir, "web"));
  writeFileSync(
    join(dir, "web/a.ts"),
    "one\ntwo\nthree\nfour\nfive\nsix\nseven\neight\nnine\nten\n",
  );
  git("init", "-q", "-b", "main");
  git("add", "-A");
  git("commit", "-qm", "seed");
  return dir;
}
// The hunks `git diff` would report, in realm's DiffHunk shape.
const hunkTwo = {
  header: "",
  oldStart: 1,
  oldLines: 4,
  newStart: 1,
  newLines: 4,
  lines: [
    { kind: "context", text: "one" },
    { kind: "del", text: "two" },
    { kind: "add", text: "TWO" },
    { kind: "context", text: "three" },
    { kind: "context", text: "four" },
  ],
};
const hunkNine = {
  header: "",
  oldStart: 7,
  oldLines: 4,
  newStart: 7,
  newLines: 4,
  lines: [
    { kind: "context", text: "seven" },
    { kind: "context", text: "eight" },
    { kind: "del", text: "nine" },
    { kind: "add", text: "NINE" },
    { kind: "context", text: "ten" },
  ],
};

test("Reject puts back exactly one hunk and leaves the other", () => {
  const dir = repo();
  writeFileSync(
    join(dir, "web/a.ts"),
    "one\nTWO\nthree\nfour\nfive\nsix\nseven\neight\nNINE\nten\n",
  );
  assert.deepEqual(
    rejectHunk({ cwd: dir, path: "web/a.ts", hunk: hunkTwo }, { home: dir }),
    { ok: true, path: "web/a.ts" },
  );
  assert.equal(
    readFileSync(join(dir, "web/a.ts"), "utf8"),
    "one\ntwo\nthree\nfour\nfive\nsix\nseven\neight\nNINE\nten\n",
  );
});

test("a hunk that no longer matches changes nothing", () => {
  const dir = repo();
  writeFileSync(
    join(dir, "web/a.ts"),
    "one\nTWO-again\nthree\nfour\nfive\nsix\nseven\neight\nnine\nten\n",
  );
  assert.throws(
    () =>
      rejectHunk({ cwd: dir, path: "web/a.ts", hunk: hunkTwo }, { home: dir }),
    /no longer in the file/,
  );
  assert.match(readFileSync(join(dir, "web/a.ts"), "utf8"), /TWO-again/);
  void hunkNine;
});

test("Reject refuses a path that climbs out, a folder outside home, and a malformed hunk", () => {
  const dir = repo();
  assert.throws(() => hunkPatch("../etc/passwd", hunkTwo), /bad path/);
  assert.throws(() => hunkPatch("/etc/passwd", hunkTwo), /bad path/);
  assert.throws(
    () =>
      hunkPatch("a.ts", { ...hunkTwo, lines: [{ kind: "add", text: "x\ny" }] }),
    /bad hunk/,
  );
  assert.throws(
    () => hunkPatch("a.ts", { ...hunkTwo, oldStart: -1 }),
    /bad hunk/,
  );
  assert.throws(
    () =>
      rejectHunk({ cwd: "/", path: "web/a.ts", hunk: hunkTwo }, { home: dir }),
    /under your home/,
  );
  assert.equal(underHome("/etc/hosts", dir), null);
  assert.equal(underHome("relative/path", dir), null);
});

async function serve(home) {
  const token = "tok-123";
  const state = glassState();
  let clock = 1_000_000;
  const now = () => clock;
  const server = createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    if (
      !handleGlass(req, res, {
        path: url.pathname,
        url,
        token,
        origin: "http://127.0.0.1:1",
        state,
        home,
        now,
      })
    )
      res.writeHead(404).end();
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = (path, { method = "GET", body, headers = {} } = {}) =>
    fetch(base + path, {
      method,
      headers: { "X-Glass-Token": token, ...headers },
      body: body && JSON.stringify(body),
    });
  return { server, call, state, tick: (ms) => (clock += ms) };
}

test("every glass route needs the pipe token and this server's origin", async () => {
  const { server, call } = await serve(repo());
  try {
    assert.equal(
      (await call("/glass/focus", { headers: { "X-Glass-Token": "nope" } }))
        .status,
      403,
    );
    assert.equal(
      (
        await call("/glass/focus", {
          headers: { Origin: "http://evil.example" },
        })
      ).status,
      403,
    );
    assert.equal((await call("/glass/focus")).status, 200);
  } finally {
    server.close();
  }
});

test("voice reaches the page only while it is shown and listening, and fresh", async () => {
  const { server, call, tick } = await serve(repo());
  try {
    assert.equal(
      (await call("/glass/voice", { method: "POST", body: { text: "hi" } }))
        .status,
      409,
      "nothing up",
    );
    await call("/glass/focus", {
      method: "POST",
      body: {
        shown: true,
        mode: "work",
        sessionId: "s1",
        title: "Fix the rail",
      },
    });
    assert.equal(
      (await call("/glass/voice", { method: "POST", body: { text: "hi" } }))
        .status,
      409,
      "no page listening",
    );
    const stream = await call("/glass/events");
    const reader = stream.body.getReader();
    await reader.read(); // hello
    const ok = await call("/glass/voice", {
      method: "POST",
      body: { text: "add a test" },
    });
    assert.equal(ok.status, 200);
    assert.equal((await ok.json()).to, "Fix the rail");
    const { value } = await reader.read();
    assert.deepEqual(JSON.parse(new TextDecoder().decode(value).trim()), {
      type: "voice",
      text: "add a test",
    });
    tick(FOCUS_FRESH_MS + 1);
    assert.equal(
      (await call("/glass/voice", { method: "POST", body: { text: "late" } }))
        .status,
      409,
      "stale focus",
    );
    await call("/glass/focus", { method: "POST", body: { shown: false } });
    assert.equal(
      (await call("/glass/voice", { method: "POST", body: { text: "hidden" } }))
        .status,
      409,
      "hidden",
    );
    await reader.cancel();
  } finally {
    server.close();
  }
});

test("the file view reads text under home only", async () => {
  const dir = repo();
  const { server, call } = await serve(dir);
  try {
    const r = await call(
      `/glass/file?path=${encodeURIComponent(join(dir, "web/a.ts"))}`,
    );
    assert.equal(r.status, 200);
    assert.match((await r.json()).text, /^one\n/);
    assert.equal(
      (await call(`/glass/file?path=${encodeURIComponent("/etc/hosts")}`))
        .status,
      404,
    );
    writeFileSync(join(dir, "bin.dat"), Buffer.from([1, 0, 2]));
    assert.equal(
      (
        await call(
          `/glass/file?path=${encodeURIComponent(join(dir, "bin.dat"))}`,
        )
      ).status,
      415,
    );
  } finally {
    server.close();
  }
});

test("the file view never shows keys, tokens or keychains, even under home", async () => {
  for (const p of ["/Users/x/.ssh/id_ed25519", "/Users/x/proj/.env", "/Users/x/proj/.env.local", "/Users/x/.aws/credentials", "/Users/x/certs/server.pem", "/Users/x/.chewbacca/realm-ui/server.json", "/Users/x/.chewbacca/realm/daemon.json", "/Users/x/proj/.git/config"]) {
    assert.ok(secretPath(p), p);
  }
  for (const p of ["/Users/x/proj/web/lib/orgs.ts", "/Users/x/proj/.github/workflows/ci.yml", "/Users/x/proj/env.ts"]) assert.ok(!secretPath(p), p);
  const dir = repo();
  writeFileSync(join(dir, ".env"), "TOKEN=abc\n");
  const { server, call } = await serve(dir);
  try {
    assert.equal((await call(`/glass/file?path=${encodeURIComponent(join(dir, ".env"))}`)).status, 403);
    // Outside any checkout, or ignored by it, nothing is shown either.
    writeFileSync(join(dir, ".gitignore"), "build/\n");
    mkdirSync(join(dir, "build"));
    writeFileSync(join(dir, "build/out.js"), "x\n");
    assert.equal((await call(`/glass/file?path=${encodeURIComponent(join(dir, "build/out.js"))}`)).status, 403);
    const loose = realpathSync(mkdtempSync(join(dir, "..", "loose-")));
    writeFileSync(join(loose, "notes.txt"), "hi\n");
    const outside = await serve(loose);
    try {
      assert.equal((await outside.call(`/glass/file?path=${encodeURIComponent(join(loose, "notes.txt"))}`)).status, 403);
    } finally {
      outside.server.close();
    }
  } finally {
    server.close();
  }
});

// 2026-10-11: typing @ on the glass took Carlton's whole page down, because
// his mention picker reads `computerAccess.rows` and the bridge answered null.
// Every bridge namespace his store reads a shape from must answer that shape.
test("the bridge answers his access shapes, so @ never crashes the page", async () => {
  const { readFileSync } = await import("node:fs");
  const vm = await import("node:vm");
  const src = readFileSync(new URL("../bin/lib/realm_ui/bridge.js", import.meta.url), "utf8");
  const win = { __realmUiToken: "t", addEventListener() {} };
  win.window = win;
  vm.runInNewContext(src, { window: win, document: { hasFocus: () => true }, Object, Promise, Number });
  for (const call of [win.realm.computerAccess.status(), win.realm.computerAccess.request("x"), win.realm.macAccess.status()]) {
    const shape = await call;
    assert.ok(shape && Array.isArray(shape.rows), JSON.stringify(shape));
  }
});

// The tiles' truth (tab_truth.mjs). Caleb, 2026-10-11 8:25pm: all nine tiles
// read "Done 5m" while GTME and TTS Logo were mid-turn, because realm's
// imported rows say "idle" and carry the import time. These lines are the
// shapes Claude Code writes, copied from the live TTS Logo transcript.
const at = (iso) => Date.parse(iso);
const line = (o) => JSON.stringify(o);
const asst = (ts, stop, blocks = ["text"]) =>
  line({
    type: "assistant",
    timestamp: ts,
    isSidechain: false,
    message: { stop_reason: stop, content: blocks.map((type) => ({ type })) },
  });
const user = (ts, content) =>
  line({ type: "user", timestamp: ts, isSidechain: false, message: { content } });
const MID_TOOL = [
  user("2026-10-12T03:20:00.000Z", "Push the forehead out"),
  asst("2026-10-12T03:26:49.513Z", "tool_use", ["thinking"]),
  asst("2026-10-12T03:27:01.160Z", "tool_use", ["tool_use"]),
  line({ type: "attachment", timestamp: "2026-10-12T03:27:01.233Z" }),
  user("2026-10-12T03:27:02.575Z", [{ type: "tool_result", content: "ok" }]),
  asst("2026-10-12T03:27:05.083Z", "tool_use", ["tool_use"]),
  line({ type: "last-prompt" }),
  line({ type: "custom-title" }),
];
const FINISHED = [
  user("2026-10-12T03:04:00.000Z", "WP2 next due date"),
  asst("2026-10-12T03:04:41.147Z", "end_turn"),
  line({ type: "attachment", timestamp: "2026-10-12T03:04:41.370Z" }),
  line({ type: "system", subtype: "stop_hook_summary", timestamp: "2026-10-12T03:04:44.132Z" }),
  line({ type: "last-prompt" }),
  line({ type: "cost-state" }),
];

test("a tab mid-tool is running, and its age is its last message, not the import", () => {
  const now = at("2026-10-12T03:27:30.000Z");
  const t = turnFrom(MID_TOOL, { touchedAt: now - 1000, now });
  assert.equal(t.state, "running");
  assert.equal(t.lastAt, at("2026-10-12T03:27:05.083Z"));
});

test("a turn that ended is done, whatever hook lines came after it", () => {
  const now = at("2026-10-12T03:30:00.000Z");
  const t = turnFrom(FINISHED, { touchedAt: now, now });
  assert.deepEqual(t, { state: "done", lastAt: at("2026-10-12T03:04:41.147Z") });
});

test("a prompt with no answer yet is running; Esc ends the turn", () => {
  const now = at("2026-10-12T03:00:05.000Z");
  const asked = [user("2026-10-12T03:00:00.000Z", "Restart the hud")];
  assert.equal(turnFrom(asked, { now }).state, "running");
  const esc = [
    ...asked,
    user("2026-10-12T03:00:02.000Z", [{ type: "text", text: "[Request interrupted by user]" }]),
  ];
  assert.equal(turnFrom(esc, { now }).state, "done");
});

test("a turn left open with no write for STALE_MS is stopped, not working", () => {
  const last = at("2026-10-12T03:27:05.083Z");
  const now = last + STALE_MS + 1;
  assert.equal(turnFrom(MID_TOOL, { touchedAt: last, now }).state, "stopped");
  // A subagent still writing its own file keeps the turn alive.
  assert.equal(turnFrom(MID_TOOL, { touchedAt: now - 1000, now }).state, "running");
});

test("subagent and meta lines never stand in for the tab's own last message", () => {
  const now = at("2026-10-12T03:05:00.000Z");
  const lines = [
    ...FINISHED,
    line({
      type: "user",
      isSidechain: true,
      timestamp: "2026-10-12T03:04:59.000Z",
      message: { content: "sub" },
    }),
    line({ type: "user", isMeta: true, timestamp: "2026-10-12T03:04:59.500Z", message: { content: "caveat" } }),
  ];
  assert.equal(turnFrom(lines, { now, touchedAt: now }).state, "done");
});

test("only well formed session ids are read, at most fifty", () => {
  const id = "597a44cd-b859-4fd1-abb1-48e1a65c4791";
  assert.deepEqual(idsFrom(`${id},../../etc/passwd,${id},nope`), [id]);
  assert.equal(tabTruth("../x", () => "/etc/passwd"), null);
  const many = Array.from({ length: 60 }, (_, i) =>
    `00000000-0000-0000-0000-${String(i).padStart(12, "0")}`,
  ).join(",");
  assert.equal(idsFrom(many).length, 50);
});

test("GET /glass/tabs reads each tile's own transcript from its projects folder", async () => {
  const home = realpathSync(mkdtempSync(join(tmpdir(), "glass-tabs-")));
  const live = "597a44cd-b859-4fd1-abb1-48e1a65c4791";
  const done = "a4a1a2bd-ec9a-4e73-b7a4-2a6d4934896a";
  const codex = "11111111-2222-3333-4444-555555555555";
  mkdirSync(join(home, ".claude/projects/-Users-x"), { recursive: true });
  mkdirSync(join(home, ".claude/projects/-Users-x-code"), { recursive: true });
  writeFileSync(join(home, ".claude/projects/-Users-x", `${live}.jsonl`), MID_TOOL.join("\n") + "\n");
  writeFileSync(join(home, ".claude/projects/-Users-x-code", `${done}.jsonl`), FINISHED.join("\n") + "\n");
  const { server, call } = await serve(home);
  try {
    assert.equal(
      (await call(`/glass/tabs?ids=${live}`, { headers: { "X-Glass-Token": "nope" } })).status,
      403,
    );
    const r = await call(`/glass/tabs?ids=${live},${done},${codex}`);
    assert.equal(r.status, 200);
    const { tabs } = await r.json();
    assert.equal(tabs[live].state, "running");
    assert.equal(tabs[live].lastAt, at("2026-10-12T03:27:05.083Z"));
    assert.equal(tabs[done].state, "done");
    assert.equal(tabs[codex], null);
  } finally {
    server.close();
  }
});

test("the tiles take the tab's truth over realm's imported idle row", () => {
  // What realm held at 8:25pm: every row idle, every updatedAt the resync.
  const resync = at("2026-10-12T03:19:19.000Z");
  const rows = [
    { id: "a", title: "Midterms", status: "idle", updatedAt: resync, providerSessionId: "pa" },
    { id: "b", title: "TTS Logo", status: "idle", updatedAt: resync, providerSessionId: "pb" },
    { id: "c", title: "GTME", status: "idle", updatedAt: resync, providerSessionId: "pc" },
    { id: "d", title: "Realm run", status: "running", updatedAt: resync, providerSessionId: null },
  ];
  const truths = {
    pa: { state: "done", lastAt: at("2026-10-12T03:04:41.147Z") },
    pb: { state: "running", lastAt: at("2026-10-12T03:27:05.083Z") },
    pc: { state: "running", lastAt: at("2026-10-12T03:27:02.876Z") },
  };
  assert.equal(m.tileState(rows[1], false, truths.pb).word, "Working");
  assert.equal(m.tileState(rows[0], false, truths.pa).word, "Done");
  assert.equal(m.tileState(rows[0], false, { state: "stopped", lastAt: 1 }).word, "Stopped");
  // realm's own live states still win where realm is running the session.
  assert.equal(m.tileState({ status: "waiting_permission" }, false, truths.pa).word, "Needs you");
  assert.equal(m.tileState(rows[3], false, undefined).word, "Working");
  assert.equal(m.tileTime(rows[1], truths.pb), truths.pb.lastAt);
  assert.equal(m.tileTime(rows[3], undefined), resync);
  assert.deepEqual(
    m.tileOrder(rows, truths).map((r) => r.title),
    ["TTS Logo", "GTME", "Realm run", "Midterms"],
  );
  assert.equal(m.tileOrder(rows, truths, 2).length, 2);
});

test("a code card is a grid, so lit and diff tints reach the end of a long line", () => {
  const css = readFileSync(
    new URL("../bin/lib/realm_ui/glass/glass.css", import.meta.url),
    "utf8",
  );
  const block = /\.glass-code \{([^}]*)\}/.exec(css)[1];
  assert.match(block, /display: grid;/);
  assert.match(block, /grid-template-columns: minmax\(max-content, 1fr\);/);
  assert.match(/\.glass-line \{([^}]*)\}/.exec(css)[1], /display: block;/);
});
