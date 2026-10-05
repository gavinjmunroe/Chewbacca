// @ts-nocheck
// people lookup: resolving a name, handle or id to exactly one person or
// circle, refusing on ambiguity, and spotting the same human under two rows.

"use strict";

const { c, die } = require("./output");
const { SEED_DIMENSIONS } = require("./schema");
const { db } = require("./db");

// ---------------------------------------------------------------- lookup

function findPerson(needle, { required = true } = {}) {
  if (!needle) return null;
  const d = db();
  // AN EXACT NAME IS NOT AN IDENTITY. This used to be `.get()`, so when two
  // live rows were both called "Tobias Lund" SQLite handed back whichever it
  // reached first and said nothing. Half of what was known about the man sat
  // on the row that lost, and a message got written off the half that won.
  // The LIKE branch below had refused ambiguity since day one; the exact
  // branch skipped the check because an exact match felt like certainty.
  const exact = d
    .prepare(
      "SELECT * FROM people WHERE deleted_at IS NULL AND (id = ? OR handle = ? OR lower(name) = lower(?)) ORDER BY id",
    )
    .all(needle, needle, needle);
  if (exact.length === 1) return exact[0];
  if (exact.length > 1)
    die(
      `"${needle}" is the name of ${exact.length} separate rows:\n` +
        exact
          .map(
            (p) =>
              `  ${p.id}  ${[p.role, p.company, p.location].filter(Boolean).join(" · ") || c.dim("(nothing on file)")}`,
          )
          .join("\n") +
        "\nPass an id. If they are the same person: people merge <keep-id> <drop-id>",
      2,
    );
  const like = d
    .prepare(
      "SELECT * FROM people WHERE deleted_at IS NULL AND lower(name) LIKE lower(?) ORDER BY name LIMIT 5",
    )
    .all(`%${needle}%`);
  if (like.length === 1) return like[0];
  // A FIRST NAME BEATS A NAME THAT MERELY CONTAINS IT. On 2026-10-05 "gavin"
  // matched Gavin Munroe plus "Gregory Gavin Lee UCLA", "Jake UIUX Gavin's
  // Friend" and "Semyon Gavin's Friend", and `people note gavin` refused.
  // Contact names here are decorated with who introduced them, so the only
  // row that is actually called Gavin is the one whose name starts with it.
  // Two real first-name matches (Tyler Law, Tyler Larsen) still refuse below.
  const first = d
    .prepare("SELECT * FROM people WHERE deleted_at IS NULL AND lower(name) LIKE lower(?) ORDER BY name")
    .all(`${needle}%`)
    .filter((p) => nameTokens(p.name)[0] === String(needle).toLowerCase());
  if (first.length === 1) return first[0];
  if (like.length > 1) {
    die(
      `"${needle}" matches ${like.length} people:\n` +
        like.map((p) => `  ${p.name}`).join("\n") +
        "\nBe more specific, or use the handle.",
    );
  }
  if (required) die(`No one matches "${needle}". Add them: people add "${needle}"`);
  return null;
}

// THE SAME HUMAN UNDER TWO NAMES.
//
// A contact saved as "Tobias Lund USC" and a LinkedIn row called "Tobias
// Larsen" are one person, and nothing in this store knew that. `show` resolved
// one of them, printed it in full, and never mentioned that the texts, the
// cats, the club and the career history were split across two rows. The half
// you got looked complete because there was no marker for the half you did not.
//
// The test is token containment, not string similarity: every token of the
// shorter name appears in the longer one, and at least two tokens are shared.
// That catches the decorated-contact-name pattern this address book is full of
// ("Sam Rivera GOAT", "Owen Marsh IYA") without matching two strangers who
// happen to share a first name. A shared phone, email or LinkedIn URL counts on
// its own, because those identify rather than describe.
const nameTokens = (n) =>
  String(n || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);

function possibleTwins(p) {
  const d = db();
  const mine = nameTokens(p.name);
  const idKeys = ["phone", "email", "linkedin"];
  const others = d
    .prepare(`SELECT * FROM people WHERE deleted_at IS NULL AND id <> ? ORDER BY name`)
    .all(p.id);
  const norm = (u) => String(u || "").trim().toLowerCase().replace(/\/+$/, "").replace(/^https?:\/\/(www\.)?/, "");
  return others.filter((o) => {
    for (const k of idKeys) {
      if (p[k] && o[k] && norm(p[k]) === norm(o[k])) return true;
    }
    const theirs = nameTokens(o.name);
    const shared = mine.filter((t) => theirs.includes(t));
    if (shared.length < 2) return false;
    const short = mine.length <= theirs.length ? mine : theirs;
    const long = short === mine ? theirs : mine;
    return short.every((t) => long.includes(t));
  });
}

// Everybody else who answers to the same first name. Not the same person, and
// that is exactly the point: this is the list you must not blend into the one
// you are writing to. Tobias Lane is Colin's friend; Tobias Lund runs TTS.
function sameFirstName(p) {
  const d = db();
  const first = nameTokens(p.name)[0];
  if (!first) return [];
  const twins = new Set(possibleTwins(p).map((x) => x.id));
  return d
    .prepare(`SELECT * FROM people WHERE deleted_at IS NULL AND id <> ? ORDER BY name`)
    .all(p.id)
    .filter((o) => nameTokens(o.name)[0] === first && !twins.has(o.id));
}

function findCircle(needle, { required = true } = {}) {
  const d = db();
  const exact = d
    .prepare("SELECT * FROM circles WHERE deleted_at IS NULL AND (id = ? OR lower(name) = lower(?))")
    .get(needle, needle);
  if (exact) return exact;
  const like = d
    .prepare("SELECT * FROM circles WHERE deleted_at IS NULL AND lower(name) LIKE lower(?) LIMIT 5")
    .all(`%${needle}%`);
  if (like.length === 1) return like[0];
  if (like.length > 1)
    die(`"${needle}" matches ${like.length} circles:\n` + like.map((x) => `  ${x.name}`).join("\n"));
  if (required) die(`No circle matches "${needle}". Make one: people circle create "${needle}"`);
  return null;
}

function dimByCode(code) {
  const d = db().prepare("SELECT * FROM dimensions WHERE code = ?").get(String(code).toLowerCase());
  if (!d)
    die(
      `Unknown dimension "${code}". One of: ` +
        SEED_DIMENSIONS.map((x) => x[1]).join(", "),
    );
  return d;
}

// One canonical form for a phone or an address, so "+1 (213) 555-0168",
// "2135550168" and "+12135550168" are the same key.
function normHandle(v) {
  if (!v) return null;
  const s = String(v).trim();
  if (s.includes("@")) return s.toLowerCase();
  let d = s.replace(/\D/g, "");
  if (d.length === 11 && d.startsWith("1")) d = d.slice(1);
  return d.length === 10 ? d : null;
}

module.exports = {
  findPerson, nameTokens, possibleTwins, sameFirstName, findCircle, dimByCode, normHandle,
};
