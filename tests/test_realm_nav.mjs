// Getting around the agents glass (bin/lib/realm_ui/glass/nav.mjs, turn.mjs,
// beats.mjs). Caleb's first live open, 2026-10-12 3:38pm: "Bro wtf is this
// ux I can't navigate anything???" It opened straight into a 2-day-old
// Gemini session that died on sign-in, told its raw error as a three-line
// headline, drew a red bar under a beat line of grey words, and gave no
// visible way back. Each test here fails on the code he met. Spec:
// skills/hud/SKILL.md, "Getting around".
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import * as nav from "../bin/lib/realm_ui/glass/nav.mjs";
import * as t from "../bin/lib/realm_ui/glass/turn.mjs";
import * as b from "../bin/lib/realm_ui/glass/beats.mjs";

// The words realm stored for that session (its error event, 10/10).
const GEMINI =
  "Gemini needs you to sign in: This client is no longer supported for Gemini Code Assist for individuals. To continue using Gemini, please migrate to the Antigravity suite of products: https://antigravity.google Sign-in methods it offers: Log in with Google, Gemini API key, Vertex AI";
const NOW = Date.parse("2026-10-12T15:38:00-07:00");
const DAY = 86_400_000;
const ev = (seq, type, payload, ts = NOW - 2 * DAY + seq) => ({
  seq,
  sessionId: "gem",
  event: { type, ts, payload },
});
const DEAD = [
  ev(2223, "user_message", { text: "Hello", attachments: [] }),
  ev(2224, "error", { message: GEMINI }),
  ev(2225, "status", { status: "error" }),
  ev(2226, "status", { status: "ended" }),
];
const agentOf = (events) =>
  events.reduce((a, e) => t.step(a, e), t.emptyAgent());
const storyOf = (events) =>
  events.reduce((st, e) => b.tell(st, e), b.emptyStory());

// The shape of his list that night: one realm-native Gemini session, the
// rest Claude Code tabs realm imported, read from their transcripts.
function hisList() {
  const sessions = [
    {
      id: "gem",
      agentKind: "acp:gemini",
      status: "ended",
      title: "Hello",
      cwd: "/Users/x",
      updatedAt: NOW - 2 * DAY,
      lastEventSeq: 2226,
    },
  ];
  const truths = {};
  for (let i = 0; i < 16; i++) {
    const pid = `tab-${i}`;
    sessions.push({
      id: `s${i}`,
      agentKind: "claude",
      status: "idle",
      title: `Tab ${i}`,
      cwd: "/Users/x/code/chewbacca",
      updatedAt: NOW - DAY,
      providerSessionId: pid,
    });
    truths[pid] = { state: "done", lastAt: NOW - (i + 1) * 3_600_000 };
  }
  return { sessions, truths };
}

test("every opening is the tiles, nothing focused, nothing picked", () => {
  assert.deepEqual(
    { ...nav.opening() },
    { mode: "tiles", focus: null, picked: nav.NO_PICK },
  );
});

test("Return opens only a tile he picked; the first arrow picks the first tile", () => {
  assert.deepEqual(nav.tileKey(nav.NO_PICK, 9, "Enter"), {
    picked: nav.NO_PICK,
    open: false,
    handled: false,
  });
  assert.equal(nav.tileKey(nav.NO_PICK, 9, "ArrowRight").picked, 0);
  assert.equal(nav.tileKey(nav.NO_PICK, 9, "ArrowDown").picked, 0);
  assert.equal(nav.tileKey(0, 9, "ArrowDown").picked, 3);
  assert.equal(nav.tileKey(8, 9, "ArrowRight").picked, 8);
  assert.deepEqual(nav.tileKey(4, 9, "Enter"), {
    picked: 4,
    open: true,
    handled: true,
  });
  assert.equal(nav.tileKey(nav.NO_PICK, 0, "ArrowRight").handled, false);
});

test("no tile is drawn until every tab's state is in", () => {
  const base = { listed: true, faulted: false, needTruth: true };
  assert.equal(
    nav.tilesReady({ ...base, truthAsked: false }),
    false,
    "the lone Gemini tile drew first",
  );
  assert.equal(nav.tilesReady({ ...base, truthAsked: true }), true);
  assert.equal(
    nav.tilesReady({ ...base, needTruth: false, truthAsked: false }),
    true,
  );
  assert.equal(
    nav.tilesReady({ ...base, listed: false, truthAsked: true }),
    false,
  );
  assert.equal(
    nav.tilesReady({ ...base, faulted: true, truthAsked: true }),
    false,
  );
});

test("before the tabs answer, the dead Gemini session was the only tile", () => {
  // Why tilesReady exists: this is what the old field drew first.
  const { sessions } = hisList();
  const early = t.restingView(sessions, { gem: agentOf(DEAD) }, {}, true, NOW);
  assert.deepEqual(
    early.tiles.map((x) => x.id),
    ["gem"],
  );
});

test("his real list: newest real work first, the dead Gemini session last", () => {
  const { sessions, truths } = hisList();
  const view = t.restingView(
    sessions,
    { gem: agentOf(DEAD) },
    truths,
    true,
    NOW,
  );
  assert.equal(view.tiles[0].id, "s0", "the newest work leads");
  assert.notEqual(view.tiles[0].id, "gem");
  assert.ok(
    !view.tiles.some((x) => x.id === "gem"),
    "past the nine drawn, it's a count",
  );
  // A failure from the last half hour still leads the settled work.
  const fresh = DEAD.map((e) => ({
    ...e,
    event: { ...e.event, ts: NOW - 60_000 },
  }));
  const soon = t.restingView(
    sessions,
    { gem: agentOf(fresh) },
    truths,
    true,
    NOW,
  );
  assert.equal(soon.tiles[0].id, "gem");
});

test("a provider refusing its login is a named fault, and the tile says Signed out", () => {
  const a = agentOf(DEAD);
  assert.equal(a.turn.phase, "failed");
  assert.equal(a.turn.fault.name, "signed-out");
  assert.equal(t.word(a.turn), "Signed out");
  assert.equal(t.errorFault("ENOENT: no such file").name, "agent-error");
  assert.equal(t.errorFault("401 Unauthorized").name, "signed-out");
  assert.equal(t.errorFault("OAuth token has expired. Please run /login").name, "signed-out");
  // Ordinary errors that merely contain the words (review, 10/12).
  for (const m of [
    "Failed to write log in /tmp/realm",
    "flush the log out to disk failed",
    "ENOENT: ~/.config/gh/login.json",
    "Model claude-3-opus is no longer supported",
  ])
    assert.equal(t.errorFault(m).name, "agent-error", m);
});

test("realm's own sessions are read for their last turn; imported tabs are not", () => {
  const { sessions } = hisList();
  assert.deepEqual(
    nav.toSeed(sessions).map((s) => s.id),
    ["gem"],
  );
  assert.deepEqual(
    nav.toSeed(sessions, {}, new Set(["gem:2226"])),
    [],
    "once per event seq",
  );
  assert.deepEqual(nav.toSeed(sessions, { gem: agentOf(DEAD) }), []);
});

test("a failed turn is told as a named state, never the raw error", () => {
  const st = storyOf(DEAD);
  const beat = b.beat(st);
  assert.equal(beat, "failed");
  const line = b.headline(st, beat, { who: "Gemini" });
  assert.equal(line, "Gemini can't sign in");
  assert.ok(line.split(/\s+/).length <= 6);
  const call = b.decision(st, { who: "Gemini" });
  assert.equal(call.kind, "failed");
  assert.equal(call.line, "Gemini's login is dead. Claude can do this.");
  // One line, one press: the raw words are the transcript's, one press away.
  assert.deepEqual(call.verbs.map((v) => [v.id, v.text]), [["new", "Use Claude instead"]]);
  assert.equal(call.detail, undefined, "no raw provider words on the call");
  // Claude signed out is never told to use Claude.
  const claude = b.decision(st, { who: "Claude" });
  assert.doesNotMatch(claude.line, /Use Claude/);
  assert.ok(!claude.verbs.some((v) => /with Claude/.test(v.text)));
});

test("the beat line shows where a failed turn died, and nothing past it", () => {
  const st = storyOf(DEAD);
  const line = b.beatLine("failed", st);
  assert.deepEqual(
    line.map((x) => [x.id, x.state]),
    [["failed", "failed"]],
  );
  assert.equal(line[0].word, "Failed before it started");
  // Died mid-edit: what it got through reads, the failure is the last word.
  const mid = storyOf([
    ev(1, "user_message", { text: "fix it", attachments: [] }),
    ev(2, "status", { status: "running" }),
    ev(3, "tool_call", {
      toolUseId: "r",
      name: "Read",
      input: { file_path: "/r/a.ts" },
      parentToolUseId: null,
    }),
    ev(4, "tool_result", { toolUseId: "r", content: "", isError: false }),
    ev(5, "tool_call", {
      toolUseId: "e",
      name: "Edit",
      input: { file_path: "/r/a.ts", old_string: "a", new_string: "b" },
      parentToolUseId: null,
    }),
    ev(6, "error", { message: "overloaded" }),
  ]);
  assert.deepEqual(
    b.beatLine("failed", mid).map((x) => x.word),
    ["You asked", "Reading", "Failed while changing files"],
  );
});

test("the stylesheet: no filled beat, a nav in every mode, an opaque pane", () => {
  const css = readFileSync(
    new URL("../bin/lib/realm_ui/glass/glass.css", import.meta.url),
    "utf8",
  );
  for (const m of css.matchAll(/\.story-beats li\[[^\]]*\]\s*\{([^}]*)\}/g))
    assert.doesNotMatch(
      m[1],
      /background/,
      "a beat word with a fill drew the red bar",
    );
  // The bar is one fixed strip over his frame, the same in every mode;
  // switching agents is his sidebar under it.
  const bar = /\n\.glass-nav \{([^}]*)\}/.exec(css)?.[1] ?? "";
  assert.match(bar, /position:\s*fixed/, "the bar isn't fixed over the frame");
  assert.doesNotMatch(css, /\.glass-nav\[data-shape="column"\]/, "a second agent list beside his sidebar");
  assert.doesNotMatch(css, /\.glass-layer\[data-mode="\w+"\] \{[^}]*"nav/, "the bar moves between modes");
  const alpha = Number(/--pane-alpha:\s*(\d+)%/.exec(css)?.[1]);
  assert.ok(
    alpha >= 95,
    `pane alpha ${alpha}%: the desktop read through at 84%`,
  );
});

test("an imported tab's transcript outranks realm's stale copy of its turn", () => {
  // 10/12: opening the 5h-old TTS Logo tab read realm's import, which ends
  // on a pasted image with no reply, and its row turned to "Starting".
  const stale = agentOf([ev(1, "user_message", { text: "[Image: original 2048x2048]", attachments: [] }, NOW - DAY)]);
  assert.equal(stale.turn.phase, "asked");
  const s = { id: "s0", status: "idle", title: "TTS Logo", providerSessionId: "tab-0" };
  const done = { state: "done", lastAt: NOW - 5 * 3_600_000 };
  assert.equal(t.tileTurn(s, stale, done, true).phase, "done");
  assert.equal(t.tileTurn(s, stale, { state: "running", lastAt: NOW }, true).phase, "asked");
  // A realm-run session has no tab, so its own events stand.
  assert.equal(t.tileTurn({ ...s, providerSessionId: null }, stale, undefined, true).phase, "asked");
});

// 10/12 4:10pm: "study carlton's UX on realm, we need buttons". His frame is
// on the glass now, so a press of his has to land somewhere visible, and
// nothing that isn't his press may move the glass.
test("his presses move the glass; his boot restoring a layout doesn't", () => {
  const base = { mode: "tiles", before: null, after: "gem", known: true, page: false, pageBefore: false };
  // His boot restored the dead Gemini session as the focused pane (the
  // first build of this, 4:45pm, opened straight into it).
  assert.equal(nav.followHis({ ...base, pressed: false }), null);
  assert.equal(nav.followHis({ ...base, known: false, pressed: false }), null);
  // A row in his sidebar, from the tiles or a story: that agent's story.
  assert.deepEqual(nav.followHis({ ...base, pressed: true }), { mode: "story", focus: "gem", keep: false });
  assert.deepEqual(nav.followHis({ ...base, mode: "story", before: "a", pressed: true }), { mode: "story", focus: "gem", keep: false });
  // From the transcript it stays the transcript.
  assert.deepEqual(nav.followHis({ ...base, mode: "work", before: "a", pressed: true }), { mode: "work", focus: "gem", keep: false });
  // His New session: an agent the glass doesn't list yet, shown as his hero composer.
  assert.deepEqual(nav.followHis({ ...base, known: false, pressed: true }), { mode: "work", focus: "gem", keep: false });
  // The same focus, or none: nothing moves.
  assert.equal(nav.followHis({ ...base, before: "gem", pressed: true }), null);
  assert.equal(nav.followHis({ ...base, after: null, pressed: true }), null);
  // A page of his rail (Code review, Library...) shows in the workspace.
  assert.deepEqual(nav.followHis({ ...base, after: null, page: true, pressed: true }), { mode: "work", focus: null, keep: true });
  assert.equal(nav.followHis({ ...base, mode: "work", after: null, page: true, pressed: true }), null);
});

test("the bar's labeled buttons, per mode", () => {
  assert.deepEqual(nav.barButtons("tiles", false), ["All agents", "New agent", "Close"]);
  assert.deepEqual(nav.barButtons("tiles", true), ["All agents", "New agent", "Close"]);
  for (const m of ["story", "work"])
    assert.deepEqual(nav.barButtons(m, true), ["All agents", "Story", "Transcript", "New agent", "Close"]);
  // A session his New session just made isn't listed: no story to switch to.
  assert.deepEqual(nav.barButtons("work", false), ["All agents", "New agent", "Close"]);
  const src = readFileSync(new URL("../bin/lib/realm_ui/glass/GlassLayer.tsx", import.meta.url), "utf8");
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  const bar = code.slice(code.indexOf("function Nav("), code.indexOf("export function FaultBody"));
  assert.match(bar, /barButtons\(mode,/, "the bar doesn't draw from barButtons");
  for (const label of ["All agents", "Story", "Transcript", "New agent", "Close"])
    assert.match(bar, new RegExp(`[>}]\\s*${label}\\s*[<{]|<span>${label}</span>`), `${label} isn't drawn as a button label`);
  // His rail's Home ("Back to your sessions") goes to the tiles, and his
  // Rail.tsx still names it that way (a relabel would silently skip us).
  assert.match(code, /\.app-rail \.rail-btn\[aria-label="Home"\]/);
  const rail = path.join(process.env.CHEWBACCA_REALM_DIR || path.join(os.homedir(), "code/vendor/realm"), "apps/desktop/src/renderer/src/components/sidebar/Rail.tsx");
  if (existsSync(rail)) assert.match(readFileSync(rail, "utf8"), /className="rail-btn" aria-label="Home"/, "his Home button changed its label");
});

test("a press on his sidebar row opens only the row he pressed", () => {
  const base = { mode: "tiles", focused: "gem", known: true, current: null };
  // The row his layout already shows (marked data-active): that one.
  assert.deepEqual(nav.followRow({ ...base, rowActive: true }), { mode: "story", focus: "gem", keep: false });
  // Any other row that didn't move his focus (an imported tab still
  // opening, a profile switch in flight): never the restored session.
  assert.equal(nav.followRow({ ...base, rowActive: false }), null);
  // Already on that agent's story: nothing moves.
  assert.equal(nav.followRow({ ...base, mode: "story", rowActive: true, current: "gem" }), null);
  assert.equal(nav.followRow({ ...base, rowActive: true, focused: null }), null);
  // The layer reads the row before his click handler runs, and never
  // guesses from "whatever is focused" with no row behind it.
  const src = readFileSync(new URL("../bin/lib/realm_ui/glass/GlassLayer.tsx", import.meta.url), "utf8");
  const onRow = src.slice(src.indexOf("const onRow = "), src.indexOf('document.addEventListener("click", onRow, true);'));
  assert.match(onRow, /hasAttribute\("data-active"\)/);
  assert.doesNotMatch(onRow, /before:\s*null|setTimeout/);
});

// Headless WebKit, 10/12 5:10pm: his Home pressed 200 ms after a tile grew
// stayed on the transcript, and Escape the same, because the shrink
// returned early while the grow's 320 ms morph ran. A press always wins.
test("a press during a morph is never dropped", () => {
  const layer = readFileSync(new URL("../bin/lib/realm_ui/glass/GlassLayer.tsx", import.meta.url), "utf8");
  const shrink = layer.slice(layer.indexOf("const shrink = useCallback("), layer.indexOf("}, [tiles]);"));
  assert.doesNotMatch(shrink, /if \(morphing\.current\) return;/, "shrink drops a press mid-morph");
  assert.match(shrink, /morphGen\.current \+= 1;/, "shrink doesn't end the running morph");
  const grow = layer.slice(layer.indexOf("const grow = useCallback("), layer.indexOf("const shrink = useCallback("));
  assert.match(grow, /if \(!live\(\)\) return;\s*setMode\(land\)/, "an ended grow still lands its mode");
  assert.doesNotMatch(grow, /morphing\.current\) return;/, "a tile pressed mid-shrink is dropped");
  // And the follower of his frame never waits on a morph either.
  const follow = layer.slice(layer.indexOf("const take = "), layer.indexOf("const onRow = "));
  assert.doesNotMatch(follow, /if \(morphing\.current\) return/);
  assert.match(follow, /morphGen\.current \+= 1;/, "a followed press leaves the morph flying");
});
