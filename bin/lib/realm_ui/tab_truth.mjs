// What a Claude Code tab is really doing, for the agent tiles on the glass.
//
// Part of our layer on Carlton Aikins' Realm (github.com/31Carlton7/realm).
// His import copies a Claude Code transcript into a realm session once, so
// the row it makes says "idle" and carries the import time as `updatedAt`
// even while the tab is mid-turn in another window. On 2026-10-11 at 8:25pm
// every one of nine tiles read "Done 5m", GTME and TTS Logo included, both of
// which had written their transcripts within the minute. The row keeps the
// CLI's own session id as `providerSessionId`, and that id names the
// transcript Claude Code is still writing, so this file reads the answer
// from there: the last message's time, and whether the turn is still open.
// Read only, stdlib only.
import {
  closeSync,
  existsSync,
  fstatSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  statSync,
} from "node:fs";
import { join } from "node:path";

// A turn whose transcript has gone this long without a write is not running,
// whatever its last line says: the tab was closed or killed mid-turn. A live
// turn writes at least once per tool call; the longest single call that does
// not write is a foreground Bash at its 10 minute ceiling (the tool's own
// 600000 ms max), and a foreground subagent writes its own file, which is
// counted below. 15 minutes is that ceiling plus margin; guessed past that.
export const STALE_MS = 15 * 60 * 1000;
// How much of a transcript's end is read. They run to 80 MB (TTS Logo, 10/11),
// and the last message sits within the final few KB unless a tool result was
// huge, so 1 MB first and 8 MB once if that held no message.
const TAIL_BYTES = 1 << 20;
const TAIL_BYTES_MAX = 8 << 20;
// The most ids one request may ask about. The glass draws nine tiles.
export const MAX_IDS = 50;
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
// A user line that ends a turn rather than starting one: Esc in the tab.
const INTERRUPTED = /^\[Request interrupted by user/;

const textOf = (content) =>
  typeof content === "string"
    ? content
    : Array.isArray(content)
      ? content
          .map((c) => (c?.type === "text" ? String(c.text ?? "") : ""))
          .join("")
      : "";

/** Whether a user line is a prompt he typed, rather than a tool's result
 *  coming back to the model (also a "user" line in Claude Code's log). */
const isPrompt = (d) => {
  const c = d?.message?.content;
  if (typeof c === "string") return !INTERRUPTED.test(c.trim());
  return Array.isArray(c) && c.length > 0 && !c.some((b) => b?.type === "tool_result");
};

/** When the open turn began: the newest prompt line's time, or null when
 *  the tail read holds none (a turn longer than the tail). Never the last
 *  write, which would start the clock at the newest tool call. */
function promptAt(lines) {
  for (let i = lines.length - 1; i >= 0; i--) {
    let d;
    try {
      d = JSON.parse(lines[i]);
    } catch {
      continue;
    }
    if (!d || d.type !== "user" || d.isSidechain || d.isMeta || !isPrompt(d)) continue;
    const at = Date.parse(d.timestamp ?? "");
    return Number.isFinite(at) ? at : null;
  }
  return null;
}

/** The turn state from a transcript's last lines (oldest first).
 *  Returns { state: "running" | "done" | "stopped", lastAt } where lastAt is
 *  the newest user or assistant message's time in ms, or null without one.
 *  A running turn also carries `since`, when its prompt was sent, or null. */
export function turnFrom(lines, { touchedAt = 0, now = Date.now() } = {}) {
  let last = null;
  let lastAt = null;
  for (let i = lines.length - 1; i >= 0; i--) {
    let d;
    try {
      d = JSON.parse(lines[i]);
    } catch {
      continue;
    }
    if (!d || (d.type !== "user" && d.type !== "assistant")) continue;
    if (d.isSidechain || d.isMeta) continue;
    const at = Date.parse(d.timestamp ?? "");
    if (!last) last = d;
    if (Number.isFinite(at)) {
      lastAt = lastAt === null ? at : Math.max(lastAt, at);
      // Lines are written as they stream, so the last few can be out of order
      // by a second; three messages back is enough to find the newest time.
      if (last !== d && lastAt !== null) break;
    }
  }
  if (!last) return { state: "done", lastAt: null };
  const msg = last.message ?? {};
  let open;
  if (last.type === "assistant") {
    // end_turn closes the turn; tool_use, or a block still streaming
    // (stop_reason null), means the tab is waiting on a tool or on the model.
    open =
      msg.stop_reason !== "end_turn" && msg.stop_reason !== "stop_sequence";
  } else {
    // A prompt or a tool result: the model is answering, unless it was Esc.
    open = !INTERRUPTED.test(textOf(msg.content).trim());
  }
  if (!open) return { state: "done", lastAt };
  const beat = Math.max(touchedAt, lastAt ?? 0);
  if (now - beat > STALE_MS) return { state: "stopped", lastAt };
  return { state: "running", lastAt, since: promptAt(lines) };
}

function tail(file, bytes) {
  const fd = openSync(file, "r");
  try {
    const size = fstatSync(fd).size;
    const start = Math.max(0, size - bytes);
    const buf = Buffer.alloc(size - start);
    readSync(fd, buf, 0, buf.length, start);
    const lines = buf.toString("utf8").split("\n");
    if (start > 0) lines.shift(); // a partial first line
    return lines.filter(Boolean);
  } finally {
    closeSync(fd);
  }
}

/** The newest write to a transcript or the subagent files beside it. */
function touched(file) {
  let at = statSync(file).mtimeMs;
  const sub = join(file.replace(/\.jsonl$/, ""), "subagents");
  try {
    for (const name of readdirSync(sub)) {
      try {
        at = Math.max(at, statSync(join(sub, name)).mtimeMs);
      } catch {
        // Expected: a subagent file removed between readdir and stat.
      }
    }
  } catch {
    // Expected: most transcripts have no subagents folder.
  }
  return at;
}

/** Finds transcripts by session id under one projects folder, remembering
 *  where each was and, for a minute, where one was not (a Codex id, say). */
export function transcriptFinder(projects, { now = Date.now } = {}) {
  const found = new Map();
  const missing = new Map();
  return (id) => {
    const hit = found.get(id);
    if (hit && existsSync(hit)) return hit;
    if ((missing.get(id) ?? 0) > now()) return null;
    let dirs = [];
    try {
      dirs = readdirSync(projects);
    } catch {
      // Expected: a Mac with no Claude Code projects yet has nothing to find.
    }
    for (const dir of dirs) {
      const file = join(projects, dir, `${id}.jsonl`);
      if (existsSync(file)) {
        found.set(id, file);
        return file;
      }
    }
    missing.set(id, now() + 60_000);
    return null;
  };
}

/** The truth for one session id; null when it has no transcript here (a
 *  Codex session, say), and `{ state: "unreadable", detail }` when it has one
 *  that couldn't be read. The two are different answers: the first lets
 *  realm's own status speak, the second is a fault the tile names, never a
 *  quiet Done (Daniel pass, 2026-10-11: errors are values). */
export function tabTruth(id, find, { now = Date.now() } = {}) {
  if (!ID.test(String(id))) return null;
  const file = find(id);
  if (!file) return null;
  try {
    const touchedAt = touched(file);
    let truth = turnFrom(tail(file, TAIL_BYTES), { touchedAt, now });
    if (truth.lastAt === null)
      truth = turnFrom(tail(file, TAIL_BYTES_MAX), { touchedAt, now });
    return truth;
  } catch (e) {
    return { state: "unreadable", lastAt: null, detail: String(e?.code ?? e?.message ?? e) };
  }
}

// Where a live Claude Code session runs, from the `entrypoint` its process
// writes to ~/.claude/sessions/<pid>.json (seen on this Mac 10/13:
// "claude-vscode" for the VS Code extension, "sdk-cli" for a headless
// `claude -p` job; the CLI's is "cli"). Anything else is its own window.
const HOSTS = Object.freeze({ "claude-vscode": "vscode", cli: "terminal", "sdk-cli": "job", "claude-desktop": "desktop" });
// The most session files read per ask. One per live Claude Code process;
// 18 were on this Mac at 10:58pm 10/12 with five tabs and four overnight
// jobs open. 200 is a guessed ceiling, never measured past that.
const MAX_LIVE_FILES = 200;

/** Every live Claude Code process's session: Map of session id to where it
 *  runs. Read only. A file whose pid is gone is left out, so a closed tab
 *  never reads as running somewhere. */
export function liveTabs(dir, { alive = pidAlive } = {}) {
  const out = new Map();
  let names = [];
  try {
    names = readdirSync(dir).filter((n) => /^\d+\.json$/.test(n)).slice(0, MAX_LIVE_FILES);
  } catch {
    // Expected: no Claude Code on this Mac, or none running.
    return out;
  }
  for (const name of names) {
    try {
      const d = JSON.parse(readFileSync(join(dir, name), "utf8"));
      if (!ID.test(String(d?.sessionId)) || !Number.isInteger(d?.pid) || !alive(d.pid)) continue;
      out.set(d.sessionId, { where: HOSTS[d.entrypoint] ?? "window", pid: d.pid });
    } catch {
      // Expected: a file mid-write or removed between readdir and read.
    }
  }
  return out;
}

function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e?.code === "EPERM";
  }
}

/** The ids from `?ids=a,b,c`, only well formed ones, at most MAX_IDS. */
export function idsFrom(param) {
  return [...new Set(String(param ?? "").split(","))]
    .filter((id) => ID.test(id))
    .slice(0, MAX_IDS);
}
