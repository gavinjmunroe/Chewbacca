/**
 * Instant people-tagging, and specifically the hard half: names that are also
 * ordinary English words.
 *
 * "Will you send it in May?" and "Will is meeting May on Friday" contain the same two
 * capitalised words; the first mentions nobody. A stoplist can only refuse both,
 * which means a contact called Will never gets tagged. The difference is grammatical,
 * so these tests are mostly pairs: the same word used as a word, and used as a name.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { fastTagPeople } from "./fast-tag.js";

const CONTACTS = [
  { id: 1, name: "Sagar Tiwari" },
  { id: 2, name: "Sam Ortiz" },
  { id: 3, name: "Priya Raman" },
  { id: 4, name: "Will Chen" },
  { id: 5, name: "May Fischer" },
  { id: 6, name: "Art Delgado" },
  { id: 7, name: "Rose Nakamura" },
  { id: 8, name: "Grant Whitfield" },
  { id: 9, name: "Mark Ellis" },
];
const names = (t, c = CONTACTS) => fastTagPeople(t, c).map((x) => x.name).sort();

test("the demo case", () => {
  assert.deepEqual(
    names("I am traveling to San Francisco to fundraise with Sagar, and my friend Sam is also out there."),
    ["Sagar Tiwari", "Sam Ortiz"],
  );
});

// ── the pairs. Same word, two jobs. ─────────────────────────────────────────
test("Will — modal vs person", () => {
  assert.deepEqual(names("Will you send it over?"), []);
  assert.deepEqual(names("Will we make the flight?"), []);
  assert.deepEqual(names("Will is meeting us in SF"), ["Will Chen"]);
  assert.deepEqual(names("I saw Will at the office"), ["Will Chen"]);
  assert.deepEqual(names("Grabbing coffee with Will tomorrow"), ["Will Chen"]);
  assert.deepEqual(names("Will's deck was good"), ["Will Chen"]);
});

test("May — month vs person", () => {
  assert.deepEqual(names("Let's do it in May"), []);
  assert.deepEqual(names("May 5th works"), []);
  assert.deepEqual(names("May I ask something?"), []);
  assert.deepEqual(names("May said she would join"), ["May Fischer"]);
  assert.deepEqual(names("Dinner with May on Thursday"), ["May Fischer"]);
});

test("Art — noun vs person", () => {
  assert.deepEqual(names("We talked about the art on the wall"), []);
  assert.deepEqual(names("She studies modern Art"), []);
  assert.deepEqual(names("Art is in San Francisco"), ["Art Delgado"]);
  assert.deepEqual(names("I met Art last week"), ["Art Delgado"]);
});

test("Rose — verb vs person", () => {
  assert.deepEqual(names("Prices rose sharply"), []);
  assert.deepEqual(names("He rose to speak"), []);
  assert.deepEqual(names("Rose called about the deal"), ["Rose Nakamura"]);
  assert.deepEqual(names("Sent it to Rose"), ["Rose Nakamura"]);
});

test("Grant — noun vs person", () => {
  assert.deepEqual(names("We got the grant"), []);
  assert.deepEqual(names("The Grant was approved"), []);
  assert.deepEqual(names("a grant of $50k"), []);
  assert.deepEqual(names("Grant said yes"), ["Grant Whitfield"]);
  assert.deepEqual(names("Looping in Grant"), ["Grant Whitfield"]);
});

test("Mark — noun/verb vs person", () => {
  assert.deepEqual(names("That left a mark"), []);
  assert.deepEqual(names("Mark, Sam and Priya are coming"), ["Mark Ellis", "Priya Raman", "Sam Ortiz"]);
  assert.deepEqual(names("Mark is running late"), ["Mark Ellis"]);
});

// ── the rules that must not regress ─────────────────────────────────────────
test("lower case is never a name", () => {
  assert.deepEqual(names("we should bill them for it"), []);
  assert.deepEqual(names("the will was signed"), []);
});

test("two contacts sharing a first name emit NOTHING — the disambiguation flow's job", () => {
  const twoSams = [...CONTACTS, { id: 99, name: "Sam Whitfield" }];
  assert.deepEqual(names("Sam is in San Francisco", twoSams), []);
  assert.deepEqual(names("with Sam and Priya", twoSams), ["Priya Raman"]);
  // Said in full, it is not ambiguous any more.
  assert.deepEqual(names("Sam Ortiz is in San Francisco", twoSams), ["Sam Ortiz"]);
});

test("a distinctive name needs no context, only capitalisation", () => {
  assert.deepEqual(names("Sagar."), ["Sagar Tiwari"]);
  assert.deepEqual(names("Priya"), ["Priya Raman"]);
});

test("a full name always wins and scores higher", () => {
  const r = fastTagPeople("Met Sagar Tiwari and Will is coming too", CONTACTS);
  assert.equal(r[0].name, "Sagar Tiwari");
  assert.equal(r[0].score, 1);
  assert.equal(r.length, 2);
});

test("the same person mentioned twice is emitted once", () => {
  const r = fastTagPeople("Sagar said Sagar Tiwari would come", CONTACTS);
  assert.equal(r.length, 1);
});

test("possessives, punctuation and parentheses do not hide a name", () => {
  assert.deepEqual(names("Called Priya."), ["Priya Raman"]);
  assert.deepEqual(names("(Priya) and I spoke"), ["Priya Raman"]);
  assert.deepEqual(names("Priya's idea was better"), ["Priya Raman"]);
});

test("a capitalised word that is nobody's name is ignored", () => {
  assert.deepEqual(names("Flying to San Francisco on Tuesday"), []);
});

test("one word used both ways in the same note still resolves to the person", () => {
  // The auxiliary occurrence reads as a word; the second reads as a person. One clear
  // person reading is enough.
  assert.deepEqual(names("Will you ask Will about it?"), ["Will Chen"]);
});

test("adversarial phrasings, checked by hand against real speech", () => {
  // Each of these was run against the implementation and the expectation is what a
  // person would say the answer is — not what the code happened to do.
  assert.deepEqual(names("Will texted me back"), ["Will Chen"]);
  assert.deepEqual(names("Will from Sequoia is in"), ["Will Chen"]);
  assert.deepEqual(names("Met Will yesterday"), ["Will Chen"]);
  assert.deepEqual(names("Ask Will and May to join"), ["May Fischer", "Will Chen"]);
  assert.deepEqual(names("Talked to Art about art"), ["Art Delgado"]);
  assert.deepEqual(names("Sagar and Sam are both in SF for the summer"), ["Sagar Tiwari", "Sam Ortiz"]);
  // and the refusals
  assert.deepEqual(names("I might grant him access"), []);
  assert.deepEqual(names("The art was beautiful"), []);
  assert.deepEqual(names("Hope you are well"), []);
  assert.deepEqual(names("in May we will see"), []);
  assert.deepEqual(names("May we begin?"), []);
  assert.deepEqual(names("Art history class"), []);
});

test("degenerate input never throws", () => {
  for (const [t, c] of [["", CONTACTS], ["hi", []], [null, CONTACTS], ["hi", null], ["hi", [{ id: 9 }]]]) {
    assert.deepEqual(fastTagPeople(t, c), []);
  }
});

test("the result is capped", () => {
  const many = Array.from({ length: 20 }, (_, i) => ({ id: i + 100, name: `Zed${i} Smith` }));
  assert.equal(fastTagPeople(many.map((m) => m.name).join(", "), many, { max: 3 }).length, 3);
});

// ── DUPLICATE ROWS ARE NOT AN AMBIGUITY ──────────────────────────────────────
//
// A real address book has the same person in it twice. Counting rows made every
// duplicated person permanently untaggable: the note said "Sagar", the book had
// two Sagar Tiwari rows, and the pass read that as "which Sagar?" and stayed
// silent. The user's actual book has "Samy" in it twice, which is how this was
// found.
test("the same person entered twice is still one person", () => {
  const one = fastTagPeople("Sagar is starting at Stanford in a few weeks.", [
    { id: 1, name: "Sagar Tiwari" },
  ]);
  const dup = fastTagPeople("Sagar is starting at Stanford in a few weeks.", [
    { id: 1, name: "Sagar Tiwari" },
    { id: 2, name: "Sagar Tiwari" },
  ]);
  assert.deepEqual(
    dup.map((p) => p.name),
    ["Sagar Tiwari"],
    "a duplicated row must not suppress the tag",
  );
  assert.equal(dup.length, one.length, "and must not produce two identical cards");
  // Deterministic pick, so the card does not change identity with row order.
  assert.equal(dup[0].contactId, "1");
});

test("two genuinely different people with one first name still ask", () => {
  const out = fastTagPeople("Sagar is starting at Stanford in a few weeks.", [
    { id: 1, name: "Sagar Tiwari" },
    { id: 2, name: "Sagar Mehta" },
  ]);
  assert.deepEqual(out, [], "a real ambiguity belongs to the disambiguation flow");
});

test("a first-name-only row is not assumed to be the same person", () => {
  // "Sagar" alone might be someone else entirely, so this still counts as two.
  const out = fastTagPeople("Sagar is starting at Stanford in a few weeks.", [
    { id: 1, name: "Sagar Tiwari" },
    { id: 2, name: "Sagar" },
  ]);
  assert.deepEqual(out, []);
});

// ── A HELP DESK IS NOT A DINNER GUEST ────────────────────────────────────────
//
// "Help me plan a dinner in the Bay Area. It has great Indian food" produced a
// contact card for "IT Self service Desk". Nothing inferred anything: the
// sentence contains the capitalised token "It", that contact's first token is
// "IT", and the match is string equality. Two separate guards now stop it — the
// contact is an organisation, and "it" is a pronoun — and either alone is enough.
test("an organisation in the address book never becomes a contact card", () => {
  const book = [
    { id: "1", name: "IT Self service Desk" },
    { id: "2", name: "USC Graduate School" },
    { id: "3", name: "Indian Consulate" },
    { id: "4", name: "Shirley Park" },
  ];
  assert.deepEqual(
    fastTagPeople("Help me plan a dinner in the Bay Area. It has great Indian food", book),
    [],
  );
  // The real person in the same book still tags, including in a sentence that
  // also names the school.
  assert.deepEqual(
    fastTagPeople("Shirley is coming to the Bay Area before she starts at USC", book).map(
      (p) => p.name,
    ),
    ["Shirley Park"],
  );
});

test("a pronoun or determiner is never a name by itself", () => {
  // These words open ordinary sentences constantly. A contact whose first token is
  // one of them would otherwise match on almost every note.
  const book = [
    { id: "1", name: "It Takes Two Bakery" },
    { id: "2", name: "May Lin" },
    { id: "3", name: "Will Hastings" },
  ];
  assert.deepEqual(fastTagPeople("It rained all weekend and I stayed in", book), []);
  assert.deepEqual(fastTagPeople("The plan fell through so we rescheduled", book), []);
  // A distinctive name that merely LOOKS like a word still works, because the
  // context rules own that case and they are unchanged.
  assert.deepEqual(
    fastTagPeople("May said she would send the deck over", book).map((p) => p.name),
    ["May Lin"],
  );
  assert.deepEqual(
    fastTagPeople("Will is starting at Stanford in the fall", book).map((p) => p.name),
    ["Will Hastings"],
  );
});
