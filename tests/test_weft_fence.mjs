// The rules a headless Tangle build runs under (bin/lib/weft_fence.js).
//
// tangle-settings.json is the .claude/settings.json `weft new --assistant
// claude-code` wrote on 2026-10-04 (Tangle 0.6.0). The commit review found two
// escapes in the first fence; each has a test here that fails on that version.
//
//   node --test tests/test_weft_fence.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const fenceLib = require("../bin/lib/weft_fence.js");
const tangle = JSON.parse(readFileSync(join(here, "fixtures", "weft", "tangle-settings.json"), "utf8"));
const fenced = fenceLib.fence(tangle, "/outside/validate_weft.py");
const allow = fenced.permissions.allow;

test("no refused verb survives in the allow list", () => {
  for (const verb of ["weft activate", "weft infra start", "weft infra upgrade", "weft rm", "weft clean", "weft connect", "weft token"]) {
    assert.ok(tangle.permissions.allow.some((r) => r.startsWith(`Bash(${verb}`)), `fixture should allow ${verb} before fencing`);
    assert.ok(!allow.some((r) => r.startsWith(`Bash(${verb}`)), `${verb} is still allowed`);
  }
});

test("a flag before the verb cannot reach a refused verb", () => {
  // Tangle ships `weft infra --json:*`, which covered `weft infra --json start`.
  assert.ok(tangle.permissions.allow.includes("Bash(weft infra --json:*)"));
  assert.ok(!allow.some((r) => /--/.test(r)), "an allow rule with a flag in its prefix survived");
  for (const rule of ["Bash(weft --json:*)", "Bash(weft infra --json:*)", "Bash(weft --on:*)", "Bash(weft --dispatcher:*)"]) {
    assert.ok(fenced.permissions.deny.includes(rule), `${rule} is not denied`);
  }
});

test("no allowed verb compiles Tangle's code on the host or puts a trigger live", () => {
  // test-node runs a project's Rust with plain cargo outside Docker; resync is
  // deactivate-then-activate. Both were allowed by the first fence.
  for (const verb of ["weft test-node", "weft resync"]) {
    assert.ok(tangle.permissions.allow.some((r) => r.startsWith(`Bash(${verb}`)), `fixture should allow ${verb} before fencing`);
    assert.ok(!allow.some((r) => r.startsWith(`Bash(${verb}`)), `${verb} is still allowed`);
  }
});

test("a target flag after the verb is denied wherever it sits", () => {
  // `weft run --dispatcher <url>` posts the program to that address.
  for (const flag of ["--dispatcher", "--on"]) {
    assert.ok(fenced.permissions.deny.includes(`Bash(weft * ${flag} *)`), `${flag} with a space is not denied`);
    assert.ok(fenced.permissions.deny.includes(`Bash(weft * ${flag}=*)`), `${flag}= is not denied`);
  }
});

test("the build and inspect verbs Tangle needs stay allowed", () => {
  for (const rule of ["Bash(weft validate:*)", "Bash(weft run:*)", "Bash(weft describe-nodes:*)", "Bash(weft events:*)", "Bash(weft freeze:*)"]) {
    assert.ok(allow.includes(rule), `${rule} was dropped`);
  }
});

test("the validate hook runs from the copy outside the project", () => {
  const command = fenced.hooks.PostToolUse[0].hooks[0].command;
  assert.equal(command, 'python3 "/outside/validate_weft.py"');
  assert.ok(!JSON.stringify(fenced).includes("CLAUDE_PROJECT_DIR"));
});

test("the session plugin carries skills and agents and nothing that sets rules", () => {
  const root = mkdtempSync(join(tmpdir(), "weft-fence-"));
  const project = join(root, "project");
  for (const part of ["skills/weft-language", "agents", "commands", "hooks"]) mkdirSync(join(project, ".claude", part), { recursive: true });
  writeFileSync(join(project, ".claude", "skills", "weft-language", "SKILL.md"), "---\nname: weft-language\n---\n");
  writeFileSync(join(project, ".claude", "agents", "node-smith.md"), "---\nname: node-smith\n---\n");
  writeFileSync(join(project, ".claude", "settings.json"), JSON.stringify(tangle));
  const plugin = fenceLib.packagePlugin(project, join(root, "plugin"));
  assert.ok(existsSync(join(plugin, "skills", "weft-language", "SKILL.md")));
  assert.ok(existsSync(join(plugin, "agents", "node-smith.md")));
  assert.equal(JSON.parse(readFileSync(join(plugin, ".claude-plugin", "plugin.json"), "utf8")).name, "tangle");
  assert.ok(!existsSync(join(plugin, "settings.json")));
  assert.ok(!existsSync(join(plugin, "hooks")));
});

test("weft-build runs Tangle under the fence, never the project's own rules", () => {
  const source = readFileSync(join(here, "..", "bin", "weft-build"), "utf8");
  assert.ok(source.includes('"--restricted"'));
  assert.ok(source.includes('"--plugin-dir"'));
  assert.ok(!/path\.join\(dir, "\.claude", "settings\.json"\)\s*,?\s*\n\s*"--/.test(source), "the project's settings file is passed as --settings");
  assert.ok(!source.includes('"--setting-sources"'));
  assert.ok(!fenceLib.TOOLS.includes("WebFetch") && !fenceLib.TOOLS.includes("WebSearch"));
  assert.ok(source.includes("delete tangleEnv.WEFT_DISPATCHER_URL"), "the build can inherit a dispatcher address");
});
