// Nothing floats on the glass without a reason Caleb would name.
// Caleb, 2026-10-11 8:40pm: "not hv unintentional floating things for no
// valuable reason". The floating audit (headless WebKit against a scratch
// realm engine, every state of the surface, 2026-10-12) found four:
//   - beside his transcript, the stage drew "Needs you / It's waiting on you"
//     next to his own permission card, which already has Allow and Deny
//   - at done it drew a second diff of the whole turn beside his own
//     "Edited 2 files" card with Review, running 157 px off the glass
//   - the trail of earlier beats sat as bare text on the desktop, no surface
//   - Carlton's "Show side panel" button floated alone in the top right
//     corner, off his app, over the desktop
// And the tiles said "N more agents in the sidebar" while the glass hides
// the sidebar. This holds each of them shut.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import * as t from "../bin/lib/realm_ui/glass/turn.mjs";

const DIR = new URL("../bin/lib/realm_ui/glass/", import.meta.url);
const src = (n) => readFileSync(new URL(n, DIR), "utf8");
const layer = src("GlassLayer.tsx");
const css = src("glass.css");

/** The body of `function Name(` up to the next top-level function. */
function body(text, name) {
  const at = text.indexOf(`function ${name}(`);
  const next = text.slice(at + 1).search(/\n(?:export )?function \w+\(/);
  return next < 0 ? text.slice(at) : text.slice(at, at + 1 + next);
}

test("beside the transcript the stage draws only what the transcript lists as a row", () => {
  const file = { path: "web/lib/orgs.ts", done: false };
  const tests = { command: "pnpm vitest run", done: true };
  assert.equal(t.stageObject(null), null);
  assert.equal(
    t.stageObject(t.Turn.asked("fix it")),
    null,
    "his own message says it",
  );
  assert.equal(
    t.stageObject(t.Turn.reading("fix it", "orgs.ts")),
    null,
    "a file read is a row and nothing more",
  );
  assert.equal(
    t.stageObject(t.Turn.reading("fix it", "ls", 0, { command: "ls -R src" })),
    "command",
  );
  assert.equal(t.stageObject(t.Turn.changing("fix it", file)), "file");
  assert.equal(t.stageObject(t.Turn.proved("fix it", tests)), "tests");
  assert.equal(
    t.stageObject(
      t.Turn.needsYou("fix it", "Allow Bash?", t.Turn.asked("fix it")),
    ),
    null,
    "his permission card has Allow and Deny already",
  );
  assert.equal(
    t.stageObject(t.Turn.done("fix it")),
    null,
    "his Edited card has Review already",
  );
  assert.equal(
    t.stageObject(t.Turn.failed("fix it", t.fault("agent-error", "boom"))),
    "fault",
    "an error stays a value on the glass",
  );
});

test("the stage draws through stageObject and never the trail", () => {
  const stage = body(layer, "Stage");
  assert.ok(
    stage.includes("stageObject(turn)"),
    "Stage doesn't ask stageObject",
  );
  assert.ok(!/trail/.test(stage), "Stage still draws the trail");
  assert.ok(!/<Review\b/.test(stage), "Stage still draws a second Review");
  assert.ok(!/Needs you/.test(stage), "Stage still draws a Needs you card");
  assert.ok(!css.includes(".glass-trail"), "the trail's styles outlived it");
});

// 10/12 4:10pm, after his first live test with this chrome hidden: "Bro
// study carlton's UX on realm, we need buttons to get through a UX". Every
// piece of Carlton's window chrome stays on the glass (skills/hud/SKILL.md,
// "His navigation stays"); this held the opposite until that day.
const CHROME = [".app-rail", ".sidebar", ".sidebar-shade", ".window-lead", ".window-trail", ".side-pane-toggle", ".rail-btn", ".sb-header"];
test("no piece of Carlton's window chrome is hidden on the glass", () => {
  for (const m of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    const [sel, decl] = [m[1], m[2]];
    if (!/display:\s*none|visibility:\s*hidden|opacity:\s*0[;\s]/.test(decl)) continue;
    for (const cls of CHROME)
      assert.ok(
        !new RegExp(`\\${cls}(?![\\w-])`).test(sel.replace(/\/\*[\s\S]*?\*\//g, "")),
        `${cls} is hidden by: ${sel.trim().slice(0, 80)}`,
      );
  }
  // And his whole app is never hidden in any mode: it is the frame.
  assert.doesNotMatch(css, /:root\[data-glass="(tiles|story)"\] #root \{[^}]*(visibility:\s*hidden|opacity:\s*0)/);
  // Any fixed window-* chrome Carlton adds later moves down under our bar
  // with the rest, or it would sit under the bar, unpressable.
  const realm = process.env.CHEWBACCA_REALM_DIR || path.join(os.homedir(), "code/vendor/realm");
  const theirs = path.join(realm, "apps/desktop/src/renderer/src/styles.css");
  if (!existsSync(theirs)) return;
  const fixed = [...readFileSync(theirs, "utf8").matchAll(/\n(\.window-[\w-]+) \{[^}]*position: fixed/g)].map((m) => m[1]);
  assert.ok(fixed.length > 0, "found none of his fixed window chrome; the pattern drifted");
  const moved = /([^{}]*)\{[^}]*translate:\s*0 calc\(var\(--glass-bar-h\)/.exec(css)?.[1] ?? "";
  // His connection banner (top 0, z 30, with Retry) too: under the bar
  // its buttons couldn't be seen or pressed (review, 10/12).
  for (const cls of [...fixed, ".conn-banner", ".sidebar-shade"])
    assert.ok(moved.includes(`:root[data-glass] ${cls}`), `${cls} sits under the bar`);
});

test("the bridge never asks Caleb's fork to put his chrome away", () => {
  const bridge = readFileSync(new URL("../bridge.js", DIR), "utf8");
  assert.match(bridge, /frameless: false,/);
});

// Day polish, 10/12. Measured on his default build in headless WebKit with
// the fake agent (day-ide-report.md): 40 rl-orb-breathe loops ran under the
// tiles with no agents, 44 under the story while needs-you, 43 under the
// tiles after a turn, all inside a #root nobody could see.
test("his hidden app's loops are paused while the tiles or the story cover it, and run again in the workspace", () => {
  // Only his main pane, which the tiles and the story cover: his sidebar is
  // on screen and its status dots keep moving.
  for (const mode of ["tiles", "story"])
    for (const sel of [`:root[data-glass="${mode}"] #root .main *`, `:root[data-glass="${mode}"] #root .main *::before`, `:root[data-glass="${mode}"] #root .main *::after`])
      assert.ok(css.includes(sel), sel);
  assert.ok(!css.includes(':root[data-glass="tiles"] #root *'), "the sidebar's dots paused while on screen");
  const rule = /:root\[data-glass="tiles"\] #root \.main \*,[\s\S]*?\{([^}]*)\}/.exec(css)?.[1] ?? "";
  assert.match(rule, /animation-play-state:\s*paused\s*!important/);
  assert.doesNotMatch(rule, /animation:\s*none/, "paused, not removed: his entrances resume where they were");
  assert.ok(!css.includes(':root[data-glass="work"] #root *'), "never paused where he can see it");
});

// The 12:33am verify: in review the second file's diff ran off its card and
// its Keep and Reject sat below the fold.
test("every file's Keep and Reject stay on screen in the story's review", () => {
  const block = (sel) => new RegExp(`${sel.replace(/[[\]().*"=>]/g, "\\$&")}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? "";
  assert.match(block('.story-figure[data-figure="review"]'), /overflow:\s*hidden/, "the figure itself never scrolls a verb away");
  assert.match(block('.story-figure[data-figure="review"] > .glass-card'), /min-height:\s*0/);
  assert.match(block('.story-figure[data-figure="review"]'), /align-self:\s*stretch/, "a centered figure has no height to shrink against");
  assert.match(block('.story-figure[data-figure="review"] .glass-hunk .glass-code'), /overflow-y:\s*auto/, "the lines give up height, inside themselves");
  assert.match(block('.story-figure[data-figure="review"] .glass-hunk .glass-code'), /max-height:/, "a big hunk can't squeeze a small one to nothing");
  const fixed = /\.story-figure\[data-figure="review"\] \.glass-card > \*,[\s\S]*?\.glass-hunk-actions\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
  assert.match(fixed, /flex:\s*none/, "heads and actions never shrink");
});

// The floating audit counted 48 words on the tiles after a turn: the needs-you
// tile said "Needs you" and then "It's waiting on you".
test("a tile waiting with nothing more to say says it once", () => {
  const view = t.restingView(
    [{ id: "a", title: "Build the toggle", status: "waiting_permission", cwd: "/r", agentKind: "fake" }],
    {},
    {},
    true,
  );
  assert.equal(view.tiles[0].word, "Needs you");
  assert.equal(view.tiles[0].line, "", "the stand-in question repeats the word");
  const asked = t.Turn.needsYou("go", "Allow Bash?", t.Turn.asked("go"));
  assert.equal(t.restingView([{ id: "b", title: "go", status: "running" }], { b: { ...t.emptyAgent(), turn: asked } }, {}, true).tiles[0].line, "Allow Bash?");
});

test("a done tile says the answer's first sentence as words, not Markdown", () => {
  const done = t.Turn.done("add slugify", { said: "I added `slugify` to [src/text.js](src/text.js). Then more." });
  const view = t.restingView([{ id: "d", title: "add slugify", status: "idle" }], { d: { ...t.emptyAgent(), turn: done } }, {}, true);
  assert.equal(view.tiles[0].line, "I added slugify to src/text.js.");
});

// Opening every frame of the 10/12 rehearsal: the frame right after a beat
// change showed no headline and no figure, both fading in from opacity 0.
test("the headline never enters invisible, so a beat change can't flash an empty story", () => {
  const rule = /\.story-headline\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
  const name = /animation:\s*([\w-]+)/.exec(rule)?.[1];
  assert.ok(name, "the headline has an entrance");
  const from = new RegExp(`@keyframes ${name}\\s*\\{\\s*from\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? "";
  const opacity = Number(/opacity:\s*([\d.]+)/.exec(from)?.[1] ?? 1);
  assert.ok(opacity >= 0.5, `the headline starts at opacity ${opacity}`);
});
