/**
 * WHAT A SEARCH BOX HAS TO GET RIGHT, in the order people notice when it does
 * not:
 *
 *   the person you meant is first       -- not the person whose name sorts first
 *   a company match never beats a name  -- "park" is Shirley Park, not Parkside
 *   a typo still finds them             -- "Tieari" is Tiwari
 *   digits mean a phone number          -- and match nothing else
 *   two words mean BOTH words           -- not everyone matching either one
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  prepareForSearch,
  searchContacts,
  matchRow,
  strengthOf,
  looksLikePhone,
  TIER,
} from "./contact-search.js";

const DAY = 86_400_000;
const agoIso = (d) => new Date(Date.now() - d * DAY).toISOString();

let nextId = 1;
const c = (over = {}) => ({ id: String(nextId++), full_name: null, ...over });
const book = (...rows) => rows.map(prepareForSearch);
const names = (hits) => hits.map((h) => h.name);

// ── query shape ─────────────────────────────────────────────────────────────

test("digits are a phone number and words are not", () => {
  assert.equal(looksLikePhone("630"), true);
  assert.equal(looksLikePhone("+1 (555) 010-0001"), true);
  assert.equal(looksLikePhone("630-815"), true);
  assert.equal(looksLikePhone("sagar"), false);
  assert.equal(looksLikePhone("a1"), false);
  assert.equal(looksLikePhone(""), false);
});

// ── the thing that was actually broken ──────────────────────────────────────

test("the person you are in touch with outranks the one who sorts first", () => {
  // Both are equally good name matches. The old ranking put Aaron first
  // forever, because A. The rollup already knows which of these two the user
  // has spoken to this week.
  const hits = searchContacts(
    book(
      c({ full_name: "Aaron Sandoval", last_interaction_at: null, count_90d: 0 }),
      c({ full_name: "Sagar Tiwari", last_interaction_at: agoIso(1), count_90d: 30 }),
      c({ full_name: "Samir Shah", last_interaction_at: agoIso(400), count_90d: 0 }),
    ),
    "sa",
  );
  assert.equal(names(hits)[0], "Sagar Tiwari", JSON.stringify(names(hits)));
});

test("a name match ALWAYS beats a company match, however cold the contact", () => {
  const hits = searchContacts(
    book(
      c({ full_name: "Dana Rivera", company: "Parkside Capital", last_interaction_at: agoIso(0), count_90d: 90 }),
      c({ full_name: "Shirley Park", company: null, last_interaction_at: null, count_90d: 0 }),
    ),
    "park",
  );
  assert.deepEqual(names(hits), ["Shirley Park", "Dana Rivera"]);
  assert.equal(hits[0].tier, TIER.NAME_PREFIX);
  assert.equal(hits[1].tier, TIER.ATTRIBUTE);
});

test("an exact name beats a prefix of a longer one", () => {
  const hits = searchContacts(book(c({ full_name: "Samantha Rodriguez" }), c({ full_name: "Sam" })), "sam");
  assert.deepEqual(names(hits), ["Sam", "Samantha Rodriguez"]);
});

// ── fields that were invisible before ───────────────────────────────────────

test("a company, a city and a title are all searchable", () => {
  const b = book(
    c({ full_name: "Dana Rivera", company: "Rytual" }),
    c({ full_name: "Priya Nair", city: "Austin" }),
    c({ full_name: "Marcus Lee", title: "Technical Recruiter" }),
  );
  assert.deepEqual(names(searchContacts(b, "rytual")), ["Dana Rivera"]);
  assert.deepEqual(names(searchContacts(b, "austin")), ["Priya Nair"]);
  assert.deepEqual(names(searchContacts(b, "recruiter")), ["Marcus Lee"]);
});

test("two words mean both words, not either", () => {
  const b = book(
    c({ full_name: "Dana Rivera", company: "Rytual", city: "Austin" }),
    c({ full_name: "Priya Nair", company: "Foundry", city: "Austin" }),
  );
  assert.deepEqual(names(searchContacts(b, "rytual austin")), ["Dana Rivera"]);
  assert.deepEqual(names(searchContacts(b, "foundry rytual")), []);
});

test("an email address finds its owner and nobody else", () => {
  const b = book(
    c({ full_name: "Sagar Tiwari", emails: "sagar@rytual.com" }),
    c({ full_name: "Sagar Mehta", emails: "s.mehta@other.com" }),
  );
  assert.deepEqual(names(searchContacts(b, "sagar@rytual.com")), ["Sagar Tiwari"]);
  // An @ query that matches no address matches NOTHING -- it does not then get
  // tried against names, which would make both Sagars come back.
  assert.deepEqual(searchContacts(b, "nobody@nowhere.com"), []);
});

test("a name typed as one word finds the email local part", () => {
  const b = book(c({ full_name: "Shirley Park", emails: "shirley.park@usc.edu" }));
  assert.deepEqual(names(searchContacts(b, "shirleypark")), ["Shirley Park"]);
});

// ── phones ──────────────────────────────────────────────────────────────────

test("a phone number finds the card, typed however", () => {
  const b = book(c({ full_name: "Sagar Tiwari", phone_primary: "+1 (555) 010-0001" }));
  for (const q of ["5550100001", "555-010-0001", "+15550100001", "8159796"]) {
    assert.deepEqual(names(searchContacts(b, q)), ["Sagar Tiwari"], q);
  }
});

test("a digits query never falls through to names", () => {
  // "630" must not fuzzy-match a person. A precise query returning noise is
  // worse than a precise query returning nothing.
  const b = book(c({ full_name: "Sagar Tiwari", phone_primary: "+12135550100" }));
  assert.deepEqual(searchContacts(b, "630"), []);
});

// ── spelling ────────────────────────────────────────────────────────────────

test("a misspelled name still finds the person", () => {
  const b = book(c({ full_name: "Sagar Tiwari" }), c({ full_name: "Dana Rivera" }));
  const hits = searchContacts(b, "sagar tieari");
  assert.deepEqual(names(hits), ["Sagar Tiwari"]);
  assert.equal(hits[0].tier, TIER.FUZZY_NAME);
});

test("a wrong name is still a wrong name", () => {
  const b = book(c({ full_name: "Sagar Tiwari" }));
  assert.deepEqual(searchContacts(b, "gregory abernathy"), []);
});

// ── strength ────────────────────────────────────────────────────────────────

test("strength is recency first, and absent history is zero not negative", () => {
  const fresh = strengthOf({ last_interaction_at: agoIso(0), count_90d: 20 });
  const stale = strengthOf({ last_interaction_at: agoIso(400), count_90d: 40 });
  const none = strengthOf({});
  assert.ok(fresh > stale, `${fresh} vs ${stale}`);
  assert.equal(none, 0);
  assert.ok(fresh <= 1 && stale >= 0);
  // A favorite with no history still outranks a stranger with no history.
  assert.ok(strengthOf({ is_favorite: true }) > none);
});

test("strength cannot promote a worse match across a tier", () => {
  // The most-contacted person in the book, matching only on their city, still
  // loses to a cold contact whose NAME matches. This is the invariant the
  // whole comparator exists to protect.
  const hits = searchContacts(
    book(
      c({ full_name: "Most Contacted", city: "Park City", last_interaction_at: agoIso(0), count_90d: 500, is_favorite: true }),
      c({ full_name: "Park Unknown", last_interaction_at: null }),
    ),
    "park",
  );
  assert.equal(names(hits)[0], "Park Unknown");
});

// ── the shape of the answer ─────────────────────────────────────────────────

test("a hit says what it matched on", () => {
  const b = book(c({ full_name: "Dana Rivera", company: "Rytual" }));
  assert.equal(searchContacts(b, "dana")[0].matchedOn, "name");
  assert.equal(searchContacts(b, "rytual")[0].matchedOn, "details");
});

test("the limit is honored and junk is survived", () => {
  const rows = Array.from({ length: 50 }, (_, i) => c({ full_name: `Person ${i}` }));
  assert.equal(searchContacts(book(...rows), "person", { limit: 5 }).length, 5);
  assert.deepEqual(searchContacts([], "x"), []);
  assert.deepEqual(searchContacts(null, "x"), []);
  assert.deepEqual(searchContacts(book(c({})), "x"), []);
  assert.deepEqual(searchContacts(book(c({ full_name: "A" })), "   "), []);
  assert.equal(matchRow(prepareForSearch(c({ full_name: "A" })), ""), null);
});

test("a card with no full_name is found by its first and last name", () => {
  const b = book(c({ full_name: null, first_name: "Kshitij", last_name: "Bhardwaj" }));
  assert.deepEqual(names(searchContacts(b, "kshitij")), ["Kshitij Bhardwaj"]);
});
