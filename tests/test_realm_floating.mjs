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

test("every piece of Carlton's window chrome is hidden on the glass", () => {
  const hidden = /:root\[data-glass\][^{]*\{\s*display: none !important;/.exec(
    css,
  );
  assert.ok(hidden, "no hide rule");
  const rule = css.slice(
    css.lastIndexOf("/*", hidden.index),
    hidden.index + hidden[0].length,
  );
  for (const cls of [
    ".app-rail",
    ".app > .sidebar",
    ".sidebar-shade",
    ".window-lead",
    ".window-trail",
  ])
    assert.ok(
      rule.includes(`:root[data-glass] ${cls}`),
      `${cls} still draws on the glass`,
    );
  // Any fixed window-* chrome Carlton adds later has to be named here too.
  const realm =
    process.env.CHEWBACCA_REALM_DIR ||
    path.join(os.homedir(), "code/vendor/realm");
  const theirs = path.join(realm, "apps/desktop/src/renderer/src/styles.css");
  if (!existsSync(theirs)) return;
  const fixed = [
    ...readFileSync(theirs, "utf8").matchAll(
      /\n(\.window-[\w-]+) \{[^}]*position: fixed/g,
    ),
  ].map((m) => m[1]);
  assert.ok(
    fixed.length > 0,
    "found none of his fixed window chrome; the pattern drifted",
  );
  for (const cls of fixed)
    assert.ok(
      rule.includes(`:root[data-glass] ${cls}`),
      `${cls} floats on the glass`,
    );
});

test("no copy on the glass points at the sidebar the glass hides", () => {
  for (const name of ["GlassLayer.tsx", "Story.tsx", "FolderPick.tsx"]) {
    const jsx = src(name).replace(/\/\/.*$|\/\*[\s\S]*?\*\//gm, "");
    assert.ok(
      !/in the sidebar/.test(jsx),
      `${name} sends him to a sidebar that isn't drawn`,
    );
  }
});
