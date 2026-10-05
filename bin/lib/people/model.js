// @ts-nocheck
// people model calls: headless Claude Code with rate-limit retry, and a
// bounded-concurrency pool for running batches of those calls.

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { execFileSync, execFile } = require("node:child_process");
const { die } = require("./output");
const { HOME } = require("./db");

/// One shot at Claude Code, headless. Same resolution problem the Plynn side
/// has: a GUI-launched process has no nvm on PATH.
let _claudeBin;
function claudeBin() {
  if (_claudeBin !== undefined) return _claudeBin;
  _claudeBin = claudeBinUncached();
  return _claudeBin;
}
function claudeBinUncached() {
  const cands = [
    "/opt/homebrew/bin/claude",
    "/usr/local/bin/claude",
    path.join(HOME, ".local/bin/claude"),
    path.join(HOME, ".claude/local/claude"),
  ];
  // Any nvm-managed node install, newest first. This is where it usually is,
  // and leaving it out meant every call paid for a login shell to find it.
  const nvm = path.join(HOME, ".nvm/versions/node");
  try {
    for (const v of fs.readdirSync(nvm).sort().reverse()) {
      cands.push(path.join(nvm, v, "bin/claude"));
    }
  } catch {}
  for (const c of cands) if (fs.existsSync(c)) return c;
  try {
    return execFileSync("/bin/zsh", ["-lc", "command -v claude"], { encoding: "utf8" }).trim() || null;
  } catch {
    return null;
  }
}

/// Async on purpose. execFileSync blocks the event loop, so batches could only
/// ever run one at a time, and a full history is a few hundred calls at half a
/// minute each. Most of that wait is Claude Code starting up rather than
/// thinking, so it parallelises almost perfectly.
// Rate limits are the normal case when several of these run at once, and a 429
// that resolves to null is indistinguishable from "this person had no facts".
// That silently drops people from a full pass, so retry with backoff and let
// the caller see a real failure when it still will not go through.
async function claudeJSON(prompt, system, model, tries = 7) {
  for (let attempt = 0; ; attempt++) {
    const out = await claudeJSONOnce(prompt, system, model);
    if (out !== RATE_LIMITED) return out;
    if (attempt >= tries - 1) return null;
    // Caps around two minutes. These run unattended overnight, so waiting out
    // a rate limit is strictly better than dropping the person from the pass.
    const wait = Math.min(120000, Math.round(2000 * Math.pow(2, attempt) * (0.7 + Math.random() * 0.6)));
    await new Promise((r) => setTimeout(r, wait));
  }
}

const RATE_LIMITED = Symbol("rate-limited");

function claudeJSONOnce(prompt, system, model) {
  const bin = claudeBin();
  if (!bin) die("Claude Code is not installed, so events cannot be extracted.");
  return new Promise((resolve) => {
    // stdin has to be CLOSED, not merely unused: claude waits three seconds
    // for piped input on every call before giving up, which is dead time
    // multiplied by the number of batches. It is closed on the returned child
    // rather than through an stdio option, because execFile builds its own
    // pipes to collect output and passing stdio here fights that and hangs.
    const child = execFile(
      bin,
      ["-p", "--output-format", "json", "--strict-mcp-config", "--model", model,
       "--append-system-prompt", system, prompt],
      { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: 300000 },
      (err, stdout, stderr) => {
        const limited = /\b429\b|rate limit|overloaded/i;
        if (err && !stdout) return resolve(limited.test(String(stderr || err)) ? RATE_LIMITED : null);
        try {
          const obj = JSON.parse(stdout);
          if (obj.is_error) return resolve(limited.test(String(obj.result || "")) ? RATE_LIMITED : null);
          if (typeof obj.result !== "string") return resolve(null);
          return resolve(limited.test(obj.result) ? RATE_LIMITED : obj.result);
        } catch {
          resolve(limited.test(String(stdout || "")) ? RATE_LIMITED : null);
        }
      },
    );
    child.stdin?.end();
  });
}

/// Run `jobs` with at most `n` in flight. Results keep input order.
async function pool(jobs, n, onDone) {
  const out = new Array(jobs.length);
  let next = 0, finished = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, jobs.length) }, async () => {
      while (true) {
        const i = next++;
        if (i >= jobs.length) return;
        out[i] = await jobs[i]();
        onDone?.(++finished, jobs.length);
      }
    }),
  );
  return out;
}

module.exports = {
  claudeJSON, pool,
};
