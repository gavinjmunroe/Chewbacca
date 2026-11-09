// The agents glass keeps going when what's under it moves (bin/lib/realm_ui).
// Five rough spots left by the 10/12 jobs (ux-apply-report.md,
// final-report.md, day-ide-report.md), each with the test that fails on the
// glass as it was at ccba59c9:
//
//   1. a live "Working for 42s" on a running turn, from one start time
//   2. a turn running outside realm's engine says where to stop it
//   3. realm-ui handing over to new code never blinks the page
//   4. an engine restart under a turn is said, never "Starting on it" forever
//   5. a rebuild never costs a visible reload of the page
import test from "node:test";
import assert from "node:assert/strict";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as t from "../bin/lib/realm_ui/glass/turn.mjs";
import * as b from "../bin/lib/realm_ui/glass/beats.mjs";
const link = await import("../bin/lib/realm_ui/glass/link.mjs").catch(() => ({}));
// Namespaces, so the glass as it was (no link.mjs, no liveTabs) fails test
// by test instead of failing to load.
import * as tab from "../bin/lib/realm_ui/tab_truth.mjs";
import * as srv from "../bin/lib/realm_ui/server.mjs";
const { turnFrom } = tab;
const liveTabs = (...a) => tab.liveTabs(...a);
const start = (...a) => srv.start(...a);
const keptToken = (...a) => srv.keptToken(...a);
const entryOfIndex = (...a) => srv.entryOfIndex(...a);

const GLASS = new URL("../bin/lib/realm_ui/glass/", import.meta.url);
const read = (f) =>
  readFileSync(new URL(f, GLASS), "utf8").replace(
    /\/\*[\s\S]*?\*\/|^\s*\/\/.*$/gm,
    "",
  );
const ev = (seq, type, payload = {}, ts = seq * 1000) => ({
  seq,
  sessionId: "x",
  event: { type, ts, payload },
});
const run = (events) => events.reduce((a, e) => t.step(a, e), t.emptyAgent());

// ------------------------------------------------------------ 1. the clock

test("a turn has one start time, its ask's, through every beat to done", () => {
  const a = run([
    ev(1, "user_message", { text: "fix it" }, 10_000),
    ev(2, "init", {}, 10_001),
    ev(3, "status", { status: "running" }, 10_002),
    ev(
      4,
      "tool_call",
      { toolUseId: "r", name: "Read", input: { file_path: "/a.ts" } },
      12_000,
    ),
    ev(5, "tool_result", { toolUseId: "r", content: "x" }, 12_100),
    ev(
      6,
      "tool_call",
      {
        toolUseId: "e",
        name: "Edit",
        input: { file_path: "/a.ts", old_string: "a", new_string: "b" },
      },
      15_000,
    ),
    ev(7, "tool_result", { toolUseId: "e", content: "ok" }, 15_200),
    ev(8, "status", { status: "waiting_permission" }, 20_000),
    ev(9, "status", { status: "running" }, 25_000),
  ]);
  assert.equal(a.turn.phase, "changing");
  assert.equal(a.turn.since, 10_000);
  assert.equal(t.clock(a.turn, 52_000).text, "Working for 42s");
  const done = run([
    ...[1, 2, 3].map((n) =>
      ev(
        n,
        n === 1 ? "user_message" : n === 2 ? "init" : "status",
        n === 1 ? { text: "x" } : n === 3 ? { status: "running" } : {},
        10_000 + n,
      ),
    ),
    ev(4, "usage", {}, 95_000),
    ev(5, "status", { status: "idle" }, 95_000),
  ]);
  assert.equal(done.turn.phase, "done");
  assert.equal(t.clock(done.turn, 999_999).text, "Took 1m 24s");
});

test("the clock says waiting from when it began to wait, and nothing it can't know", () => {
  const waiting = t.Turn.needsYou(
    "x",
    "It wants to use Bash",
    t.Turn.asked("x", 1000),
    61_000,
  );
  assert.equal(t.clock(waiting, 66_000).text, "Waiting on you for 5s");
  assert.equal(t.clock(t.Turn.asked("x", 0, null), 5_000), null);
  assert.equal(t.duration(185_000), "3m 05s");
  assert.equal(t.duration(3_725_000), "1h 02m");
  // A tile known only from realm's row starts at the row's time.
  const row = t.tileTurn(
    { id: "s", title: "T", status: "running", updatedAt: 7_000 },
    undefined,
    undefined,
    false,
  );
  assert.equal(t.clock(row, 49_000).short, "42s");
});

test("a tab's running turn counts from its prompt, never its newest tool call", () => {
  const at = (ms) => new Date(ms).toISOString();
  const lines = [
    { type: "user", timestamp: at(1_000), message: { content: "old prompt" } },
    {
      type: "assistant",
      timestamp: at(2_000),
      message: { stop_reason: "end_turn", content: [] },
    },
    {
      type: "user",
      timestamp: at(10_000),
      message: { content: [{ type: "text", text: "move it down" }] },
    },
    {
      type: "assistant",
      timestamp: at(20_000),
      message: { stop_reason: "tool_use", content: [{ type: "tool_use" }] },
    },
    {
      type: "user",
      timestamp: at(30_000),
      message: { content: [{ type: "tool_result", content: "ok" }] },
    },
  ].map((l) => JSON.stringify(l));
  const truth = turnFrom(lines, { now: 40_000 });
  assert.equal(truth.state, "running");
  assert.equal(truth.since, 10_000);
  assert.equal(t.turnFromTruth(truth, "TTS").since, 10_000);
});

test("the story and the tiles draw the clock, ticking only while shown", () => {
  const story = read("Story.tsx");
  const layer = read("GlassLayer.tsx");
  assert.match(story, /className="story-clock"/);
  assert.match(story, /useNow\(shown &&/);
  assert.match(layer, /data-clock=\{c\.tone\}/);
  assert.match(layer, /useNow\(shown && mode === "tiles" && busy\)/);
});

// ------------------------------------------- 2. Stop where realm can't reach

test("a tab's live process says which app runs it; a dead pid says nothing", () => {
  const dir = mkdtempSync(join(tmpdir(), "live-"));
  const id = (n) => `00000000-0000-4000-8000-00000000000${n}`;
  writeFileSync(
    join(dir, "11.json"),
    JSON.stringify({ pid: 11, sessionId: id(1), entrypoint: "claude-vscode" }),
  );
  writeFileSync(
    join(dir, "12.json"),
    JSON.stringify({ pid: 12, sessionId: id(2), entrypoint: "sdk-cli" }),
  );
  writeFileSync(
    join(dir, "13.json"),
    JSON.stringify({ pid: 13, sessionId: id(3), entrypoint: "cli" }),
  );
  writeFileSync(join(dir, "14.json"), "{not json");
  const live = liveTabs(dir, { alive: (pid) => pid !== 13 });
  assert.equal(live.get(id(1)).where, "vscode");
  assert.equal(live.get(id(2)).where, "job");
  assert.equal(live.has(id(3)), false);
  assert.equal(
    t.stopElsewhere("vscode"),
    "This one runs in VS Code, so stop it there.",
  );
  assert.equal(
    t.stopElsewhere(undefined),
    "This one runs in its own window, so stop it there.",
  );
});

test("the story offers Stop only for realm's turn, and the reason otherwise", () => {
  const story = read("Story.tsx");
  assert.match(story, /!stoppable && away &&/);
  assert.match(story, /stopElsewhere\(away\.where\)/);
  assert.match(read("GlassLayer.tsx"), /where: tr\.where \?\? null/);
});

// ------------------------------------------------ 4. the engine restarted

// The log a scratch engine held after a SIGTERM mid-turn and a restart
// (10/13 probe): the boot wrote a synthetic idle at the last real event.
const CUT = [
  ev(1, "user_message", { text: "keep working" }, 1_000),
  ev(2, "init", {}, 1_000),
  ev(3, "status", { status: "idle" }, 1_000),
  ev(4, "status", { status: "running" }, 1_003),
  ev(17, "status", { status: "idle" }, 1_003),
];
const BOOT = 7_280;

test("a turn the engine's restart settled reads as that, never Done", () => {
  const a = run(CUT);
  assert.equal(a.turn.phase, "done", "the replay alone calls it Done");
  const cut = t.cutByRestart(a, BOOT, "claude");
  assert.equal(cut.turn.phase, "failed");
  assert.equal(cut.turn.fault.name, "engine-restarted");
  assert.equal(cut.turn.since, 1_000);
});

test("a turn cut before it began reads as cut, never Starting on it forever", () => {
  const a = run(CUT.slice(0, 3));
  assert.equal(a.turn.phase, "asked");
  assert.equal(
    t.cutByRestart(a, BOOT, "claude").turn.fault.name,
    "engine-restarted",
  );
  const story = { ...b.emptyStory(), agent: t.cutByRestart(a, BOOT, "claude") };
  assert.equal(b.headline(story), "Realm's engine restarted mid-turn");
  assert.equal(b.beatLine("failed", story).at(-1).word, "Cut off by the restart");
  const call = b.decision(story);
  assert.deepEqual(
    call.verbs.map((v) => v.id),
    ["reply"],
  );
});

test("a finished turn, an imported tab and a turn after the boot are left alone", () => {
  const finished = run([
    ...CUT.slice(0, 4),
    ev(5, "usage", {}, 1_500),
    ev(6, "status", { status: "idle" }, 1_500),
  ]);
  assert.equal(t.cutByRestart(finished, BOOT, "claude").turn.phase, "done");
  const gemini = run(CUT);
  assert.equal(t.cutByRestart(gemini, BOOT, "acp:gemini").turn.phase, "done");
  // Realm's importer writes no init and no status: a tab's copy never settles.
  const imported = run([
    ev(1, "user_message", { text: "x" }, 1_000),
    ev(
      2,
      "tool_call",
      { toolUseId: "a", name: "Bash", input: { command: "ls" } },
      1_100,
    ),
  ]);
  assert.equal(t.cutByRestart(imported, BOOT, "claude"), imported);
  const after = run([
    ev(1, "user_message", { text: "x" }, 9_000),
    ev(2, "init", {}, 9_000),
    ev(3, "status", { status: "running" }, 9_001),
  ]);
  assert.equal(t.cutByRestart(after, BOOT, "claude"), after);
});

test("the story and tiles re-read on every reconnect and judge by the engine's boot", () => {
  const story = read("Story.tsx");
  const layer = read("GlassLayer.tsx");
  // A reconnect catches up forward from what the story already told, never
  // rebuilds from the list's lastEventSeq (which rewound a settled turn).
  assert.match(story, /eventsAfter\(session\.id, from\)/);
  assert.match(story, /const from = lastSeq\.current;/);
  assert.doesNotMatch(story, /\[session\.id, attempt, gen\]/);
  assert.match(layer, /const from = stepped\.current\.get\(id\)/);
  // Realm's own session is never told as a tab running elsewhere.
  assert.match(story, /const away = st\.agent\.ran \? null : outside;/);
  assert.match(
    story,
    /cutByRestart\(told0\.agent, bootAt, session\.agentKind\)/,
  );
  assert.match(layer, /cutByRestart\(a, link\.bootAt/);
  assert.match(layer, /link\.gen === 0/);
});

// ---------------------------------------------- 3. the line rides a handover

function fakeClient() {
  const fns = new Set();
  return {
    fns,
    retries: 0,
    onStatusChange(fn) {
      fns.add(fn);
      return () => fns.delete(fn);
    },
    retryNow() {
      this.retries++;
    },
    say(s) {
      for (const f of fns) f(s);
    },
  };
}
function fakeTimer() {
  let now = 0;
  const q = [];
  return {
    now: () => now,
    setTimeout(fn, ms) {
      const h = { fn, at: now + ms, on: true };
      q.push(h);
      return h;
    },
    clearTimeout(h) {
      if (h) h.on = false;
    },
    run(ms) {
      now += ms;
      for (const h of q
        .filter((x) => x.on && x.at <= now)
        .sort((x, y) => x.at - y.at)) {
        h.on = false;
        h.fn();
      }
    },
  };
}
const flush = () => new Promise((r) => setImmediate(r));

test("a drop redials at once and is said only past the grace", async () => {
  const client = fakeClient();
  const timer = fakeTimer();
  let boot = { bootId: "a", startedAt: 100 };
  const w = link.watchLink({ client, info: () => boot, timer, now: timer.now });
  await flush();
  assert.equal(w.snapshot().bootAt, 100);
  client.say("reconnecting");
  assert.equal(w.snapshot().phase, "handover");
  timer.run(link.REDIAL_MS);
  assert.equal(client.retries, 1, "redialed in REDIAL_MS, not his 1 s backoff");
  client.say("connected");
  await flush();
  assert.deepEqual(
    [w.snapshot().phase, w.snapshot().gen, w.snapshot().restarts],
    ["steady", 1, 0],
  );
  timer.run(link.GRACE_MS);
  assert.equal(w.snapshot().phase, "steady", "a cleared grace never fires");
  // The engine itself restarts: down past the grace, then a new boot.
  client.say("reconnecting");
  timer.run(link.GRACE_MS);
  assert.equal(w.snapshot().phase, "down");
  boot = { bootId: "b", startedAt: 900 };
  client.say("connected");
  await flush();
  assert.deepEqual(
    [w.snapshot().gen, w.snapshot().restarts, w.snapshot().bootAt],
    [2, 1, 900],
  );
  w.stop();
  assert.equal(client.fns.size, 0);
});

test("his banner hides only while the glass rides a drop out", () => {
  const css = readFileSync(new URL("glass.css", GLASS), "utf8");
  assert.match(
    css,
    /:root\[data-glass\]\[data-link="handover"\] \.conn-banner \{\s*visibility: hidden;/,
  );
});

test("a new realm-ui generation on the same port keeps the pipe token", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ui-"));
  mkdirSync(join(dir, "dist"));
  writeFileSync(
    join(dir, "dist", "index.html"),
    '<script type="module" crossorigin src="/assets/index-AAA.js"></script>',
  );
  const state = join(dir, "server.json");
  const one = await start({ dist: join(dir, "dist"), realmHome: dir, state });
  const port = one.port;
  one.server.close();
  const two = await start({
    dist: join(dir, "dist"),
    realmHome: dir,
    state,
    port,
  });
  assert.equal(
    two.token,
    one.token,
    "same port, same token: Kyber keeps its page",
  );
  two.server.close();
  // A state file anyone else could read never hands its token on.
  chmodSync(state, 0o644);
  assert.equal(keptToken(state, port), null);
  // Another port's token is not this one's.
  chmodSync(state, 0o600);
  assert.equal(keptToken(state, port + 1), null);
  assert.equal(keptToken(state, port), one.token);
  // A day on, it rotates: Kyber reloads at most once a day for it.
  assert.equal(srv.keptToken(state, port, { now: Date.now() + srv.TOKEN_MAX_AGE_MS + 1 }), null);
});

// ------------------------------------------------------- 5. the rebuild

test("the server names its build and tells listening pages of a new one", { timeout: 10_000 }, async () => {
  assert.equal(
    entryOfIndex(
      '<script type="module" crossorigin src="/assets/index-Bc5nroMI.js"></script>',
    ),
    "index-Bc5nroMI.js",
  );
  const dir = mkdtempSync(join(tmpdir(), "ui-"));
  mkdirSync(join(dir, "dist"));
  const index = join(dir, "dist", "index.html");
  writeFileSync(
    index,
    '<script type="module" crossorigin src="/assets/index-AAA.js"></script>',
  );
  const ui = await start({
    dist: join(dir, "dist"),
    realmHome: dir,
    state: join(dir, "s.json"),
  });
  const res = await fetch(`${ui.url}glass/events`, {
    headers: { "X-Glass-Token": ui.token },
  });
  const reader = res.body.getReader();
  const lines = [];
  let buf = "";
  const next = async () => {
    while (!buf.includes("\n"))
      buf += new TextDecoder().decode((await reader.read()).value);
    const i = buf.indexOf("\n");
    const line = JSON.parse(buf.slice(0, i));
    buf = buf.slice(i + 1);
    lines.push(line);
    return line;
  };
  assert.deepEqual(await next(), { type: "hello", entry: "index-AAA.js" });
  writeFileSync(
    index,
    '<script type="module" crossorigin src="/assets/index-BBB.js"></script>',
  );
  assert.deepEqual(await next(), { type: "build", entry: "index-BBB.js" });
  await reader.cancel();
  ui.server.closeAllConnections?.();
  ui.server.close();
});

test("a page on an older build reloads only off the glass, once per build", () => {
  assert.equal(link.staleBuild("index-A.js", "index-B.js"), true);
  assert.equal(link.staleBuild("index-A.js", "index-A.js"), false);
  assert.equal(link.staleBuild("", "index-B.js"), false);
  assert.equal(
    link.entryOf([null, "/squircle.js", "/assets/index-Bc5nroMI.js"]),
    "index-Bc5nroMI.js",
  );
  const layer = read("GlassLayer.tsx");
  assert.match(
    layer,
    /if \(shown \|\| !staleBuild\(myEntry, servedEntry\)\) return;/,
  );
  assert.match(layer, /realm-glass-reloaded-for:/);
  // The bundle a kept page still runs keeps its lazy chunks through a rebuild.
  assert.match(
    readFileSync(new URL("../vite.config.mjs", GLASS), "utf8"),
    /emptyOutDir: false/,
  );
});
