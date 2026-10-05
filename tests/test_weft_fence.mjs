// The rules a headless Tangle build runs under (bin/lib/weft_fence.js) and
// the one tool it has for running weft (bin/weft-mcp), plus the VM side:
// the weft-box config and the runner inside it (mac/weft-box/weft-box.yaml).
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
const fenced = fenceLib.fence(tangle, "/outside/validate_weft.py", "/outside/bin");

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
  ["ps"],
  ["files", "ls"],
  ["files", "inspect", "x"],
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

test("ids must be whole ids this project owns, and example names plain names", () => {
  const owned = { executions: new Set(["exec-own"]), versions: new Set(["version-own"]) };
  for (const argv of [
    ["events", "exec-own"],
    ["logs"],
    ["freeze", "sum", "exec-own"],
    ["diff", "exec-own", "example:sum"],
    ["branch", "version-own"],
    ["run", "sum", "--save", "sum-2"],
  ]) {
    assert.equal(fenceLib.scopeRefusal(argv, owned), null, `weft ${argv.join(" ")} was refused`);
  }
  for (const argv of [
    ["events", "exec-other"],
    ["events", "exec"],
    ["logs", "exec-other"],
    ["freeze", "steal", "exec-other"],
    ["freeze", "../outside"],
    ["diff", "exec-own", "example:../x"],
    ["branch", "version-other"],
    ["run", "../../x"],
    ["run", "--save", "a/b"],
  ]) {
    assert.ok(fenceLib.scopeRefusal(argv, owned), `weft ${argv.join(" ")} got through`);
  }
  assert.deepEqual(fenceLib.scopedArgv(["executions", "--limit", "5"], "P"), ["executions", "--limit", "5", "--project", "P"]);
  assert.deepEqual(fenceLib.scopedArgv(["run"], "P"), ["run"]);
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

// Drives bin/weft-mcp the way Claude Code does, against a stand-in runner
// that speaks weft-box's protocol (first line JSON {argv, cwd}, then weft's
// stdin) and records what it was handed.
const PROJECT_ID = "11111111-2222-3333-4444-555555555555";

function mcpSession(calls, { statusId = PROJECT_ID, registered = true, dotenv = false, parentDotenv = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), "weft-mcp-"));
  const project = join(root, "project");
  mkdirSync(project);
  if (dotenv) writeFileSync(join(project, ".env"), "WEFT_DISPATCHER_URL=http://127.0.0.1:9\n");
  if (parentDotenv) writeFileSync(join(root, ".env"), "WEFT_DISPATCHER_URL=http://127.0.0.1:9\n");
  const record = join(root, "record.jsonl");
  const runner = join(root, "runner");
  writeFileSync(
    runner,
    [
      "#!/usr/bin/env node",
      "const fs = require('fs');",
      "const input = fs.readFileSync(0, 'utf8');",
      "const cut = input.indexOf('\\n');",
      "const { argv, cwd } = JSON.parse(input.slice(0, cut));",
      `fs.appendFileSync(${JSON.stringify(record)}, JSON.stringify({ mode: process.argv[2], argv, cwd, stdin: input.slice(cut + 1) }) + "\\n");`,
      `if (argv[0] === "status") process.stdout.write(JSON.stringify(${registered} ? { id: ${JSON.stringify(statusId)} } : { registered: false, project_id: ${JSON.stringify(statusId)} }));`,
      `else if (argv[0] === "executions" && argv.includes("--offset")) process.stdout.write(JSON.stringify({ executions: [{ execution_id: "exec-own", project_id: ${JSON.stringify(PROJECT_ID)} }, { execution_id: "exec-other", project_id: "someone-else" }], total: 2 }));`,
      `else if (argv[0] === "tree") process.stdout.write(JSON.stringify({ versions: [{ id: "version-own" }] }));`,
      "else process.stdout.write('ok');",
      "",
    ].join("\n"),
  );
  chmodSync(runner, 0o755);
  const server = spawn(process.execPath, [join(here, "..", "bin", "weft-mcp"), project, runner, PROJECT_ID]);
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

test("the weft tool hands the runner exactly the argv it was given, as data, from this project", async () => {
  const literal = ["run", "--from", 'x=$(touch /tmp/weft-mcp-pwned);`id`'];
  const { replies, ran, project } = await mcpSession([{ argv: literal }, { argv: ["validate"], stdin: 'a = Text { value: "x" }\n' }]);
  assert.deepEqual(replies.get(1).result.tools.map((tool) => tool.name), ["weft"]);
  assert.equal(replies.get(10).result.isError, false);
  // The calls run side by side, so the record is matched by argv. Each is
  // preceded by weft's own `status --json`.
  assert.equal(ran.filter((call) => call.argv[0] === "status").length, 2);
  assert.ok(ran.every((call) => call.mode === "run"));
  const run = ran.find((call) => call.argv[0] === "run");
  const validate = ran.find((call) => call.argv[0] === "validate");
  assert.deepEqual(run.argv, literal);
  assert.equal(run.cwd, realpathSync(project));
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

test("the weft tool checks ids against this project and pins executions to it", async () => {
  const calls = [{ argv: ["events", "exec-own"] }, { argv: ["events", "exec-other"] }, { argv: ["executions"] }];
  const { replies, ran } = await mcpSession(calls);
  assert.equal(replies.get(10).result.isError, false);
  assert.match(replies.get(11).result.content[0].text, /^refused: exec-other is not a whole execution id of this project/);
  assert.ok(!ran.some((call) => call.argv[0] === "events" && call.argv[1] === "exec-other"), "the other project's run was read");
  const listed = ran.find((call) => call.argv[0] === "executions" && !call.argv.includes("--offset"));
  assert.deepEqual(listed.argv, ["executions", "--project", PROJECT_ID]);
});

test("a .env in the project or the projects folder stops weft before it runs", async () => {
  for (const where of [{ dotenv: true }, { parentDotenv: true }]) {
    const { replies, ran } = await mcpSession([{ argv: ["status"] }], where);
    assert.match(replies.get(10).result.content[0].text, /^refused: .*\.env sets weft's own settings/);
    assert.deepEqual(ran, []);
  }
});

test("a project that has never run is recognised by the id weft reports for it", async () => {
  const { replies } = await mcpSession([{ argv: ["validate"] }], { registered: false });
  assert.equal(replies.get(10).result.isError, false);
  const swapped = await mcpSession([{ argv: ["validate"] }], { registered: false, statusId: "99999999-0000-0000-0000-000000000000" });
  assert.match(swapped.replies.get(10).result.content[0].text, /^refused: weft.toml no longer names/);
});

test("the weft tool refuses everything once weft.toml names another project", async () => {
  const { replies, ran } = await mcpSession([{ argv: ["run"] }], { statusId: "99999999-0000-0000-0000-000000000000" });
  assert.match(replies.get(10).result.content[0].text, /^refused: weft.toml no longer names/);
  assert.deepEqual(ran.map((call) => call.argv[0]), ["status"]);
});

test("the validate hook finds the VM shim first on its PATH", () => {
  const command = fenced.hooks.PostToolUse[0].hooks[0].command;
  assert.match(command, /^PATH="\/outside\/bin:\/usr\/bin:\/bin" python3 "\/outside\/validate_weft.py"$/);
});

test("weft-build runs Tangle with no shell, only the weft tool, and weft in the VM", () => {
  const source = readFileSync(join(here, "..", "bin", "weft-build"), "utf8");
  for (const flag of ['"--restricted"', '"--plugin-dir"', '"--mcp-config"', '"--strict-mcp-config"', '"--tools"']) assert.ok(source.includes(flag), `${flag} is gone`);
  assert.ok(source.includes("withoutWeftEnv(process.env)"), "the build can inherit a WEFT_ setting");
  assert.ok(/freeName\(slugFrom\(/.test(source), "--name reaches a path unslugged");
  assert.ok(/mcpConfig\(.*\bBOX\b/.test(source), "the weft tool no longer goes through the VM");
  assert.ok(!existsSync(join(here, "..", "bin", "weft-gate")), "the shell-era gate is back");
});

// The VM. Its first build, from `base: template:ubuntu-24.04`, merged the
// template's read-only mount of the whole home folder into this file's one
// mount, and ~/.env was readable inside (2026-10-04).
const boxConfig = readFileSync(join(here, "..", "mac", "weft-box", "weft-box.yaml"), "utf8");

test("the VM inherits no template and mounts only the projects folder", () => {
  assert.ok(!/^base:/m.test(boxConfig), "a template base merges its mounts in");
  const mounts = boxConfig.split(/^mounts:\n/m)[1].split(/^\S/m)[0];
  assert.equal((mounts.match(/- location:/g) || []).length, 1);
  assert.match(mounts, /- location: "__PROJECTS__"/);
  assert.match(boxConfig, /forwardAgent: false/);
  const forwards = boxConfig.split(/^portForwards:\n/m)[1].split(/^\S/m)[0];
  assert.match(forwards, /guestPort: 14111\n\s+hostIP: 127\.0\.0\.1/);
  assert.match(forwards, /guestPortRange: \[1, 65535\]\n\s+ignore: true/);
});

// weft-argv, the runner inside the VM, run here against a stand-in weft.
function guestRunner(request, stdin = "") {
  const root = mkdtempSync(join(tmpdir(), "weft-argv-"));
  const projects = join(root, "projects");
  mkdirSync(join(projects, "one"), { recursive: true });
  mkdirSync(join(root, "home", ".local", "bin"), { recursive: true });
  const record = join(root, "record.json");
  const weft = join(root, "home", ".local", "bin", "weft");
  writeFileSync(
    weft,
    `#!/usr/bin/env node\nconst fs = require("fs");\nfs.writeFileSync(${JSON.stringify(record)}, JSON.stringify({ argv: process.argv.slice(2), cwd: process.cwd(), weftEnv: Object.keys(process.env).filter((k) => k.startsWith("WEFT_")), stdin: fs.readFileSync(0, "utf8") }));\n`,
  );
  chmodSync(weft, 0o755);
  const source = boxConfig.split("<<'RUNNER'\n")[1].split(/\n\s*RUNNER\n/)[0].replace(/^ {6}/gm, "").replace(/__PROJECTS__/g, realpathSync(projects));
  const script = join(root, "weft-argv");
  writeFileSync(script, source);
  const line = typeof request === "string" ? request : JSON.stringify({ ...request, cwd: request.cwd && join(realpathSync(projects), request.cwd) });
  const result = spawnSync("python3", [script], {
    input: `${line}\n${stdin}`,
    env: { ...process.env, HOME: join(root, "home"), WEFT_DISPATCHER_URL: "http://127.0.0.1:9" },
    encoding: "utf8",
  });
  return { result, ran: existsSync(record) ? JSON.parse(readFileSync(record, "utf8")) : null, projects: realpathSync(projects) };
}

test("the VM runner runs weft with the argv as given, no WEFT_ settings, and the rest of stdin intact", () => {
  const { result, ran, projects } = guestRunner({ argv: ["validate", "--file", "src/main.weft"], cwd: "one" }, "line one\nline two\n");
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(ran.argv, ["validate", "--file", "src/main.weft"]);
  assert.equal(ran.cwd, join(projects, "one"));
  assert.deepEqual(ran.weftEnv, []);
  assert.equal(ran.stdin, "line one\nline two\n");
});

test("the VM runner refuses a folder outside the projects mount and a non-list argv", () => {
  for (const cwd of ["..", "../..", "one/../.."]) {
    const { result, ran } = guestRunner({ argv: ["status"], cwd });
    assert.notEqual(result.status, 0, `cwd ${cwd} was accepted`);
    assert.equal(ran, null);
  }
  const { result, ran } = guestRunner({ argv: "status --on prod", cwd: "one" });
  assert.notEqual(result.status, 0);
  assert.equal(ran, null);
});
