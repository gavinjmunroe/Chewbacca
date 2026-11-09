// @ts-nocheck
// people calls: phone and FaceTime calls from this Mac's call history, filed
// as dated interactions on the person whose number it was. Read-only on the
// Mac side (mac/lib/calls.py); nothing here places a call.
//
//   people calls sync [--days N]     file new calls (30 days; 0 means all)
//   people calls [who] [--days N]    the calls on file, newest first
//
// A call is filed only when its number belongs to exactly one person by the
// whole number (resolvePerson strict). A number nobody owns is skipped, not
// guessed at, and a name never decides anything.

"use strict";

const { execFileSync } = require("node:child_process");
const { c, die, say, parseArgs } = require("./output");
const { db } = require("./db");
const { findPerson } = require("./lookup");

function readCalls(days) {
  const { textsReader } = require("./texts");
  const py = textsReader("calls.py");
  if (!py) return [];
  try {
    return JSON.parse(
      execFileSync("python3", [py, "--json", "--days", String(days)], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 30000,
      }),
    );
  } catch {
    return [];
  }
}

function note(r) {
  const mins =
    r.seconds >= 60 ? `${Math.round(r.seconds / 60)} min` : `${r.seconds} s`;
  if (!r.answered && !r.outgoing) return `missed ${r.kind} call`;
  return `${r.outgoing ? "outgoing" : "incoming"} ${r.kind} call, ${r.answered ? mins : "not answered"}`;
}

function syncCalls(days = 30) {
  const { resolvePerson } = require("./texts");
  const d = db();
  const ins = d.prepare(
    "INSERT OR IGNORE INTO interactions (id, person_id, channel, note, happened_at) VALUES (?,?,?,?,?)",
  );
  let added = 0,
    unowned = 0;
  for (const r of readCalls(days)) {
    const pid = resolvePerson(null, r.handle, { strict: true });
    if (!pid) {
      unowned++;
      continue;
    }
    const res = ins.run(
      "call:" + r.id,
      pid,
      r.kind.startsWith("facetime") ? "facetime" : "call",
      note(r),
      String(r.at).replace("T", " "),
    );
    added += res.changes;
  }
  return { added, unowned };
}

function cmdCalls(argv) {
  const { flags, rest } = parseArgs(argv);
  if (rest[0] === "sync") {
    const { added, unowned } = syncCalls(Number(flags.days ?? 30));
    say(
      `${c.grn(added)} call${added === 1 ? "" : "s"} filed${unowned ? c.dim(`, ${unowned} from numbers nobody in the store owns`) : ""}`,
    );
    return;
  }
  const d = db();
  const days = Number(flags.days || 90);
  let sql = `SELECT i.happened_at, i.note, p.name FROM interactions i JOIN people p ON p.id = i.person_id
              WHERE i.id LIKE 'call:%' AND i.happened_at >= datetime('now', ?)`;
  const args = [`-${days} days`];
  if (rest[0]) {
    const person = findPerson(rest.join(" "));
    if (!person) die(`No one matches "${rest.join(" ")}".`);
    sql += " AND i.person_id = ?";
    args.push(person.id);
  }
  const rows = d
    .prepare(sql + " ORDER BY i.happened_at DESC LIMIT 100")
    .all(...args);
  if (!rows.length)
    return say(c.dim("No calls on file. people calls sync files them."));
  for (const r of rows)
    say(`  ${c.dim(r.happened_at.slice(0, 16))}  ${c.b(r.name)}  ${r.note}`);
}

module.exports = { cmdCalls, syncCalls };
