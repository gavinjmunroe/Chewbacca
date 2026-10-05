// @ts-nocheck
// people keeping up: update, mute, mine, reconnect, birthdays, today and
// intro, the commands about who is slipping and what is coming up.

"use strict";

const { c, die, say, parseArgs } = require("./output");
const { db, params, nowISO, daysBetween } = require("./db");
const { findPerson } = require("./lookup");
const { recomputeScores } = require("./scoring");
const { upcomingDates, dueLabel, openTasks, dueChecks } = require("./commitments");
const { insertObservation } = require("./observations");
const { fmt } = require("./show");
const { sayNextStep } = require("./health");

// `people reconnect` blend. Additive and renormalized, so a missing signal
// costs its weight instead of zeroing the row. Lateness dominates because the
// question is who you are overdue with; score is the tiebreaker toward people
// there is written evidence you care about. They need not sum to 1. The shape
// is Karthik Devarakonda's from amber-search's PeopleRank.
const RECONNECT_W_LATENESS = Number(process.env.PEOPLE_W_LATENESS ?? 0.85);
const RECONNECT_W_SCORE = Number(process.env.PEOPLE_W_SCORE ?? 0.15);
const clamp01 = (n) => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0);

// ---------------------------------------------------------------- keeping up
//
// The half of this that is not memory. Mesh's good idea is that a relationship
// tool is worthless if you have to remember to open it, so the questions it
// answers are "who is slipping" and "what is coming up", not "what do I know".

const FIELDS = ["name", "phone", "email", "company", "role", "location", "birthday", "handle", "how_we_met", "linkedin"];

function cmdUpdate(argv) {
  const { flags, rest } = parseArgs(argv);
  const who = rest.join(" ");
  if (!who) die('Try: people update maggie --company Anthropic --role "Research Engineer"');
  const p = findPerson(who);
  const d = db();

  const changes = [];
  for (const f of FIELDS) {
    const key = f === "how_we_met" ? "met" : f;
    if (flags[key] === undefined) continue;
    const val = flags[key] === true ? null : String(flags[key]);
    if ((p[f] || null) === val) continue;
    changes.push({ field: f, from: p[f], to: val });
    d.prepare(`UPDATE people SET ${f} = ?, updated_at = ? WHERE id = ?`).run(val, nowISO(), p.id);
  }
  if (flags.cadence !== undefined) {
    d.prepare("UPDATE people SET cadence_days = ?, updated_at = ? WHERE id = ?").run(
      Number(flags.cadence),
      nowISO(),
      p.id,
    );
    say(`${c.grn("set")} cadence to every ${flags.cadence} days`);
  }
  if (!changes.length) return say(c.dim("nothing changed"));

  // A JOB CHANGE IS NEWS, NOT AN EDIT. Overwriting company loses the fact that
  // it moved, which is the part worth knowing and the part worth congratulating
  // somebody on. So the write also records what happened.
  for (const ch of changes) {
    say(`${c.grn("updated")} ${ch.field}: ${c.dim(ch.from || "(empty)")} -> ${c.b(ch.to || "(empty)")}`);
    if (ch.field === "company" && ch.to) {
      insertObservation({
        personId: p.id,
        body: ch.from ? `moved from ${ch.from} to ${ch.to}` : `works at ${ch.to}`,
        flags: { source: "observed", dim: "financial,social", temporal: "permanent" },
      });
    } else if (ch.field === "role" && ch.to) {
      insertObservation({
        personId: p.id,
        body: ch.from ? `title changed from ${ch.from} to ${ch.to}` : `is ${ch.to}`,
        flags: { source: "observed", dim: "financial", temporal: "permanent" },
      });
    } else if (ch.field === "location" && ch.to) {
      insertObservation({
        personId: p.id,
        body: ch.from ? `moved from ${ch.from} to ${ch.to}` : `lives in ${ch.to}`,
        flags: { source: "observed", dim: "social", temporal: "permanent" },
      });
    }
  }
  recomputeScores();
}

/// What span of contact history the overdue answer was actually measured over.
///
/// "Nobody is overdue" is only meaningful next to the window it was computed
/// from. Off a 90-day import it is not a finding, it is an empty window, and
/// it reads as a finding. So every clean bill of health carries its evidence.
function textsWindowNote() {
  try {
    const d = db();
    const r = d
      .prepare("SELECT MIN(happened_at) AS lo, COUNT(*) AS n FROM interactions")
      .get();
    if (!r || !r.n) return "no contact history on file yet, so this proves nothing";
    const days = Math.max(1, Math.round(daysBetween(r.lo, nowISO())));
    const span =
      days >= 365 ? `${(days / 365).toFixed(1)} years` : `${days} days`;
    let note = `${r.n.toLocaleString()} interactions over ${span}`;
    if (days < 180) {
      note += ". That window is short: run `people texts sync` to import the full history";
    }
    return note;
  } catch {
    return "an unknown window";
  }
}

// Overdue is measured against the cadence you set for that person, and falls
// back to a cadence implied by how much you care: someone you know well and
// score highly is expected more often than an acquaintance.
function overdueList(limit = 20) {
  const d = db();
  const P = params();
  const rows = d
    .prepare(
      `SELECT p.*, s.base_score, s.warmth, s.last_interaction_at, s.observation_count,
              (SELECT count(*) FROM observations o
                WHERE o.person_id = p.id AND o.deleted_at IS NULL
                  AND o.source <> 'imported') AS authored_observations
         FROM people p LEFT JOIN person_scores s ON s.person_id = p.id
        WHERE p.deleted_at IS NULL AND p.muted_at IS NULL`,
    )
    .all();
  const now = nowISO();
  const out = [];
  for (const r of rows) {
    // AN ADDRESS BOOK ENTRY IS NOT A RELATIONSHIP. After importing a thousand
    // contacts everyone has zero observations and ties at zero, so without this
    // the list is alphabetical noise: landlines, "??? USC", a dentist. Someone
    // qualifies once there is a reason to think you care, which means you wrote
    // something down, logged a conversation, or set a cadence by hand.
    // AN IMPORT IS NOT EVIDENCE YOU CARE. Bulk sources write an observation per
    // row ("connected on LinkedIn 5/2/26"), which would let two thousand people
    // you have never spoken to clear the same bar as someone you took a note
    // about. Only observations you actually authored count toward getting in.
    const known = (r.authored_observations || 0) > 0 || r.cadence_days || r.last_interaction_at;
    if (!known) continue;
    const score = r.base_score || 0;
    const cadence = r.cadence_days || Math.round(30 + (1 - score) * 300);
    const days = r.last_interaction_at ? daysBetween(r.last_interaction_at, now) : null;
    const over = days === null ? null : days - cadence;
    if (days !== null && over < 0) continue;
    // A MULTIPLICATIVE URGENCY IS A NO-OP ON A REAL ADDRESS BOOK.
    //
    // This was `score * (1 + over / cadence)`. base_score is 0 for anyone with
    // no hand-written observation, and zero times anything is zero, so every
    // urgency was 0, the sort below compared 0 to 0 for every pair, and the
    // list came back in table order. Gavin hit it on 2026-09-18 with 944 of
    // his 945 people at base_score 0: his overdue list was alphabetical,
    // opening on AJ Flamino and Abby Rivers. The bug is invisible because
    // a sorted-looking list is still a list.
    //
    // The shape is borrowed from Karthik Devarakonda's PeopleRank in
    // amberintelligence/amber-search (api/people_rank.py), which solved the
    // same problem: a renormalized ADDITIVE blend of two 0..1 signals, so a
    // missing signal costs its weight instead of zeroing the result, plus an
    // explicit tiebreak chain for the all-zero row rather than whatever order
    // the rows arrived in.
    //
    // Lateness dominates because the question is "who am I overdue with".
    // Score breaks ties toward people there is written evidence you care
    // about. For someone never contacted there is no lateness signal at all,
    // so score carries the whole thing.
    // Saturating but strictly monotonic: r/(1+r). Clamping at 1 was wrong,
    // because on a real address book almost everyone is more than one cadence
    // overdue, every lateness pinned to 1.0, and score quietly became the only
    // sort key again. This keeps someone five cadences late above someone one
    // cadence late forever, while still living in 0..1 so the blend is sane.
    const ratio = over / Math.max(cadence, 1);
    const lateness = days === null ? null : ratio / (1 + ratio);
    const wl = RECONNECT_W_LATENESS;
    const ws = RECONNECT_W_SCORE;
    const wt = wl + ws > 0 ? wl + ws : 1;
    out.push({
      name: r.name,
      company: r.company,
      days,
      cadence,
      over,
      score,
      urgency: lateness === null
        ? clamp01(score)
        : (wl * lateness + ws * clamp01(score)) / wt,
    });
  }
  // Tiebreak explicitly. `over` is raw and unclamped here on purpose: someone
  // ten cadences late and someone one cadence late both saturate `lateness` at
  // 1, and the first of them is the one to call.
  out.sort((a, b) =>
    (b.urgency - a.urgency) ||
    ((b.over ?? -1) - (a.over ?? -1)) ||
    (b.score - a.score) ||
    String(a.name || "").toLowerCase().localeCompare(String(b.name || "").toLowerCase())
  );
  return out.slice(0, limit);
}

function cmdMute(argv) {
  const { flags, rest } = parseArgs(argv);
  const who = rest.join(" ");
  if (!who) die('Try: people mute "Lexi" --because "archived"');
  const p = findPerson(who);
  db().prepare("UPDATE people SET muted_at = ?, muted_reason = ?, updated_at = ? WHERE id = ?")
    .run(nowISO(), flags.because ? String(flags.because) : null, nowISO(), p.id);
  say(`${c.grn("muted")} ${p.name}${flags.because ? c.dim("  " + flags.because) : ""}`);
  say(c.dim("  kept in full, just out of reconnect and ranking"));
}

function cmdUnmute(argv) {
  const { rest } = parseArgs(argv);
  const who = rest.join(" ");
  if (!who) die('Try: people unmute "Lexi"');
  const p = findPerson(who);
  db().prepare("UPDATE people SET muted_at = NULL, muted_reason = NULL, updated_at = ? WHERE id = ?")
    .run(nowISO(), p.id);
  say(`${c.grn("unmuted")} ${p.name}`);
}

function cmdMuted() {
  const rows = db()
    .prepare("SELECT name, muted_reason, muted_at FROM people WHERE muted_at IS NOT NULL AND deleted_at IS NULL ORDER BY name")
    .all();
  if (!rows.length) return say(c.dim("  nobody muted"));
  say("");
  for (const r of rows) say(`  ${c.b(r.name.padEnd(30))}${c.dim(r.muted_reason || "")}`);
  say(c.dim(`\n  ${rows.length} muted. people unmute <name> to bring one back\n`));
}


// WHAT SOMEBODY TOLD YOU ABOUT THEMSELVES, PULLED OUT OF THE THREAD. Half a
// million messages is not knowledge if answering "what music does he like"
// means a full-text search every time. These rules read only what the other
// person said about themselves, in their own words, and file it under a slot
// so the answer is a lookup.
//
// EVERY FACT KEEPS ITS VERBATIM QUOTE AND ITS DATE. Never paraphrase a person
// into a claim they did not make; a wrong fact about a friend is worse than no
// fact, because you will say it out loud to them.
const MINE_RULES = [
  // Each rule is [slot, regex, group]. Group 0 keeps the whole matched phrase,
  // which is what makes a family fact readable: "my sister goes to Berkeley"
  // is worth storing and "sister" is not.
  ["music", /\bi(?:'m| am)?\s*(?:really\s+)?(?:listen(?:ing)? to|love|like|fw|into|been (?:listening to|on))\s+(?:a lot of\s+|mostly\s+|mainly\s+)?(?:hip ?hop|rap|r&b|rnb|country music|jazz|k-?pop|classical|edm|indie|rock|metal|afrobeat\w*|reggae|gospel|worship music|lo-?fi|house music|techno|punk|soul music|blues|folk)\b[^.!?\n]{0,40}/i, 0],
  ["music", /\bmy favorite (?:artist|band|rapper|singer|album|song|genre) (?:is|are)\s+[^.!?,\n]{2,50}/i, 0],
  ["food", /\bi(?:'m| am)\s+allergic to\s+[^.!?,\n]{2,40}/i, 0],
  ["food", /\bi(?:'m| am)\s+(?:a\s+)?(?:vegan|vegetarian|pescatarian|gluten[- ]free|lactose intolerant)\b/i, 0],
  ["food", /\bi (?:don'?t|can'?t|cannot) eat\s+[^.!?,\n]{2,40}/i, 0],
  ["sports", /\bi (?:play|played|run|swim|row|wrestle)\s+(?:varsity |club |d1 |jv )?(?:baseball|basketball|football|soccer|tennis|golf|volleyball|water polo|lacrosse|hockey|track|cross country|swim(?:ming)?|rugby|softball|badminton|ultimate|crew|rowing|wrestling|chess|piano|guitar|violin|drums)\b[^.!?\n]{0,40}/i, 0],
  ["works_on", /\bi(?:'m| am)\s+(?:currently\s+)?(?:working (?:on|at)|interning at|studying|majoring in)\s+[^.!?,\n]{3,60}/i, 0],
  // Only durable family facts. "my mom said yes" is logistics and expires in an
  // hour; "my sister is a Girl Scout" is worth knowing next year.
  ["family", /\bmy (?:mom|dad|mother|father|brother|sister|parents|grandma|grandpa|wife|husband|son|daughter|twin)\s+(?:is|are|was|were|works|worked|goes|went|lives|lived|studies|studied|plays|played|teaches|died|passed)\b[^.!?\n]{3,55}/i, 0],
  ["faith", /\bi(?:'m| am)\s+(?:a\s+)?(?:christian|catholic|muslim|jewish|hindu|buddhist|agnostic|atheist)\b[^.!?\n]{0,30}/i, 0],
  ["health", /\bi(?:'m| am)\s+(?:diagnosed with|dealing with|struggling with)\s+[^.!?,\n]{3,45}/i, 0],
  ["cares_about", /\bi(?:'m| am)\s+(?:really\s+)?(?:passionate about|obsessed with)\s+[^.!?,\n]{3,50}/i, 0],
];

function cmdMine(argv) {
  const { flags, rest } = parseArgs(argv);
  const d = db();
  const who = rest.join(" ");
  let sql =
    "SELECT m.person_id, m.body, m.sent_at, p.name" +
    "  FROM messages m JOIN people p ON p.id = m.person_id" +
    " WHERE m.from_me = 0 AND p.deleted_at IS NULL";
  const args = [];
  if (who) {
    const found = findPerson(who);
    sql += " AND m.person_id = ?";
    args.push(found.id);
  }
  sql += " ORDER BY m.sent_at ASC"; // later statements overwrite earlier ones
  const rows = d.prepare(sql).all(...args);

  const hits = new Map(); // person_id + slot -> fact
  for (const r of rows) {
    if (!r.body || r.body.length > 600) continue;
    for (const rule of MINE_RULES) {
      const slot = rule[0];
      const m = r.body.match(rule[1]);
      if (!m) continue;
      const val = String(m[rule[2] || 0] || m[0]).trim().replace(/\s+/g, " ");
      if (val.length < 2) continue;
      hits.set(r.person_id + " " + slot, {
        person_id: r.person_id,
        slot: slot,
        value: val,
        name: r.name,
        quote: r.body.length > 160 ? r.body.slice(0, 157) + "..." : r.body,
        at: r.sent_at,
      });
    }
  }

  if (flags["dry-run"]) {
    const show = [...hits.values()].slice(0, Number(flags.limit || 30));
    for (const f of show) say("  " + c.b(f.name.padEnd(24)) + " " + c.cyn(f.slot.padEnd(9)) + " " + f.value);
    return say(c.dim("\n  " + hits.size + " facts would be written (dry run)\n"));
  }

  const up = d.prepare(
    "INSERT INTO quick_facts (person_id, key, value, updated_at) VALUES (?,?,?,?)" +
      " ON CONFLICT(person_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
  );
  d.exec("BEGIN");
  for (const f of hits.values())
    up.run(f.person_id, f.slot, f.value + '  - them, ' + f.at.slice(0, 10) + ': "' + f.quote + '"', nowISO());
  d.exec("COMMIT");

  const people = new Set([...hits.values()].map((f) => f.person_id)).size;
  say("  " + c.grn("mined") + " " + hits.size + " facts about " + people + " people");
  say(c.dim("  people show <name>  to see them\n"));
}

function cmdReconnect(argv) {
  const { flags } = parseArgs(argv);
  const rows = overdueList(Number(flags.limit || 15));
  if (!rows.length) {
    const total = db().prepare("SELECT count(*) AS n FROM people WHERE deleted_at IS NULL").get().n;
    // "Nobody is overdue" and "I know nothing about anybody" are different
    // answers and used to print the same line. Anyone whose texts have synced
    // has a real last-contact date, so telling them to start writing notes is
    // both wrong and the opposite of reassuring.
    const known = db()
      .prepare(
        `SELECT count(*) AS n FROM (
           SELECT person_id FROM observations WHERE person_id IS NOT NULL AND deleted_at IS NULL
           UNION SELECT person_id FROM interactions WHERE person_id IS NOT NULL)`,
      )
      .get().n;
    if (total && !known)
      return say(
        c.dim(`  ${total} contacts, none with anything recorded yet.\n`) +
          c.dim("  This ranks people you know things about, so start with:\n") +
          `    people note <name> "..." --dim social`,
      );
    return say(
      // Never assert a clean bill of health without the window it was
      // measured over. "Nobody is overdue" off a 90-day import is not a
      // finding, it is an empty window, and it reads as a finding.
      c.grn("  nobody is overdue") +
        (known ? c.dim(`\n  ${known} people have recent contact on file`) : "") +
        c.dim(`\n  measured against ${textsWindowNote()}`),
    );
  }
  say("");
  for (const r of rows) {
    const when =
      r.days === null
        ? c.yel("never logged")
        : `${Math.round(r.days)}d ago` + c.dim(` (want every ${r.cadence}d)`);
    say(`  ${c.b(r.name.padEnd(22))} ${when}${r.company ? c.dim("  " + r.company) : ""}`);
  }
  say(c.dim(`\n  people log <name> once you have reached out`));
  say("");
}

function upcomingBirthdays(days) {
  const rows = db()
    .prepare("SELECT name, birthday, company FROM people WHERE deleted_at IS NULL AND birthday IS NOT NULL")
    .all();
  const today = new Date();
  const out = [];
  for (const r of rows) {
    const m = String(r.birthday).match(/(\d{1,2})[-/](\d{1,2})$|^(\d{4})-(\d{2})-(\d{2})$/);
    let mo, da;
    if (r.birthday.length >= 10) {
      mo = Number(r.birthday.slice(5, 7));
      da = Number(r.birthday.slice(8, 10));
    } else if (m) {
      mo = Number(m[1]);
      da = Number(m[2]);
    } else continue;
    if (!mo || !da) continue;
    let next = new Date(today.getFullYear(), mo - 1, da);
    if (next < new Date(today.getFullYear(), today.getMonth(), today.getDate()))
      next = new Date(today.getFullYear() + 1, mo - 1, da);
    const away = Math.round((next - new Date(today.getFullYear(), today.getMonth(), today.getDate())) / 86400000);
    if (away <= days) out.push({ name: r.name, company: r.company, away, date: next });
  }
  out.sort((a, b) => a.away - b.away);
  return out;
}

function cmdBirthdays(argv) {
  const { flags } = parseArgs(argv);
  const rows = upcomingBirthdays(Number(flags.days || 60));
  if (!rows.length) return say(c.dim("  no birthdays recorded in that window"));
  say("");
  for (const r of rows) {
    const when = r.away === 0 ? c.grn("today") : r.away === 1 ? c.yel("tomorrow") : `in ${r.away} days`;
    say(`  ${c.b(r.name.padEnd(22))} ${when}${r.company ? c.dim("  " + r.company) : ""}`);
  }
  say("");
}

function cmdToday(argv = []) {
  const { flags } = parseArgs(argv);
  const dates = upcomingDates(7);
  const checks = dueChecks();
  const tasks = openTasks(7);
  const loans = db()
    .prepare(
      `SELECT l.what, l.direction, p.name FROM loans l JOIN people p ON p.id = l.person_id
        WHERE l.settled_at IS NULL AND julianday('now') - julianday(l.lent_at) > 30`,
    )
    .all();
  const over = overdueList(5);
  if (flags.json) {
    const n = db().prepare("SELECT count(*) n FROM people WHERE deleted_at IS NULL").get().n;
    return say(JSON.stringify({
      people: n,
      dates: dates.map((b) => ({ name: b.name, label: b.label, in_days: b.away })),
      check_in: checks.map((r) => ({ name: r.name, reason: r.next_check_reason || null })),
      you_owe: tasks.map((t) => ({ title: t.title, person: t.person || null, due_at: t.due_at || null })),
      outstanding: loans.map((l) => ({ what: l.what, who: l.name, direction: l.direction })),
      worth_a_message: over.map((r) => ({ name: r.name, days: r.days === null ? null : Math.round(r.days) })),
    }));
  }
  let printed = false;
  say("");

  if (dates.length) {
    printed = true;
    say(c.cyn("  dates"));
    for (const b of dates)
      say(`    ${b.name.padEnd(22)} ${b.label}  ${b.away === 0 ? c.grn("today") : c.dim(`in ${b.away}d`)}`);
    say("");
  }
  // A check you asked for beats a cadence the tool guessed, so it goes first
  // and it always carries the reason you gave.
  if (checks.length) {
    printed = true;
    say(c.cyn("  you asked to check in"));
    for (const r of checks) say(`    ${r.name.padEnd(22)} ${c.dim(r.next_check_reason || "")}`);
    say("");
  }
  if (tasks.length) {
    printed = true;
    say(c.cyn("  you owe"));
    for (const t of tasks)
      say(`    ${c.dim(t.ref)} ${t.title.padEnd(36)} ${t.person ? c.b(t.person) : ""}${t.due_at ? c.dim("  " + dueLabel(t.due_at)) : ""}`);
    say("");
  }
  if (loans.length) {
    printed = true;
    say(c.cyn("  outstanding"));
    for (const l of loans)
      say(`    ${l.direction === "lent" ? "they have" : "you have"} ${l.what}  ${c.b(l.name)}`);
    say("");
  }
  if (over.length) {
    printed = true;
    say(c.cyn("  worth a message"));
    for (const r of over)
      say(`    ${r.name.padEnd(22)}${r.days === null ? c.dim("never logged") : c.dim(Math.round(r.days) + "d")}`);
    say("");
  }
  if (!printed) {
    // "Nothing needs you today" is a reassuring sentence and a lie when the
    // store has never been given anything. Say which one this is.
    if (!sayNextStep(db())) say(c.grn("  nothing needs you today") + "\n");
  }
}

// WHO COULD INTRODUCE ME. Mesh does this across a team's networks; single-user
// it is the overlap question: who do I know at that company, or in a circle
// with that person.
function cmdIntro(argv) {
  const { rest } = parseArgs(argv);
  const q = rest.join(" ").trim();
  if (!q) die('Try: people intro Anthropic   (or a person\'s name)');
  const d = db();
  const byCompany = d
    .prepare(
      `SELECT p.name, p.role, p.company, COALESCE(s.base_score,0) AS score
         FROM people p LEFT JOIN person_scores s ON s.person_id = p.id
        WHERE p.deleted_at IS NULL AND lower(p.company) LIKE lower(?)
        ORDER BY score DESC`,
    )
    .all(`%${q}%`);
  if (byCompany.length) {
    say("\n" + c.cyn(`  people you know at ${q}`));
    for (const r of byCompany)
      say(`    ${c.b(r.name.padEnd(22))} ${c.dim(r.role || "")}  ${fmt(r.score)}`);
  }
  const target = findPerson(q, { required: false });
  if (target) {
    const shared = d
      .prepare(
        `SELECT DISTINCT p.name, c.name AS circle, COALESCE(s.base_score,0) AS score
           FROM circle_members m
           JOIN circles c ON c.id = m.circle_id
           JOIN circle_members m2 ON m2.circle_id = c.id AND m2.person_id <> m.person_id
           JOIN people p ON p.id = m2.person_id
           LEFT JOIN person_scores s ON s.person_id = p.id
          WHERE m.person_id = ? AND p.deleted_at IS NULL AND c.deleted_at IS NULL
          ORDER BY score DESC`,
      )
      .all(target.id);
    if (shared.length) {
      say("\n" + c.cyn(`  shares a circle with ${target.name}`));
      for (const r of shared) say(`    ${c.b(r.name.padEnd(22))} ${c.dim(r.circle)}`);
    }
  }
  if (!byCompany.length && !target) say(c.dim(`  no connection to "${q}" found`));
  say("");
}

module.exports = {
  cmdUpdate, cmdMute, cmdUnmute, cmdMuted, cmdMine, cmdReconnect, cmdBirthdays, cmdToday,
  cmdIntro,
};
