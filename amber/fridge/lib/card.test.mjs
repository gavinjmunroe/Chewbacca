/**
 * The card is where somebody decides whether they trust the record, so a wrong
 * claim costs more here than anywhere else in the app.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  factText,
  usableFacts,
  experienceTitle,
  usableExperiences,
  shortDate,
  looksLikeStubEnrichment,
} from "./card.js";

test("a fact's text is read from either name the endpoint uses", () => {
  assert.equal(factText({ text: "Runs marathons" }), "Runs marathons");
  assert.equal(factText({ fact_text: "Has two kids" }), "Has two kids");
  assert.equal(factText({ text: "   " }), null);
  assert.equal(factText({}), null);
});

test("AN UNRESOLVED FACT IS NOT SHOWN", () => {
  // A pending observation has not been attributed to this person. Putting one
  // on their card asserts exactly what the system declined to conclude.
  const facts = [
    { text: "Resolved thing", status: "resolved" },
    { text: "Unattributed thing", status: "pending" },
    { text: "Old row with no status" },
  ];
  assert.deepEqual(usableFacts(facts).map(factText), ["Resolved thing", "Old row with no status"]);
});

test("facts and experiences come back newest first", () => {
  const facts = [
    { text: "old", observed_at: "2024-01-01T00:00:00Z" },
    { text: "new", observed_at: "2026-09-01T00:00:00Z" },
  ];
  assert.deepEqual(usableFacts(facts).map(factText), ["new", "old"]);

  const exp = [
    { title: "old trip", occurred_at: "2024-01-01T00:00:00Z" },
    { title: "recent dinner", starts_at: "2026-09-01T00:00:00Z" },
  ];
  assert.deepEqual(usableExperiences(exp).map(experienceTitle), ["recent dinner", "old trip"]);
});

test("nothing recorded is an empty list, never a crash", () => {
  assert.deepEqual(usableFacts(null), []);
  assert.deepEqual(usableFacts(undefined), []);
  assert.deepEqual(usableExperiences([]), []);
  assert.deepEqual(usableFacts([{ text: "" }, {}]), []);
});

test("a date that is not a date gets no label rather than a guess", () => {
  assert.equal(shortDate(null), null);
  assert.equal(shortDate("not a date"), null);
  assert.ok(String(shortDate("2026-03-15T00:00:00Z")).includes("2026"));
});

// ── the fixture ─────────────────────────────────────────────────────────────

test("THE TEST FIXTURE IS RECOGNIZED ON A REAL CARD", () => {
  // stub-provider.js hands back these three for any name, and they reached
  // real contacts. Two of the three is enough, because a later merge can
  // overwrite one field with something true and leave the other two.
  assert.equal(
    looksLikeStubEnrichment({ title: "Product Manager", company: "Globex", city: "New York" }),
    true,
  );
  assert.equal(looksLikeStubEnrichment({ title: "Product Manager", city: "New York" }), true);
  assert.equal(
    looksLikeStubEnrichment({ title: "Software Engineer", company: "Acme Corp", city: "Chicago" }),
    true,
  );
  assert.equal(looksLikeStubEnrichment({ title: "analyst", company: "kowalski llc" }), true);
});

test("A REAL NEW YORKER IS NOT FLAGGED", () => {
  // He said it in the same breath as the complaint: there ARE people in his
  // book who live in New York. One field matching is a coincidence, not a
  // fixture, and flagging it would call the truth a lie.
  assert.equal(looksLikeStubEnrichment({ city: "New York" }), false);
  assert.equal(looksLikeStubEnrichment({ title: "Product Manager" }), false);
  assert.equal(looksLikeStubEnrichment({ company: "Globex" }), false);
  assert.equal(looksLikeStubEnrichment({ title: "Product Manager", company: "Stripe", city: "Austin" }), false);
  assert.equal(looksLikeStubEnrichment({}), false);
});

test("the match ignores case and padding, since a sync rewrites both", () => {
  assert.equal(
    looksLikeStubEnrichment({ title: "  product manager ", company: "GLOBEX", city: null }),
    true,
  );
});
