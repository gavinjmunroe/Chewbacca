/**
 * THE SAME PERSON TWICE, AND NEVER TWO DIFFERENT PEOPLE AS ONE.
 *
 * Run with the rest: npm test
 *
 * "There's multiple Shirley Parks, but one has a tagline that says USC on it.
 *  They were not de-duplicated even though they both have the same name. One
 *  just has a different email, and one has a phone number."
 *
 * The tests that matter most here are the ones that REFUSE. A missed duplicate
 * is a second card in a list. A wrong merge destroys notes the user wrote by
 * hand and cannot get back, and it does it to the one table they are most
 * protective of. So every "leave it alone" case below is load-bearing:
 *
 *   two same-named people tagged differently   -> the user drew that distinction
 *   two same-named people at different firms   -> contradicting evidence
 *   two equally-bare same-named rows           -> no evidence either way
 *   a dismissed pair                           -> asked once, answered, done
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  findDuplicateCandidates,
  normalizePhone,
  normalizeEmail,
  dismissalKey,
} from "./contact-duplicates.js";

let nextId = 1;
const c = (over = {}) => ({
  id: String(nextId++),
  full_name: over.full_name ?? over.first_name ?? null,
  first_name: null,
  last_name: null,
  phone_primary: null,
  phones_all: null,
  emails: null,
  company: null,
  city: null,
  fact_count: 0,
  ...over,
});

const find = (rows, opts) => findDuplicateCandidates(rows, opts);
const keys = (pairs) => pairs.map((p) => `${p.tier}:${p.keep.name}`);

// ── normalization ───────────────────────────────────────────────────────────

test("a phone is compared by its digits, however it was typed", () => {
  for (const p of ["+1 (213) 555-0100", "213-555-0100", "12135550100", "213.555.0100"]) {
    assert.equal(normalizePhone(p), "2135550100", p);
  }
  assert.equal(normalizePhone("555"), null);
  assert.equal(normalizePhone(""), null);
  // An international number is kept whole so it can still match itself.
  assert.equal(normalizePhone("+44 20 7946 0958"), "442079460958");
});

test("an email is compared lowercased, and a non-email is not an email", () => {
  assert.equal(normalizeEmail("  Shirley.Park@USC.edu "), "shirley.park@usc.edu");
  assert.equal(normalizeEmail("not-an-email"), null);
  assert.equal(normalizeEmail(""), null);
});

// ── provable ────────────────────────────────────────────────────────────────

test("the same phone number is one person, whatever the names say", () => {
  // Two cards, two different names, one mobile. One human owns one mobile.
  const rows = [
    c({ full_name: "Shirley Park", first_name: "Shirley", last_name: "Park", phone_primary: "+12135550100" }),
    c({ full_name: "Shirl", first_name: "Shirl", phones_all: "213-555-0100" }),
  ];
  const pairs = find(rows);
  assert.equal(pairs.length, 1);
  assert.equal(pairs[0].tier, "provable");
  assert.match(pairs[0].reason, /same phone/);
});

test("the same email is one person", () => {
  const rows = [
    c({ full_name: "Sagar Patel", first_name: "Sagar", last_name: "Patel", emails: "sagar@x.com" }),
    c({ full_name: "S Patel", first_name: "S", last_name: "Patel", emails: "SAGAR@X.COM" }),
  ];
  const pairs = find(rows);
  assert.equal(pairs.length, 1);
  assert.equal(pairs[0].tier, "provable");
});

// ── the Shirley Park case ───────────────────────────────────────────────────

test("same name, one with only a phone and one with only an email, is the real duplicate", () => {
  // The reported case, and the most common real duplicate there is: one person
  // imported twice, once from the phone and once from an email sync.
  const rows = [
    c({ full_name: "Shirley Park", first_name: "Shirley", last_name: "Park", phone_primary: "+12135550100" }),
    c({ full_name: "Shirley Park", first_name: "Shirley", last_name: "Park", emails: "shirley@usc.edu" }),
  ];
  const pairs = find(rows);
  assert.equal(pairs.length, 1);
  assert.equal(pairs[0].tier, "likely");
  assert.match(pairs[0].reason, /only a phone while the other has only an email/);
});

test("a tagline on one record and not the other is evidence FOR the merge", () => {
  // This reads backwards until you have seen a real address book: a label on the
  // fuller card and none on the barer one is what a partial import looks like. A
  // DISTINGUISHING feature would have to contradict, which is the next test.
  const book = [
    ...Array.from({ length: 5 }, (_, i) => c({ full_name: `Person${i} USC`, first_name: `Person${i} USC` })),
    c({ full_name: "Shirley Park USC", first_name: "Shirley Park USC", phone_primary: "+12135550100" }),
    c({ full_name: "Shirley Park", first_name: "Shirley", last_name: "Park", phone_primary: "+12135550199" }),
  ];
  const pairs = find(book).filter((p) => p.keep.name === "Shirley Park");
  assert.equal(pairs.length, 1, JSON.stringify(keys(find(book))));
  assert.equal(pairs[0].tier, "likely");
  assert.match(pairs[0].reason, /tagged "usc".*no label/i);
});

// ── the refusals. these are the important ones. ─────────────────────────────

test("two same-named people tagged DIFFERENTLY are left alone", () => {
  // The user wrote those labels precisely to tell two people apart. Merging them
  // destroys a distinction they made by hand.
  const book = [
    ...Array.from({ length: 4 }, (_, i) => c({ full_name: `A${i} USC`, first_name: `A${i} USC` })),
    ...Array.from({ length: 4 }, (_, i) => c({ full_name: `B${i} CHASE`, first_name: `B${i} CHASE` })),
    c({ full_name: "Shirley Park USC", first_name: "Shirley Park USC", phone_primary: "+12135550100" }),
    c({ full_name: "Shirley Park CHASE", first_name: "Shirley Park CHASE", emails: "s@chase.com" }),
  ];
  const pairs = find(book).filter((p) => String(p.keep.name).startsWith("Shirley"));
  assert.deepEqual(pairs, [], JSON.stringify(pairs, null, 1));
});

test("two same-named people at different companies are left alone", () => {
  const rows = [
    c({ full_name: "John Smith", first_name: "John", last_name: "Smith", company: "Stripe", phone_primary: "+12135550100" }),
    c({ full_name: "John Smith", first_name: "John", last_name: "Smith", company: "Google", emails: "js@google.com" }),
  ];
  assert.deepEqual(find(rows), []);
});

test("two equally bare same-named rows are left alone", () => {
  // No evidence in either direction. Two Chris Lees with nothing on them is not
  // a duplicate, it is two names.
  const rows = [
    c({ full_name: "Chris Lee", first_name: "Chris", last_name: "Lee" }),
    c({ full_name: "Chris Lee", first_name: "Chris", last_name: "Lee" }),
  ];
  assert.deepEqual(find(rows), []);
});

test("different names with nothing shared are never paired", () => {
  const rows = [
    c({ full_name: "Sagar Patel", first_name: "Sagar", last_name: "Patel", phone_primary: "+12135550100" }),
    c({ full_name: "Karthik Rao", first_name: "Karthik", last_name: "Rao", phone_primary: "+12135550200" }),
    c({ full_name: "Nina Gupta", first_name: "Nina", last_name: "Gupta", emails: "n@x.com" }),
  ];
  assert.deepEqual(find(rows), []);
});

test("a first name in common is NOT a duplicate", () => {
  // Weak tier: never surfaced here. resolveContactByName's soft-confirm handles
  // it at capture time, which is where a question about it belongs.
  const rows = [
    c({ full_name: "Shirley Park", first_name: "Shirley", last_name: "Park", phone_primary: "+12135550100" }),
    c({ full_name: "Shirley Kim", first_name: "Shirley", last_name: "Kim", emails: "sk@x.com" }),
  ];
  assert.deepEqual(find(rows), []);
});

test("a dismissed pair is never asked about again", () => {
  const rows = [
    c({ full_name: "Shirley Park", first_name: "Shirley", last_name: "Park", phone_primary: "+12135550100" }),
    c({ full_name: "Shirley Park", first_name: "Shirley", last_name: "Park", emails: "shirley@usc.edu" }),
  ];
  const first = find(rows);
  assert.equal(first.length, 1);
  const dismissed = new Set([dismissalKey(rows[0].id, rows[1].id)]);
  assert.deepEqual(find(rows, { dismissed }), []);
  // And in the other order, because a pair has no direction.
  const flipped = new Set([dismissalKey(rows[1].id, rows[0].id)]);
  assert.deepEqual(find(rows, { dismissed: flipped }), []);
});

// ── which one survives ──────────────────────────────────────────────────────

test("the record carrying the user's own notes is the one that survives", () => {
  // The thing that cannot be recovered by re-syncing. It outranks channels, age,
  // everything.
  const rows = [
    c({ full_name: "Shirley Park", first_name: "Shirley", last_name: "Park", emails: "s@usc.edu", fact_count: 0 }),
    c({ full_name: "Shirley Park", first_name: "Shirley", last_name: "Park", phone_primary: "+12135550100", fact_count: 7 }),
  ];
  const [pair] = find(rows);
  assert.equal(pair.keepId, rows[1].id);
  assert.equal(pair.keep.facts, 7);
});

test("with no notes on either side, the fuller record survives", () => {
  const rows = [
    c({ full_name: "Shirley Park", first_name: "Shirley", last_name: "Park", emails: "s@usc.edu" }),
    c({
      full_name: "Shirley Park",
      first_name: "Shirley",
      last_name: "Park",
      phone_primary: "+12135550100",
      company: "BTG",
    }),
  ];
  const [pair] = find(rows);
  assert.equal(pair.keepId, rows[1].id);
});

test("a bare stub next to a real record is a duplicate, and the stub is the one dropped", () => {
  const rows = [
    c({ full_name: "Devi Rao", first_name: "Devi", last_name: "Rao" }),
    c({ full_name: "Devi Rao", first_name: "Devi", last_name: "Rao", phone_primary: "+12135550100", fact_count: 2 }),
  ];
  const [pair] = find(rows);
  assert.match(pair.reason, /nothing on it but the name/);
  assert.equal(pair.dropId, rows[0].id);
});

// ── labels are stripped before names are compared ───────────────────────────

test("a label on one card does not make it a different person", () => {
  // "Shirley Park USC BTG" and "Shirley Park" are one name with a label on one
  // of them. Comparing the raw fields says they are two people.
  const book = [
    ...Array.from({ length: 5 }, (_, i) => c({ full_name: `P${i} USC`, first_name: `P${i} USC` })),
    c({ full_name: "Shirley Park USC BTG", first_name: "Shirley Park USC BTG", phone_primary: "+12135550100" }),
    c({ full_name: "Shirley Park", first_name: "Shirley", last_name: "Park", emails: "shirley@usc.edu" }),
  ];
  const pairs = find(book).filter((p) => p.keep.name === "Shirley Park");
  assert.equal(pairs.length, 1);
  assert.equal(pairs[0].keep.name, "Shirley Park");
  assert.equal(pairs[0].drop.name, "Shirley Park");
});

test("a name given in a different word order still matches", () => {
  const rows = [
    c({ full_name: "Park Shirley", first_name: "Park", last_name: "Shirley", phone_primary: "+12135550100" }),
    c({ full_name: "Shirley Park", first_name: "Shirley", last_name: "Park", emails: "s@usc.edu" }),
  ];
  assert.equal(find(rows).length, 1);
});

// ── ordering, scale and safety ──────────────────────────────────────────────

test("provable pairs are offered before likely ones", () => {
  const rows = [
    c({ full_name: "A One", first_name: "A", last_name: "One", phone_primary: "+12135550100" }),
    c({ full_name: "A One", first_name: "A", last_name: "One", emails: "a@x.com" }),
    c({ full_name: "B Two", first_name: "B", last_name: "Two", phone_primary: "+12135550200" }),
    c({ full_name: "Bee Two", first_name: "Bee", last_name: "Two", phones_all: "213-555-0200" }),
  ];
  const tiers = find(rows).map((p) => p.tier);
  assert.equal(tiers[0], "provable");
  assert.ok(tiers.indexOf("likely") > 0);
});

test("a placeholder number shared by hundreds of rows does not explode into pairs", () => {
  // A bucket the size of the address book is a bucket of nothing. Without the
  // cap this is 4,950 pairs from one junk phone number.
  const rows = Array.from({ length: 100 }, (_, i) =>
    c({ full_name: `Person ${i}`, first_name: "Person", last_name: `${i}`, phone_primary: "+10000000000" }),
  );
  const pairs = find(rows);
  assert.equal(pairs.length, 0);
});

test("a large address book stays fast and bounded", () => {
  const rows = [];
  for (let i = 0; i < 4000; i += 1) {
    rows.push(
      c({
        full_name: `Name${i} Last${i}`,
        first_name: `Name${i}`,
        last_name: `Last${i}`,
        phone_primary: `+1213555${String(i).padStart(4, "0")}`,
      }),
    );
  }
  // Twelve genuine duplicates hidden in it.
  for (let i = 0; i < 12; i += 1) {
    rows.push(
      c({ full_name: `Name${i} Last${i}`, first_name: `Name${i}`, last_name: `Last${i}`, emails: `n${i}@x.com` }),
    );
  }
  const t0 = Date.now();
  const pairs = find(rows);
  const ms = Date.now() - t0;
  assert.equal(pairs.length, 12, `found ${pairs.length}`);
  assert.ok(ms < 4000, `took ${ms}ms`);
});

test("junk input is survived", () => {
  assert.deepEqual(find(null), []);
  assert.deepEqual(find([]), []);
  assert.deepEqual(find([c({})]), []);
  assert.deepEqual(find([{ id: null }, { id: null }]), []);
});

// ── a city corroborates a full name, and only a full name ───────────────────
//
// Four pairs in one real 966-contact address book cleared `likely` on nothing
// but a bare first name and a shared city: Hannah, Harrison, Jack, Max. None of
// them were the same person. A first name is the most collided token there is.

test("two people sharing a full name and a city are a candidate", () => {
  const pairs = find([
    c({ full_name: "Shirley Park", first_name: "Shirley", last_name: "Park", city: "New York", phone_primary: "+12135550140" }),
    c({ full_name: "Shirley Park", first_name: "Shirley", last_name: "Park", city: "New York", phone_primary: "+12135550141" }),
  ]);
  assert.deepEqual(keys(pairs), ["likely:Shirley Park"]);
  assert.match(pairs[0].reason, /both in New York/);
});

test("two bare first names in the same city are NOT a candidate", () => {
  const pairs = find([
    c({ full_name: "Hannah", first_name: "Hannah", city: "New York", phone_primary: "+12135550150" }),
    c({ full_name: "Hannah", first_name: "Hannah", city: "New York", phone_primary: "+12135550151" }),
  ]);
  assert.deepEqual(pairs, []);
});

test("a bare first name still clears on a company, which a city cannot do", () => {
  const pairs = find([
    c({ full_name: "Max", first_name: "Max", company: "Foundry Labs", city: "Austin", phone_primary: "+12135550160" }),
    c({ full_name: "Max", first_name: "Max", company: "Foundry Labs", city: "Austin", phone_primary: "+12135550161" }),
  ]);
  assert.deepEqual(keys(pairs), ["likely:Max"]);
  assert.match(pairs[0].reason, /both at Foundry Labs/);
});

test("a bare first name still clears on complementary channels", () => {
  // The strongest `likely` signal there is -- one card reachable only by phone,
  // the other only by email -- is not weakened by the name being one token.
  const pairs = find([
    c({ full_name: "Jack", first_name: "Jack", phone_primary: "+12135550170" }),
    c({ full_name: "Jack", first_name: "Jack", emails: "jack@example.com" }),
  ]);
  assert.deepEqual(keys(pairs), ["likely:Jack"]);
});

test("the token count is taken AFTER labels are stripped", () => {
  // "USC" on five different people is a label, not a surname -- that is how
  // name-split.js earns its dictionary. Once it is stripped, "Harrison USC" is
  // one token, so the shared city must not carry the pair. What DOES carry it
  // is the shared tag, which is the honest reason to show.
  const book = ["Dana", "Priya", "Marcus", "Ines"].map((n) =>
    c({ full_name: `${n} USC`, first_name: n, city: "Chicago", phone_primary: `+1213555${nextId}00` }),
  );
  const pairs = find([
    ...book,
    c({ full_name: "Harrison USC", first_name: "Harrison", city: "Chicago", phone_primary: "+12135550182" }),
    c({ full_name: "Harrison USC", first_name: "Harrison", city: "Chicago", phone_primary: "+12135550183" }),
  ]);
  const harrisons = pairs.filter((p) => p.keep.name.startsWith("Harrison"));
  assert.equal(harrisons.length, 1, JSON.stringify(pairs.map((p) => [p.keep.name, p.reason])));
  assert.match(harrisons[0].reason, /tagged "usc"/);
  assert.doesNotMatch(harrisons[0].reason, /Chicago/);
});
