// @ts-nocheck
// people texts: syncing the Messages history through the mac kit's reader,
// then reading, searching and linking threads (texts sync, log, stats,
// link, search).

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { execFileSync } = require("node:child_process");
const { c, die, say, parseArgs } = require("./output");
const { db, nowISO, syncState } = require("./db");
const { findPerson, nameTokens, normHandle } = require("./lookup");
const { recomputeScores } = require("./scoring");
const { cmdIdentities } = require("./identities");

// ------------------------------------------------------------------- messages

// The reader lives in the mac kit because decoding attributedBody is fiddly and
// already solved there. Without that decode you see about 5% of a real library
// and almost nothing the user sent.
// WHO "GAVIN" MEANS WHEN YOU ARE READING TEXTS. The store holds five people
// whose first name is Gavin, so findPerson rightly refuses to guess, which is
// what a write needs. Reading is different: the person someone asks to "scan
// texts with" is the one they are texting now, and a wrong pick costs one
// visible line, not a corrupted record. So ambiguity resolves to the most
// recently texted candidate, and the others are named so a miss is obvious.
// Message bodies and group-chat names are written by other people, and an
// ESC byte in one is a terminal escape sequence when printed raw: it can
// recolor, retitle or rewrite what is on screen. Strip C0/C1 controls except
// newline and tab before anything from chat.db reaches the terminal.
const printable = (s) => String(s).replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, "");

// iMessage is the default and goes unmarked; any other app says which it was,
// so a reply goes back through the app the conversation is actually in.
const tag = (r) => (r.source && r.source !== "imessage" ? c.dim(`[${r.source}] `) : "");

function textPartner(d, needle) {
  const n = String(needle).toLowerCase();
  const exact = d
    .prepare("SELECT * FROM people WHERE deleted_at IS NULL AND (id = ? OR handle = ? OR lower(name) = ?)")
    .all(needle, needle, n);
  if (exact.length === 1) return exact[0];
  const like = exact.length
    ? exact
    : d.prepare("SELECT * FROM people WHERE deleted_at IS NULL AND lower(name) LIKE ?").all(`%${n}%`);
  if (like.length <= 1) return like[0] || null;
  const first = like.filter((p) => nameTokens(p.name)[0] === n);
  const pool = first.length ? first : like;
  const last = d.prepare("SELECT max(sent_at) t FROM messages WHERE person_id = ?");
  const ranked = pool
    .map((p) => ({ p, t: last.get(p.id).t || "" }))
    .sort((a, b) => (a.t < b.t ? 1 : a.t > b.t ? -1 : 0));
  if (!ranked[0].t) return null;
  const others = ranked.slice(1, 6).map((r) => r.p.name);
  say(c.dim(`  "${needle}" = ${ranked[0].p.name}, texted most recently. Also: ${others.join(", ")}`));
  return ranked[0].p;
}

function textsReader(file = "texts.py") {
  const here = path.dirname(fs.realpathSync(process.argv[1]));
  for (const cand of [
    path.join(here, "..", "mac", "lib", file),
    path.join(here, "..", "..", "mac", "lib", file),
    path.join(os.homedir(), ".chewbacca", "mac", "lib", file),
    path.join(os.homedir(), "code/chewbacca/mac/lib", file),
  ])
    if (fs.existsSync(cand)) return cand;
  return null;
}

// Every app besides iMessage whose history lands in the same messages table.
// Each reader is a script in mac/lib that prints texts.py's JSON shape and
// prints [] when its app is not set up on this machine.
//
// `refresh` pulls the app's own local copy up to date first. Each step is
// best-effort and bounded: a tool that is missing or not signed in is skipped.
const CHANNELS = [
  {
    source: "whatsapp",
    reader: "whatsapp.py",
    label: "WhatsApp",
    // wacrawl copies WhatsApp Desktop's database (local, about a second here);
    // wacli asks the linked device for anything new since its last sync.
    refresh: [
      ["wacrawl", ["import"]],
      ["wacli", ["sync", "--once", "--idle-exit", "10s"]],
    ],
  },
];

function syncChannel(d, ch, flags) {
  const py = textsReader(ch.reader);
  if (!py) return 0;
  if (!flags["no-refresh"])
    for (const [cmd, args] of ch.refresh || []) {
      try {
        execFileSync(cmd, args, { stdio: "ignore", timeout: 60000 });
      } catch {
        /* missing, not linked, or busy: read whatever the store already has */
      }
    }
  const key = `${ch.source}_last_sync`;
  // Same rule as iMessage: everything the first time, a 30-day window after.
  const days = Number(flags.days ?? (syncState(key) ? 30 : 0));
  let rows;
  try {
    rows = JSON.parse(
      execFileSync("python3", [py, "--json", "--days", String(days)], {
        encoding: "utf8",
        maxBuffer: 1024 * 1024 * 1024,
        stdio: ["ignore", "pipe", "pipe"],
      }),
    );
  } catch (e) {
    // One app failing must not cost the user their iMessage sync.
    if (!flags.quiet) say(c.dim(`  ${ch.label} skipped: ${String((e && e.message) || e).split("\n")[0]}`));
    return 0;
  }
  const { added } = ingestRows(d, rows, ch.source, 0);
  syncState(key, nowISO());
  return added;
}

// Match a thread to someone already in the store. Handle first because a phone
// number is exact; the display name is a fallback and is allowed to miss.
function resolvePerson(who, handle) {
  const d = db();
  if (handle) {
    const alias = d
      .prepare("SELECT person_id FROM identities WHERE value = ?")
      .get(normHandle(handle) || "");
    if (alias) return alias.person_id;
    const digits = String(handle).replace(/\D/g, "").slice(-10);
    if (digits.length === 10) {
      const hit = d
        .prepare(
          `SELECT id FROM people WHERE deleted_at IS NULL
             AND replace(replace(replace(replace(replace(coalesce(phone,''),'+',''),'-',''),' ',''),'(',''),')','') LIKE ?`,
        )
        .get("%" + digits);
      if (hit) return hit.id;
    }
    if (String(handle).includes("@")) {
      const hit = d
        .prepare("SELECT id FROM people WHERE deleted_at IS NULL AND lower(email)=lower(?)")
        .get(handle);
      if (hit) return hit.id;
    }
  }
  if (who) {
    const exact = d
      .prepare("SELECT id FROM people WHERE deleted_at IS NULL AND lower(name)=lower(?)")
      .get(who);
    if (exact) return exact.id;
  }
  return null;
}

// Write reader rows into messages. Shared by iMessage and every other channel,
// so attribution, FTS and batching behave the same whichever app a row came
// from. Only iMessage advances messages_max_id: other channels' ids are hashes.
function ingestRows(d, rows, source, seen) {
    const ins = d.prepare(
      `INSERT INTO messages (msg_id, person_id, who, handle, from_me, body, sent_at, room, source)
       VALUES (?,?,?,?,?,?,?,?,?)
       ON CONFLICT(msg_id) DO UPDATE SET
         -- REPAIR, NOT JUST INSERT. Rows written before the reader learned to
         -- name the speaker have a group's name where a person belongs, and
         -- DO NOTHING would leave 54,000 of them wrong forever. Only the
         -- attribution is rewritten; the body and the timestamp are what
         -- chat.db said then and still says now.
         who       = excluded.who,
         person_id = COALESCE(excluded.person_id, messages.person_id),
         room      = excluded.room
       WHERE messages.room IS NULL AND excluded.room IS NOT NULL`,
    );
    const fts = d.prepare("INSERT INTO messages_fts (rowid, body) VALUES (?,?)");
    let added = 0,
      maxId = seen,
      unlinked = new Map();

    // resolvePerson runs a LIKE scan over every contact, and a full backfill
    // asks the same question 600k times for a few thousand distinct threads.
    // Cache by thread so each one is resolved once.
    const pidCache = new Map();
    const resolveCached = (who, handle) => {
      const key = (handle || "") + "\u0000" + (who || "");
      if (pidCache.has(key)) return pidCache.get(key);
      const pid = resolvePerson(who, handle);
      pidCache.set(key, pid);
      return pid;
    };

    // Batched transactions, not one enormous one.
    //
    // Committing per row fsyncs half a million times and turns a backfill into
    // half an hour. Wrapping the whole backfill in a single transaction fixes
    // that and creates a worse problem: one writer holding the database for
    // minutes, which starved the SessionStart hooks until they were killed at
    // their timeout. Five of those failures are in this machine's log, all
    // during a full re-sync, and they read as a broken kit rather than as a
    // busy one.
    //
    // A commit every few thousand rows keeps the fsync count negligible and
    // gives readers a gap to run in.
    const TX_ROWS = 5000;
    let txCount = 0;
    d.exec("BEGIN");
    try {
    for (const r of rows) {
      if (r.reaction || r.attachment_only) continue; // "Loved an image" is not a conversation
      const body = String(r.text || "").trim();
      if (!body) continue;
      const pid = resolveCached(r.with, r.handle);
      const res = ins.run(
        r.id,
        pid,
        r.with || r.handle || "unknown",
        r.handle || null,
        r.from_me ? 1 : 0,
        body,
        String(r.at).replace("T", " "),
        r.room || null,
        source,
      );
      if (res.changes) {
        fts.run(r.id, body);
        added++;
        if (!pid) unlinked.set(r.with, (unlinked.get(r.with) || 0) + 1);
      }
      if (source === "imessage" && r.id > maxId) maxId = r.id;
      if (++txCount % TX_ROWS === 0) {
        d.exec("COMMIT");
        d.exec("BEGIN");
      }
    }
      d.exec("COMMIT");
    } catch (e) {
      d.exec("ROLLBACK");
      throw e;
    }
    return { added, maxId, unlinked };
}

function cmdTexts(argv) {
  const sub = ["sync", "log", "stats", "link", "search"].includes(argv[0]) ? argv.shift() : "log";
  const { flags, rest } = parseArgs(argv);
  const d = db();

  if (sub === "sync") {
    const py = textsReader();
    if (!py)
      die(
        "Cannot find the message reader (mac/lib/texts.py).\n" +
          "  It ships with this kit. Re-run setup.sh, or set CHEWBACCA_ROOT.",
      );
    // First run takes a bounded window. A full history is 600k+ rows on a real
    // machine and nobody wants their first command to be a ten-minute import.
    //
    // The DAY WINDOW is that bound, and it is the only one. The reader also has
    // a --limit, defaulting to 2000, which used to apply here silently: asking
    // for --days 3200 returned the most recent 2000 rows and reported success,
    // so a backfill looked like it worked and quietly imported six days. Pass 0
    // to turn the row cap off and let --days mean what it says.
    // THE FIRST SYNC TAKES EVERYTHING, AND THE WINDOW IS ALWAYS PRINTED.
    //
    // This used to default the first sync to 90 days. Every last-contact date
    // then lands inside the window, so nothing can be overdue, and `people
    // reconnect` answers "nobody is overdue, 232 people have recent contact on
    // file" off 23,000 messages. Gavin hit it on 2026-09-18 and named the real
    // problem: the clean bill of health is the dangerous part, because it
    // reads as an answer rather than as an empty window. Running --days 3200
    // gave him 155k messages back to 2021 and fifteen overdue people
    // immediately.
    //
    // A bounded first import was the wrong trade. It is slower to be correct
    // once than to be silently wrong forever, and the row cap that made a
    // backfill actually dangerous is already off (see above). An incremental
    // sync still takes 30 days, because by then there is a high-water mark.
    const seen = Number(syncState("messages_max_id") || 0);
    const days = Number(flags.days ?? (seen ? 30 : 0));
    if (!flags.quiet) {
      say(
        c.dim(
          days === 0
            ? "  reading the full message history (first sync, this takes a minute)"
            : `  reading the last ${days} days`,
        ),
      );
    }
    const limit = flags.limit === undefined ? 0 : Number(flags.limit);
    let raw;
    try {
      raw = execFileSync("python3", [py, "--json", "--days", String(days), "--limit", String(limit)], {
        encoding: "utf8",
        maxBuffer: 1024 * 1024 * 1024,
      });
    } catch (e) {
      const err = String((e && e.stderr) || e.message || "");
      if (/operation not permitted|unable to open database/i.test(err))
        die(
          "macOS blocked the read of your message database.\n" +
            "  Give your terminal Full Disk Access:\n" +
            "  System Settings > Privacy & Security > Full Disk Access\n" +
            "  Nothing is sent anywhere; this reads a local file.",
        );
      die("Could not read messages: " + err.split("\n")[0]);
    }
    let rows;
    try {
      rows = JSON.parse(raw);
    } catch {
      die("The message reader returned something unreadable.");
    }

    const imsg = ingestRows(d, rows, "imessage", seen);
    let added = imsg.added;
    const maxId = imsg.maxId;
    const unlinked = imsg.unlinked;

    // OTHER APPS, SAME STORE. Each reader prints rows in texts.py's shape, so
    // a person's thread is one log whichever app the conversation was in. A
    // channel whose app is not set up here prints nothing and costs nothing.
    const channelAdded = {};
    for (const ch of CHANNELS) {
      const n = syncChannel(d, ch, flags);
      if (n) channelAdded[ch.source] = n;
      added += n;
    }
    // Link the backlog too. Insert-time linking alone means any message that
    // arrived before its contact existed stays orphaned forever, which is the
    // normal case: the session hook syncs texts before anyone runs an import.
    let relinked = 0;
    for (const row of d
      .prepare("SELECT DISTINCT who, handle FROM messages WHERE person_id IS NULL")
      .all()) {
      const pid = resolvePerson(row.who, row.handle);
      if (!pid) continue;
      // Match on the handle when there is one. Matching on the thread name
      // instead credited every sender in a group chat to whichever member
      // happened to resolve first, and left the rest orphaned. The handle
      // says who actually sent the message; the thread name does not.
      relinked += row.handle
        ? d
            .prepare("UPDATE messages SET person_id=? WHERE person_id IS NULL AND handle=?")
            .run(pid, row.handle).changes
        : d
            .prepare("UPDATE messages SET person_id=? WHERE person_id IS NULL AND who=? AND handle IS NULL")
            .run(pid, row.who).changes;
    }

    // Undo the damage the old rule did. A message whose handle belongs to a
    // different person in the store was credited to the wrong one.
    let recredited = 0;
    for (const row of d
      .prepare(
        `SELECT DISTINCT m.handle, m.person_id FROM messages m
          WHERE m.from_me = 0 AND m.handle IS NOT NULL AND m.handle <> '' AND m.person_id IS NOT NULL`,
      )
      .all()) {
      const truth = resolvePerson(null, row.handle);
      if (!truth || truth === row.person_id) continue;
      recredited += d
        .prepare("UPDATE messages SET person_id=? WHERE handle=? AND person_id=? AND from_me=0")
        .run(truth, row.handle, row.person_id).changes;
    }

    syncState("messages_max_id", maxId);
    syncState("messages_last_sync", nowISO());

    // The whole point: a real conversation counts as contact, so warmth and
    // reconnect stop depending on the user remembering to log by hand.
    const logged = d
      .prepare(
        `INSERT INTO interactions (id, person_id, channel, note, happened_at)
         SELECT lower(hex(randomblob(16))), m.person_id,
                (SELECT x.source FROM messages x WHERE x.person_id = m.person_id
                  ORDER BY x.sent_at DESC LIMIT 1),
                NULL, max(m.sent_at)
           FROM messages m
          WHERE m.person_id IS NOT NULL
            AND m.sent_at > coalesce((SELECT max(happened_at) FROM interactions i
                                       WHERE i.person_id = m.person_id), '')
          GROUP BY m.person_id`,
      )
      .run();
    recomputeScores();

    say(`${c.grn("synced")} ${added} new messages${c.dim(`  (${days}d window)`)}`);
    for (const ch of CHANNELS)
      if (channelAdded[ch.source]) say(c.dim(`  ${channelAdded[ch.source]} of them from ${ch.label}`));
    // Every handle in those messages is an address somebody demonstrably sent
    // from, and identities is what phone-keyed joins run on. Recording them is
    // part of the sync, not a second command to remember.
    if (added) {
      try {
        cmdIdentities(["backfill", "--quiet"]);
      } catch {
        /* a failed backfill must not fail the sync */
      }
    }
    if (relinked) say(c.dim(`  ${relinked} older messages linked to people you have since added`));
    if (recredited) say(c.dim(`  ${recredited} messages re-credited to the person who actually sent them`));
    if (logged.changes) say(c.dim(`  ${logged.changes} people had their last-contact updated`));
    if (unlinked.size) {
      const top = [...unlinked.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
      say(c.dim(`\n  ${unlinked.size} threads are not linked to anyone in your store:`));
      for (const [w, n] of top) say(c.dim(`    ${w}  (${n})`));
      say(c.dim(`  people texts link "<thread name>" <person>   to connect one`));
    }
    return;
  }

  if (sub === "link") {
    const who = rest.shift();
    const target = rest.join(" ");
    if (!who || !target) die('Try: people texts link "Sam Rivera" sam');
    const p = findPerson(target);
    const n = d.prepare("UPDATE messages SET person_id=? WHERE who=? AND person_id IS NULL").run(p.id, who);
    say(`${c.grn("linked")} ${n.changes} messages from ${c.b(who)} to ${c.b(p.name)}`);
    recomputeScores();
    return;
  }

  if (sub === "stats") {
    const t = d.prepare("SELECT count(*) n, min(sent_at) a, max(sent_at) b FROM messages").get();
    const linked = d.prepare("SELECT count(*) n FROM messages WHERE person_id IS NOT NULL").get().n;
    say("");
    say(`  messages   ${t.n}`);
    say(`  linked     ${linked}${t.n ? c.dim(`  (${Math.round((linked / t.n) * 100)}%)`) : ""}`);
    say(`  range      ${(t.a || "").slice(0, 10)} to ${(t.b || "").slice(0, 10)}`);
    say(`  last sync  ${syncState("messages_last_sync") || "never"}`);
    for (const r of d.prepare("SELECT source, count(*) n FROM messages GROUP BY source ORDER BY n DESC").all())
      say(c.dim(`  ${String(r.source).padEnd(10)} ${r.n}`));
    say("");
    return;
  }

  if (sub === "search") {
    const q = rest.join(" ");
    if (!q) die('Try: people texts search "the trip"');
    const rows = d
      .prepare(
        `SELECT m.who, m.from_me, m.body, m.sent_at, m.source FROM messages_fts f
           JOIN messages m ON m.msg_id = f.rowid
          WHERE messages_fts MATCH ? ORDER BY m.sent_at DESC LIMIT ?`,
      )
      .all(q, Number(flags.limit || 25));
    if (!rows.length) return say(c.dim(`  nothing matches "${q}"`));
    say("");
    for (const r of rows)
      say(
        `  ${c.dim(r.sent_at.slice(0, 16))}  ${c.b(printable(r.who).padEnd(20).slice(0, 20))} ${r.from_me ? c.cyn("->") : "<-"} ${tag(r)}${printable(r.body).replace(/\s+/g, " ").slice(0, 90)}`,
      );
    say(`\n  ${rows.length} results\n`);
    return;
  }

  // the running log
  //
  // "Read my texts with Gavin" took eight tool calls on 2026-10-05 because of
  // three bugs here, each of which looked like a different problem:
  // - ORDER BY ASC LIMIT kept the OLDEST 300 rows, so `--days 14` silently
  //   ended eleven days ago and the newest messages were the ones dropped.
  // - `lower(who) LIKE %gavin%` pulled every thread whose contact name
  //   mentions him ("Jake UIUX Gavin's Friend") into his log.
  // - bodies were cut at 100 characters, and the message that mattered was a
  //   1,400-character proposal, so the reader fell back to raw chat.db.
  // One person now means their messages only, newest kept, printed whole, and
  // with no --days the window is their whole history rather than three days.
  const who = flags.who || rest.join(" ") || null;
  const person = who ? textPartner(d, who) : null;
  const days = Number(flags.days || (person ? 36500 : 3));
  const limit = Number(flags.limit || 300);
  const full = Boolean(flags.full || person);
  let sql = `SELECT who, from_me, body, sent_at, source FROM messages
              WHERE julianday('now') - julianday(sent_at) <= ?`;
  const args = [days];
  if (person) {
    sql += " AND person_id = ?";
    args.push(person.id);
  } else if (who) {
    sql += " AND lower(who) LIKE ?";
    args.push("%" + who.toLowerCase() + "%");
  }
  sql += " ORDER BY sent_at DESC LIMIT ?";
  args.push(limit);
  const rows = d.prepare(sql).all(...args).reverse();
  if (!rows.length) {
    const any = d.prepare("SELECT count(*) n FROM messages").get().n;
    return say(
      any
        ? c.dim(`  nothing in the last ${days} days${who ? ` with ${who}` : ""}`)
        : c.dim("  no messages yet. Run: people texts sync"),
    );
  }
  say("");
  if (rows.length === limit)
    say(c.dim(`  showing the newest ${limit}; --limit N for more`));
  let last = null;
  for (const r of rows) {
    if (r.who !== last) {
      say(`\n${c.cyn(printable(r.who))}`);
      last = r.who;
    }
    const body = full
      ? printable(r.body).replace(/\n/g, "\n                 ")
      : printable(r.body).replace(/\s+/g, " ").slice(0, 100);
    say(`  ${c.dim(r.sent_at.slice(5, 16))} ${r.from_me ? c.cyn("->") : "  "} ${tag(r)}${body}`);
  }
  say("");
}

module.exports = {
  cmdTexts, textPartner, textsReader, CHANNELS,
};
