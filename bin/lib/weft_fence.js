"use strict";

const fs = require("node:fs");
const path = require("node:path");

// The rules a headless Tangle build runs under.
//
// Three commit reviews on 2026-10-04 each found a new way past a deny list
// laid over Tangle's own 53-rule allow list: `weft infra --json start` slipping
// a prefix deny, `weft test-node` compiling Tangle's Rust with cargo on the Mac,
// `weft resync` re-activating triggers, `weft run --dispatcher <url>` posting
// the program anywhere. A CLI with sixty verbs and flags that go before or
// after the verb does not fit a deny list. So both layers are positive:
//   - Claude Code allows only the verbs in VERBS, from this file, never from
//     Tangle's settings. Anything else is refused in -p.
//   - `weft` on Tangle's PATH is the gate (bin/weft-gate). It reads the argv
//     the shell actually hands it, refuses any verb not in VERBS and any
//     target flag however it is spelled, drops WEFT_DISPATCHER_URL, and only
//     then runs the real binary.
//
// The rules live outside the project and the build runs under --restricted,
// which ignores the project and local settings files: Tangle edits files in
// the project under acceptEdits and once could have rewritten its own rules.
// --restricted also stops the project's skills and subagents loading, and
// Tangle cannot build without them, so they are copied, as `weft new` wrote
// them, into a session plugin outside the project.
//
// The gate only works when `weft` resolves to it, and Claude Code runs each
// command after a shell snapshot built from the person's own zsh startup
// files: a .zshrc that puts ~/.local/bin first, or aliases weft, would skip it
// without a word. So the target flags are also refused by a PreToolUse hook
// (bin/weft-fence-hook) that reads the raw command text before any shell does,
// and the gate is the third layer rather than the only one.
//
// What the fence does not cover: `weft run` executes the program Tangle wrote,
// ExecPython and HTTP nodes included, inside Docker, with network.

// Each entry is the verb words that must open the argv. Reading, checking,
// building, running here, and the version tree. Not here on purpose: going
// live (activate, resync, wake), infrastructure, deleting (rm, clean,
// prune), accounts (connect, token, options), deploying, other projects'
// runs (stop, deactivate, cancel-*), test-node (cargo on the host) and
// catalog update (writes the shared catalog from the network).
const VERBS = [
  ["validate"],
  ["parse"],
  ["build"],
  ["run"],
  ["describe-nodes"],
  ["executions"],
  ["events"],
  ["logs"],
  ["status"],
  ["ps"],
  ["follow"],
  ["bake"],
  ["checkpoint"],
  ["branch"],
  ["tree"],
  ["diff"],
  ["freeze"],
  ["examples"],
  ["files", "ls"],
  ["files", "inspect"],
  ["daemon", "status"],
];

// bake runs a trigger's setup on a container worker without listening, which
// Tangle needs before `weft run --fire` (first seen on a live build,
// 2026-10-04). It also takes another project's id and rebuilds that worker,
// so here it takes flags only: these, each with its value where it has one.
const BAKE_FLAGS = { "--referenced": 0, "--json": 0, "--running-policy": 1, "--drain-timeout": 1, "--trigger": 1, "--instance": 1 };

function bakeRefusal(rest) {
  for (let i = 0; i < rest.length; i += 1) {
    const [flag, inline] = rest[i].split(/=(.*)/s);
    if (!(flag in BAKE_FLAGS)) return `weft bake ${rest[i]} is not allowed in this build; bake takes this project only`;
    if (BAKE_FLAGS[flag] && inline === undefined) i += 1;
  }
  return null;
}

// Global flags weft reads before the verb. --json only changes output.
const LEADING_OK = ["--json"];

// Flags that point a verb at another install: --dispatcher takes an address,
// --on reads one from weft.toml, which Tangle can edit.
const TARGET_FLAGS = ["--dispatcher", "--on"];

const PLUGIN_PARTS = ["skills", "agents", "commands"];

const NAME_NOTE =
  "Your skills, commands and helpers are loaded as the tangle plugin, so their names carry a tangle: prefix. " +
  "When your instructions name node-smith, the weft-language skill or /weft-run, use tangle:node-smith, tangle:weft-language and /tangle:weft-run. " +
  "In this build weft refuses test-node, activate, infra and account commands; prove a node with weft run instead.";

// No WebFetch or WebSearch: a build has no reason to reach the network
// except through weft, and weft's network verbs are not in VERBS.
const TOOLS = ["Bash", "Read", "Edit", "Write", "Glob", "Grep", "Agent", "Skill", "TodoWrite"];

// Returns null when the gate may run `weft <argv>`, or the reason it may not.
function refusal(argv) {
  const words = [...argv];
  while (words.length && words[0].startsWith("-")) {
    if (!LEADING_OK.includes(words[0])) return `${words[0]} before the verb is not allowed in this build`;
    words.shift();
  }
  for (const word of argv) {
    if (TARGET_FLAGS.some((flag) => word === flag || word.startsWith(`${flag}=`))) {
      return `${word.split("=")[0]} points weft at another install, which this build does not do`;
    }
  }
  const verb = VERBS.find((parts) => parts.every((part, i) => words[i] === part));
  if (!verb) return `weft ${words.slice(0, 2).join(" ")} is not allowed in this build`;
  if (verb[0] === "bake") return bakeRefusal(words.slice(1));
  return null;
}

// For the PreToolUse hook: splits a Bash call's raw command into the words
// zsh would hand a program, before any shell runs it, and checks those words.
// Anything that would expand is refused outright rather than modelled ($,
// backticks, globs, zsh's (a|b) alternation, unquoted {a,b}, a word opening
// with ~ or =), so every word
// left is literal. Quoting follows zsh: nothing escapes inside '...'; inside
// "..." a backslash escapes only $ ` " \ and newline; outside quotes it
// escapes anything, and backslash-newline disappears. Over-inclusive on
// purpose: a refused harmless command costs Tangle one retry. Two reviews on
// 2026-10-04 found shapes a plainer match missed: --dis\<newline>patcher and
// --on<file.
const WORD_END = new Set([" ", "\t", "\n", ";", "&", "|", "<", ">"]);
const REFUSED_PLAIN = { $: "shell expansion", "`": "shell expansion", "*": "wildcards", "?": "wildcards", "[": "wildcards", "(": "parentheses", ")": "parentheses" };
const DOUBLE_ESCAPES = new Set(["$", "`", '"', "\\", "\n"]);

function shellWords(source) {
  const words = [];
  let word = "";
  let started = false;
  let state = "plain";
  let braceOpen = false;
  const end = () => {
    if (started) words.push(word);
    word = "";
    started = false;
  };
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    const next = source[i + 1];
    if (state === "single") {
      if (ch === "'") state = "plain";
      else word += ch;
      continue;
    }
    if (state === "double") {
      if (ch === '"') state = "plain";
      else if (ch === "$" || ch === "`") return { refused: "shell expansion" };
      else if (ch === "\\" && DOUBLE_ESCAPES.has(next)) {
        if (next !== "\n") word += next;
        i += 1;
      } else word += ch;
      continue;
    }
    if (ch === "\\") {
      if (next !== "\n" && next !== undefined) {
        word += next;
        started = true;
      }
      i += 1;
      continue;
    }
    if (REFUSED_PLAIN[ch]) return { refused: REFUSED_PLAIN[ch] };
    if (WORD_END.has(ch)) {
      end();
      continue;
    }
    // zsh expands an unquoted ~ or = opening a word (home, command path).
    if (!started && (ch === "~" || ch === "=")) return { refused: "shell expansion" };
    started = true;
    if (ch === "'") state = "single";
    else if (ch === '"') state = "double";
    else {
      if (ch === "{") braceOpen = true;
      else if (ch === "}") braceOpen = false;
      else if (ch === "," && braceOpen) return { refused: "unquoted {a,b}" };
      word += ch;
    }
  }
  end();
  return { words };
}

function commandRefusal(text) {
  const { words, refused } = shellWords(String(text || ""));
  if (refused) return `${refused} is not allowed in this build; write the value out and quote it`;
  for (const word of words) {
    if (word.includes("WEFT_")) return "weft's own environment settings are not set from a command in this build";
    const flag = TARGET_FLAGS.find((f) => word === f || word.startsWith(`${f}=`));
    if (flag) return `${flag} points weft at another install, which this build does not do`;
  }
  return null;
}

// weft reads WEFT_DISPATCHER_URL, WEFT_TARGET, WEFT_PUBLIC_URL, WEFT_INSTALL
// and two dozen more; several point it somewhere else. None is inherited.
// keep: names to leave in place (the gate's own WEFT_GATE_REAL).
function withoutWeftEnv(env, keep = []) {
  const out = {};
  for (const [key, value] of Object.entries(env)) {
    if (!key.startsWith("WEFT_") || keep.includes(key)) out[key] = value;
  }
  return out;
}

function allowRules() {
  return VERBS.map((parts) => `Bash(weft ${parts.join(" ")}:*)`);
}

// Belt and braces under the allow list: the shapes the reviews found.
function denyRules() {
  const rules = [];
  for (const flag of TARGET_FLAGS) rules.push(`Bash(weft * ${flag} *)`, `Bash(weft * ${flag}=*)`, `Bash(weft ${flag}:*)`);
  return rules;
}

// tangleSettings: the parsed .claude/settings.json `weft new` wrote; only its
// CLAUDE.md exclusions are kept. hookPath: a copy of validate_weft.py outside
// the project. fenceHookPath: bin/weft-fence-hook.
function fence(tangleSettings, hookPath, fenceHookPath) {
  return {
    claudeMdExcludes: tangleSettings.claudeMdExcludes || [],
    permissions: { allow: allowRules(), deny: denyRules() },
    hooks: {
      PreToolUse: [
        {
          matcher: "Bash",
          hooks: [{ type: "command", command: `node ${JSON.stringify(fenceHookPath)}`, timeout: 10 }],
        },
      ],
      PostToolUse: [
        {
          matcher: "Edit|Write|MultiEdit",
          hooks: [{ type: "command", command: `python3 ${JSON.stringify(hookPath)}`, timeout: 120 }],
        },
      ],
    },
  };
}

// Copies the project's skills, agents and commands into pluginDir, which must
// sit outside the project, and returns pluginDir.
function packagePlugin(projectDir, pluginDir) {
  fs.rmSync(pluginDir, { recursive: true, force: true });
  fs.mkdirSync(path.join(pluginDir, ".claude-plugin"), { recursive: true });
  for (const part of PLUGIN_PARTS) {
    const from = path.join(projectDir, ".claude", part);
    if (fs.existsSync(from)) fs.cpSync(from, path.join(pluginDir, part), { recursive: true });
  }
  fs.writeFileSync(
    path.join(pluginDir, ".claude-plugin", "plugin.json"),
    `${JSON.stringify({ name: "tangle", description: "Tangle, weft's builder, fenced for a headless build" })}\n`,
  );
  return pluginDir;
}

// A directory holding only `weft`, linked to the gate, for the front of
// Tangle's PATH.
function gateDir(dir, gatePath) {
  fs.mkdirSync(dir, { recursive: true });
  const link = path.join(dir, "weft");
  fs.rmSync(link, { force: true });
  fs.symlinkSync(gatePath, link);
  return dir;
}

module.exports = { NAME_NOTE, TOOLS, VERBS, allowRules, commandRefusal, denyRules, fence, gateDir, packagePlugin, refusal, shellWords, withoutWeftEnv };
