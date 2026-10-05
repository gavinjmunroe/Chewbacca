// The rules a headless Tangle build runs under (bin/lib/weft_fence.js) and
// the gate that stands in for `weft` on its PATH (bin/weft-gate).
//
// tangle-settings.json is the .claude/settings.json `weft new --assistant
// claude-code` wrote on 2026-10-04 (Tangle 0.6.0). Three commit reviews that
// day each found a way past the fence; every one has a test here.
//
//   node --test tests/test_weft_fence.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
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

// Every one of these was allowed by Tangle's own list, an earlier fence, or
// both. activate and resync put triggers live, infra start spends money,
// test-node runs Tangle's Rust on the host, the rest delete or reach accounts.
const ESCAPES = [
  ["activate"],
  ["resync"],
  ["bake"],
  ["wake"],
  ["test-node"],
  ["infra", "start"],
  ["infra", "--json", "start"],
  ["--json", "activate"],
  ["--on", "prod", "run"],
  ["run", "--dispatcher", "http://127.0.0.1:9"],
  ["run", "--dispatcher=http://127.0.0.1:9"],
  ["status", "--on", "prod"],
  ["events", "--on=prod", "x"],
  ["rm", "x"],
  ["clean"],
  ["connect", "slack"],
  ["token", "mint"],
  ["deactivate", "--mode", "wipe"],
  ["stop", "other-project"],
  ["cancel-running", "x"],
  ["catalog", "update"],
  ["options", "x"],
  ["files", "rm", "x"],
  ["daemon", "stop"],
];

test("the allow list comes from the fence, never from Tangle's settings", () => {
  assert.ok(tangle.permissions.allow.includes("Bash(weft infra --json:*)"), "fixture changed");
  assert.deepEqual(allow, fenceLib.allowRules());
  assert.ok(!allow.some((r) => r.includes("--")), "an allow rule carries a flag");
  assert.ok(!allow.some((r) => !r.startsWith("Bash(weft ")), "something other than weft is allowed");
});

test("the gate refuses every escape the reviews found", () => {
  for (const argv of ESCAPES) assert.ok(fenceLib.refusal(argv), `weft ${argv.join(" ")} was let through`);
});

test("the gate lets the build and inspect verbs through", () => {
  for (const argv of [["validate"], ["run"], ["run", "--target", "sum"], ["--json", "status"], ["describe-nodes", "--list"], ["events", "abc", "--full"], ["freeze", "ok", "abc"], ["files", "ls"], ["daemon", "status"]]) {
    assert.equal(fenceLib.refusal(argv), null, `weft ${argv.join(" ")} was refused`);
  }
});

test("a target flag is denied in the permission layer too, wherever it sits", () => {
  for (const flag of ["--dispatcher", "--on"]) {
    assert.ok(fenced.permissions.deny.includes(`Bash(weft * ${flag} *)`));
    assert.ok(fenced.permissions.deny.includes(`Bash(weft * ${flag}=*)`));
  }
});

test("the gate runs the real weft only when allowed, without the dispatcher variable", () => {
  const root = mkdtempSync(join(tmpdir(), "weft-gate-"));
  const fake = join(root, "fake-weft");
  writeFileSync(fake, `#!/bin/sh\necho "ran: $* dispatcher=[$WEFT_DISPATCHER_URL]"\n`);
  chmodSync(fake, 0o755);
  const dir = fenceLib.gateDir(join(root, "bin"), join(here, "..", "bin", "weft-gate"));
  const env = { ...process.env, PATH: `${dir}:${process.env.PATH}`, WEFT_GATE_REAL: fake, WEFT_DISPATCHER_URL: "http://127.0.0.1:9" };
  const ok = spawnSync("weft", ["status"], { env, encoding: "utf8" });
  assert.equal(ok.status, 0);
  assert.equal(ok.stdout.trim(), "ran: status dispatcher=[]");
  const no = spawnSync("weft", ["activate"], { env, encoding: "utf8" });
  assert.equal(no.status, 2);
  assert.equal(no.stdout, "");
  assert.match(no.stderr, /not allowed in this build/);
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

test("weft-build runs Tangle under the fence and the gate", () => {
  const source = readFileSync(join(here, "..", "bin", "weft-build"), "utf8");
  for (const flag of ['"--restricted"', '"--plugin-dir"']) assert.ok(source.includes(flag), `${flag} is gone`);
  assert.ok(!source.includes('"--setting-sources"'));
  assert.ok(source.includes("gateDir("), "the gate is not on Tangle's PATH");
  assert.ok(source.includes("delete tangleEnv.WEFT_DISPATCHER_URL"));
  assert.ok(!fenceLib.TOOLS.includes("WebFetch") && !fenceLib.TOOLS.includes("WebSearch"));
});
