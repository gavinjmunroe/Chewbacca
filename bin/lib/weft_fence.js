"use strict";

const fs = require("node:fs");
const path = require("node:path");

// The rules a headless Tangle build runs under, built from the settings
// `weft new` wrote into the project before Tangle ever ran.
//
// Escapes found by two commit reviews on 2026-10-04 set the shape:
//   - Tangle's own list allows `weft infra --json:*`, so a deny on
//     `weft infra start` never matched `weft infra --json start`. A deny list
//     of prefixes cannot keep up with flags placed before the verb, so the
//     allow list is filtered instead: anything not allowed is refused in -p.
//   - weft test-node compiles a project's own Rust nodes with plain cargo and
//     runs them on this Mac, outside Docker, so it is refused; a node Tangle
//     writes is proved by `weft run`, which builds and runs it in a container.
//   - The project's .claude/settings.json was the rule file, and Tangle runs
//     with acceptEdits inside that project, so it could rewrite its own rules
//     mid-build. The fenced copy lives outside the project, and the build runs
//     under --restricted, which ignores the project and local settings files.
//
// --restricted also stops the project's skills and subagents loading, and
// Tangle cannot build without them (its weft-* skills, node-smith and five
// more helpers). They are copied, as `weft new` wrote them, into a session
// plugin outside the project. A plugin's names carry its prefix, so Tangle is
// told the mapping once rather than its files being edited.

const REFUSED = [
  "weft activate",
  "weft resync",
  "weft test-node",
  "weft infra start",
  "weft infra upgrade",
  "weft infra press",
  "weft rm",
  "weft clean",
  "weft prune",
  "weft connect",
  "weft token",
  "weft deploy",
  "weft domain",
  "curl",
  "git push",
];

// Flags weft accepts before the verb. Each one turns a denied verb into a
// command no prefix rule recognises.
const LEADING_FLAGS = ["--json", "--on", "--dispatcher"];

// Flags that point an allowed verb at another install. `weft run --dispatcher
// <url>` posts the whole program to that address, and `--on` reads its address
// from weft.toml, which Tangle can edit. Found by the second commit review,
// 2026-10-04. Matched anywhere in the command, not only as a prefix.
const TARGET_FLAGS = ["--dispatcher", "--on"];

const PLUGIN_PARTS = ["skills", "agents", "commands"];

const NAME_NOTE =
  "Your skills, commands and helpers are loaded as the tangle plugin, so their names carry a tangle: prefix. " +
  "When your instructions name node-smith, the weft-language skill or /weft-run, use tangle:node-smith, tangle:weft-language and /tangle:weft-run.";

// No WebFetch or WebSearch: a build has no reason to reach the network
// except through weft, and weft's network verbs are the refused ones.
const TOOLS = ["Bash", "Read", "Edit", "Write", "Glob", "Grep", "Agent", "Skill", "TodoWrite"];

function command(rule) {
  const match = /^Bash\((.*)\)$/.exec(rule);
  return match ? match[1].replace(/:\*$/, "").trim() : null;
}

function refused(cmd) {
  return REFUSED.some((prefix) => cmd === prefix || cmd.startsWith(`${prefix} `));
}

function allowed(rule) {
  const cmd = command(rule);
  if (cmd === null) return false;
  if (refused(cmd)) return false;
  return !cmd.split(/\s+/).some((word) => word.startsWith("--"));
}

function denyRules() {
  const rules = REFUSED.map((cmd) => `Bash(${cmd}:*)`);
  for (const flag of LEADING_FLAGS) {
    rules.push(`Bash(weft ${flag}:*)`, `Bash(weft infra ${flag}:*)`);
  }
  for (const flag of TARGET_FLAGS) {
    rules.push(`Bash(weft * ${flag} *)`, `Bash(weft * ${flag}=*)`);
  }
  return rules;
}

// tangleSettings: the parsed .claude/settings.json `weft new` wrote.
// hookPath: an absolute path to a copy of validate_weft.py outside the project.
function fence(tangleSettings, hookPath) {
  const allow = ((tangleSettings.permissions || {}).allow || []).filter(allowed);
  return {
    claudeMdExcludes: tangleSettings.claudeMdExcludes || [],
    permissions: { allow, deny: denyRules() },
    hooks: {
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

module.exports = { NAME_NOTE, REFUSED, TOOLS, allowed, denyRules, fence, packagePlugin };
