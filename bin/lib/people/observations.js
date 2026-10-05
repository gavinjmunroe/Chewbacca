// @ts-nocheck
// people observations: insertObservation, with Jev's typed judgments and
// the keyword fallback for dimensions, plus the hand-entry commands add,
// note, me and log.

"use strict";

const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { c, die, say, parseArgs } = require("./output");
const { db, uuid, nowISO } = require("./db");
const { findPerson, dimByCode } = require("./lookup");
const { recomputeScores } = require("./scoring");

function cmdAdd(argv) {
  const { flags, rest } = parseArgs(argv);
  const name = rest.join(" ").trim();
  if (!name) die('Who? Try: people add "Maggie Chen" --company Acme');
  const d = db();
  const dupe = d
    .prepare("SELECT * FROM people WHERE deleted_at IS NULL AND lower(name) = lower(?)")
    .get(name);
  if (dupe && !flags.force)
    die(`${name} already exists. Use --force to add a second one, or pick a handle.`);
  const id = uuid();
  d.prepare(
    `INSERT INTO people (id, name, handle, phone, email, company, role, location, how_we_met, birthday)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    id,
    name,
    flags.handle || null,
    flags.phone || null,
    flags.email || null,
    flags.company || null,
    flags.role || null,
    flags.location || null,
    flags["met"] || null,
    flags.birthday || null,
  );
  say(`${c.grn("added")} ${c.b(name)}`);
  if (flags.note) cmdNote([name, flags.note]);
  return id;
}

function insertObservation({ personId, circleId, body, flags = {}, sourceCircleId = null, judge = false }) {
  const d = db();
  const id = uuid();
  const judged = judge && !(flags.dim && flags.modality && flags.source) ? jevJudge(body) : null;
  const kind = flags.kind || "fact";
  const modality = flags.modality || judged?.modality || "actual";
  const source = flags.source || judged?.source || "told_directly";
  const temporal = flags.temporal || (flags.until ? "window" : "decaying");
  d.prepare(
    `INSERT INTO observations
      (id, person_id, circle_id, kind, modality, source, body, observed_at,
       temporal, valid_from, valid_until, source_circle_id)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    id,
    personId || null,
    circleId || null,
    kind,
    modality,
    source,
    body,
    flags.at || nowISO(),
    temporal,
    flags.from || null,
    flags.until || null,
    sourceCircleId,
  );
  const rowid = d.prepare("SELECT rowid FROM observations WHERE id = ?").get(id).rowid;
  d.prepare("INSERT INTO observations_fts (rowid, body) VALUES (?, ?)").run(rowid, body);

  const codes = flags.dim
    ? String(flags.dim)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : judged?.dims.length
      ? judged.dims
      : flags.dimFallback
        ? [flags.dimFallback]
        : judged
          ? []
          : inferDimensions(body);
  const link = d.prepare(
    "INSERT INTO observation_dimensions (observation_id, dimension_id, weight) VALUES (?,?,?) ON CONFLICT DO NOTHING",
  );
  for (const code of codes) link.run(id, dimByCode(code).id, 1.0);
  return { id, dims: codes, modality, source, judged: !!judged };
}

// ---------------------------------------------------------------- jev
//
// The scoring half of Amber's design weights every observation by how it is
// known: modality (a "might" counts 0.25, a thing that happened 1.0) and source
// (told directly 1.0, third party 0.4). None of that ever fired. On 2026-09-23
// all 28 observations in the live store were `actual`, because nothing sets
// --modality and the default is actual, so "she might move to SF" scored as a
// move. Dimensions fell back to keyword lists whenever --dim was missing.
//
// TypeSafe's Jev answers those three judgments as typed questions in one call
// of about a third of a second. It fills only what the caller left unset, and
// for notes the user typed or said (`note`, `me`) and for facts pulled out of
// message threads (events, identify). Gavin chose on 2026-09-23 to give Jev full
// access, with Karthik's permission for the Amber side, so those bodies leave the
// Mac for TypeSafe. Events used to be tagged `social` whatever they were; social
// is now the fallback when Jev finds no dimension or cannot answer. No key, a
// timeout, or PEOPLE_JEV=off, and it returns null and the keyword path runs.

// bin/lib, where jev.py lives. This module is one directory below it.
const JEV_LIB = path.join(__dirname, "..");

// Every question sees the note and nothing else about the person.
const JEV_DIM_TEXT = {
  spiritual: "faith, church, prayer, meaning, religious practice",
  emotional: "mood, stress, grief, relationships' emotional weight, mental health, excitement",
  physical: "health, injury, illness, fitness, sleep, body, medical care",
  intellectual: "school, study, reading, research, learning, ideas they are working through",
  social: "friends, family, dating, marriage, moving, community, events, who they spend time with",
  financial: "work, jobs, money, raises, layoffs, fundraising, a company they run, rent",
};

function jevQuestions() {
  const q = {};
  for (const [code, text] of Object.entries(JEV_DIM_TEXT)) {
    q[`dim_${code}`] = {
      type: "noul",
      instructions: `Does \`note\` say something about this person's ${code} life (${text})?`,
    };
  }
  q.modality = {
    type: "choice",
    instructions: {
      question: "Did the thing in `note` happen, or is it planned, possible, wanted, offered or turned down?",
      note: "Judge the main claim of the note. Present-tense states count as actual.",
    },
    criteria: {
      actual: "It happened or is true now.",
      planned: "It is agreed or scheduled for the future and has not happened yet.",
      hypothetical: "It might happen: maybe, considering, thinking about, could.",
      desired: "They want or hope for it.",
      available: "They are open to it or offering it.",
      declined: "They said no to it or turned it down.",
    },
  };
  q.source = {
    type: "choice",
    instructions: {
      question: "The user wrote `note` about someone they know. How does the user know it?",
      note: "Without any sign of how it is known, the person told the user.",
    },
    criteria: {
      told_directly: "The person said it to the user, or nothing says otherwise.",
      observed: "The user saw it happen themselves.",
      third_party: "Somebody else told the user: heard from, apparently, someone said.",
      inferred: "The user is guessing or working it out.",
    },
  };
  return q;
}

// Set before any run and not tuned on tests/eval_people_jev.py, whose results
// stay private: TypeSafe's customer agreement (2.3(f)) bars publishing Jev
// performance results.
const JEV_DIM_FLOOR = 0.5;
const JEV_CHOICE_FLOOR = 0.5;

function jevJudge(body) {
  if (process.env.PEOPLE_JEV === "off") return null;
  let answers;
  try {
    const out = execFileSync(
      "python3",
      ["-c", "import json,sys; sys.path.insert(0, sys.argv[1]); import jev; " +
             "s,q = json.load(sys.stdin); print(json.dumps(jev.ask(s, q)))", JEV_LIB],
      { input: JSON.stringify([{ note: body }, jevQuestions()]), timeout: 4000, encoding: "utf8",
        stdio: ["pipe", "pipe", "ignore"] },
    );
    answers = JSON.parse(out);
  } catch {
    return null;
  }
  if (!answers || typeof answers !== "object") return null;
  const pick = (a) => {
    const choice = a?.choice;
    return choice && (a.probabilities?.[choice] ?? 0) >= JEV_CHOICE_FLOOR ? choice : null;
  };
  const dims = Object.keys(JEV_DIM_TEXT).filter(
    (code) => (answers[`dim_${code}`]?.noul ?? 0) >= JEV_DIM_FLOOR,
  );
  return { dims, modality: pick(answers.modality), source: pick(answers.source) };
}

// Keyword fallback only. The skill instructs Claude to pass --dim explicitly,
// which is always better than this. This exists so a human typing at a terminal
// still gets something rather than an unscored row.
const DIM_HINTS = {
  spiritual: ["church", "faith", "pray", "prayer", "god", "jesus", "bible", "worship", "ministry", "sermon"],
  emotional: ["anxious", "anxiety", "depressed", "grief", "burnout", "lonely", "stressed", "therapy", "breakup", "divorce", "excited", "overwhelmed"],
  physical: ["gym", "injury", "surgery", "sick", "marathon", "training", "sleep", "diagnosis", "hospital", "diet", "lifting", "running"],
  intellectual: ["reading", "book", "research", "phd", "studying", "course", "paper", "learning", "thesis", "class"],
  social: ["married", "engaged", "wedding", "moved", "friends", "party", "community", "roommate", "dating", "family"],
  financial: ["raise", "salary", "laid off", "fundraising", "broke", "funding", "job", "promotion", "startup", "investor", "rent", "money"],
};

function inferDimensions(body) {
  const t = body.toLowerCase();
  const hits = [];
  for (const [code, words] of Object.entries(DIM_HINTS)) {
    if (words.some((w) => t.includes(w))) hits.push(code);
  }
  return hits;
}

function cmdNote(argv) {
  const { flags, rest } = parseArgs(argv);
  const who = rest.shift();
  const body = rest.join(" ").trim();
  if (!who || !body) die('Try: people note maggie "just got promoted" --dim financial');
  const p = findPerson(who);

  // An agent writing on the user's behalf will sometimes run this twice for one
  // spoken sentence, and the store then says a thing happened twice. The same
  // words about the same person within the hour are one observation.
  // --force writes it anyway, for the rare case where the repetition is real.
  if (!flags.force) {
    const dupe = db()
      .prepare(
        `SELECT id FROM observations
          WHERE person_id = ? AND body = ? AND deleted_at IS NULL
            AND julianday('now') - julianday(observed_at) < 0.042`,
      )
      .get(p.id, body);
    if (dupe) {
      say(c.dim(`already noted on ${p.name} within the hour, skipped`));
      return;
    }
  }

  const { dims, modality, source } = insertObservation({ personId: p.id, body, flags, judge: true });
  const tag = dims.length ? c.dim(` [${dims.join(", ")}]`) : c.dim(" [no dimension]");
  const how = modality !== "actual" || source !== "told_directly" ? c.dim(` ${modality}, ${source}`) : "";
  say(`${c.grn("noted")} on ${c.b(p.name)}${tag}${how}`);
  if (!flags["no-score"]) recomputeScores();
}

function cmdMe(argv) {
  const { flags, rest } = parseArgs(argv);
  const body = rest.join(" ").trim();

  // With no text, `me` reads instead of writes. Facts about Caleb were being
  // written and then never surfaced anywhere, which is the same as not having
  // them. Self-observations carry person_id NULL, so they are one query away.
  if (!body || flags.list) {
    const d = db();
    let sql =
      "SELECT body, observed_at FROM observations" +
      " WHERE person_id IS NULL AND circle_id IS NULL AND deleted_at IS NULL";
    const args = [];
    if (flags.search) {
      sql += " AND body LIKE ?";
      args.push(`%${flags.search}%`);
    }
    sql += " ORDER BY observed_at DESC LIMIT ?";
    args.push(Number(flags.limit) || 40);
    const rows = d.prepare(sql).all(...args);
    if (flags.json) return say(JSON.stringify(rows.map((r) => ({ said: r.body, at: r.observed_at }))));
    if (!rows.length) {
      say(c.dim("nothing recorded about you yet"));
      say(c.dim('  people me "starting the neuro sequence this fall"'));
      return;
    }
    say("");
    say(c.b("you") + c.dim(`  ${rows.length} of ` + d.prepare(
      "SELECT count(*) n FROM observations WHERE person_id IS NULL AND circle_id IS NULL AND deleted_at IS NULL",
    ).get().n));
    for (const r of rows) say(`  ${c.dim(String(r.observed_at).slice(0, 10))}  ${r.body}`);
    say("");
    return;
  }

  const { dims } = insertObservation({ personId: null, circleId: null, body, flags, judge: true });
  say(`${c.grn("noted")} about ${c.b("you")}${dims.length ? c.dim(` [${dims.join(", ")}]`) : ""}`);
}

function cmdLog(argv) {
  const { flags, rest } = parseArgs(argv);
  const who = rest.shift();
  if (!who) die('Try: people log maggie --channel call "caught up about the move"');
  const p = findPerson(who);
  db().prepare(
    "INSERT INTO interactions (id, person_id, channel, note, happened_at) VALUES (?,?,?,?,?)",
  ).run(uuid(), p.id, flags.channel || null, rest.join(" ") || null, flags.at || nowISO());
  say(`${c.grn("logged")} contact with ${c.b(p.name)}`);
  recomputeScores();
}

module.exports = {
  cmdAdd, insertObservation, inferDimensions, cmdNote, cmdMe, cmdLog,
};
