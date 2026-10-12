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

/** The turn state from a transcript's last lines (oldest first).
 *  Returns { state: "running" | "done" | "stopped", lastAt } where lastAt is
 *  the newest user or assistant message's time in ms, or null without one. */
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
  return { state: now - beat > STALE_MS ? "stopped" : "running", lastAt };
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
      } catch {}
    }
  } catch {}
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
    } catch {}
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

/** The truth for one session id, or null when no transcript is found. */
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
  } catch {
    return null;
  }
}

/** The ids from `?ids=a,b,c`, only well formed ones, at most MAX_IDS. */
export function idsFrom(param) {
  return [...new Set(String(param ?? "").split(","))]
    .filter((id) => ID.test(id))
    .slice(0, MAX_IDS);
}
