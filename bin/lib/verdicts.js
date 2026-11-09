// @ts-nocheck
// One row in the kit's verdict log, the format tools/verdicts.py reads
// (`chewbacca why --verdicts`). Sends written in Node call sendRow so a held,
// sent or failed send leaves a trace the same way a refused hook does.
// Never throws: a missing row must not fail a send.
"use strict";
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

function logPath() {
  if (process.env.CHEWBACCA_VERDICT_LOG) return process.env.CHEWBACCA_VERDICT_LOG;
  const base = process.env.CHEWBACCA_LOG_DIR || path.join(os.homedir(), ".chewbacca", "logs");
  return path.join(base, "verdicts.tsv");
}

// The same caps as lib.sh, hookd and verdicts.py: a row stays one short write.
const clean = (v, cap) => String(v ?? "").replace(/[\t\n\r]/g, " ").slice(0, cap);

function record(kind, name, decision, ms = 0, reason = "", subject = "", event = "", session = null) {
  try {
    if (process.env.CHEWBACCA_VERDICTS === "0") return;
    const file = logPath();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const row = [
      Date.now(), clean(kind, 20), clean(name, 200), clean(event, 60), clean(decision, 40),
      Math.round(ms || 0), clean(session ?? process.env.CLAUDE_CODE_SESSION_ID ?? "", 80),
      clean(subject, 300), clean(reason, 600),
    ].join("\t") + "\n";
    fs.appendFileSync(file, row, { mode: 0o600 });
  } catch {
    /* a missing row, never a failed send */
  }
}

// Enough of a recipient to tell two sends apart: an email's domain, the last
// four of anything else. verdicts.py's mask_to does the same.
function maskTo(to) {
  const t = String(to ?? "").trim();
  if (!t) return "";
  if (t.includes("@")) return "...@" + t.slice(t.lastIndexOf("@") + 1);
  return t.length > 4 ? "..." + t.slice(-4) : "...";
}

// A reason that quotes what the send said is dropped: an error's text can
// carry the whole command, body included.
function scrub(reason, values = []) {
  const r = String(reason ?? "");
  for (const v of values) if (typeof v === "string" && v.length >= 4 && r.includes(v)) return "(the reason quotes the message, so it isn't logged)";
  return r;
}

// Who it was for (masked), never what it said. A child process that a Node
// send hands its work to sees CHEWBACCA_SEND_LOGGED and writes no second row.
function sendRow(name, decision, to = "", reason = "", started = 0, values = []) {
  if (process.env.CHEWBACCA_SEND_LOGGED) return;
  const masked = maskTo(to);
  record("send", name, decision, started ? Date.now() - started : 0, scrub(reason, values), masked ? `to ${masked}` : "");
}

module.exports = { record, sendRow, logPath, maskTo, scrub };
