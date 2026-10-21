/**
 * A TAGLINE IS NOT A NAME, AND THAT DISTINCTION HAS TO HOLD.
 *
 * Run with the rest: npm test
 *
 * "Do you know anything about any of my contacts?" was answered with "Right now
 * I don't have any contacts or notes in front of me for you" against 1,231
 * contacts. Everything needed to answer it properly was in the contact rows.
 *
 * The bar Karthik set:
 *
 *   "I know that you have this many contacts. I know that 10 of your contacts
 *    have the tag USC on them. I know 50 of them have the area code for LA. I
 *    know 100 of them have the area code for New York, but there is no personal
 *    information on any of them."
 *
 * And the constraint that makes it hard:
 *
 *   "It has to make sure tech is not part of their first name, last name,
 *    nickname, or anything else, but it's actually just a tagline that they gave
 *    them to identify them."
 *
 * So the tests that matter most here are the negative ones. A person called
 * Tesla is not evidence of a tech contact. A surname must never be reported as a
 * tag. Getting that wrong is worse than saying nothing, because it is a
 * confident wrong answer about someone's own address book.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  annotationTokens,
  areaCodeOf,
  metroOf,
  summarizeAddressBook,
  contactsMatchingTopic,
  addressBookBrief,
} from "./address-book.js";
import { buildNameCorpus, splitName } from "./name-split.js";

const card = (full, first, last, extra = {}) => ({
  id: full,
  full_name: full,
  first_name: first,
  last_name: last,
  ...extra,
});

// ── the tagline ─────────────────────────────────────────────────────────────

test("the words around the name are the tagline", () => {
  // The real card from the logs.
  assert.deepEqual(annotationTokens(card("Shirley Park BTG USC", "Shirley", "Park")), [
    "BTG",
    "USC",
  ]);
  // A role word needs no corpus: a plumber appears once in most address books,
  // so waiting for frequency to notice it would never fire.
  assert.deepEqual(annotationTokens(card("Mike Plumber", "Mike", null)), ["Plumber"]);
});

test("a label sitting where a FIRST NAME goes needs the address book to spot it", () => {
  // "Arjun USC Tech Club" -- USC is in position 1, which is name territory, so
  // position and shape alone cannot tell. What settles it is that USC is on ten
  // other cards belonging to ten other people. Nobody has ten relatives called
  // USC.
  const c = card("Arjun USC Tech Club", "Arjun", null);
  const alone = buildNameCorpus([c]);
  const inABook = buildNameCorpus([
    c,
    ...Array.from({ length: 10 }, (_, i) => card(`Person${i} USC`, `Person${i}`, null)),
  ]);

  // On its own, the conservative reading: only the fourth token is a label.
  assert.deepEqual(annotationTokens(c, alone), ["Club"]);
  // In its real book, the whole tail resolves -- and Tech and Club come free off
  // the sticky tail, with no vocabulary entry for either.
  assert.deepEqual(annotationTokens(c, inABook), ["USC", "Tech", "Club"]);
  assert.equal(splitName(c, inABook).name, "Arjun");
});

test("the labels are found even when they are inside the name FIELDS", () => {
  // The case Karthik reported: "a lot of times there's more information in the
  // first and last name fields than what is actually the first and last name.
  // The Shirley Park USC BTG stuff, all of that was in one name field."
  const c = { full_name: "Shirley Park USC BTG", first_name: "Shirley Park USC BTG", last_name: null };
  const book = buildNameCorpus([
    c,
    ...Array.from({ length: 10 }, (_, i) => card(`Person${i} USC`, `Person${i} USC`, null)),
    card("David Park", "David", "Park"),
    card("Grace Park", "Grace", "Park"),
  ]);
  const r = splitName(c, book);
  assert.equal(r.name, "Shirley Park", JSON.stringify(r));
  assert.deepEqual(r.tags, ["USC", "BTG"]);
});

test("a surname shared by a family is still a surname", () => {
  // Park is on three cards, which is what a family looks like, and it sits where
  // a surname sits. Frequency alone would have eaten it.
  const book = buildNameCorpus([
    card("Shirley Park", "Shirley", "Park"),
    card("David Park", "David", "Park"),
    card("Grace Park", "Grace", "Park"),
  ]);
  for (const c of [card("David Park", "David", "Park"), card("Grace Park", "Grace", "Park")]) {
    assert.deepEqual(annotationTokens(c, book), [], c.full_name);
    assert.equal(splitName(c, book).name, c.full_name);
  }
});

test("a joiner does not push a surname into label territory", () => {
  // "Maria de la Cruz" puts Cruz at raw index 3, where the fourth-token rule
  // fires. `de` and `la` are joiners, not name positions.
  const c = card("Maria de la Cruz", "Maria", "Cruz");
  assert.deepEqual(annotationTokens(c), []);
  assert.equal(splitName(c).name, "Maria de la Cruz");
});

test("a plain name has no tagline", () => {
  for (const c of [
    card("Sagar Patel", "Sagar", "Patel"),
    card("Karthik", "Karthik", null),
    card("Mary Jane Watson", "Mary Jane", "Watson"),
  ]) {
    assert.deepEqual(annotationTokens(c), [], c.full_name);
  }
});

test("a surname is NEVER reported as a tagline", () => {
  // The failure this whole module has to avoid. Somebody called Tesla, Apple or
  // Tech is a person, not a signal.
  for (const c of [
    card("Elon Tesla", "Elon", "Tesla"),
    card("Ravi Tech", "Ravi", "Tech"),
    card("Anna Apple", "Anna", "Apple"),
  ]) {
    assert.deepEqual(annotationTokens(c), [], c.full_name);
  }
});

test("a nickname is part of the name, not a tagline", () => {
  assert.deepEqual(
    annotationTokens(card("Robert Bobby Smith USC", "Robert", "Smith", { nickname: "Bobby" })),
    ["USC"],
  );
});

test("with no name parts on the card, the first two tokens are treated as the name", () => {
  // Conservative on purpose: the cost is dropping a word that might have been a
  // tagline, never inventing a tagline out of a surname.
  assert.deepEqual(annotationTokens({ full_name: "Shirley Park BTG USC" }), ["BTG", "USC"]);
  assert.deepEqual(annotationTokens({ full_name: "Sagar Patel" }), []);
  assert.deepEqual(annotationTokens({ full_name: "Karthik" }), []);
});

test("name furniture and phone-book debris are not taglines", () => {
  assert.deepEqual(annotationTokens(card("John Smith Jr", "John", "Smith")), []);
  assert.deepEqual(annotationTokens(card("Maria de la Cruz", "Maria", "Cruz")), []);
  assert.deepEqual(annotationTokens(card("Dave iPhone", "Dave", null)), []);
  assert.deepEqual(annotationTokens(card("Sam old number", "Sam", null)), []);
  assert.deepEqual(annotationTokens(card("Priya 2", "Priya", null)), []);
});

test("a repeated word is not eaten twice", () => {
  // "Park Park" is a real name shape, and a tagline that repeats a name word
  // must survive.
  assert.deepEqual(annotationTokens(card("Park Park USC", "Park", "Park")), ["USC"]);
});

test("punctuation around a tagline does not hide it", () => {
  assert.deepEqual(annotationTokens(card("Shirley Park (BTG/USC)", "Shirley", "Park")), [
    "BTG",
    "USC",
  ]);
});

test("junk input is survived", () => {
  assert.deepEqual(annotationTokens(null), []);
  assert.deepEqual(annotationTokens({}), []);
  assert.deepEqual(annotationTokens({ full_name: "   " }), []);
});

// ── area codes ──────────────────────────────────────────────────────────────

test("an area code is read from the shapes a real address book holds", () => {
  for (const p of ["+1 (213) 555-0100", "213-555-0100", "12135550100", "213.555.0100"]) {
    assert.equal(areaCodeOf(p), "213", p);
  }
  assert.equal(metroOf("+12135550100"), "Los Angeles");
  assert.equal(metroOf("+16465550100"), "New York");
  assert.equal(metroOf("+14155550100"), "San Francisco Bay Area");
});

test("a number that is not North American gets no area code rather than a wrong one", () => {
  // "50 contacts in Ohio" being wrong is worse than not saying it.
  for (const p of ["+44 20 7946 0958", "+91 98765 43210", "555", "", null, "011234"]) {
    assert.equal(areaCodeOf(p), null, String(p));
  }
  // Valid ten digits, but an area code the table does not cover: a code, no metro.
  assert.equal(areaCodeOf("+13155550100"), "315");
  assert.equal(metroOf("+13155550100"), null);
});

test("service codes are not area codes", () => {
  assert.equal(areaCodeOf("9115550100"), null);
  assert.equal(areaCodeOf("0135550100"), null);
  assert.equal(areaCodeOf("1135550100"), null);
});

// ── the summary ─────────────────────────────────────────────────────────────

const BOOK = [
  card("Shirley Park BTG USC", "Shirley", "Park", { phone_primary: "+12135550001" }),
  card("Arjun USC Tech Club", "Arjun", null, { phone_primary: "+13105550002" }),
  card("Nina USC", "Nina", null, { phone_primary: "+16465550003" }),
  card("Sagar Patel", "Sagar", "Patel", { phone_primary: "+16465550004", company: "Stripe" }),
  card("Devi Rao", "Devi", "Rao", { phone_primary: "+19175550005", company: "Stripe" }),
  card("Elon Tesla", "Elon", "Tesla", { phone_primary: "+14155550006" }),
];

test("the summary is the answer he asked for", () => {
  const s = summarizeAddressBook(BOOK);
  assert.equal(s.total, 6);
  // USC is on three cards, so it is a tag the user actually uses.
  const usc = s.tags.find((t) => t.label.toUpperCase() === "USC");
  assert.ok(usc, `USC missing from ${JSON.stringify(s.tags)}`);
  assert.equal(usc.count, 3);
  // BTG is on one card: a detail about Shirley, not a tag across the book.
  assert.ok(!s.tags.some((t) => t.label.toUpperCase() === "BTG"));
  // Tesla is a surname and must not appear at all.
  assert.ok(!s.tags.some((t) => /tesla/i.test(t.label)));

  const la = s.metros.find((m) => m.label === "Los Angeles");
  const ny = s.metros.find((m) => m.label === "New York");
  assert.equal(la.count, 2);
  assert.equal(ny.count, 3);

  assert.deepEqual(s.companies.map((c) => c.label), ["Stripe"]);
  assert.equal(s.companies[0].count, 2);
});

test("the summary says when there is no personal information at all", () => {
  const s = summarizeAddressBook(BOOK, { factCounts: {} });
  assert.equal(s.withFacts, 0);
  const brief = addressBookBrief(s);
  assert.ok(/NO saved notes or personal facts/i.test(brief));
  assert.ok(/offer to start adding/i.test(brief));
});

test("an empty book produces no brief rather than a claim about nothing", () => {
  assert.equal(addressBookBrief(summarizeAddressBook([])), "");
  assert.equal(addressBookBrief(null), "");
});

test("the brief carries the counts and the never-say instruction", () => {
  const brief = addressBookBrief(summarizeAddressBook(BOOK, { factCounts: {} }));
  assert.ok(brief.includes("6 contacts"));
  assert.ok(/3 tagged "USC"/.test(brief), brief);
  assert.ok(/2 in Los Angeles/.test(brief));
  assert.ok(/NEVER say you have no contacts/i.test(brief));
});

// ── the topic question ──────────────────────────────────────────────────────

test("a topic matches a tagline, a company and a title — never a name", () => {
  const hits = contactsMatchingTopic(BOOK, ["tech", "technology", "software"]);
  // The CLEAN name, not the raw field. "Arjun USC Tech Club" is what is typed on
  // the card; Arjun is who it is.
  assert.deepEqual(hits.map((h) => h.name), ["Arjun"]);
  assert.equal(hits[0].where, "tagline");
  // Elon Tesla is not a tech contact on the strength of his surname.
  assert.ok(!hits.some((h) => /Tesla/.test(h.name ?? "")));
});

test("a topic matching a company reports the company as the reason", () => {
  const hits = contactsMatchingTopic(BOOK, ["stripe"]);
  assert.deepEqual(hits.map((h) => h.name).sort(), ["Devi Rao", "Sagar Patel"]);
  assert.equal(hits[0].where, "company");
});

test("matching is whole-token, so a topic cannot match inside a longer word", () => {
  // Aiden is not an AI contact and Ravi Techachapi is not a tech contact. Both
  // of those are surnames and first names that merely CONTAIN a topic word, and
  // a substring match would report each of them confidently.
  const rows = [
    card("Aiden Brooks", "Aiden", "Brooks"),
    card("Ravi Techachapi", "Ravi", "Techachapi"),
    card("Techla Nordstrom", "Techla", "Nordstrom"),
    // A real one, with a company field so it needs no corpus support.
    { ...card("Devi Rao", "Devi", "Rao"), company: "Tech Co" },
  ];
  const hits = contactsMatchingTopic(rows, ["ai", "tech"]);
  assert.deepEqual(hits.map((h) => h.name), ["Devi Rao"]);
  assert.equal(hits[0].where, "company");
});

test("a label with no support in the address book stays a name, on purpose", () => {
  // "Lena AI Lab" in a three-card book: AI appears once, so there is no evidence
  // it is a label rather than part of her name. This is the conservative
  // direction and it is the right one -- a word wrongly kept in a name is
  // invisible, and a surname wrongly reported as a tag is Amber being
  // confidently wrong about someone's own address book.
  const alone = [card("Lena AI Lab", "Lena", null)];
  assert.deepEqual(annotationTokens(alone[0], buildNameCorpus(alone)), []);

  // Give it a book where AI is plainly a label, and it resolves.
  const book = [
    ...alone,
    card("Bo AI", "Bo", null),
    card("Cara AI", "Cara", null),
    card("Dev AI", "Dev", null),
  ];
  assert.deepEqual(annotationTokens(alone[0], buildNameCorpus(book)), ["AI", "Lab"]);
});

test("an empty topic matches nothing rather than everything", () => {
  assert.deepEqual(contactsMatchingTopic(BOOK, []), []);
  assert.deepEqual(contactsMatchingTopic(BOOK, [""]), []);
  assert.deepEqual(contactsMatchingTopic(BOOK, ["a"]), []);
});

test("no topic match says the contacts carry no such label, not that we cannot see them", () => {
  const brief = addressBookBrief(summarizeAddressBook(BOOK, { factCounts: {} }), {
    topic: "medicine",
    topicHits: [],
  });
  assert.ok(/carry no such label/i.test(brief), brief);
  assert.ok(/Nothing in any contact's tagline, company or title/i.test(brief));
});

test("a topic match is named person by person, with the reason", () => {
  const hits = contactsMatchingTopic(BOOK, ["tech"]);
  const brief = addressBookBrief(summarizeAddressBook(BOOK), { topic: "tech", topicHits: hits });
  assert.ok(brief.includes("Arjun"));
  assert.ok(/tagline: Tech/.test(brief), brief);
});

test("a large book is summarized without the brief growing without bound", () => {
  const many = [];
  for (let i = 0; i < 1500; i += 1) {
    many.push(
      card(`Person${i} Last${i} USC Tag${i % 40}`, `Person${i}`, `Last${i}`, {
        phone_primary: `+1213555${String(i).padStart(4, "0")}`,
        company: `Company${i % 30}`,
      }),
    );
  }
  const s = summarizeAddressBook(many);
  assert.equal(s.total, 1500);
  assert.ok(s.tags.length <= 8);
  assert.ok(s.metros.length <= 5);
  assert.ok(s.companies.length <= 8);
  assert.ok(addressBookBrief(s).length < 3000);
});
