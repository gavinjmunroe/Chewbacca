/**
 * Ambiguous names still produce a person.
 *
 * With a 973-contact address book, almost every common first name matches two or
 * more people. The resolver refused to pick, the subject came back with no
 * contactId, and a subject with no contactId is filtered out before it can reach
 * the screen — so "Kayla just moved to the Bay Area" tagged nobody, every time.
 * That is the whole of "it only tags one time in five".
 */
import test from "node:test";
import assert from "node:assert/strict";
import { resolveContactByName } from "./fact-capture.js";

const c = (id, full_name, interaction_count = 0) => ({
  id,
  full_name,
  first_name: full_name.split(" ")[0],
  last_name: full_name.split(" ")[1] ?? null,
  interaction_count,
});

test("one match still resolves outright", () => {
  const r = resolveContactByName("Kayla", [c(1, "Kayla Nguyen"), c(2, "Dev Shah")]);
  assert.equal(r.status, "resolved");
  assert.equal(r.contactId, 1);
});

test("several people with one name is still ambiguous, and now ranked", () => {
  // The person the user actually talks about comes first, because that entry is
  // what the soft-confirm offers as its guess.
  const r = resolveContactByName("Kayla", [
    c(1, "Kayla Nguyen", 0),
    c(2, "Kayla Brooks", 11),
    c(3, "Kayla Ruiz", 3),
  ]);
  assert.equal(r.status, "ambiguous");
  assert.deepEqual(
    r.candidateObjects.map((x) => x.name),
    ["Kayla Brooks", "Kayla Ruiz", "Kayla Nguyen"],
  );
  assert.equal(r.candidateObjects[0].interactionCount, 11);
});

test("spelling closeness still outranks familiarity", () => {
  // A phonetic near-miss must not jump ahead of an exact spelling just because
  // the user talks about them more — the count is a TIEBREAK, not the ranking.
  const r = resolveContactByName("Maya", [
    c(1, "Mya Patel", 40),
    c(2, "Maya Cohen", 1),
    c(3, "Maya Iyer", 0),
  ]);
  assert.equal(r.status, "ambiguous");
  // Both exact "Maya" spellings come before "Mya", and among them the
  // more-talked-about one leads.
  assert.deepEqual(
    r.candidateObjects.map((x) => x.name),
    ["Maya Cohen", "Maya Iyer", "Mya Patel"],
  );
});

test("a name nobody answers to resolves to nothing, not a guess", () => {
  const r = resolveContactByName("Zephaniah", [c(1, "Kayla Brooks", 9)]);
  assert.equal(r.status, "none");
  assert.equal(r.contactId, null);
});

test("a missing interaction count is treated as zero, never NaN", () => {
  const r = resolveContactByName("Kayla", [
    { id: 1, full_name: "Kayla Nguyen", first_name: "Kayla" },
    c(2, "Kayla Brooks", 4),
  ]);
  assert.equal(r.status, "ambiguous");
  assert.equal(r.candidateObjects[0].name, "Kayla Brooks");
  assert.equal(r.candidateObjects[1].interactionCount, 0);
});

// ── SAYING SOMEBODY'S WHOLE NAME ────────────────────────────────────────────
//
// Everything above is about a bare FIRST name, which is genuinely ambiguous on a
// large book. A FULL name is not, and it was being treated as though it were.
//
// "Marcus O'Dell just left Sequoia to raise his own fund" filed against Marcus
// Castillo, a man imported from a SIM card and never mentioned since. The real
// Marcus was not even in the candidate list. exactFull was computed and then
// discarded: every same-first-name contact joined the pool as a "nickname
// extension", the final ranking measured the whole spoken name against each
// candidate's FIRST name only (so every Marcus tied exactly), interaction counts
// were all zero on a freshly synced book, and the last tiebreak was alphabetical.
//
// Measured on a 907-contact book: of 400 people addressed by their own exact
// full name, 38 came back as somebody else. One in ten, and silently -- the
// caller treats "ambiguous" as a soft confirm, so the fact parks against the
// wrong person and never reaches the right card.

test("an exact full name resolves to that person even when the first name is shared", () => {
  const r = resolveContactByName("Marcus O'Dell", [
    c(1, "Marcus Castillo"),
    c(2, "Marcus Fitzgerald"),
    c(3, "Marcus O'Dell"),
    c(4, "Marcus Hoffman"),
  ]);
  assert.equal(r.status, "resolved");
  assert.equal(r.contactId, 3);
  assert.equal(r.matchedName, "Marcus O'Dell");
});

test("an exact full name beats a same-first-name contact with a big interaction count", () => {
  // Familiarity is the tiebreak between EQUALLY good matches. It must never
  // outrank the person whose whole name was said.
  const r = resolveContactByName("Marcus O'Dell", [
    c(1, "Marcus Castillo", 94),
    c(2, "Marcus O'Dell", 0),
  ]);
  assert.equal(r.status, "resolved");
  assert.equal(r.contactId, 2);
});

test("two contacts with the SAME full name stay ambiguous, and offer only those two", () => {
  // Real duplicates. A second Marcus with a different surname is not a candidate
  // for "Marcus O'Dell" and must not be offered as one.
  const r = resolveContactByName("Marcus O'Dell", [
    c(1, "Marcus O'Dell", 2),
    c(2, "Marcus O'Dell", 9),
    c(3, "Marcus Castillo", 40),
  ]);
  assert.equal(r.status, "ambiguous");
  assert.deepEqual(r.candidateObjects.map((x) => x.id), ["2", "1"]);
  assert.equal(r.candidateObjects.length, 2);
});

test("a MISSPELLED full name matches nobody rather than guessing", () => {
  // DOCUMENTING A LIMIT, NOT ENDORSING IT. "Marcus O'Dul" returns none: the
  // Soundex of the whole two-token string does not match the Soundex of any
  // candidate's first name, so no candidate is admitted at all.
  //
  // That is the SAFE failure. This resolver writes facts onto people's cards,
  // and "none" produces a clarify card offering "add as a new contact" or
  // "skip" -- a tap -- whereas widening recall here would file a fact about
  // one person onto another's card silently. The typo path that DOES guess
  // (fuzzyFindContactsByName, contact-name-match.js) is deliberately a separate
  // matcher used on the read side, where a wrong guess costs a wrong search
  // result and not a corrupted memory.
  //
  // If this is ever loosened, it needs the same treatment the read side got:
  // exact tokens required for short words, and a bounded edit budget.
  const r = resolveContactByName("Marcus O'Dul", [
    c(1, "Marcus Castillo"),
    c(2, "Marcus O'Dell"),
    c(3, "Marcus Alvarez"),
  ]);
  assert.equal(r.status, "none");
});

test("a bare first name is unaffected by the full-name rule", () => {
  // The single-token path is the common one and must not change: no exact full
  // name exists, so every Marcus is still a candidate, ranked by familiarity.
  const r = resolveContactByName("Marcus", [
    c(1, "Marcus Castillo", 1),
    c(2, "Marcus O'Dell", 7),
  ]);
  assert.equal(r.status, "ambiguous");
  assert.equal(r.candidateObjects[0].name, "Marcus O'Dell");
  assert.equal(r.candidateObjects.length, 2);
});
