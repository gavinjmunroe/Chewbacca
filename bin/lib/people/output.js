// @ts-nocheck
// people output: terminal colors, die and say, the EPIPE guard, and the
// flag parser every command shares.

"use strict";

// ---------------------------------------------------------------- output

const TTY = process.stdout.isTTY;
const c = {
  b: (s) => (TTY ? `\x1b[1m${s}\x1b[0m` : s),
  dim: (s) => (TTY ? `\x1b[2m${s}\x1b[0m` : s),
  red: (s) => (TTY ? `\x1b[31m${s}\x1b[0m` : s),
  grn: (s) => (TTY ? `\x1b[32m${s}\x1b[0m` : s),
  yel: (s) => (TTY ? `\x1b[33m${s}\x1b[0m` : s),
  cyn: (s) => (TTY ? `\x1b[36m${s}\x1b[0m` : s),
};

// Piping into `head` closes stdout early. Without this the process dies with an
// unhandled EPIPE and a stack trace, which looks like a crash rather than the
// completely normal thing it is.
process.stdout.on("error", (e) => {
  if (e && e.code === "EPIPE") process.exit(0);
});

function die(msg, code = 1) {
  process.stderr.write(c.red("people: ") + msg + "\n");
  process.exit(code);
}
function say(s = "") {
  process.stdout.write(s + "\n");
}

// ---------------------------------------------------------------- args

function parseArgs(argv) {
  const flags = {};
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const eq = a.indexOf("=");
      if (eq > -1) flags[a.slice(2, eq)] = a.slice(eq + 1);
      else if (i + 1 < argv.length && !argv[i + 1].startsWith("--")) flags[a.slice(2)] = argv[++i];
      else flags[a.slice(2)] = true;
    } else rest.push(a);
  }
  return { flags, rest };
}

module.exports = {
  c, die, say, parseArgs,
};
