// @ts-nocheck
// people send: one command that replies to a person through the app the
// conversation is actually in (iMessage, WhatsApp, Slack, email, and every
// network `chewbacca chat up` bridges: Signal, Telegram, Discord, Instagram,
// Messenger, X, Google Messages, Google Chat, Google Voice, LinkedIn, Bluesky).
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
const { textsReader, resolvePerson, printable } = require("./texts");
const { findPerson } = require("./lookup");
const { quietFor } = require("./quiet-hours");
const approval = require("../send-approval");
const attach = require("./attach");
// Internal flags live under Symbols so no argv can set them: parseArgs turns
// any --word into a flag, and a string key "approved" would let
// `people send x "hi" --approved` skip the press (caught in review, 10/31).
const FILE = Symbol("file");
const APPROVED = Symbol("approved");

const { APPS, BRIDGED } = require("./apps");
// Loaded up front and guarded, so a missing file can never throw after a
// send has already gone out (review, 2026-10-12).
let verdicts;
try {
  verdicts = require("../verdicts");
} catch {
  verdicts = { sendRow() {} };
}

// The LinkedIn export (msg_id under 6e12) is a one-time dump with nowhere to
// reply; only bridged LinkedIn rows (6e12 and up) are a thread send can use.
const REPLYABLE = "NOT (source = 'linkedin' AND msg_id < 6000000000000)";

// Most recent one-to-one message with this person, optionally in one app.
// Group rows are skipped: their handle is the room or another member.
function lastThread(d, person, who, via) {
  let sql = `SELECT source, handle, who, sent_at FROM messages
              WHERE room IS NULL AND handle IS NOT NULL AND handle <> '' AND ${REPLYABLE}`;
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
  if (digits.length === 10 && !String(handle).trim().startsWith("+"))
    digits = "1" + digits;
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

// A bridged thread is answered in its own Matrix room, which the reader
// recorded against (network, handle) when it filed the rows. No room on file
// means no send: a room id is never guessed or built from a name.
function matrixRoom(via, handle) {
  const { textsReader } = require("./texts");
  const py = textsReader("matrix.py");
  if (!py) return null;
  const r = run("python3", [
    py,
    "room",
    "--network",
    via,
    "--handle",
    String(handle),
  ]);
  return r.code === 0 && r.out.trim().startsWith("!") ? r.out.trim() : null;
}

// The exact address each app is handed. Computed once, then both printed and
// used, so what a dry run shows is what a send does.
function target(via, handle) {
  if (BRIDGED.includes(via)) return matrixRoom(via, handle);
  return via === "whatsapp" ? waJid(handle) : handle;
}

// A group chat is addressed by the room's own id, never by a member. The
// store's own outgoing rows in a room carry that id as their handle (the chat
// identifier for iMessage, the @g.us JID for WhatsApp), so the room the user
// already wrote in is the room that gets the message. Exact name match only:
// "Paul" is a group of four people, and a fuzzy match is a text in the wrong
// group chat.
function roomThread(d, name, via) {
  let sql = `SELECT source, handle, room, max(sent_at) AS last FROM messages
              WHERE room IS NOT NULL AND lower(room) = lower(?) AND from_me = 1 AND handle IS NOT NULL AND handle <> ''
                AND ${REPLYABLE}`;
  const args = [name];
  if (via) {
    sql += " AND source = ?";
    args.push(via);
  }
  return d
    .prepare(sql + " GROUP BY source, handle ORDER BY last DESC")
    .all(...args);
}

// Messages wants the chat's GUID, which chat.db holds. Read it rather than
// build it: the prefix is "iMessage;+;" on this Mac and "any;+;" on newer
// macOS, and a guessed GUID is a send that fails or lands somewhere else.
function chatGuid(identifier) {
  const file =
    process.env.CHEWBACCA_CHAT_DB ||
    require("node:path").join(
      require("node:os").homedir(),
      "Library",
      "Messages",
      "chat.db",
    );
  try {
    const { DatabaseSync } = require("node:sqlite");
    const cdb = new DatabaseSync(file, { readOnly: true });
    // One identifier can carry several GUIDs (RCS;+;, SMS;+;, iMessage;+;
    // for the same group, 2026-10-10). The live one is where the newest
    // message landed; LIMIT 1 alone picked whichever row came first.
    let row;
    try {
      row = cdb
        .prepare(
          `SELECT c.guid FROM chat c LEFT JOIN chat_message_join j ON j.chat_id = c.ROWID
            LEFT JOIN message m ON m.ROWID = j.message_id
            WHERE c.chat_identifier = ? GROUP BY c.ROWID ORDER BY max(m.date) DESC LIMIT 1`,
        )
        .get(identifier);
    } catch {
      // A chat.db without the message tables (a stand-in) still names the chat.
      row = cdb
        .prepare("SELECT guid FROM chat WHERE chat_identifier = ? LIMIT 1")
        .get(identifier);
    }
    cdb.close();
    return row ? row.guid : null;
  } catch {
    return null;
  }
}

// The text and the chat id go in as argv, never spliced into the script, so a
// quote or a backslash in a message can't become AppleScript.
const GROUP_SCRIPT = [
  "on run argv",
  'tell application "Messages" to send (item 2 of argv) to chat id (item 1 of argv)',
  "end run",
];

// Can this process drive Messages? A read-only Apple event, 0.2s. On
// 2026-10-09 every iMessage draft queued for the morning would have failed:
// macOS had Automation for Messages denied for the app the agent runs in
// (osascript -1743), and nothing said so until a send was attempted.
const MESSAGES_FIX =
  "macOS is blocking this app from controlling Messages, so no iMessage can be sent from here.\n" +
  "  Fix: System Settings > Privacy & Security > Automation > your terminal or Claude app > turn on Messages.\n" +
  "  Nothing was sent.";
function messagesBlocked() {
  if (process.platform !== "darwin") return null;
  const r = run("osascript", [
    "-e",
    'tell application "Messages" to count chats',
  ]);
  if (r.code === 0) return null;
  if (!/-1743|not authorized/i.test(r.err || "")) return null;
  return openAutomationPane()
    ? MESSAGES_FIX + "\n  Opened that page for you."
    : MESSAGES_FIX;
}

// "Always take me there" (Caleb, 2026-10-10): naming a settings path makes him
// hunt for it, so the pane opens itself. Once per 10 minutes, so listing the
// drafts and then sending doesn't throw System Settings at him twice; the
// cooldown is a guess, never measured.
function openAutomationPane() {
  const fs = require("node:fs");
  const path = require("node:path");
  const { DIR } = require("./db");
  const stamp = path.join(DIR, ".opened-automation-pane");
  try {
    if (Date.now() - fs.statSync(stamp).mtimeMs < 10 * 60 * 1000) return true;
  } catch {
    /* never opened yet */
  }
  const r = run("open", [
    "x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_Automation",
  ]);
  if (r.code !== 0) return false;
  try {
    fs.writeFileSync(stamp, "");
  } catch {
    /* the pane opened; a missing stamp only means it may open again */
  }
  return true;
}

// One send row per call: sent, held by CHEWBACCA_NO_SEND, or failed. The
// child it hands a send to (gmail.py, slack.py, matrix.py) writes none.
function dispatch(via, to, text, flags) {
  const started = Date.now();
  const before = process.env.CHEWBACCA_SEND_LOGGED;
  process.env.CHEWBACCA_SEND_LOGGED = "1";
  let r;
  try {
    r = dispatchUnlogged(via, to, text, flags);
  } finally {
    if (before === undefined) delete process.env.CHEWBACCA_SEND_LOGGED;
    else process.env.CHEWBACCA_SEND_LOGGED = before;
  }
  const decision = r.code === 0 ? "sent" : r.code === 3 ? "held" : "failed";
  verdicts.sendRow(`people send ${via}`, decision, to, r.code === 0 ? "" : r.err || `exit ${r.code}`, started, [text]);
  return r;
}

function dispatchUnlogged(via, to, text, flags) {
  // Tests set this so a mistake in a test can never reach a real phone. On
  // 2026-10-08 a check meant to refuse a send had not applied, and the test
  // call delivered "hi" to a client.
  if (process.env.CHEWBACCA_NO_SEND)
    return { code: 3, err: "sending is disabled (CHEWBACCA_NO_SEND)" };
  if (via === "imessage") {
    const blocked = messagesBlocked();
    if (blocked) return { code: 4, err: blocked };
    // A group's GUID came from chat.db; make sure Messages itself knows that
    // chat before handing it text, so a stale id fails here and not silently.
    if (flags.room) {
      const probe = run("osascript", [
        "-e",
        "on run argv",
        "-e",
        'tell application "Messages" to get id of chat id (item 1 of argv)',
        "-e",
        "end run",
        to,
      ]);
      if (probe.code !== 0)
        return {
          code: 5,
          err: `Messages has no chat ${to}: ${(probe.err || "").trim()}`,
        };
    }
  }
  // The apps sent from right here need this message's press now; email,
  // Slack and the bridged chats hand it to gmail.py, slack.py and matrix.py,
  // which take it themselves (tools/send_approval.py).
  const file = flags[FILE];
  if ((via === "imessage" || via === "whatsapp") && !flags[APPROVED]) {
    const ok = approval.take(via, to, attach.boundText(text, file));
    if (!ok.ok) return { code: 6, err: ok.err };
  }
  if (file && via === "whatsapp")
    return run("wacli", attach.whatsappFileArgs(to, file, text));
  if (file && via === "imessage") {
    // The text goes first, as its own message, then the file: Messages has no
    // caption, and one script that sent both would fail as a unit.
    if (text) {
      const t = dispatchUnlogged(via, to, text, { ...flags, [FILE]: null, [APPROVED]: true });
      if (t.code !== 0) return t;
    }
    let staged;
    try {
      staged = attach.stage(file);
    } catch (e) {
      return { code: 7, err: `Couldn't copy ${file.name} where Messages can read it: ${e.message}` };
    }
    return run("osascript", attach.imessageFileArgs(to, staged, Boolean(flags.room)));
  }
  if (via === "imessage" && flags.room)
    return run("osascript", [
      ...GROUP_SCRIPT.flatMap((l) => ["-e", l]),
      to,
      text,
    ]);
  if (via === "imessage")
    return run("mac", ["messages", "send", to, text, "--json"]);
  if (via === "whatsapp")
    return run("wacli", [
      "--json",
      "--lock-wait=15s",
      "send",
      "text",
      "--to",
      to,
      "--message",
      text,
    ]);
  if (BRIDGED.includes(via)) {
    const py = require("./texts").textsReader("matrix.py");
    if (!py)
      return { code: 2, err: "mac/lib/matrix.py is missing from this install" };
    return run("python3", [
      py,
      "send",
      "--network",
      via,
      "--to",
      to,
      "--text",
      text,
    ]);
  }
  const reader = textsReader(via === "slack" ? "slack.py" : "gmail.py");
  if (!reader) return { code: 2, err: `${via} is not set up in this kit yet` };
  const args = [reader, "send", "--to", to, "--text", text];
  if (via === "email") args.push("--subject", emailSubject(flags, text));
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

// people send --room "Sophomore DT" "text": the group-chat path. It names the
// room and its id on a dry run, and refuses a name that two rooms share.
function sendRoom(d, name, text, via, flags, P) {
  let rooms = roomThread(d, name, via);
  // Two chats can share a display name (an RCS and an SMS copy of the same
  // group, 2026-10-10 "premed core"). An exact --to picks the one it names.
  if (rooms.length > 1 && flags.to) {
    const idOf = (r) =>
      r.source === "imessage" ? chatGuid(r.handle) : r.handle;
    const hit = rooms.filter((r) => idOf(r) === String(flags.to));
    if (hit.length === 1) rooms = hit;
  }
  if (!rooms.length)
    die(
      `No group called "${P(name)}" that you've written in${via ? ` on ${via}` : ""}. The name must match exactly; people texts owed prints it.`,
    );
  if (rooms.length > 1)
    die(
      `"${P(name)}" is ${rooms.length} groups:\n` +
        rooms.map((r) => `  ${r.source} ${P(r.handle)}`).join("\n") +
        "\nPick one with --via.",
    );
  const r = rooms[0];
  // Slack's own outgoing rows in a channel carry the channel id, the same
  // convention as iMessage and WhatsApp. An email "room" is a subject line
  // with three or more people on it, which is no address at all.
  if (!["imessage", "whatsapp", "slack", ...BRIDGED].includes(r.source))
    die(
      `Group sends work on iMessage, WhatsApp, Slack and the bridged chats, not ${r.source}. Reply to that thread from Gmail.`,
    );
  refuseFileApp(r.source, flags);
  const to =
    r.source === "imessage"
      ? chatGuid(r.handle)
      : BRIDGED.includes(r.source)
        ? matrixRoom(r.source, r.handle)
        : r.handle;
  if (!to)
    die(
      `Couldn't find the chat id for "${P(r.room)}" (chat.db, or the bridge room list people texts sync writes). Nothing was sent.`,
    );
  const where = `${c.b(P(r.room))} ${c.dim(`group via ${r.source}, ${P(to)}`)}`;
  if (flags["dry-run"]) {
    say(`  would send to ${where}`);
    if (text) say(`  ${P(text)}`);
    fileLine(flags);
    say(c.dim(`  to send: add --to ${P(to)}`));
    approvalLine(flags, r.source, to, text);
    return;
  }
  // SAME GATE AS AN UNSAVED 1:1. A room is found by its display name, and any
  // member can rename a group, so the name alone never authorizes a send:
  // --to has to repeat the exact id the dry run printed. A draft records that
  // id when it is written and carries it here.
  if (String(flags.to || "") !== to)
    die(
      `"${P(r.room)}" was found by name, so ${P(to)} is unconfirmed. Nothing was sent.\n` +
        `  If that is the right group, add --to ${P(to)}`,
    );
  const started = Date.now();
  const res = dispatch(r.source, to, text, { ...flags, room: true });
  if (!succeeded(res))
    die(
      `Not sent to ${P(r.room)}: ${P(
        (res.err || res.out || "no output")
          .trim()
          .split("\n")
          .slice(0, res.code === 4 ? 3 : 1)
          .join("\n"),
      )}`,
    );
  say(`${c.grn("sent")} to ${where}`);
  confirmLanded(r.source, to, text, flags, started, P);
}

// After an iMessage send, read its own rows back from chat.db: `mac` exits 0
// for a text Messages later marks Not Delivered, and the people store only
// catches up on its next sync (10/31: four "sent" texts missing for 10 min).
// A row with an error code is a failed send; no row at all is only a warning,
// since a slow network can take longer than the wait.
function confirmLanded(app, to, text, flags, started, P) {
  if (app !== "imessage" || process.env.CHEWBACCA_NO_VERIFY) return;
  const expect = (text ? 1 : 0) + (flags[FILE] ? 1 : 0);
  const v = attach.verifySent(to, started, { expect, wantFile: Boolean(flags[FILE]) });
  if (v.state === "landed")
    return say(c.dim(`  in chat.db: ${v.rows.length} sent row${v.rows.length === 1 ? "" : "s"}${flags[FILE] ? ", file attached" : ""}`));
  if (v.state === "failed")
    die(`Messages marked the send to ${P(to)} as failed (${v.error}). Check the thread before resending.`);
  if (v.state === "missing")
    return say(c.yel("  not in chat.db yet after 8s; check the thread before resending"));
  say(c.dim(`  couldn't read chat.db to confirm (${P(v.error)})`));
}

// --approval-binding on a dry run: one JSON line naming the exact channel and
// address the send would hand over, so a press handler (kit_confirm) can mint
// the approval for what the person saw. It approves nothing by itself.
function approvalLine(flags, channel, to, text) {
  text = attach.boundText(text, flags[FILE]);
  const subject = channel === "email" ? emailSubject(flags, text) : "";
  if (flags["approval-binding"])
    process.stdout.write(
      "approval-binding " +
        JSON.stringify({ channel, to, text, subject }) +
        "\n",
    );
}

// The subject an email goes out with, and so the one its approval is bound to.
function emailSubject(flags, text) {
  return String(flags.subject || text.split("\n")[0].slice(0, 60));
}

function refuseFileApp(app, flags) {
  if (flags[FILE] && !attach.FILE_APPS.includes(app))
    die(`Files go over ${attach.FILE_APPS.join(" and ")} only, and this thread is ${app}. Nothing was sent.`);
}

// "attach rec.pdf (182 KB)" on every dry run that carries one.
function fileLine(flags) {
  const f = flags[FILE];
  if (f) say(c.dim(`  attach ${f.name} (${Math.max(1, Math.round(f.size / 1024))} KB)`));
}

function cmdSend(argv) {
  const { flags, rest } = parseArgs(argv);
  // `--room "Den Group" "text"`: the parser hands the room name to the flag.
  if (typeof flags.room === "string") {
    rest.unshift(flags.room);
    flags.room = true;
  }
  const who = rest.shift();
  const text = rest.join(" ").trim();
  if (flags.file === true) die("--file needs a path. Nothing was sent.");
  flags[FILE] = null;
  if (flags.file) {
    const info = attach.fileInfo(flags.file);
    if (info.err) die(info.err);
    flags[FILE] = info;
  }
  if (!who || (!text && !flags[FILE]))
    die(
      'Try: people send maggie "running 10 late" [--via whatsapp] [--file path] [--dry-run]   or   people send --room "Group Name" "text"',
    );
  const via = flags.via ? String(flags.via).toLowerCase() : null;
  if (via && !APPS.includes(via)) die(`--via is one of: ${APPS.join(", ")}`);
  const P = (v) => printable(v == null ? "" : v);

  const d = db();
  if (flags.room) return sendRoom(d, who, text, via, flags, P);
  // STRICT, UNLIKE READING. `people texts dad` may guess the most recently
  // texted match because a wrong pick there costs one visible line. Here it
  // costs a message in the wrong person's phone: on 2026-10-08 a dry run of
  // `people send dad` resolved to "prestons dad". findPerson refuses ambiguity.
  const person = findPerson(who, { required: false });
  if (!person) {
    // A thread nobody's card owns yet (an unsaved WhatsApp number) may still
    // be addressed, but only when exactly one such thread matches.
    const names = d
      .prepare(
        "SELECT DISTINCT who FROM messages WHERE person_id IS NULL AND room IS NULL AND lower(who) LIKE ? LIMIT 6",
      )
      .all("%" + String(who).toLowerCase() + "%")
      .map((r) => r.who);
    if (names.length > 1)
      die(
        `"${P(who)}" matches ${names.length} threads:\n` +
          names.map((n) => `  ${P(n)}`).join("\n") +
          "\nBe more specific.",
      );
  }
  const thread = lastThread(d, person, who, via);
  const app = via || (thread && thread.source);
  const handle = (thread && thread.handle) || fromCard(person, app);
  const name = (person && person.name) || (thread && thread.who) || who;
  if (!app || !handle)
    die(
      `No ${via || "message"} history with ${P(name)} and no address on their card.\n` +
        `  Add one: people set "${P(who)}" phone <number>   or pick an app with --via`,
    );
  refuseFileApp(app, flags);
  const to = target(app, handle);
  if (!to)
    die(
      BRIDGED.includes(app)
        ? `No ${app} room on file for ${P(name)} (${P(handle)}). people texts sync records it once the bridge has the thread. Nothing was sent.`
        : `No ${app} address for ${P(name)} (${P(handle)}).`,
    );
  // mac/lib/gmail.py files mail whose From failed Gmail's own sender check
  // under "unverified:" plus the claimed address. A reply there answers
  // whoever forged the name, so no --to can confirm it.
  if (/^unverified:/i.test(to))
    die(
      `${P(name)}'s last ${app} came from ${P(to.slice(11))}, which failed Gmail's sender check. Nothing was sent.\n` +
        `  It may be forged. Confirm the address with them another way before writing to it.`,
    );

  // AN ADDRESS ONLY COUNTS IF IT PROVABLY BELONGS TO THEM: the card's own
  // phone or email, or a handle the store resolves back to this same person.
  // Anything else was reached through a name, and on WhatsApp or Slack the
  // sender picks their own name. That sends only when --to repeats the exact
  // address the dry run printed, so a person chose the number, not the name.
  const owned =
    Boolean(person) &&
    (resolvePerson(null, handle, { strict: true }) === person.id ||
      handle === fromCard(person, app));
  const where = `${c.b(P(name))} ${c.dim(`via ${app}, ${P(to)}${owned ? "" : ", not a saved contact"}`)}`;
  // config/send-policy.cedar decides who and when; quietFor and the owned
  // check below stay as a backstop for a Mac where the policy isn't built or
  // its reader broke, and either one saying no is a no. no-send is left to dispatch, which
  // holds the send and writes its row the same way it always has.
  const verdict = approval.policy({
    channel: app,
    name,
    direct: true,
    after_hours: Boolean(flags["after-hours"]),
    address_owned: owned,
    to_confirmed: String(flags.to || "") === to,
  });
  const said = new Set((verdict.rules || []).map((r) => r.id));
  // Only a rule the policy names refuses (send_policy.refuses). A reader that
  // crashed or timed out is no answer, and the inline checks below stand:
  // agents send by default (Caleb, 2026-10-12 9:54am).
  const named = verdict.refuses === true;
  const policyOther =
    named && [...said].some((id) => !["no-send", "quiet-hours", "unowned-address"].includes(id));
  const policyLine = `The send policy says no: ${[
    ...(verdict.rules || []).map((r) => `${r.reason} (${r.id})`),
    ...(verdict.errors || []),
  ].join("; ")}.`;
  const quiet = quietFor(name);
  const quietLine = quiet
    ? `It's ${quiet.local} for ${P(name)}, inside the hours they asked not to get a direct text (${P(quiet.rule.source || "quiet-hours.json")}).`
    : "";
  if (flags["dry-run"]) {
    say(`  would send to ${where}`);
    if (text) say(`  ${P(text)}`);
    fileLine(flags);
    if (!owned) say(c.dim(`  to send: add --to ${P(to)}`));
    if (quiet)
      say(
        c.dim(
          `  ${quietLine} A send now is refused; queue it in people texts drafts.`,
        ),
      );
    if (named && said.has("quiet-hours") && !quiet)
      say(c.dim(`  The send policy puts this inside ${P(name)}'s quiet hours. A send now is refused.`));
    if (policyOther) say(c.dim(`  ${P(policyLine)} A send now is refused.`));
    approvalLine(flags, app, to, text);
    return;
  }
  if (policyOther) die(`${P(policyLine)} Nothing was sent.`);
  if (named && said.has("quiet-hours") && !quiet)
    die(
      `The send policy puts this inside ${P(name)}'s quiet hours. Nothing was sent.\n` +
        `  Queue it: people texts drafts add "${P(who)}" "..."   or post it in the group chat.`,
    );
  if (quiet && !flags["after-hours"])
    die(
      `${quietLine} Nothing was sent.\n` +
        `  Queue it: people texts drafts add "${P(who)}" "..."   or post it in the group chat.`,
    );
  if ((named && said.has("unowned-address")) || (!owned && String(flags.to || "") !== to))
    die(
      `${P(name)} isn't a saved contact, so ${P(to)} is unconfirmed. Nothing was sent.\n` +
        `  If that address is right, add --to ${P(to)}   or save them: people add "${P(name)}"`,
    );

  const started = Date.now();
  const r = dispatch(app, to, text, flags);
  if (!succeeded(r))
    die(
      `Not sent to ${P(name)} via ${app}: ${P(
        (r.err || r.out || "no output")
          .trim()
          .split("\n")
          .slice(0, r.code === 4 ? 3 : 1)
          .join("\n"),
      )}`,
    );
  if (person)
    d.prepare(
      "INSERT INTO interactions (id, person_id, channel, note, happened_at) VALUES (lower(hex(randomblob(16))),?,?,NULL,?)",
    ).run(person.id, app, nowISO());
  say(`${c.grn("sent")} to ${where}`);
  confirmLanded(app, to, text, flags, started, P);
}

module.exports = {
  cmdSend,
  lastThread,
  waJid,
  target,
  roomThread,
  chatGuid,
  messagesBlocked,
  matrixRoom,
};
