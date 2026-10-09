// @ts-nocheck
// people send: one command that replies to a person through the app the
// conversation is actually in (iMessage, WhatsApp, Slack, email).
//
//   people send maggie "running 10 late"            same app as the last message
//   people send maggie "running 10 late" --via whatsapp
//   people send jonah "deck attached" --via email --subject "QUBE deck"
//   people send maggie "..." --dry-run             resolve and print, send nothing
//
// The target is always an exact address read off a message that person sent
// or received, never a name handed to another tool to guess at: wacli's --to
// and Slack lookups both accept names and will pick somebody.

"use strict";

const { execFileSync } = require("node:child_process");
const { c, die, say, parseArgs } = require("./output");
const { db, nowISO } = require("./db");
const { textsReader } = require("./texts");
const { findPerson } = require("./lookup");

const APPS = ["imessage", "whatsapp", "slack", "email"];

// Most recent one-to-one message with this person, optionally in one app.
// Group rows are skipped: their handle is the room or another member.
function lastThread(d, person, who, via) {
  let sql = `SELECT source, handle, who, sent_at FROM messages
              WHERE room IS NULL AND handle IS NOT NULL AND handle <> ''`;
  const args = [];
  if (person) {
    sql += " AND person_id = ?";
    args.push(person.id);
  } else {
    sql += " AND lower(who) LIKE ?";
    args.push("%" + String(who).toLowerCase() + "%");
  }
  if (via) {
    sql += " AND source = ?";
    args.push(via);
  } else {
    sql += " AND source IN (" + APPS.map(() => "?").join(",") + ")";
    args.push(...APPS);
  }
  return d.prepare(sql + " ORDER BY sent_at DESC LIMIT 1").get(...args) || null;
}

// An app with no history for this person can still be reached through the
// card's own phone or email.
function fromCard(person, via) {
  if (!person) return null;
  if ((via === "imessage" || via === "whatsapp") && person.phone)
    return person.phone;
  if ((via === "email" || via === "imessage") && person.email)
    return person.email;
  return null;
}

function waJid(handle) {
  if (String(handle).includes("@")) return handle;
  let digits = String(handle).replace(/\D/g, "");
  // A card phone saved without a country code is a US number, the same
  // assumption normHandle makes. "3106946088@s.whatsapp.net" is nobody.
  if (digits.length === 10 && !String(handle).trim().startsWith("+")) digits = "1" + digits;
  return digits.length >= 8 ? `${digits}@s.whatsapp.net` : null;
}

function run(cmd, args) {
  try {
    return {
      code: 0,
      out: execFileSync(cmd, args, {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 60000,
      }),
    };
  } catch (e) {
    return {
      code: e.status ?? 1,
      out: String(e.stdout || ""),
      err: String(e.stderr || e.message || ""),
    };
  }
}

function dispatch(via, handle, text, flags) {
  if (via === "imessage")
    return run("mac", ["messages", "send", handle, text, "--json"]);
  if (via === "whatsapp") {
    const jid = waJid(handle);
    if (!jid) return { code: 2, err: `no WhatsApp address for ${handle}` };
    return run("wacli", [
      "--json",
      "--lock-wait=15s",
      "send",
      "text",
      "--to",
      jid,
      "--message",
      text,
    ]);
  }
  const reader = textsReader(via === "slack" ? "slack.py" : "email_reader.py");
  if (!reader) return { code: 2, err: `${via} is not set up in this kit yet` };
  const args = [reader, "send", "--to", handle, "--text", text];
  if (via === "email")
    args.push(
      "--subject",
      String(flags.subject || text.split("\n")[0].slice(0, 60)),
    );
  return run("python3", args);
}

// Every sender prints JSON, and each spells success its own way.
function succeeded(r) {
  if (r.code !== 0) return false;
  try {
    const j = JSON.parse(r.out);
    if (j.success === false || j.ok === false) return false;
  } catch {
    /* a sender that printed plain text and exited 0 is taken at its exit code */
  }
  return true;
}

function cmdSend(argv) {
  const { flags, rest } = parseArgs(argv);
  const who = rest.shift();
  const text = rest.join(" ").trim();
  if (!who || !text)
    die(
      'Try: people send maggie "running 10 late" [--via whatsapp] [--dry-run]',
    );
  const via = flags.via ? String(flags.via).toLowerCase() : null;
  if (via && !APPS.includes(via)) die(`--via is one of: ${APPS.join(", ")}`);

  const d = db();
  // STRICT, UNLIKE READING. `people texts dad` may guess the most recently
  // texted match because a wrong pick there costs one visible line. Here it
  // costs a message in the wrong person's phone: on 2026-10-08 a dry run of
  // `people send dad` resolved to "prestons dad". findPerson refuses ambiguity.
  const person = findPerson(who, { required: false });
  if (!person) {
    // A thread nobody's card owns yet (an unsaved WhatsApp number) is still
    // sendable, but only when exactly one such thread matches.
    const names = d
      .prepare("SELECT DISTINCT who FROM messages WHERE person_id IS NULL AND room IS NULL AND lower(who) LIKE ? LIMIT 6")
      .all("%" + String(who).toLowerCase() + "%")
      .map((r) => r.who);
    if (names.length > 1) die(`"${who}" matches ${names.length} threads:\n` + names.map((n) => `  ${n}`).join("\n") + "\nBe more specific.");
  }
  const thread = lastThread(d, person, who, via);
  const app = via || (thread && thread.source);
  const handle = (thread && thread.handle) || fromCard(person, app);
  const name = (person && person.name) || (thread && thread.who) || who;
  if (!app || !handle)
    die(
      `No ${via || "message"} history with ${name} and no address on their card.\n` +
        `  Add one: people set ${who} phone <number>   or pick an app with --via`,
    );

  const where = `${c.b(name)} ${c.dim(`via ${app}, ${handle}`)}`;
  if (flags["dry-run"]) {
    say(`  would send to ${where}`);
    say(`  ${text}`);
    return;
  }

  const r = dispatch(app, handle, text, flags);
  if (!succeeded(r)) {
    die(
      `Not sent to ${name} via ${app}: ${(r.err || r.out || "no output").trim().split("\n")[0]}`,
    );
  }
  if (person)
    d.prepare(
      "INSERT INTO interactions (id, person_id, channel, note, happened_at) VALUES (lower(hex(randomblob(16))),?,?,NULL,?)",
    ).run(person.id, app, nowISO());
  say(`${c.grn("sent")} to ${where}`);
}

module.exports = { cmdSend, lastThread, waJid };
