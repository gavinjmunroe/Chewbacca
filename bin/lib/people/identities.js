// @ts-nocheck
// people identities: which phone or email belongs to whom (alias,
// identify, identities), including asking the model who is speaking in a
// group chat.

"use strict";

const { c, die, say, parseArgs } = require("./output");
const { db, uuid, nowISO } = require("./db");
const { findPerson, normHandle } = require("./lookup");
const { recomputeScores } = require("./scoring");
const { claudeJSON } = require("./model");
const { insertObservation } = require("./observations");

function cmdAlias(argv) {
  const { flags, rest } = parseArgs(argv);
  const d = db();

  // No arguments: show the handles sending you messages that belong to nobody.
  // That list is the whole reason this command exists.
  if (!rest.length) {
    const rows = d
      .prepare(
        // Recency first, not raw volume. A stranger from a 2019 middle-school
        // group chat has thousands of messages and no chance of being named
        // six years later; a teammate from last semester has two hundred and
        // is someone you actually know. --all restores the volume ordering.
        `SELECT handle, count(*) AS n, max(sent_at) AS last FROM messages
          WHERE person_id IS NULL AND from_me = 0 AND handle IS NOT NULL AND handle <> ''
            -- A shortcode is a bank, a carrier or a two-factor robot. It is
            -- never a person, and it crowded out everyone who is.
            AND (handle LIKE '+%' OR handle LIKE '%@%')
          GROUP BY handle
          ${flags.all ? "ORDER BY n DESC" : "HAVING last > date('now', '-18 months') ORDER BY last DESC"}
          LIMIT ?`,
      )
      .all(Number(flags.limit) || 20);
    if (!rows.length) return say(c.grn("  every recent sender is attributed") + c.dim("  people alias --all for the whole backlog"));
    say("");
    say(c.b("handles nobody owns") + c.dim("   people alias <name> <handle>"));
    for (const r of rows) {
      const t = d
        .prepare("SELECT who FROM messages WHERE handle=? AND who IS NOT NULL AND who <> '' GROUP BY who ORDER BY count(*) DESC LIMIT 1")
        .get(r.handle);
      say(`  ${String(r.n).padStart(5)}  ${r.handle.padEnd(26)} ${c.dim((t ? t.who : "") + "  last " + String(r.last).slice(0, 10))}`);
    }
    say("");
    return;
  }

  const handle = rest.pop();
  const who = rest.join(" ");
  if (!who) die('Try: people alias "Maya Patel" maya@example.com');
  const key = normHandle(handle);
  if (!key) die(`Not a phone or an email: ${handle}`);
  const p = findPerson(who);
  d.prepare("INSERT INTO identities (person_id, kind, value) VALUES (?,?,?) ON CONFLICT(kind, value) DO UPDATE SET person_id = excluded.person_id")
    .run(p.id, key.includes("@") ? "email" : "phone", key);
  const n = d
    .prepare("UPDATE messages SET person_id=? WHERE person_id IS NULL AND handle=?")
    .run(p.id, handle).changes;
  say(`${c.grn("linked")} ${handle} to ${c.b(p.name)}${n ? c.dim(`  (${n} messages attributed)`) : ""}`);
  if (n) recomputeScores();
}


// ---------------------------------------------------------------- identify
// A group chat carries the sender's phone number but not their name, so people
// Caleb has never texted one-to-one show up as "+16266170404" with 2,000
// messages attached. Their name is almost always somewhere in the conversation:
// somebody greets them, thanks them, or they sign a message. This reads the
// surrounding thread and asks Claude who is speaking.

const IDENTIFY_SYSTEM =
  "You identify who is speaking in a group chat from context. " +
  "You reply with a JSON object and nothing else: no preamble, no prayer.";

async function identifyOne(d, handle, model) {
  const mine = d
    .prepare(
      `SELECT who, body, sent_at FROM messages
        WHERE handle = ? AND body IS NOT NULL AND length(body) BETWEEN 8 AND 300
        ORDER BY sent_at LIMIT 60`,
    )
    .all(handle);
  if (!mine.length) return null;

  // The name is usually in what other people say back, not in what the person
  // says, so the reply context matters more than their own messages.
  const threads = [...new Set(mine.map((m) => m.who).filter(Boolean))].slice(0, 3);
  const around = d
    .prepare(
      `SELECT p.name AS speaker, m.body FROM messages m
         LEFT JOIN people p ON p.id = m.person_id
        WHERE m.who IN (${threads.map(() => "?").join(",")}) AND m.handle IS NOT ?
          AND m.body IS NOT NULL AND length(m.body) BETWEEN 8 AND 200
        ORDER BY random() LIMIT 60`,
    )
    .all(...threads, handle);

  const prompt = [
    `Handle: ${handle}`,
    `Threads: ${threads.join(", ") || "unknown"}`,
    "",
    "MESSAGES THIS PERSON SENT:",
    ...mine.slice(0, 45).map((m) => `- ${m.body.replace(/\s+/g, " ").slice(0, 200)}`),
    "",
    "MESSAGES OTHERS SENT IN THE SAME THREADS (for context, names in brackets):",
    ...around.slice(0, 45).map((m) => `- [${m.speaker || "?"}] ${m.body.replace(/\s+/g, " ").slice(0, 160)}`),
    "",
    "Who is the person behind the handle?",
    "",
    "Confidence rubric, follow it exactly:",
    '  high   - they name themselves ("im Chloe", "this is Jake Moreno"), or several',
    "           different people address this speaker by the same name.",
    '  medium - one person addresses them by name and nothing contradicts it.',
    "  low    - a name is only inferable from indirect context.",
    "  null   - no name is evidenced. This is a perfectly good answer.",
    "",
    "Never guess from vibes, tone, or what the thread is about. Prefer null.",
    "If a name appears only as someone the speaker is TALKING ABOUT, that is not them.",
    "",
    'Reply with only: {"name": "First Last" or null, "confidence": "high"|"medium"|"low", "evidence": "the line that shows it"}',
  ].join("\n");

  const out = await claudeJSON(prompt, IDENTIFY_SYSTEM, model);
  if (!out) return null;
  const a = out.indexOf("{");
  const b = out.lastIndexOf("}");
  if (a < 0 || b <= a) return null;
  try {
    return JSON.parse(out.slice(a, b + 1));
  } catch {
    return null;
  }
}

// Writing a name is idempotent: run it twice and the second run changes
// nothing. That is what lets the worker write as it goes instead of banking
// everything until the end, where a crash at 140 of 146 loses the lot.
function applyIdentity(d, f) {
  const existing = d
    .prepare("SELECT id FROM people WHERE deleted_at IS NULL AND lower(name) = lower(?) LIMIT 1")
    .get(f.name);
  let pid = existing ? existing.id : null;
  if (!pid) {
    pid = uuid();
    const isEmail = String(f.handle).includes("@");
    d.prepare("INSERT INTO people (id, name, phone, email, created_at) VALUES (?,?,?,?,?)").run(
      pid, f.name, isEmail ? null : f.handle, isEmail ? f.handle : null, nowISO(),
    );
  }
  const key = normHandle(f.handle);
  if (key)
    d.prepare(
      "INSERT INTO identities (person_id, kind, value) VALUES (?,?,?) ON CONFLICT(kind, value) DO UPDATE SET person_id = excluded.person_id",
    ).run(pid, key.includes("@") ? "email" : "phone", key);
  const moved = d
    .prepare("UPDATE messages SET person_id=? WHERE person_id IS NULL AND handle=?")
    .run(pid, f.handle).changes;
  const body = `identified from group-chat context: ${f.evidence || "named by others in the thread"}`;
  const dupe = d
    .prepare("SELECT 1 FROM observations WHERE person_id=? AND body=? AND deleted_at IS NULL")
    .get(pid, body);
  if (!dupe)
    insertObservation({ personId: pid, circleId: null, body, flags: { source: "inferred", kind: "note" }, judge: true });
  return { pid, moved, existed: !!existing };
}

async function cmdIdentify(argv) {
  const { flags } = parseArgs(argv);
  const d = db();
  const model = flags.model || "claude-sonnet-5";
  const floor = Number(flags.min) || 25;

  const unknown = d
    .prepare(
      `SELECT handle, count(*) AS n FROM messages
        WHERE person_id IS NULL AND from_me = 0 AND handle IS NOT NULL AND handle <> ''
        GROUP BY handle HAVING n >= ? ORDER BY n DESC`,
    )
    .all(floor);
  if (!unknown.length) return say(c.grn("  every sender above the threshold is named"));

  const cap = Number(flags.limit) || unknown.length;
  const work = unknown.slice(0, cap);
  say("");
  say(`${c.b("identify")} ${work.length} handles${c.dim(`  at least ${floor} messages each`)}`);

  const width = Math.max(1, Math.min(Number(flags.concurrency) || 8, 16));
  const found = [];
  let cursor = 0;
  let seen = 0;
  let linked = 0;
  const worker = async () => {
    for (;;) {
      const i = cursor++;
      if (i >= work.length) return;
      const { handle, n } = work[i];
      const got = await identifyOne(d, handle, model);
      seen++;
      if (got && got.name) {
        const f = { handle, n, ...got, confidence: String(got.confidence || "").trim().toLowerCase() };
        if (f.confidence === "high" && !flags["dry-run"]) {
          const { existed } = applyIdentity(d, f);
          f.written = existed ? "linked" : "new";
          linked++;
        }
        found.push(f);
      }
      // A run over 146 handles that prints nothing until the end is
      // indistinguishable from a hang, which is exactly how it read.
      if (seen % 10 === 0) say(c.dim(`  ${seen}/${work.length}  ${found.length} named`));
    }
  };
  await Promise.all(Array.from({ length: width }, worker));

  found.sort((a, b) => b.n - a.n);
  say("");
  for (const f of found) {
    const tag = f.written
      ? f.written === "linked"
        ? c.grn("linked  ")
        : c.cyn("new     ")
      : f.confidence === "high"
        ? c.cyn("would   ")
        : c.yel(String(f.confidence || "?").padEnd(8));
    say(
      `  ${tag} ${String(f.n).padStart(5)}  ${c.b(f.name.padEnd(24))} ${f.handle.padEnd(24)} ${c.dim(String(f.evidence || "").slice(0, 70))}`,
    );
  }
  say("");
  say(
    `${c.grn("identified")} ${found.length} of ${work.length}${linked ? `, ${linked} written` : ""}` +
      c.dim("  anything not high confidence was only proposed"),
  );
  if (linked) recomputeScores();
}

// Every handle somebody actually messaged from is a confirmed identity.
//
// `identities` is what every phone-keyed and email-keyed join runs on, and it
// covered a third of the store. Meanwhile 1,895 distinct handles in `messages`
// already resolved to a person: those are not guesses, they are addresses the
// person demonstrably sent from. The same is true of the phone and email
// columns on `people`, which were never mirrored into the table built to hold
// exactly that.
//
// Consequence of the gap: a LinkedIn row and a contact row for the same human
// could not be joined on a number, so enrichment landed on one of them and the
// other kept the phone. That is the split-record shape behind a chunk of the
// duplicate backlog.
//
// The primary key is (kind, value), so a handle can only belong to one person.
// Conflicts are ignored rather than reassigned: if two people genuinely share a
// number, guessing which one owns it is worse than leaving it alone.
function cmdIdentities(argv) {
  const sub = ["backfill", "list"].includes(argv[0]) ? argv.shift() : "list";
  const { flags } = parseArgs(argv);
  const d = db();

  if (sub === "list") {
    const r = d
      .prepare(
        `SELECT (SELECT count(*) FROM identities) rows,
                (SELECT count(DISTINCT person_id) FROM identities) people,
                (SELECT count(*) FROM people WHERE deleted_at IS NULL) total`,
      )
      .get();
    say();
    say(`  ${c.b(String(r.rows))} identities across ${r.people} of ${r.total} people.`);
    say(c.dim(`  people identities backfill   to recover them from messages and contact fields`));
    say();
    return;
  }

  const apply = !flags["dry-run"];
  const norm = (v) => String(v || "").trim();
  const kindOf = (v) => (v.includes("@") ? "email" : /^\+?[0-9()\-.\s]{7,}$/.test(v) ? "phone" : null);

  const candidates = [];
  for (const r of d
    .prepare(
      `SELECT id, phone, email FROM people
        WHERE deleted_at IS NULL AND ((phone IS NOT NULL AND phone<>'') OR (email IS NOT NULL AND email<>''))`,
    )
    .all()) {
    for (const v of [r.phone, r.email]) {
      const val = norm(v);
      const k = val && kindOf(val);
      if (k) candidates.push([r.id, k, val]);
    }
  }
  for (const r of d
    .prepare(
      // iMessage handles only. Elsewhere a row can be linked to a person by
      // hand (`people texts link`) on a thread name the sender chose, and
      // recording that row's handle here would turn a stranger's number or a
      // forged From into an address `people send` trusts as theirs.
      `SELECT DISTINCT person_id, handle FROM messages
        WHERE person_id IS NOT NULL AND handle IS NOT NULL AND handle<>''
          AND handle NOT LIKE 'chat%' AND coalesce(source, 'imessage') = 'imessage'`,
    )
    .all()) {
    const val = norm(r.handle);
    const k = val && kindOf(val);
    if (k) candidates.push([r.person_id, k, val]);
  }

  let added = 0, already = 0;
  if (apply) d.exec("BEGIN IMMEDIATE");
  const ins = d.prepare(
    `INSERT OR IGNORE INTO identities (person_id, kind, value) VALUES (?,?,?)`,
  );
  for (const [pid, kind, value] of candidates) {
    if (!apply) { added++; continue; }
    const res = ins.run(pid, kind, value);
    if (res.changes) added++; else already++;
  }
  if (apply) d.exec("COMMIT");

  say();
  say(
    apply
      ? `  ${c.grn(String(added))} identities recovered, ${already} already known.`
      : c.dim(`  ${added} candidate identities found (--dry-run)`),
  );
  const cov = d
    .prepare(
      `SELECT (SELECT count(DISTINCT person_id) FROM identities) p,
              (SELECT count(*) FROM people WHERE deleted_at IS NULL) t`,
    )
    .get();
  say(c.dim(`  ${cov.p} of ${cov.t} people now have at least one.`));
  say();
}

module.exports = {
  cmdAlias, cmdIdentify, cmdIdentities,
};
