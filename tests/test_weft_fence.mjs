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
const fenced = fenceLib.fence(tangle, "/outside/validate_weft.py", "/chewbacca/bin/weft-fence-hook");
const allow = fenced.permissions.allow;

// Every one of these was allowed by Tangle's own list, an earlier fence, or
// both. activate and resync put triggers live, infra start spends money,
// test-node runs Tangle's Rust on the host, the rest delete or reach accounts.
const ESCAPES = [
  ["activate"],
  ["resync"],
  ["bake", "other-project"],
  ["bake", "--trigger", "ask", "other-project"],
  ["bake", "--on", "prod"],
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
  for (const argv of [["validate"], ["run"], ["run", "--target", "sum"], ["--json", "status"], ["describe-nodes", "--list"], ["events", "abc", "--full"], ["freeze", "ok", "abc"], ["files", "ls"], ["daemon", "status"], ["bake"], ["bake", "--trigger", "ask"], ["bake", "--running-policy=wait", "--referenced"]]) {
    assert.equal(fenceLib.refusal(argv), null, `weft ${argv.join(" ")} was refused`);
  }
});

test("a target flag is denied in the permission layer too, wherever it sits", () => {
  for (const flag of ["--dispatcher", "--on"]) {
    assert.ok(fenced.permissions.deny.includes(`Bash(weft * ${flag} *)`));
    assert.ok(fenced.permissions.deny.includes(`Bash(weft * ${flag}=*)`));
  }
});

// The hook reads the raw command, so it holds even when a person's .zshrc
// puts the real weft ahead of the gate. Each of these got past a layer once
// or would get past a plain text match.
test("the hook refuses target flags however the shell would spell them", () => {
  const refused = [
    "weft run --dispatcher http://x",
    "weft run '--dispatcher' x",
    'weft run "--di"spatcher x',
    "weft run --dispa\\tcher x",
    "weft run $'\\x2d-on' p",
    "weft run --{on,x} p",
    "weft run --o? p",
    "weft run --on=prod",
    "weft validate && weft status --on p",
    "WEFT_DISPATCHER_URL=x weft run",
    "weft run `echo --on` p",
    "weft run --dis\\\npatcher x",
    "weft run --on<f",
    "weft run --o(n|x) p",
    "WEFT_TARGET=prod weft run",
    "weft run ~/x",
    "weft run =ls",
  ];
  for (const command of refused) assert.ok(fenceLib.commandRefusal(command), `let through: ${command}`);
  const allowed = ["weft run --once", "weft run --target online", `weft run --from 'lookup={"a":1,"b":2}'`, "weft validate", "weft describe-nodes --node LlmInference --compact"];
  for (const command of allowed) assert.equal(fenceLib.commandRefusal(command), null, `refused: ${command}`);
});

// The words the hook checks must be the words zsh hands weft, or a spelling
// the scanner misreads walks through. Every string here is run through real
// zsh, with the options Claude Code's shell snapshot sets, and the two word
// lists must match exactly; a string the scanner refuses is skipped.
test("the hook splits words exactly as zsh does", { skip: spawnSync("zsh", ["-fc", "true"]).status !== 0 && "no zsh" }, () => {
  const parts = ["--on", "'--o'n", '"--d\\ispatcher"', '"--di"spatcher', "--dis\\\npatcher", "a\\ b", "'it''s'", '"x\\"y"', '"a\\\\b"', "x\\'y", "--on=1", "{a}", "{}", "a=b", "~/x", "%x", "!x", "x#y", "=ls", "a\tb", '""', "''", "-", "--", '"\\\n"', "^x", "a}b", "{a"];
  let compared = 0;
  for (let i = 0; i < 400; i += 1) {
    const pick = Array.from({ length: 1 + (i % 4) }, (_, j) => parts[(i * 7 + j * 13 + (i >> 2)) % parts.length]);
    const command = `p ${pick.join(i % 3 ? " " : "")}`;
    const ours = fenceLib.shellWords(command);
    if (ours.refused) continue;
    const script = `setopt NO_EXTENDED_GLOB NO_BARE_GLOB_QUAL; p(){ for a in "$@"; do print -rn -- "$a"; print -n '\\0'; done; }; ${command}`;
    const zsh = spawnSync("zsh", ["-f", "-c", script], { encoding: "utf8", cwd: tmpdir() });
    const words = zsh.stdout.split("\0").slice(0, -1);
    assert.deepEqual(ours.words.slice(1), words, `zsh and the scanner disagree on ${JSON.stringify(command)}`);
    compared += 1;
  }
  assert.ok(compared > 100, `only ${compared} strings compared`);
});

test("the hook is wired before every Bash call and fails closed", () => {
  const pre = fenced.hooks.PreToolUse[0];
  assert.equal(pre.matcher, "Bash");
  assert.equal(pre.hooks[0].command, 'node "/chewbacca/bin/weft-fence-hook"');
  const hook = join(here, "..", "bin", "weft-fence-hook");
  const run = (input) => spawnSync("node", [hook], { input, encoding: "utf8" });
  assert.equal(run(JSON.stringify({ tool_input: { command: "weft status" } })).status, 0);
  assert.equal(run(JSON.stringify({ tool_input: { command: "weft run --on prod" } })).status, 2);
  assert.equal(run("not json").status, 2);
});

test("the gate runs the real weft only when allowed, without the dispatcher variable", () => {
  const root = mkdtempSync(join(tmpdir(), "weft-gate-"));
  const fake = join(root, "fake-weft");
  writeFileSync(fake, `#!/bin/sh\necho "ran: $* dispatcher=[$WEFT_DISPATCHER_URL] target=[$WEFT_TARGET]"\n`);
  chmodSync(fake, 0o755);
  const dir = fenceLib.gateDir(join(root, "bin"), join(here, "..", "bin", "weft-gate"));
  const env = { ...process.env, PATH: `${dir}:${process.env.PATH}`, WEFT_GATE_REAL: fake, WEFT_DISPATCHER_URL: "http://127.0.0.1:9", WEFT_TARGET: "prod" };
  const ok = spawnSync("weft", ["status"], { env, encoding: "utf8" });
  assert.equal(ok.status, 0);
  assert.equal(ok.stdout.trim(), "ran: status dispatcher=[] target=[]");
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
  assert.ok(source.includes("withoutWeftEnv(process.env)"), "the build can inherit a WEFT_ setting");
  assert.ok(source.includes('"weft-fence-hook"'), "the hook is not wired into the build");
  assert.ok(/freeName\(slugFrom\(/.test(source), "--name reaches a path unslugged");
  assert.ok(!fenceLib.TOOLS.includes("WebFetch") && !fenceLib.TOOLS.includes("WebSearch"));
});
