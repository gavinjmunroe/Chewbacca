// @ts-nocheck
// people show, list, rank and search: reading one person or the whole store
// back out, including the shelf-life check on facts that say they are
// temporary.

"use strict";

const { c, die, say, parseArgs } = require("./output");
const { db } = require("./db");
const { findPerson, possibleTwins, dimByCode } = require("./lookup");
const { dueLabel } = require("./commitments");

function cmdShow(argv) {
  const { rest } = parseArgs(argv);
  const who = rest.join(" ");
  if (!who) die("Who? Try: people show maggie");
  const p = findPerson(who);
  const d = db();

  say("");
  // Printed before the record, not after it, because the record reads as
  // complete on its own and there is no other sign that half of it is missing.
  const twins = possibleTwins(p);
  if (twins.length) {
    say(c.yel(`  ⚠  ${twins.length === 1 ? "Another row looks like" : `${twins.length} other rows look like`} this same person.`));
    say(c.yel(`     What you are about to read is only part of what is on file.`));
    for (const t of twins)
      say(c.dim(`     ${t.id}  ${t.name}${t.phone ? `  ${t.phone}` : ""}${t.company ? `  ${t.company}` : ""}`));
    say(c.dim(`     people merge ${p.id} <drop-id>   to make them one`));
    say("");
  }
  say(c.b(p.name) + (p.handle ? c.dim(` @${p.handle}`) : ""));
  const bits = [p.role, p.company, p.location].filter(Boolean).join(" · ");
  if (bits) say(c.dim(bits));
  const contact = [p.phone, p.email].filter(Boolean).join("  ");
  if (contact) say(c.dim(contact));
  if (p.how_we_met) say(c.dim(`met: ${p.how_we_met}`));

  const circles = d
    .prepare(
      `SELECT c.name FROM circles c JOIN circle_members m ON m.circle_id = c.id
        WHERE m.person_id = ? AND c.deleted_at IS NULL ORDER BY c.name`,
    )
    .all(p.id);
  if (circles.length) say("\n" + c.cyn("circles  ") + circles.map((x) => x.name).join(", "));

  const s = d.prepare("SELECT * FROM person_scores WHERE person_id = ?").get(p.id);
  if (s) {
    const states = d
      .prepare(
        `SELECT dm.code, dm.label, st.score, st.evidence
           FROM person_dimension_state st JOIN dimensions dm ON dm.id = st.dimension_id
          WHERE st.person_id = ? ORDER BY dm.sort_order`,
      )
      .all(p.id);
    // THESE BARS SAY KNOWN, NOT GOOD. The idea and the wording are Karthik
    // Devarakonda's, from amber-id, and the reasoning is worth keeping intact:
    // the evidence is whatever somebody happened to mention, so a zero means
    // nothing was ever recorded about that part of a person's life, not that
    // the part is thin. Presenting it as a verdict would invent an assessment
    // out of note-taking, about someone who never agreed to be assessed and
    // would have no way to know the judgment was made of silence.
    //
    // It matters more here than it did there. This is a kit strangers install
    // and point at their friends, and six labelled bars next to a name read as
    // a scorecard unless the header says otherwise.
    const recorded = states.filter((st) => st.score > 0).length;
    say("");
    say(c.dim(`  what you have written down, not how they are doing`));
    for (const st of states) {
      say(`  ${st.label.padEnd(13)} ${bar(st.score)} ${fmt(st.score)}${st.evidence ? c.dim(`  ${st.evidence}`) : ""}`);
    }
    if (recorded === 0)
      say(c.dim(`  nothing recorded in any dimension yet`));
    else if (recorded < states.length)
      say(
        c.dim(
          `  ${states.length - recorded} of ${states.length} are empty because nothing was recorded, not because they are low`,
        ),
      );
    say(
      c.dim(
        `\n  score ${fmt(s.base_score)}   warmth ${fmt(s.warmth)}   known ${Math.round(s.completeness * 100)}%` +
          (s.last_interaction_at ? `   last contact ${s.last_interaction_at.slice(0, 10)}` : ""),
      ),
    );
  }

  // WHERE the last message was, not just when. `circles` lists every room they
  // are in, which does not tell you the one they just wrote in, and that is the
  // thing you need before replying to somebody.
  const lastRoom = d
    .prepare(
      `SELECT room, sent_at FROM messages WHERE person_id = ?
        ORDER BY sent_at DESC LIMIT 1`,
    )
    .get(p.id);
  if (lastRoom)
    say(
      c.dim(
        `  last spoke ${lastRoom.room ? `in ${c.b(lastRoom.room)}` : "one to one"}, ${String(lastRoom.sent_at).slice(0, 16)}`,
      ),
    );

  // WHO IS WAITING ON WHOM. The store knew every message but had no notion of
  // an outbound that never got an answer, so a thread you dropped and a thread
  // that dropped you looked identical. Derived from messages, never stored, so
  // it cannot go stale the way a hand-maintained field does.
  const r = d
    .prepare(
      `SELECT MAX(CASE WHEN from_me = 0 THEN sent_at END) AS last_in,
              MAX(CASE WHEN from_me = 1 THEN sent_at END) AS last_out
         FROM messages WHERE person_id = ?`,
    )
    .get(p.id);
  if (r && (r.last_in || r.last_out)) {
    const days = (t) =>
      Math.floor((Date.now() - new Date(String(t).replace(" ", "T")).getTime()) / 86400000);
    if (r.last_in && (!r.last_out || r.last_in > r.last_out)) {
      say(c.yel(`  they wrote last, ${days(r.last_in)}d ago, and you have not replied`));
    } else if (r.last_out) {
      // Every outbound since their last word. Three in a row unanswered is a
      // different situation from one, and the count is the whole signal.
      const n = d
        .prepare(
          `SELECT COUNT(*) AS n FROM messages
            WHERE person_id = ? AND from_me = 1 AND sent_at > COALESCE(?, '')`,
        )
        .get(p.id, r.last_in).n;
      if (n > 1)
        say(c.yel(`  you have sent ${n} since they last wrote, ${days(r.last_out)}d ago`));
      else if (!r.last_in) say(c.dim("  you have written, they never have"));
    }
  }

  const qf = d.prepare("SELECT key, value FROM quick_facts WHERE person_id=? ORDER BY key").all(p.id);
  if (qf.length) {
    say("");
    for (const f of qf) {
      const lines = String(f.value).split("\n");
      const marked = lines
        .map((line) => {
          const gone = shelfLife(line, factLearnedAt(line));
          return gone ? `${line}  ${c.yel(`[${gone}]`)}` : line;
        })
        .join("\n" + " ".repeat(17));
      say(`  ${c.cyn(f.key.padEnd(14))} ${marked}`);
    }
  }

  const rels = d
    .prepare(
      `SELECT r.kind, p2.name FROM relationships r JOIN people p2 ON p2.id=r.to_id
        WHERE r.from_id=? AND p2.deleted_at IS NULL ORDER BY r.kind`,
    )
    .all(p.id);
  if (rels.length)
    say("\n" + c.cyn("family & links  ") + rels.map((r) => `${r.kind} of ${r.name}`).join(", "));

  const dts = d
    .prepare("SELECT label, month, day, year FROM important_dates WHERE person_id=? ORDER BY month, day")
    .all(p.id);
  if (dts.length)
    say(
      c.cyn("dates           ") +
        dts.map((x) => `${x.label} ${String(x.month).padStart(2, "0")}-${String(x.day).padStart(2, "0")}`).join(", "),
    );

  const owed = d.prepare("SELECT substr(id,1,6) AS ref, title, due_at FROM tasks WHERE person_id=? AND done_at IS NULL").all(p.id);
  if (owed.length) {
    say("\n" + c.cyn("you owe them"));
    for (const t of owed) say(`  ${c.dim(t.ref)} ${t.title}${t.due_at ? c.dim("  " + dueLabel(t.due_at)) : ""}`);
  }

  const ln = d.prepare("SELECT direction, what FROM loans WHERE person_id=? AND settled_at IS NULL").all(p.id);
  if (ln.length) {
    say("\n" + c.cyn("outstanding"));
    for (const l of ln) say(`  ${l.direction === "lent" ? "they have" : "you have"} ${l.what}`);
  }

  if (p.next_check_at)
    say(
      "\n" + c.cyn("next check      ") + String(p.next_check_at).slice(0, 10) +
        c.dim(`  because ${p.next_check_reason || "no reason given"}`),
    );

  const obs = d
    .prepare(
      `SELECT * FROM observations WHERE person_id = ? AND deleted_at IS NULL
        ORDER BY observed_at DESC LIMIT 40`,
    )
    .all(p.id);
  if (obs.length) {
    say("\n" + c.cyn("what you know"));
    for (const o of obs) say("  " + renderObs(o));
  } else {
    say(c.dim("\n  nothing recorded yet"));
  }
  say("");
}

function renderObs(o) {
  const date = c.dim(String(o.observed_at).slice(0, 10));
  const marks = [];
  if (o.modality !== "actual") marks.push(o.modality);
  if (o.kind !== "fact") marks.push(o.kind);
  if (o.source !== "told_directly") marks.push(o.source.replace("_", " "));
  if (o.source_circle_id) marks.push("from circle");
  const tail = marks.length ? c.dim(`  (${marks.join(", ")})`) : "";
  return `${date}  ${o.body}${tail}`;
}

function bar(v) {
  const n = Math.round(Math.max(0, Math.min(1, v)) * 12);
  const s = "█".repeat(n) + c.dim("·".repeat(12 - n));
  return v >= 0.66 ? c.grn(s) : v >= 0.33 ? c.yel(s) : s;
}
const fmt = (v) => v.toFixed(2);

function cmdList(argv) {
  const { flags } = parseArgs(argv);
  const d = db();
  const rows = d
    .prepare(
      `SELECT p.*, COALESCE(s.base_score,0) AS score, COALESCE(s.observation_count,0) AS n
         FROM people p LEFT JOIN person_scores s ON s.person_id = p.id
        WHERE p.deleted_at IS NULL
        ORDER BY ${flags.by === "score" ? "score DESC" : "p.name COLLATE NOCASE"}`,
    )
    .all();
  if (!rows.length) return say(c.dim('nobody yet. try: people add "Maggie Chen"'));
  for (const r of rows) {
    say(
      `  ${r.name.padEnd(24)} ${c.dim(String(r.n).padStart(3) + " obs")}  ${fmt(r.score)}` +
        (r.company ? c.dim("  " + r.company) : ""),
    );
  }
  say(c.dim(`\n  ${rows.length} people`));
}

function cmdRank(argv) {
  const { flags } = parseArgs(argv);
  const d = db();
  const limit = Number(flags.limit || 20);
  if (flags.dim) {
    const dim = dimByCode(flags.dim);
    const rows = d
      .prepare(
        `SELECT p.name, st.score, st.evidence
           FROM person_dimension_state st JOIN people p ON p.id = st.person_id
          WHERE st.dimension_id = ? AND p.deleted_at IS NULL AND st.evidence > 0
          ORDER BY st.score DESC LIMIT ?`,
      )
      .all(dim.id, limit);
    if (!rows.length) return say(c.dim(`nothing recorded in ${dim.label} yet`));
    say("\n" + c.b(dim.label) + c.dim(`  half-life ${dim.half_life_days}d`));
    for (const r of rows)
      say(`  ${bar(r.score)} ${fmt(r.score)}  ${r.name}${c.dim(`  ${r.evidence}`)}`);
    say("");
    return;
  }
  const rows = d
    .prepare(
      `SELECT p.name, s.base_score, s.warmth, s.observation_count
         FROM person_scores s JOIN people p ON p.id = s.person_id
        WHERE p.deleted_at IS NULL ORDER BY s.base_score DESC LIMIT ?`,
    )
    .all(limit);
  if (!rows.length) return say(c.dim("no scores yet. run: people score"));
  say("");
  for (const r of rows)
    say(`  ${bar(r.base_score)} ${fmt(r.base_score)}  ${r.name}${c.dim(`  warmth ${fmt(r.warmth)}`)}`);
  say("");
}

function cmdSearch(argv) {
  const { rest, flags } = parseArgs(argv);
  const q = rest.join(" ").trim();
  const d = db();
  let rows;
  // --person narrows to one person's observations, newest first, with or
  // without words: "what do I know about Sam" has no search term.
  if (flags.person) {
    const p = findPerson(String(flags.person));
    rows = d
      .prepare(
        `SELECT o.*, p.name AS person, NULL AS circle FROM observations o
           JOIN people p ON p.id = o.person_id
          WHERE o.person_id = ? AND o.deleted_at IS NULL
            AND (? = '' OR o.body LIKE ?)
          ORDER BY o.observed_at DESC LIMIT 40`,
      )
      .all(p.id, q, `%${q}%`);
  }
  if (!rows && !q) die('Search for what? people search "hiking"');
  if (!rows) try {
    rows = d
      .prepare(
        `SELECT o.*, p.name AS person, ci.name AS circle
           FROM observations_fts f
           JOIN observations o ON o.rowid = f.rowid
           LEFT JOIN people  p  ON p.id  = o.person_id
           LEFT JOIN circles ci ON ci.id = o.circle_id
          WHERE observations_fts MATCH ? AND o.deleted_at IS NULL
          ORDER BY rank LIMIT 40`,
      )
      .all(q);
  } catch {
    rows = d
      .prepare(
        `SELECT o.*, p.name AS person, ci.name AS circle
           FROM observations o
           LEFT JOIN people  p  ON p.id  = o.person_id
           LEFT JOIN circles ci ON ci.id = o.circle_id
          WHERE o.body LIKE ? AND o.deleted_at IS NULL
          ORDER BY o.observed_at DESC LIMIT 40`,
      )
      .all(`%${q}%`);
  }
  if (flags.json)
    return say(JSON.stringify(rows.map((r) => ({
      about: r.person || (r.circle ? `${r.circle} (circle)` : "you"),
      said: r.body, modality: r.modality, source: r.source, at: r.observed_at,
    }))));
  if (!rows.length) return say(c.dim(`nothing matches "${q}"`));
  say("");
  for (const r of rows) {
    const subject = r.person || (r.circle ? `${r.circle} (circle)` : "you");
    say(`  ${c.b(subject.padEnd(20))} ${renderObs(r)}`);
  }
  say(c.dim(`\n  ${rows.length} results`));
}

// ---------------------------------------------------------------- shelf life
// Ported from Karthik's api/temporal.py in amberintelligence/amber-search
// ("Facts have a shelf life", 2026-08-25), with his and Sagar's standing
// permission to lift Amber's people architecture into Chewbacca.
//
// The problem it names: "Sam is visiting SF for a month" and "Sam moved to
// SF" are the same sentence to anything that only reads text. One is true
// forever and one is true for five weeks, and nobody ever sends a correction
// when a trip ends.
//
// Conservative on purpose. A fact perishes only when it SAYS it is temporary.
// The failure we accept is keeping a stale fact. The one we refuse is quietly
// burying a true one.

const TRANSIENT_DEFAULT_DAYS = 14;

const TRANSIENT_CUES = [
  "visiting", "visits", "in town", "passing through", "stopping by", "swinging by",
  "flying in", "on a trip", "trip to", "traveling to", "travelling to", "on the road",
  "here for", "in for", "staying", "crashing", "on vacation", "on holiday", "on leave",
  "sabbatical", "layover", "conference in", "wedding in", "offsite", "house sitting",
  "subletting", "temporarily in", "for the summer", "for the weekend", "this week",
];

// Checked first and wins outright. "moved to Austin, staying with his brother
// while he looks for a place" contains "staying" and is not a visit.
const PERSISTENT_CUES = [
  "moved to", "moving to", "relocated", "lives in", "living in", "based in",
  "settled in", "bought a house", "new job", "started at", "works at", "working at",
  "grew up", "is from", "hometown", "married", "engaged", "had a baby",
  "graduated", "joined", "founded", "co-founded", "retired", "majoring",
];

function shelfLife(text, learnedAt) {
  if (!learnedAt) return null;
  const t = String(text).toLowerCase();
  if (PERSISTENT_CUES.some((cue) => t.includes(cue))) return null;
  if (!TRANSIENT_CUES.some((cue) => t.includes(cue))) return null;

  // "for three weeks", "for 2 months" -- take the fact at its word when it
  // states a duration, otherwise assume a fortnight.
  const m = t.match(/for (?:about |around |roughly )?(\d+|a|one|two|three|four|five|six)\s+(day|week|month)/);
  const words = { a: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };
  let days = TRANSIENT_DEFAULT_DAYS;
  if (m) {
    const n = words[m[1]] ?? Number(m[1]);
    days = n * (m[2] === "day" ? 1 : m[2] === "week" ? 7 : 30);
  }
  const age = Math.floor((Date.now() - Date.parse(learnedAt)) / 86400000);
  if (!Number.isFinite(age) || age <= days) return null;
  return age > days * 3 ? "long gone" : "expired";
}

// The date a fact was learned is stored inside the value, as `- YYYY-MM-DD: "…"`.
function factLearnedAt(value) {
  const m = String(value).match(/- (\d{4}-\d{2}-\d{2}):/);
  return m ? m[1] : null;
}

module.exports = {
  cmdShow, renderObs, fmt, cmdList, cmdRank, cmdSearch,
};
