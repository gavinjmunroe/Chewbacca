// @ts-nocheck
// people infer: the rule engine that proposes conclusions from evidence
// already in the store, written as inferred observations only with --apply.

"use strict";

const fs = require("node:fs");
const { c, die, say, parseArgs } = require("./output");
const { DIR, db, uuid } = require("./db");
const { parseCsvRows, allExports } = require("./linkedin-match");

// ---------------------------------------------------------------- infer
//
// Conclude things nobody typed in, from evidence that is already here.
//
// The shape is a rule engine, not a feature. A rule is data: what to look for,
// what that means, and how sure it makes you. Adding "people who texted me
// about homework between 2021 and 2025 went to my high school" is a literal in
// a list, and so is every rule after it, which is the point.
//
// THREE THINGS KEEP THIS HONEST, and all three were learned the hard way.
//
// 1. An inference is stored as `source='inferred'`, never `told_directly`. The
//    schema has carried that value since the beginning and the scoring weights
//    it lower on purpose. A guess that enters the store as a statement is
//    indistinguishable from something the person actually said, forever.
//
// 2. The evidence travels with the claim. Every written observation names the
//    rule, the count, and the window that produced it, so a wrong one can be
//    found and argued with instead of just being believed.
//
// 3. It proposes by default and writes only with --apply. The first draft of
//    the high-school rule concluded that Mom, Dad, and Caleb's little sister
//    all attended Oak Ridge High School, because they talked about homework
//    during those years. Generic evidence proves somebody was near a subject,
//    not that they share an affiliation.
//
// A rule is:
//   id         stable name, used to re-run or retract just this rule
//   claim      what gets written, as a sentence
//   window     [fromISO, toISO] or null for any time
//   phrases    substrings that count as evidence, matched case-insensitively
//   min        how many hits before it is worth saying
//   require    optional extra predicate over the evidence bundle
//   exclude    optional predicate that disqualifies outright
//   against    substrings that DISPROVE the claim, matched against the name,
//              the label the user typed, the company and the role
//   confidence 0..1, written into the body so the reader can weigh it
//   dimension  which of the six it informs, or null
//
// `against` earns its place. The first run concluded that "Evan Cho SPHS
// treasurer", "Jordan Seo Other CVHS Club Prez" and "Kara Wells Mkhs Cyf"
// all attended Oak Ridge High School, when each of those labels names a
// different school and the user typed it himself. Evidence for a claim is easy
// to look for; the reason to look for evidence against it is that a contact
// book is full of it and it is more reliable than the thing being inferred.
const INFERENCE_RULES = [
  // NO SCHOOL IS HARDCODED HERE ANY MORE. This shipped with "Oak Ridge High
  // School" and "USC" written into the kit, which made two of the five
  // built-in rules useless to everyone except the person who wrote them, and
  // quietly wrong for anybody whose own school shares a word with his.
  //
  // Where somebody went to school is already on their disk. Education.csv sits
  // in every LinkedIn export and describes the owner, not their connections,
  // so the school rules are generated from it at run time with the years
  // attended as the window. That is exactly the inference Caleb asked for:
  // someone talking about a school in the years you were there is probably
  // there with you. See schoolRules().
  {
    id: "teammate-baseball",
    claim: "probably played a sport with them",
    window: null,
    phrases: ["practice", "scrimmage", "bullpen", "batting", "the team", "coach"],
    min: 6,
    against: ["coach", "mom", "dad", "newton"],
    exclude: (e) => e.isGroup || e.looksFamily,
    confidence: 0.5,
    dimension: "physical",
  },
  {
    id: "church-community",
    claim: "probably shares their church or ministry community",
    window: null,
    phrases: ["church", "bible study", "worship", "small group", "fellowship", "pray for"],
    min: 5,
    exclude: (e) => e.isGroup,
    confidence: 0.55,
    dimension: "spiritual",
  },
  {
    id: "works-together",
    claim: "probably works or has worked with them",
    window: null,
    phrases: ["standup", "the repo", "deploy", "pull request", "the client", "our team", "sprint"],
    min: 5,
    exclude: (e) => e.looksFamily,
    confidence: 0.6,
    dimension: "intellectual",
  },
];

// The user's own schools, read from their own LinkedIn export.
//
// Education.csv is the one file in that export that is about the owner rather
// than their connections, and it carries the school name and the years. That
// is everything a school rule needs, and it is different for every person who
// installs this, which is the whole reason it cannot be a constant.
//
// The window matters as much as the name. Somebody who mentions a school in
// the years you were enrolled is plausibly there with you; the same words in
// 2019 are somebody talking about a place. An acronym is generated only when
// the school name yields a distinctive one, because two-letter initials match
// half the language.
function schoolRules() {
  const out = [];
  for (const conns of allExports()) {
    const f = conns.replace(/Connections\.csv$/, "Education.csv");
    if (!fs.existsSync(f)) continue;
    let rows;
    try {
      rows = parseCsvRows(fs.readFileSync(f, "utf8").replace(/^﻿/, ""));
    } catch {
      continue;
    }
    const head = rows.findIndex((r) => r.includes("School Name"));
    if (head < 0) continue;
    const cols = rows[head];
    const at = (r, n) => r[cols.indexOf(n)] || "";
    for (const r of rows.slice(head + 1)) {
      const school = at(r, "School Name").trim();
      if (!school || school.length < 4) continue;
      const from = at(r, "Start Date").trim();
      const to = at(r, "End Date").trim();
      const words = school.toLowerCase().replace(/[^a-z ]/g, " ").split(/\s+/).filter(Boolean);
      const stop = new Set(["the", "of", "and", "university", "college", "school", "high", "academy", "institute"]);
      // THE SHORT WORD IS THE ONE PEOPLE TYPE. Dropping anything under four
      // characters deleted "usc" from "USC Jimmy Iovine and Dr. Dre Knox
      // Academy" and kept "jimmy", "iovine" and "young", so the rule searched
      // for a first name and a colour and found forty hits on a little
      // brother. USC, UCLA, MIT, NYU and SMHS are all the distinctive part of
      // their own names.
      //
      // An all-caps token in the original string is a school's short name, and
      // is kept whatever its length. Everything else still needs four.
      const caps = (school.match(/\b[A-Z]{2,5}\b/g) || []).map((w) => w.toLowerCase());
      const distinctive = [
        ...caps,
        ...words.filter((w) => !stop.has(w) && w.length > 3 && !caps.includes(w)),
      ];
      const acronym = words.filter((w) => !stop.has(w)).map((w) => w[0]).join("");
      const phrases = [school.toLowerCase(), ...distinctive];
      if (acronym.length >= 3) phrases.push(acronym);
      const id = `school-${distinctive[0] || acronym || "x"}`;
      if (out.some((x) => x.id === id)) continue;
      out.push({
        id,
        claim: `probably overlapped with them at ${school}`,
        // A year alone is what LinkedIn stores, so it becomes a January
        // boundary rather than a guessed month.
        window: [from ? `${from.slice(-4)}-01` : null, to ? `${to.slice(-4)}-12` : null],
        phrases: [...new Set(phrases)],
        min: 3,
        // Relatives discuss school constantly without attending it, and a
        // coach or a teacher is at the school without being a classmate.
        against: ["mom", "dad", "mother", "father", "sister", "brother",
                  "coach", "teacher", "professor", "principal"],
        exclude: (e) => e.isGroup || e.looksFamily,
        confidence: 0.55,
        dimension: "social",
      });
    }
  }
  return out;
}

// Anything the user drops in here is treated exactly like a built-in rule, so
// a new kind of inference costs a JSON entry rather than a release.
function loadRules() {
  const extra = `${DIR}/rules.json`;
  let user = [];
  try {
    user = JSON.parse(fs.readFileSync(extra, "utf8"));
    // A user rule cannot carry a function, so its predicates come as arrays of
    // strings and are compiled here into the same shape a built-in has.
    user = user.map((r) => ({
      ...r,
      against: r.against || [],
      where: r.where || [],
      exclude: (e) => (r.excludeGroups && e.isGroup) || (r.excludeFamily && e.looksFamily),
    }));
  } catch {
    /* no user rules is the normal case */
  }
  return [...INFERENCE_RULES, ...schoolRules(), ...user];
}

// One pass over a person's messages produces everything every rule needs, so
// adding rules costs no extra reads.
function evidenceFor(d, who, phraseSet, window) {
  const [from, to] = window || [null, null];
  const clauses = ["who = ?"];
  const args = [who];
  if (from) { clauses.push("sent_at >= ?"); args.push(from); }
  if (to) { clauses.push("sent_at <= ?"); args.push(to); }
  const rows = d
    .prepare(`SELECT body, from_me, sent_at FROM messages WHERE ${clauses.join(" AND ")}`)
    .all(...args);
  const hits = new Map();
  let sent = 0, recvd = 0;
  for (const r of rows) {
    if (r.from_me) sent++; else recvd++;
    const b = String(r.body || "").toLowerCase();
    for (const p of phraseSet) if (b.includes(p)) hits.set(p, (hits.get(p) || 0) + 1);
  }
  return {
    who,
    total: rows.length,
    sent,
    recvd,
    hits,
    hitCount: [...hits.values()].reduce((a, b) => a + b, 0),
    first: rows.length ? rows[0].sent_at : null,
    // A thread nobody replied to is an announcement list, and a thread whose
    // name lists several people is a group. Neither is a person with an
    // affiliation to infer.
    isGroup: /,/.test(who) || /\b(updates|group|chat\d|everyone|team\b.*\bupdates)\b/i.test(who),
    looksFamily: /\b(mom|dad|mother|father|grandma|grandpa|family|aunt|uncle|cousins?)\b/i.test(who),
    oneWay: rows.length > 0 && (sent === 0 || recvd === 0),
  };
}

// A rule may also test the person's own columns, not just their messages.
//
// This is what makes the engine general rather than a text matcher. Half this
// store is now structured: a company, a title, a city, a dated career history,
// a cadence, a last-contact date. A rule that can only grep message bodies
// cannot say "founders in Los Angeles who have gone quiet", which is a
// question made entirely of facts already sitting in columns.
//
// Operators are deliberately few. `has` and `lacks` cover presence, `is` and
// `contains` cover value, `gt`/`lt` cover numbers and dates as strings, which
// sorts correctly for ISO. Anything more expressive belongs in SQL, and a rule
// that needs SQL is not a rule, it is a report.
function fieldTest(person, cond) {
  const val = (person[cond.field] ?? "").toString();
  const v = val.toLowerCase();
  const want = (cond.value ?? "").toString().toLowerCase();
  switch (cond.op) {
    case "has": return val.trim() !== "";
    case "lacks": return val.trim() === "";
    case "is": return v === want;
    case "contains": return want !== "" && v.includes(want);
    case "excludes": return want !== "" && !v.includes(want);
    case "gt": return val > cond.value;
    case "lt": return val < cond.value;
    default: return false;
  }
}

function cmdInfer(argv) {
  const { flags } = parseArgs(argv);
  const apply = !!flags.apply;
  const only = typeof flags.rule === "string" ? flags.rule : null;
  const limit = Number(flags.limit || 40);
  const d = db();
  const rules = loadRules().filter((r) => !only || r.id === only);
  if (!rules.length) die(`No rule called "${only}". Try: people infer --list`);

  if (flags.list) {
    say();
    for (const r of loadRules())
      say(`  ${c.b(r.id.padEnd(22))} ${c.dim(r.claim)}  ${c.dim(`(${Math.round(r.confidence * 100)}%)`)}`);
    say();
    return;
  }

  const threads = d
    .prepare(`SELECT who, COUNT(*) n FROM messages GROUP BY who HAVING n >= 10`)
    .all();

  say();
  say(`  ${c.b("Inferring from what is already here")}`);
  say(c.dim(`  ${rules.length} rule(s) over ${threads.length} conversations`));
  say();

  const proposals = [];
  let blocked = 0;
  for (const r of rules) {
    const phraseSet = (r.phrases || []).map((p) => p.toLowerCase());
    for (const t of threads) {
      const e = evidenceFor(d, t.who, phraseSet, r.window);
      // min defaults to 0 so a purely structural rule is legal: "founders in
      // Los Angeles" needs no word to appear in any message.
      if (e.hitCount < (r.min || 0)) continue;
      if (r.exclude && r.exclude(e)) continue;
      if (r.require && !r.require(e)) continue;
      const person = d
        .prepare(
          `SELECT p.*, s.base_score, s.warmth, s.last_interaction_at
             FROM people p LEFT JOIN person_scores s ON s.person_id = p.id
            WHERE lower(p.name)=lower(?) AND p.deleted_at IS NULL`,
        )
        .get(t.who);
      if (!person) continue;
      // Column conditions run before the expensive message scan where possible,
      // and always before anything is proposed.
      if (r.where && !r.where.every((cond) => fieldTest(person, cond))) continue;
      // Counter-evidence beats evidence. What the user typed about somebody is
      // a firmer fact than anything inferred from how often a word came up.
      if (r.against && r.against.length) {
        const surface = [person.name, person.company, person.role, person.how_we_met,
                         person.nickname, t.who].filter(Boolean).join(" ").toLowerCase();
        const blocker = r.against.find((a) => surface.includes(a.toLowerCase()));
        if (blocker) { blocked++; continue; }
      }
      const top = [...e.hits.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
      const fieldWhy = (r.where || [])
        .map((cnd) => `${cnd.field} ${cnd.op}${cnd.value ? ` ${cnd.value}` : ""}`)
        .join(", ");
      proposals.push({
        rule: r,
        person,
        because: [top.map(([p, n]) => `"${p}" x${n}`).join(", "), fieldWhy].filter(Boolean).join(" | "),
        window: r.window ? `${r.window[0] || "any"} to ${r.window[1] || "now"}` : "any time",
      });
    }
  }

  proposals.sort((a, b) => b.rule.confidence - a.rule.confidence);
  let written = 0;
  for (const p of proposals.slice(0, limit)) {
    say(
      `    ${c.cyn(p.person.name.slice(0, 24).padEnd(26))} ${p.rule.claim.slice(0, 40).padEnd(42)} ${c.dim(p.because.slice(0, 34))}`,
    );
    if (apply) {
      const body =
        `${p.rule.claim}. Inferred by rule "${p.rule.id}" from ${p.because} ` +
        `in messages ${p.window}. Confidence ${Math.round(p.rule.confidence * 100)}%.`;
      const dup = d
        .prepare(`SELECT 1 FROM observations WHERE person_id=? AND body LIKE ? AND deleted_at IS NULL`)
        .get(p.person.id, `%rule "${p.rule.id}"%`);
      if (!dup) {
        d.prepare(
          `INSERT INTO observations (id, person_id, kind, modality, source, body)
           VALUES (?,?,'fact','actual','inferred',?)`,
        ).run(uuid(), p.person.id, body);
        written++;
      }
    }
  }

  say();
  say(`  ${c.b(String(proposals.length))} inference(s) proposed.`);
  if (blocked)
    say(c.dim(`  ${blocked} refused: something you already recorded contradicts the claim.`));
  if (apply) say(`  ${c.grn(String(written))} written as inferred, with their evidence attached.`);
  else say(c.dim(`  Nothing written. Re-run with --apply once these look right.`));
  say(c.dim(`  Add your own in ${DIR}/rules.json  |  people infer --list`));
  say();
}

module.exports = {
  cmdInfer,
};
