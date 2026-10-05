"use strict";

const fs = require("node:fs");
const path = require("node:path");

// The rules a headless Tangle build runs under.
//
// Tangle gets no shell. Six commit reviews on 2026-10-04 each found a new way
// past a policy written over shell text: a flag before the verb, quoting,
// backslash-newline, zsh glob alternation, a person's .zshrc putting the real
// weft ahead of a PATH gate, verbs that compile on the host or re-activate
// triggers. Every one came from a shell standing between the policy and weft.
// So Bash is not in TOOLS, and weft is reached through one MCP tool
// (bin/weft-mcp) that takes the argv as a JSON array, checks it against SPEC,
// and runs the real binary with no shell, in the project directory, with no
// WEFT_ variables.
//
// SPEC is positive per verb: the flags it may carry, whether each takes a
// value, and how many plain arguments, read from `weft <verb> --help` at
// 1856da2. Anything not written here is refused. Not here on purpose: going
// live (activate, resync, wake), infrastructure, deleting (rm, clean, prune,
// files rm), accounts (connect, token, options), deploying, stopping or
// cancelling runs, test-node (cargo on the host), catalog update (writes the
// shared catalog from the network), follow (never returns), ps and files
// (every project on the install), and --on / --dispatcher on every verb,
// which point weft at another install.
//
// The rules live outside the project and the build runs under --restricted,
// which ignores the project and local settings files: Tangle edits files in
// the project under acceptEdits and once could have rewritten its own rules.
// --restricted also stops the project's skills and subagents loading, so they
// are copied, as `weft new` wrote them, into a session plugin outside it.
//
// The argv is not the whole story: weft also acts on the files Tangle writes.
// The seventh and eighth reviews (2026-10-04) found `@asset("/any/path",
// String)`, which weft reads from anywhere it can see and uploads at compile,
// a .env above the project that weft loads, and weft's own key file. A
// sandbox-exec profile around weft on the Mac closed some and each review
// found the next. So weft no longer runs on the Mac during a build: weft-mcp
// and the validate hook hand every call to weft inside the weft-box VM
// (bin/weft-box, mac/weft-box/weft-box.yaml), whose only view of the Mac is
// ~/weft-projects. What a hostile program can reach there is the projects
// folder and the VM's own weft install, which holds no key of the person's.
//
// What the fence does not cover: `weft run` executes the program Tangle wrote,
// ExecPython and HTTP nodes included, inside Docker in the VM, with network.
// It can reach the internet and ~/weft-projects, other builds' folders
// included, and nothing else of the Mac's.

const VALUE = "value";
const SWITCH = "switch";

const SPEC = {
  validate: { flags: { "--file": VALUE }, args: [0, 0] },
  parse: { flags: { "--file": VALUE }, args: [0, 0] },
  build: { flags: { "--referenced": SWITCH }, args: [0, 0] },
  // The plain argument loads examples/<name>.json, whose RunSpec denies
  // unknown fields and has none that names an install.
  run: {
    flags: {
      "--detach": SWITCH,
      "--referenced": SWITCH,
      "--seed": SWITCH,
      "--seed-until": VALUE,
      "--seed-before": VALUE,
      "--root": SWITCH,
      "--from": VALUE,
      "--target": VALUE,
      "--before": VALUE,
      "--group": VALUE,
      "--feed": VALUE,
      "--fire": VALUE,
      "--emit": VALUE,
      "--instance": VALUE,
      "--save": VALUE,
      "--clear": VALUE,
      "--long": SWITCH,
    },
    args: [0, 1],
  },
  // bake runs a trigger's setup on a container worker without listening,
  // which Tangle needs before `weft run --fire` (seen on a live build,
  // 2026-10-04). Its plain argument is another project's id, which would
  // rebuild that worker, so it takes none here.
  bake: {
    flags: { "--referenced": SWITCH, "--running-policy": VALUE, "--drain-timeout": VALUE, "--trigger": VALUE, "--instance": VALUE },
    args: [0, 0],
  },
  "describe-nodes": { flags: { "--list": SWITCH, "--stdlib": SWITCH, "--node": VALUE, "--compact": SWITCH }, args: [0, 0] },
  // weft lists every project's runs without --project, so weft-mcp adds this
  // project's id itself (scopedArgv); Tangle cannot pass one.
  executions: {
    flags: { "--limit": VALUE, "--phase": VALUE, "--node": VALUE, "--since": VALUE, "--offset": VALUE, "--status": VALUE, "--instance": VALUE, "--tag": VALUE },
    args: [0, 0],
  },
  events: { flags: { "--node": VALUE, "--kind": VALUE, "--iteration": VALUE, "--full": SWITCH }, args: [1, 1] },
  logs: { flags: { "--limit": VALUE }, args: [0, 1] },
  status: { flags: {}, args: [0, 0] },
  checkpoint: { flags: { "--root": SWITCH }, args: [0, 1] },
  branch: { flags: { "--discard": SWITCH }, args: [1, 1] },
  tree: { flags: {}, args: [0, 0] },
  diff: { flags: { "--full": SWITCH }, args: [2, 2] },
  freeze: { flags: { "--expect": VALUE }, args: [1, 2] },
  examples: { flags: {}, args: [0, 0] },
  "daemon status": { flags: {}, args: [0, 0] },
};

const TOOL = "mcp__weft__weft";

const NAME_NOTE =
  "There is no shell in this build. Run weft through the mcp__weft__weft tool: pass the words after `weft` as the argv array, " +
  'for example ["run", "--target", "sum"], and pass program text as stdin for validate and parse. ' +
  "Your skills, commands and helpers are loaded as the tangle plugin, so their names carry a tangle: prefix: " +
  "node-smith is tangle:node-smith, the weft-language skill is tangle:weft-language. " +
  "This build cannot use test-node, activate, infra, account or deploy commands; prove a node with weft run instead.";

// No Bash, no WebFetch, no WebSearch: weft is reached through TOOL only.
const TOOLS = ["Read", "Edit", "Write", "Glob", "Grep", "Agent", "Skill", "TodoWrite"];

// Splits argv by SPEC into { verb, plain, flags } or { error }. --json is
// weft's only global flag that is not a target, and only changes output.
function parse(argv) {
  if (!Array.isArray(argv) || argv.length === 0 || !argv.every((word) => typeof word === "string")) {
    return { error: "argv must be a non-empty array of strings" };
  }
  const words = argv.filter((word) => word !== "--json");
  const verb = [words.slice(0, 2).join(" "), words[0]].find((key) => key && Object.hasOwn(SPEC, key));
  if (!verb) return { error: `weft ${words.slice(0, 2).join(" ")} is not allowed in this build` };
  const spec = SPEC[verb];
  const rest = words.slice(verb.split(" ").length);
  const plain = [];
  const flags = [];
  for (let i = 0; i < rest.length; i += 1) {
    const word = rest[i];
    if (!word.startsWith("-") || word === "-") {
      plain.push(word);
      continue;
    }
    const eq = word.indexOf("=");
    const flag = eq === -1 ? word : word.slice(0, eq);
    if (!Object.hasOwn(spec.flags, flag)) return { error: `weft ${verb} ${flag} is not allowed in this build` };
    if (spec.flags[flag] === SWITCH) {
      if (eq !== -1) return { error: `${flag} takes no value` };
      flags.push([flag, null]);
    } else if (eq !== -1) {
      flags.push([flag, word.slice(eq + 1)]);
    } else {
      // A value that looks like a flag is where weft's parser and this one
      // could disagree; weft would refuse it anyway.
      if (i + 1 >= rest.length || rest[i + 1].startsWith("-")) return { error: `${flag} needs a value` };
      flags.push([flag, rest[i + 1]]);
      i += 1;
    }
  }
  const [min, max] = spec.args;
  if (plain.length < min || plain.length > max) {
    return { error: `weft ${verb} takes ${min === max ? min : `${min} to ${max}`} plain argument(s), not ${plain.length}` };
  }
  return { verb, plain, flags };
}

// Returns null when `weft <argv>` may run as far as its shape goes, or the
// reason it may not. scopeRefusal checks the ids in it against this project.
function refusal(argv) {
  return parse(argv).error || null;
}

// weft takes any execution or version id on the install, and a prefix of one,
// whatever project it belongs to: from a fresh project, `weft events <id>
// --full` printed another project's run, inputs and outputs included, and
// `weft freeze` copied it into this one (2026-10-04). So an id must be a whole
// id this project owns, and an example name a plain name, which also keeps
// examples/<name>.json inside examples/.
const EXAMPLE_NAME = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

const REFERENCE_WORDS = {
  example: "a plain example name",
  "example:": "example:<name>",
  execution: "a whole execution id of this project",
  version: "a whole version id of this project",
};

// Which plain arguments and flag values are references, and of what kinds.
function references({ verb, plain, flags }) {
  const out = [];
  const add = (value, kinds) => value !== undefined && out.push({ value, kinds });
  if (verb === "run") add(plain[0], ["example"]);
  if (verb === "freeze") {
    add(plain[0], ["example"]);
    add(plain[1], ["execution"]);
  }
  if (verb === "events" || verb === "logs") add(plain[0], ["execution"]);
  if (verb === "diff") plain.forEach((ref) => add(ref, ["execution", "example:"]));
  if (verb === "branch") add(plain[0], ["execution", "version"]);
  for (const [flag, value] of flags) if (flag === "--save") add(value, ["example"]);
  return out;
}

// True when checking argv needs this project's execution or version ids.
function needsIds(argv) {
  const parsed = parse(argv);
  return !parsed.error && references(parsed).some(({ kinds }) => kinds.includes("execution") || kinds.includes("version"));
}

// owned: { executions: Set, versions: Set } of this project's whole ids.
function scopeRefusal(argv, owned) {
  const parsed = parse(argv);
  if (parsed.error) return parsed.error;
  for (const { value, kinds } of references(parsed)) {
    const ok =
      (kinds.includes("example") && EXAMPLE_NAME.test(value)) ||
      (kinds.includes("example:") && value.startsWith("example:") && EXAMPLE_NAME.test(value.slice(8))) ||
      (kinds.includes("execution") && owned.executions.has(value)) ||
      (kinds.includes("version") && owned.versions.has(value));
    if (!ok) return `${value} is not ${kinds.map((kind) => REFERENCE_WORDS[kind]).join(" or ")}`;
  }
  return null;
}

// The argv weft-mcp runs: executions is pinned to this project.
function scopedArgv(argv, projectId) {
  return parse(argv).verb === "executions" ? [...argv, "--project", projectId] : argv;
}

// weft reads WEFT_DISPATCHER_URL, WEFT_TARGET, WEFT_PUBLIC_URL, WEFT_INSTALL
// and two dozen more; several point it somewhere else. None is passed on.
function withoutWeftEnv(env) {
  return Object.fromEntries(Object.entries(env).filter(([key]) => !key.startsWith("WEFT_")));
}

// tangleSettings: the parsed .claude/settings.json `weft new` wrote; only its
// CLAUDE.md exclusions are kept. hookPath: a copy of validate_weft.py outside
// the project. shimDir: a folder whose `weft` runs weft in the VM; it leads
// the hook's PATH, which the hook searches for weft (shutil.which).
function fence(tangleSettings, hookPath, shimDir) {
  return {
    claudeMdExcludes: tangleSettings.claudeMdExcludes || [],
    permissions: { allow: [TOOL], deny: ["Bash", "WebFetch", "WebSearch"] },
    hooks: {
      PostToolUse: [
        {
          matcher: "Edit|Write|MultiEdit",
          hooks: [{ type: "command", command: `PATH=${JSON.stringify(`${shimDir}:/usr/bin:/bin`)} python3 ${JSON.stringify(hookPath)}`, timeout: 120 }],
        },
      ],
    },
  };
}

// The --mcp-config for a build: one server, bin/weft-mcp, bound to this
// project, its id and the runner that reaches weft (bin/weft-box).
function mcpConfig(serverPath, projectDir, runner, projectId) {
  return { mcpServers: { weft: { type: "stdio", command: process.execPath, args: [serverPath, projectDir, runner, projectId] } } };
}

// Copies the project's skills, agents and commands into pluginDir, which must
// sit outside the project, and returns pluginDir. A helper whose tools list
// names Bash gets TOOL in its place, since Bash does not exist here.
function packagePlugin(projectDir, pluginDir) {
  fs.rmSync(pluginDir, { recursive: true, force: true });
  fs.mkdirSync(path.join(pluginDir, ".claude-plugin"), { recursive: true });
  for (const part of ["skills", "agents", "commands"]) {
    const from = path.join(projectDir, ".claude", part);
    if (fs.existsSync(from)) fs.cpSync(from, path.join(pluginDir, part), { recursive: true });
  }
  const agents = path.join(pluginDir, "agents");
  if (fs.existsSync(agents)) {
    for (const file of fs.readdirSync(agents).filter((name) => name.endsWith(".md"))) {
      const full = path.join(agents, file);
      const text = fs.readFileSync(full, "utf8");
      fs.writeFileSync(full, text.replace(/^tools:.*$/m, (line) => line.replace(/\bBash\b/, TOOL)));
    }
  }
  fs.writeFileSync(
    path.join(pluginDir, ".claude-plugin", "plugin.json"),
    `${JSON.stringify({ name: "tangle", description: "Tangle, weft's builder, fenced for a headless build" })}\n`,
  );
  return pluginDir;
}

module.exports = { NAME_NOTE, SPEC, TOOL, TOOLS, fence, mcpConfig, needsIds, packagePlugin, refusal, scopeRefusal, scopedArgv, withoutWeftEnv };
