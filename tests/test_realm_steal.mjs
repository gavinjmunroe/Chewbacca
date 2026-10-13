// Patterns from shipped agent apps, applied to the agents glass
// (bin/lib/realm_ui/glass). The evidence is ~/.chewbacca/overnight/
// ux-universe-report.md, "Steal list for the HUD glass, ranked": what Claude,
// Codex, Cursor, ChatGPT, Linear, Notion and Carlton's Realm do, read from
// their shipped bundles and docs. Caleb, 10/12: "the future is intuitive ux!"
// Each test here fails on the glass as it was at 9c44df54. Spec:
// skills/hud/SKILL.md, "Navigation patterns from shipped agent apps".
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as nav from "../bin/lib/realm_ui/glass/nav.mjs";
import * as t from "../bin/lib/realm_ui/glass/turn.mjs";
import * as b from "../bin/lib/realm_ui/glass/beats.mjs";

const GLASS = new URL("../bin/lib/realm_ui/glass/", import.meta.url);
const read = (f) =>
  readFileSync(new URL(f, GLASS), "utf8").replace(
    /\/\*[\s\S]*?\*\/|^\s*\/\/.*$/gm,
    "",
  );
const ev = (seq, type, payload) => ({
  seq,
  sessionId: "x",
  event: { type, ts: seq * 1000, payload },
});
const play = (events) =>
  events.reduce((st, e) => b.tell(st, e), b.emptyStory());
const ASK = [
  ev(1, "user_message", { text: "do it", attachments: [] }),
  ev(2, "status", { status: "running" }),
];
const died = (message) =>
  play([
    ...ASK,
    ev(3, "error", { message }),
    ev(4, "status", { status: "error" }),
  ]);
const asking = (input, toolName = "Bash") =>
  play([
    ...ASK,
    ev(3, "permission_request", {
      requestId: "p",
      toolName,
      input,
      title: "Allow?",
      suggestions: [],
    }),
  ]);

// Steal list 9: one error, our words, one action. Realm's Sign in, Cursor's
// Try again, Linear's one Reload. On 10/12 the dead Gemini call said it in a
// 14-word line plus three lines of the provider's words, with two presses.
test("every failed turn's call is one short line and one press", () => {
  const cases = [
    [
      died(
        "Gemini needs you to sign in: This client is no longer supported for Gemini Code Assist for individuals.",
      ),
      "Gemini",
    ],
    [died("Please run /login. Invalid API key"), "Claude"],
    [died("Usage limit reached. Try again at 9pm."), "Claude"],
    [died("read ECONNRESET"), "Codex"],
  ];
  for (const [st, who] of cases) {
    const call = b.decision(st, { who });
    assert.equal(call.kind, "failed");
    assert.equal(
      call.verbs.length,
      1,
      `${who}: one press, got ${call.verbs.map((v) => v.text)}`,
    );
    assert.ok(
      call.line.split(/\s+/).length <= 8,
      `${who}: "${call.line}" is one glance`,
    );
    assert.equal(
      call.detail,
      undefined,
      "the provider's words stay in the transcript",
    );
    assert.ok(call.verbs[0].key, "the press says its key");
  }
  assert.doesNotMatch(
    b.decision(cases[1][0], { who: "Claude" }).verbs[0].text,
    /Claude instead/,
  );
});

// Steal list 8: three labeled choices with keys, Return, Shift+Return,
// Cmd+Delete and 1 to 3, as Realm's own card and Claude.app's do; keys dead
// for 400 ms after the card shows and on a held key's repeat.
test("a permission is Allow, Always allow, Deny, each with its key", () => {
  const call = b.decision(asking({ command: "pnpm vitest run settings" }), {
    who: "Claude",
  });
  assert.deepEqual(
    call.verbs.map((v) => [v.id, v.key]),
    [
      ["allow", "↵"],
      ["allow_always", "⇧↵"],
      ["deny", "⌘⌫"],
    ],
  );
  const k = (key, o = {}) => b.callKey(call, { key, sinceShown: 1000, ...o });
  assert.equal(k("Enter"), "allow");
  assert.equal(k("Enter", { shift: true }), "allow_always");
  assert.equal(k("Backspace", { meta: true }), "deny");
  assert.equal(k("Backspace"), null, "a bare Delete is never Deny");
  assert.equal(k("1"), "allow");
  assert.equal(k("3"), "deny");
  assert.equal(k("4"), null);
  assert.equal(
    k("Enter", { sinceShown: b.KEY_GUARD_MS - 1 }),
    null,
    "no key in the first 400 ms",
  );
  assert.equal(
    k("Enter", { repeat: true }),
    null,
    "no key on a held key's repeat",
  );
  assert.equal(k("Enter", { ctrl: true }), null);
  assert.equal(b.KEY_GUARD_MS, 400);
  // A request too long to see whole never gets Allow, by key or press.
  const long = b.decision(asking({ command: `echo ${"x".repeat(1300)}` }));
  assert.deepEqual(
    long.verbs.map((v) => v.id),
    ["answer", "deny"],
  );
  assert.equal(b.callKey(long, { key: "Enter", sinceShown: 1000 }), "answer");
  assert.equal(
    b.callKey(long, { key: "Enter", shift: true, sinceShown: 1000 }),
    null,
  );
});

test("the story binds the call's keys, draws each key on its button, and gates Allow by key on the whole request", () => {
  const src = read("Story.tsx");
  assert.match(src, /callKey\(call,/);
  assert.match(src, /<kbd className="glass-key">\{v\.key\}<\/kbd>/);
  assert.match(
    src,
    /\(id === "allow" \|\| id === "allow_always"\) && !wantsInView\) return/,
  );
  assert.match(
    src,
    /id === "allow" \|\| id === "allow_always" \|\| id === "deny"/,
    "Always allow reaches his engine",
  );
});

// Steal list 6: Claude.app's Cmd+1..9. One press from the tiles to any of
// the nine, with the number drawn on the tile.
test("1 to 9 open the tile with that number; a number past the last does nothing", () => {
  assert.deepEqual(nav.tileKey(nav.NO_PICK, 9, "1"), {
    picked: 0,
    open: true,
    handled: true,
  });
  assert.deepEqual(nav.tileKey(2, 9, "9"), {
    picked: 8,
    open: true,
    handled: true,
  });
  assert.deepEqual(nav.tileKey(nav.NO_PICK, 4, "5"), {
    picked: nav.NO_PICK,
    open: false,
    handled: false,
  });
  assert.match(read("GlassLayer.tsx"), /glass-tile-key[^>]*>\s*\{i \+ 1\}/);
});

// Steal list 4: a count with no way in is a dead end. "8 more agents, all
// in the sidebar" (10/12) becomes a press that draws every one.
test("Show all draws every agent as a tile", () => {
  const sessions = Array.from({ length: 17 }, (_, i) => ({
    id: `s${i}`,
    agentKind: "claude",
    status: "idle",
    title: `Tab ${i}`,
    cwd: "/x",
    updatedAt: 1000 + i,
  }));
  const nine = t.restingView(sessions, {}, {}, true);
  assert.equal(nine.tiles.length, 9);
  assert.equal(nine.moreAgents, 8);
  const all = t.restingView(sessions, {}, {}, true, Date.now(), Infinity);
  assert.equal(all.tiles.length, 17);
  assert.equal(all.moreAgents, 0);
  const src = read("GlassLayer.tsx");
  assert.match(
    src,
    /Show all \$\{tiles\.length \+ resting\.moreAgents\} agents/,
  );
  assert.match(src, /setEveryone\(false\)/, "every opening is back to nine");
});

// Steal list 11: Escape in his composer is his interrupt (Realm, Claude.app,
// Cursor). Before, the glass took it to go back to the story.
test("Escape in his composer is his; elsewhere it steps back", () => {
  assert.equal(nav.escapeOn({ mode: "work", typing: true }), "his");
  assert.equal(nav.escapeOn({ mode: "work" }), "story");
  assert.equal(nav.escapeOn({ mode: "story" }), "tiles");
  assert.equal(
    nav.escapeOn({ mode: "tiles" }),
    "his",
    "on the tiles bridge.js closes the glass",
  );
  assert.equal(nav.escapeOn({ mode: "story", overlay: true }), "his");
  assert.equal(nav.escapeOn({ mode: "work", editor: true }), "his");
});

// Steal list 11: Stop is one press while his engine runs the turn.
test("the story has Stop while his engine runs the turn, through sessions.interrupt", () => {
  const src = read("Story.tsx");
  assert.match(src, /session\.status === "running"/);
  assert.match(
    src,
    /rpc\(\)\.call\("sessions\.interrupt", \{ id: session\.id \}\)/,
  );
  assert.match(src, /\{stoppable && \([\s\S]{0,200}>\s*Stop\s*</);
});

// Steal list 12: Cursor's review bar counts what's left and has Review next;
// Keep and Reject ride at the top of each hunk, so they are on screen
// whenever any of the hunk is (the harness scrolls the review to prove it).
test("the review counts what's left, has Next change, and puts Keep and Reject above each hunk", () => {
  const src = read("GlassLayer.tsx");
  const review = src.slice(src.indexOf("export function Review("));
  assert.match(review, /changes" : "change"\}? to decide|to decide/);
  assert.match(review, />\s*Next change\s*</);
  const hunk = review.slice(review.indexOf('className="glass-hunk"'));
  assert.ok(
    hunk.indexOf("glass-hunk-actions") <
      hunk.indexOf('<pre className="glass-code">'),
    "Keep and Reject come before the lines",
  );
  const css = readFileSync(new URL("glass.css", GLASS), "utf8");
  assert.match(
    css,
    /\.story-figure\[data-figure="review"\] \.glass-hunk-actions \{[^}]*position: sticky/,
  );
  assert.match(css, /\.glass-review-bar \{[^}]*position: sticky/);
});

// Found on the 10/12 evening rehearsal: his permission card, hidden under
// the story, keeps focus on its Allow, and a Return answered it there, past
// the 400 ms guard and the whole-request-in-view gate.
test("keys never reach his hidden main pane while the tiles or the story cover it", () => {
  const src = read("GlassLayer.tsx");
  const hold = src.slice(src.indexOf("const hold = (e: KeyboardEvent)"));
  assert.match(hold, /if \(mode === "work"\) return;|e\.key === "Escape" \|\| !t\?\.closest\?\.\(MAIN\)/);
  assert.match(hold.slice(0, 300), /e\.stopPropagation\(\)/);
  assert.match(src, /window\.addEventListener\("keydown", hold, true\)/);
  assert.match(read("Story.tsx"), /window\.addEventListener\("keydown", onKey, true\)/, "the story's keys hear it at capture");
  assert.match(read("Story.tsx"), /!t\.closest\?\.\(HIDDEN_UNDER_STORY\)/);
  // His pane is inert while covered, so the browser's own Return on his
  // focused Allow can't click it either.
  assert.match(src, /el\.inert = true/);
  assert.match(hold.slice(0, 400), /e\.key === "Enter" \|\| e\.key === " "\) e\.preventDefault\(\)/);
  assert.match(src, /window\.addEventListener\("keyup", hold, true\)/);
  // A focused button keeps its own Return: Deny focused is Deny.
  assert.match(read("Story.tsx"), /t\.closest\?\.\(OWNS_KEYS\)/);
  assert.match(read("Story.tsx"), /const OWNS_KEYS =\s*'button,/);
});
