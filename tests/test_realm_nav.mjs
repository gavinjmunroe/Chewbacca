// Getting around the agents glass (bin/lib/realm_ui/glass/nav.mjs, turn.mjs,
// beats.mjs). Caleb's first live open, 2026-10-12 3:38pm: "Bro wtf is this
// ux I can't navigate anything???" It opened straight into a 2-day-old
// Gemini session that died on sign-in, told its raw error as a three-line
// headline, drew a red bar under a beat line of grey words, and gave no
// visible way back. Each test here fails on the code he met. Spec:
// skills/hud/SKILL.md, "Getting around".
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
  assert.match(call.line, /Gemini's login is dead\. Use Claude/);
  assert.deepEqual(
    call.verbs.map((v) => v.id),
    ["new", "answer"],
  );
  assert.ok(
    GEMINI.startsWith(call.detail.slice(0, 40)),
    "the raw words are the small print",
  );
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
  for (const mode of ["story", "work"]) {
    const block =
      new RegExp(`\\.glass-layer\\[data-mode="${mode}"\\] \\{([^}]*)\\}`).exec(
        css,
      )?.[1] ?? "";
    assert.match(block, /"nav /, `${mode} has no nav column`);
  }
  assert.match(
    /\.glass-layer \{([^}]*)\}/.exec(css)[1],
    /"nav"/,
    "the tiles have no nav bar",
  );
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
