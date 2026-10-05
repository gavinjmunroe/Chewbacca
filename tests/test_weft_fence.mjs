// The rules a headless Tangle build runs under (bin/lib/weft_fence.js) and
// the one tool it has for running weft (bin/weft-mcp).
//
// tangle-settings.json is the .claude/settings.json `weft new --assistant
// claude-code` wrote on 2026-10-04 (Tangle 0.6.0). Six commit reviews that
// day each found a way past a fence written over shell text; every shape they
// found is in ESCAPES, and none of them can reach weft without a shell.
//
//   node --test tests/test_weft_fence.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const fenceLib = require("../bin/lib/weft_fence.js");
const tangle = JSON.parse(readFileSync(join(here, "fixtures", "weft", "tangle-settings.json"), "utf8"));
const fenced = fenceLib.fence(tangle, "/outside/validate_weft.py");

const ESCAPES = [
  ["activate"],
  ["resync"],
  ["wake"],
  ["test-node"],
  ["infra", "start"],
  ["infra", "--json", "start"],
  ["--json", "activate"],
  ["bake", "other-project"],
  ["bake", "--trigger", "ask", "other-project"],
  ["bake", "--on", "prod"],
  ["--on", "prod", "run"],
  ["run", "--dispatcher", "http://127.0.0.1:9"],
  ["run", "--dispatcher=http://127.0.0.1:9"],
  ["run", "--target", "--dispatcher", "http://127.0.0.1:9"],
  ["run", "--", "--on", "prod"],
  ["status", "--on", "prod"],
  ["events", "--on=prod", "x"],
  ["executions", "--project", "other-project"],
  ["rm", "x"],
  ["clean"],
  ["prune"],
  ["connect", "slack"],
  ["token", "mint"],
  ["options", "x"],
  ["deactivate", "--mode", "wipe"],
  ["stop", "other-project"],
  ["cancel-running", "x"],
  ["catalog", "update"],
  ["files", "rm", "x"],
  ["files", "download", "x"],
  ["daemon", "stop"],
  ["follow", "x"],
  ["ru"],
];

const MALFORMED = [[], ["--json"], "run", [["run"]], ["run", "--seed=x"], ["run", "--target"], ["events"], ["run", "a", "b"], ["diff", "a"]];

const ALLOWED = [
  ["validate"],
  ["--json", "status"],
  ["run"],
  ["run", "--target", "sum"],
  ["run", "--target=sum", "--seed"],
  ["run", "--from", 'lookup={"query":"abc"}'],
  ["run", "--fire", 'ask={"text":"hi"}', "--detach"],
  ["run", "my-example"],
  ["bake", "--trigger", "ask"],
  ["describe-nodes", "--node", "LlmInference", "--compact"],
  ["events", "exec-1", "--node", "sum", "--full"],
  ["diff", "exec-1", "example:sum", "--full"],
  ["freeze", "sum", "exec-1"],
  ["files", "ls"],
  ["daemon", "status"],
];

test("every escape the reviews found is refused", () => {
  for (const argv of ESCAPES) assert.ok(fenceLib.refusal(argv), `weft ${argv.join(" ")} got through`);
});

test("malformed calls are refused rather than guessed at", () => {
  for (const argv of MALFORMED) assert.ok(fenceLib.refusal(argv), `${JSON.stringify(argv)} got through`);
});

test("the build, run and inspect calls Tangle makes go through", () => {
  for (const argv of ALLOWED) assert.equal(fenceLib.refusal(argv), null, `weft ${argv.join(" ")} was refused`);
});

test("every flag in the spec is one the installed weft has", { skip: !existsSync(join(homedir(), ".local", "bin", "weft")) && "weft not installed" }, () => {
  const weft = join(homedir(), ".local", "bin", "weft");
  for (const [verb, spec] of Object.entries(fenceLib.SPEC)) {
    const help = spawnSync(weft, [...verb.split(" "), "--help"], { encoding: "utf8" }).stdout;
    assert.ok(help.includes(`weft ${verb}`), `weft ${verb} is gone`);
    for (const flag of Object.keys(spec.flags)) assert.match(help, new RegExp(`\\s${flag}\\b`), `weft ${verb} no longer has ${flag}`);
  }
});

test("Tangle has no shell and no network tools, only the weft tool", () => {
  for (const tool of ["Bash", "WebFetch", "WebSearch"]) assert.ok(!fenceLib.TOOLS.includes(tool), `${tool} is in TOOLS`);
  assert.deepEqual(fenced.permissions.allow, [fenceLib.TOOL]);
  assert.ok(fenced.permissions.deny.includes("Bash"));
  for (const rule of tangle.permissions.allow) assert.ok(!JSON.stringify(fenced).includes(rule), `Tangle's ${rule} leaked in`);
});

test("the validate hook runs from the copy outside the project", () => {
  assert.equal(fenced.hooks.PostToolUse[0].hooks[0].command, 'python3 "/outside/validate_weft.py"');
  assert.ok(!JSON.stringify(fenced).includes("CLAUDE_PROJECT_DIR"));
});

test("the session plugin carries skills and agents, and its helpers get the weft tool for Bash", () => {
  const root = mkdtempSync(join(tmpdir(), "weft-fence-"));
  const project = join(root, "project");
  for (const part of ["skills/weft-language", "agents", "commands", "hooks"]) mkdirSync(join(project, ".claude", part), { recursive: true });
  writeFileSync(join(project, ".claude", "skills", "weft-language", "SKILL.md"), "---\nname: weft-language\n---\n");
  writeFileSync(join(project, ".claude", "agents", "run-digger.md"), "---\nname: run-digger\ntools: Read, Grep, Glob, Bash\n---\nRun `weft events` with Bash.\n");
  writeFileSync(join(project, ".claude", "settings.json"), JSON.stringify(tangle));
  const plugin = fenceLib.packagePlugin(project, join(root, "plugin"));
  assert.ok(existsSync(join(plugin, "skills", "weft-language", "SKILL.md")));
  const agent = readFileSync(join(plugin, "agents", "run-digger.md"), "utf8");
  assert.match(agent, /^tools: Read, Grep, Glob, mcp__weft__weft$/m);
  assert.match(agent, /with Bash\.$/m, "only the tools line changes");
  assert.equal(JSON.parse(readFileSync(join(plugin, ".claude-plugin", "plugin.json"), "utf8")).name, "tangle");
  assert.ok(!existsSync(join(plugin, "settings.json")));
  assert.ok(!existsSync(join(plugin, "hooks")));
});

// Drives bin/weft-mcp the way Claude Code does, against a stand-in weft that
// records what it was handed.
function mcpSession(calls) {
  const root = mkdtempSync(join(tmpdir(), "weft-mcp-"));
  const project = join(root, "project");
  mkdirSync(project);
  const record = join(root, "record.jsonl");
  const fake = join(root, "weft");
  writeFileSync(
    fake,
    `#!/usr/bin/env node\nrequire("fs").appendFileSync(${JSON.stringify(record)}, JSON.stringify({argv: process.argv.slice(2), cwd: process.cwd(), weftEnv: Object.keys(process.env).filter((k) => k.startsWith("WEFT_")), stdin: require("fs").readFileSync(0, "utf8")}) + "\\n");\nprocess.stdout.write("ok");\n`,
  );
  chmodSync(fake, 0o755);
  const server = spawn(process.execPath, [join(here, "..", "bin", "weft-mcp"), project, fake], {
    env: { ...process.env, WEFT_DISPATCHER_URL: "http://127.0.0.1:9", WEFT_TARGET: "prod" },
  });
  const messages = [
    { jsonrpc: "2.0", id: 0, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } } },
    { jsonrpc: "2.0", method: "notifications/initialized" },
    { jsonrpc: "2.0", id: 1, method: "tools/list" },
    ...calls.map((args, i) => ({ jsonrpc: "2.0", id: 10 + i, method: "tools/call", params: { name: "weft", arguments: args } })),
  ];
  return new Promise((resolve) => {
    let out = "";
    const replies = new Map();
    server.stdout.on("data", (chunk) => {
      out += chunk;
      const lines = out.split("\n");
      out = lines.pop();
      for (const line of lines) {
        const reply = JSON.parse(line);
        replies.set(reply.id, reply);
      }
      if (replies.size === calls.length + 2) {
        server.kill();
        const ran = existsSync(record) ? readFileSync(record, "utf8").trim().split("\n").map((line) => JSON.parse(line)) : [];
        resolve({ replies, ran, project });
      }
    });
    server.stdin.write(messages.map((m) => JSON.stringify(m)).join("\n") + "\n");
  });
}

test("the weft tool runs exactly the argv it was handed, with no shell, here, and without WEFT_ settings", async () => {
  const literal = ["run", "--from", 'x=$(touch /tmp/weft-mcp-pwned);`id`'];
  const { replies, ran, project } = await mcpSession([{ argv: literal }, { argv: ["validate"], stdin: "a = Text { value: \"x\" }\n" }]);
  assert.deepEqual(replies.get(1).result.tools.map((tool) => tool.name), ["weft"]);
  assert.equal(replies.get(10).result.isError, false);
  // The two calls run side by side, so the record is matched by argv.
  assert.equal(ran.length, 2);
  const run = ran.find((call) => call.argv[0] === "run");
  const validate = ran.find((call) => call.argv[0] === "validate");
  assert.deepEqual(run.argv, literal);
  assert.equal(run.cwd, realpathSync(project));
  assert.deepEqual(run.weftEnv, []);
  assert.equal(validate.stdin, 'a = Text { value: "x" }\n');
  assert.ok(!existsSync("/tmp/weft-mcp-pwned"));
});

test("the weft tool refuses before running anything", async () => {
  const escapes = [{ argv: ["run", "--dispatcher", "http://127.0.0.1:9"] }, { argv: ["activate"] }, { argv: "run --on prod" }, {}];
  const { replies, ran } = await mcpSession(escapes);
  for (let i = 0; i < escapes.length; i += 1) {
    assert.equal(replies.get(10 + i).result.isError, true);
    assert.match(replies.get(10 + i).result.content[0].text, /^refused: /);
  }
  assert.deepEqual(ran, []);
});

test("weft-build runs Tangle with no shell and only the weft tool", () => {
  const source = readFileSync(join(here, "..", "bin", "weft-build"), "utf8");
  for (const flag of ['"--restricted"', '"--plugin-dir"', '"--mcp-config"', '"--strict-mcp-config"', '"--tools"']) assert.ok(source.includes(flag), `${flag} is gone`);
  assert.ok(source.includes("withoutWeftEnv(process.env)"), "the build can inherit a WEFT_ setting");
  assert.ok(/freeName\(slugFrom\(/.test(source), "--name reaches a path unslugged");
  assert.ok(!existsSync(join(here, "..", "bin", "weft-gate")), "the shell-era gate is back");
});
