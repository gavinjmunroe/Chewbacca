// @ts-nocheck
// Attachments and send readback for `people send`.
//
//   people send colin "here's the pdf" --file ~/Downloads/rec.pdf
//   people send colin --file ~/Downloads/rec.pdf          file only
//
// On 2026-10-31 Colin's PDF went out as a Drive link because `mac messages
// send` takes text only, and four texts that `mac` reported sent were still
// missing from `people texts` ten minutes later, because that reader syncs on
// its own clock. chat.db itself has a sent row within a second or two, so an
// iMessage send now reads its own row back from there before saying "sent".

"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");

// iMessage and WhatsApp can carry a file from here. Email and Slack hand off
// to gmail.py and slack.py, which take text only.
const FILE_APPS = ["imessage", "whatsapp"];

// The file a send would attach, checked before anything resolves or sends.
// The digest goes into the approval binding, so a press approves this exact
// file and not whatever sits at the same path a minute later.
function fileInfo(raw) {
  const p = path.resolve(String(raw).replace(/^~(?=$|\/)/, os.homedir()));
  let st;
  try {
    st = fs.statSync(p);
  } catch {
    return { err: `No file at ${p}. Nothing was sent.` };
  }
  if (!st.isFile()) return { err: `${p} is not a file. Nothing was sent.` };
  const sha = crypto
    .createHash("sha256")
    .update(fs.readFileSync(p))
    .digest("hex");
  return { path: p, name: path.basename(p), size: st.size, sha };
}

// What the approval and the dry run are bound to: the text plus one line
// naming the file by name and digest.
function boundText(text, file) {
  if (!file) return text;
  const line = `[file ${file.name} sha256:${file.sha.slice(0, 16)}]`;
  return text ? `${text}\n${line}` : line;
}

// Messages is sandboxed, and on macOS 14 and later a file sent by AppleScript
// from outside the folders it can read lands as "Not Delivered" with no error
// to the script. ~/Pictures is one it can read, so the file is copied there.
function stage(file) {
  const dir = path.join(os.homedir(), "Pictures", "Chewbacca Sends");
  fs.mkdirSync(dir, { recursive: true });
  const dest = path.join(dir, `${Date.now()}-${file.name}`);
  fs.copyFileSync(file.path, dest);
  return dest;
}

// Handle and path go in as argv, never spliced into the script.
const DIRECT_FILE_SCRIPT = [
  "on run argv",
  'tell application "Messages"',
  "set s to 1st account whose service type = iMessage",
  "send (POSIX file (item 2 of argv)) to participant (item 1 of argv) of s",
  "end tell",
  "end run",
];
const ROOM_FILE_SCRIPT = [
  "on run argv",
  'tell application "Messages" to send (POSIX file (item 2 of argv)) to chat id (item 1 of argv)',
  "end run",
];

function imessageFileArgs(to, stagedPath, room) {
  const lines = room ? ROOM_FILE_SCRIPT : DIRECT_FILE_SCRIPT;
  return [...lines.flatMap((l) => ["-e", l]), to, stagedPath];
}

function whatsappFileArgs(to, file, caption) {
  const args = [
    "--json",
    "--lock-wait=15s",
    "send",
    "file",
    "--to",
    to,
    "--file",
    file.path,
  ];
  if (caption) args.push("--caption", caption);
  return args;
}

function chatDbPath() {
  return (
    process.env.CHEWBACCA_CHAT_DB ||
    path.join(os.homedir(), "Library", "Messages", "chat.db")
  );
}

// chat.db dates are nanoseconds since 2001-01-01. They pass 2^53, so the
// comparison stays in SQL and no date column is read into JS.
const APPLE_EPOCH = 978307200;

// Outgoing rows to this chat since `sinceMs`, newest first. `to` is a handle
// (+13105550100, a@b.com) or a group's chat GUID.
function sentRows(to, sinceMs) {
  const { DatabaseSync } = require("node:sqlite");
  const cdb = new DatabaseSync(chatDbPath(), { readOnly: true });
  try {
    return cdb
      .prepare(
        `SELECT m.ROWID AS id, m.error AS error, m.cache_has_attachments AS has_file,
                m.is_sent AS is_sent, m.text AS text
           FROM message m
           LEFT JOIN chat_message_join j ON j.message_id = m.ROWID
           LEFT JOIN chat c ON c.ROWID = j.chat_id
           LEFT JOIN handle h ON h.ROWID = m.handle_id
          WHERE m.is_from_me = 1
            AND m.date / 1000000000 >= ?
            AND (c.chat_identifier = ? OR c.guid = ? OR h.id = ?)
          GROUP BY m.ROWID
          ORDER BY m.ROWID DESC`,
      )
      .all(sinceMs / 1000 - APPLE_EPOCH, to, to, to);
  } finally {
    cdb.close();
  }
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

// Did the send land in chat.db? Polls for up to `waitMs`.
//   { state: "landed", rows }       every expected row is there, none errored
//   { state: "failed", error }      Messages wrote the row with an error code
//   { state: "missing" }            nothing showed up in time
//   { state: "unreadable", error }  chat.db can't be opened (Full Disk Access)
// 8 s is a guess: rows showed up within 2 s on this Mac's own sends, never
// measured across a slow network.
function verifySent(
  to,
  sinceMs,
  { expect = 1, wantFile = false, waitMs = 8000, stepMs = 500 } = {},
) {
  const deadline = Date.now() + waitMs;
  for (;;) {
    let rows;
    try {
      rows = sentRows(to, sinceMs);
    } catch (e) {
      return { state: "unreadable", error: String(e.message || e) };
    }
    const bad = rows.find((r) => Number(r.error) !== 0);
    if (bad)
      return { state: "failed", error: `Messages error ${bad.error}`, rows };
    const enough =
      rows.length >= expect &&
      (!wantFile || rows.some((r) => Number(r.has_file) === 1));
    if (enough) return { state: "landed", rows };
    if (Date.now() >= deadline) return { state: "missing", rows };
    sleep(stepMs);
  }
}

module.exports = {
  FILE_APPS,
  fileInfo,
  boundText,
  stage,
  imessageFileArgs,
  whatsappFileArgs,
  verifySent,
  sentRows,
};
