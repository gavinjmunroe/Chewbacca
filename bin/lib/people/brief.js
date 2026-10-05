// @ts-nocheck
// people brief: the identity-checked summary to read before writing to
// somebody.

"use strict";

const { c, die, say, parseArgs } = require("./output");
const { db } = require("./db");
const { findPerson, nameTokens, possibleTwins, sameFirstName } = require("./lookup");
const { dueLabel } = require("./commitments");
const { renderObs } = require("./show");
const { clayKey, clayCandidates } = require("./resolve");

// ---------------------------------------------------------------- brief
//
// THE COMMAND TO RUN BEFORE WRITING TO SOMEBODY.
//
// Written after a text went out to Tobias Lund containing facts about Tobias
// Law, and containing no work history at all even though the free Clay lookup
// that returns it had been sitting in this same binary for a week. Three
// things went wrong and `show` could not have caught any of them:
//
//   1. Three live rows were called "Tobias Lund". `show` picked one.
//   2. Fourteen people in this address book are called Tobias. Nothing said so.
//   3. Nobody ran `linkedin locate`, so the career field was empty and the
//      message was assembled out of whatever else was lying around.
//
// So this refuses rather than reports. An identity that is not resolved is not
// a warning to skim past, it is a reason to stop, because the output of this
// command becomes a message to a real person who will read it.
function cmdBrief(argv) {
  const { rest, flags } = parseArgs(argv);
  const who = rest.join(" ");
  if (!who) die('Who are you writing to? people brief "Tobias Lund"');
  const p = findPerson(who);
  const d = db();

  // REFUSE, DO NOT WARN. A split identity is the failure this command exists
  // for: every fact on the losing row is invisible and nothing in the output
  // would have looked wrong.
  const twins = possibleTwins(p);
  if (twins.length && !flags.force) {
    die(
      `"${p.name}" is split across ${twins.length + 1} rows, so no brief here is complete.\n\n` +
        `  ${p.id}  ${p.name}${p.phone ? `  ${p.phone}` : ""}${p.company ? `  ${p.company}` : ""}\n` +
        twins
          .map((t) => `  ${t.id}  ${t.name}${t.phone ? `  ${t.phone}` : ""}${t.company ? `  ${t.company}` : ""}`)
          .join("\n") +
        `\n\nSame person:      people merge ${p.id} ${twins[0].id}\n` +
        `Different people: people brief ${p.id} --force`,
      2,
    );
  }

  say("");
  say(c.b(p.name) + (p.handle ? c.dim(` @${p.handle}`) : ""));
  const bits = [p.role, p.company, p.location].filter(Boolean).join(" · ");
  if (bits) say(c.dim(bits));
  const contact = [p.phone, p.email].filter(Boolean).join("  ");
  if (contact) say(c.dim(contact));
  if (p.linkedin) say(c.dim(p.linkedin));

  // THE LIST YOU MUST NOT BLEND IN. Fourteen Tobiases is not an edge case in a
  // real address book, it is the normal state of one, and the only reason the
  // wrong Tobias's facts reached a message is that nothing ever said the other
  // thirteen existed.
  const others = sameFirstName(p);
  if (others.length) {
    say("");
    say(c.yel(`  do not confuse with  ${c.dim(`${others.length} other people named ${nameTokens(p.name)[0]}`)}`));
    for (const o of others.slice(0, 12))
      say(c.dim(`    ${o.name}${o.company ? ` · ${o.company}` : ""}${o.role && !o.company ? ` · ${o.role}` : ""}`));
    if (others.length > 12) say(c.dim(`    and ${others.length - 12} more`));
  }

  // WORK HISTORY, FETCHED IF MISSING. The free path: Clay bills enrichment and
  // not search, and the export already holds this person's profile URL, so the
  // right row falls out of a URL match instead of a paid disambiguation. Ten
  // Tobias Lunds come back from that search and only the URL tells them apart,
  // which is why a name match here would be worse than no answer.
  let career = (d.prepare(`SELECT value FROM quick_facts WHERE person_id=? AND key='career'`).get(p.id) || {}).value || "";
  let careerNote = "on file";
  if (!career && p.linkedin && clayKey() && !flags["no-fetch"]) {
    try {
      const norm = (u) => String(u || "").trim().toLowerCase().replace(/\/+$/, "").replace(/^https?:\/\/(www\.)?/, "");
      const hit = clayCandidates(p.name, 10).find((x) => norm(x.linkedin) === norm(p.linkedin));
      if (hit && hit.experiences.length) {
        career = hit.experiences
          .slice(0, 8)
          .map((e) => `${e.title || "?"} at ${e.company || "?"}${e.from ? ` (${e.from}${e.to ? ` to ${e.to}` : " to now"})` : ""}`)
          .join("; ");
        d.prepare(
          `INSERT INTO quick_facts (person_id, key, value) VALUES (?, 'career', ?)
           ON CONFLICT(person_id, key) DO UPDATE SET value=excluded.value`,
        ).run(p.id, career.slice(0, 1200));
        if (hit.location)
          d.prepare(`UPDATE people SET location=COALESCE(NULLIF(location,''), ?) WHERE id=?`).run(hit.location, p.id);
        careerNote = "fetched just now from Clay, matched on the LinkedIn URL";
      } else if (hit) {
        careerNote = "Clay knows the profile but lists no roles";
      } else {
        careerNote = "no Clay row matched that LinkedIn URL";
      }
    } catch (e) {
      careerNote = `Clay lookup failed (${e.message}); nothing was written`;
    }
  }
  say("");
  if (career) {
    say(c.cyn("  work history  ") + c.dim(`(${careerNote})`));
    for (const job of career.split("; ")) say(`    ${job}`);
  } else if (!p.linkedin) {
    say(c.yel("  work history   unknown, and no LinkedIn URL on file to look it up with."));
    say(c.dim("                 Do not guess at where they work. Ask, or leave it out."));
  } else if (!clayKey()) {
    say(c.yel("  work history   unknown. A Clay key at ~/.chewbacca/clay-key makes this free."));
  } else {
    say(c.yel(`  work history   unknown: ${careerNote}.`));
    say(c.dim("                 Do not guess at where they work."));
  }

  const qf = d
    .prepare(`SELECT key, value FROM quick_facts WHERE person_id=? AND key<>'career' ORDER BY key`)
    .all(p.id);
  if (qf.length) {
    say("");
    for (const f of qf) say(`  ${c.cyn(f.key.padEnd(14))} ${String(f.value).split("\n").join("\n" + " ".repeat(17))}`);
  }

  const owed = d
    .prepare(`SELECT title, due_at FROM tasks WHERE person_id=? AND done_at IS NULL`)
    .all(p.id);
  if (owed.length) {
    say("\n" + c.cyn("  you owe them"));
    for (const t of owed) say(`    ${t.title}${t.due_at ? c.dim("  " + dueLabel(t.due_at)) : ""}`);
  }

  // Every fact carries where it came from, so the message can too. "He said in
  // March" and "his LinkedIn says" are not the same claim and must not leave
  // here looking like one.
  const obs = d
    .prepare(
      `SELECT * FROM observations WHERE person_id = ? AND deleted_at IS NULL
        ORDER BY observed_at DESC LIMIT 25`,
    )
    .all(p.id);
  say("\n" + c.cyn("  what you actually know") + c.dim("  (source in brackets; never state an inferred line as fact)"));
  if (!obs.length) say(c.dim("    nothing recorded. Anything you write must come from this conversation."));
  for (const o of obs) say("    " + renderObs(o));

  const planned = obs.filter((o) => o.modality !== "actual");
  if (planned.length) {
    say("");
    say(c.yel(`  ${planned.length} of those are ${[...new Set(planned.map((o) => o.modality))].join("/")}, not things that happened.`));
    say(c.dim("  Congratulating someone on a plan is the fastest way to prove you were guessing."));
  }

  say("");
  say(c.dim(`  still blank: people ask ${p.handle || p.name}`));
  say("");
}

module.exports = {
  cmdBrief,
};
