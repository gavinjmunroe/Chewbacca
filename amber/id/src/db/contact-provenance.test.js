/**
 * A CARD THAT CAN SHOW ITS WORK.
 *
 * The provenance panel is what makes an amalgamated contact trustworthy rather
 * than merely convenient. Three properties decide whether it earns that:
 *
 *   1. it reports what each source ACTUALLY SENT, not the merged result. If
 *      Google called him "Sagar T." and the card settled on "Sagar Tiwari",
 *      the panel still has to say Google called him "Sagar T." -- otherwise it
 *      is the card again, restated, and proves nothing.
 *
 *   2. it NEVER returns identity key material. contact_identity_keys holds
 *      salted hashes of phones and emails; they are how matching works and are
 *      nobody's business on a card.
 *
 *   3. it is stable and total: same card, same order; missing provenance is an
 *      empty panel rather than a thrown error.
 *
 * This tests shapeProvenance, which is every decision worth getting right. The
 * four SELECTs around it cannot be exercised by the in-memory fake, and a test
 * that pretended otherwise would assert against an empty result.
 *
 * Run with:  node --test src/db/contact-provenance.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { shapeProvenance } from "./contact-provenance.js";

const CONTACT = "44444444-4444-4444-4444-444444444444";
const card = (over = {}) => ({
  id: CONTACT,
  full_name: "Sagar Tiwari",
  source: "apple",
  source_tier: 2,
  field_sources: null,
  created_at: new Date("2026-01-01"),
  updated_at: new Date("2026-09-01"),
  ...over,
});

test("WHAT A SOURCE SAID SURVIVES THE MERGE", () => {
  // The card settled on "Sagar Tiwari". Google called him "Sagar T." and that
  // has to still be visible, or the panel is just the card restated.
  const p = shapeProvenance({
    card: card(),
    sourceRows: [
      {
        source: "google",
        external_id: "people/c123",
        raw_full_name: "Sagar T.",
        raw_emails: "sagar@work.com, s.tiwari@gmail.com",
        raw_phones: "+15550001111",
        raw_company: "Rytual",
        created_at: new Date("2026-02-01"),
        updated_at: new Date("2026-08-01"),
      },
    ],
  });
  assert.equal(p.name, "Sagar Tiwari");
  assert.equal(p.sources[0].contributed.name, "Sagar T.");
  assert.deepEqual(p.sources[0].contributed.emails, ["sagar@work.com", "s.tiwari@gmail.com"]);
  assert.deepEqual(p.sources[0].contributed.phones, ["+15550001111"]);
  assert.equal(p.sources[0].contributed.company, "Rytual");
});

test("every source that ever claimed this person is listed, oldest first", () => {
  const p = shapeProvenance({
    card: card(),
    sourceRows: [
      { source: "apple", created_at: new Date("2026-01-02") },
      { source: "google", created_at: new Date("2026-02-02") },
      { source: "clay", created_at: new Date("2026-03-02") },
    ],
  });
  assert.deepEqual(p.sources.map((s) => s.source), ["apple", "google", "clay"]);
});

test("each source carries a trust label a person can read", () => {
  const p = shapeProvenance({
    card: card(),
    sourceRows: [{ source: "manual" }, { source: "apple" }, { source: "clay" }],
  });
  assert.deepEqual(p.sources.map((s) => s.trustLabel), ["you", "your accounts", "enrichment"]);
});

test("an unrecognized source is labeled as the bottom tier, not trusted by default", () => {
  const p = shapeProvenance({
    card: card(),
    sourceRows: [{ source: "some-integration-nobody-registered" }],
  });
  assert.equal(p.sources[0].trust, 0);
  assert.equal(p.sources[0].trustLabel, "enrichment");
});

test("field ownership is reported with a readable trust label", () => {
  const p = shapeProvenance({
    card: card({
      field_sources: { full_name: "manual", company: "clay", phone_primary: "apple" },
    }),
  });
  const byField = Object.fromEntries(p.fields.map((f) => [f.field, f]));
  assert.equal(byField.full_name.trustLabel, "you");
  assert.equal(byField.company.trustLabel, "enrichment");
  assert.equal(byField.phone_primary.trustLabel, "your accounts");
});

test("fields come back in a stable order, so the strip does not reshuffle", () => {
  const p = shapeProvenance({
    card: card({ field_sources: { company: "clay", full_name: "manual", city: "google" } }),
  });
  assert.deepEqual(p.fields.map((f) => f.field), ["city", "company", "full_name"]);
});

test("a null field_sources is an empty panel, not a crash", () => {
  const p = shapeProvenance({ card: card({ field_sources: null }) });
  assert.deepEqual(p.fields, []);
});

test("junk in field_sources is skipped rather than rendered blank", () => {
  const p = shapeProvenance({
    card: card({ field_sources: { company: null, city: "google" } }),
  });
  assert.deepEqual(p.fields.map((f) => f.field), ["city"]);
});

test("NO KEY MATERIAL IS EVER RETURNED, only counts", () => {
  const p = shapeProvenance({
    card: card(),
    keyRows: [
      { key_type: 1, n: 2 },
      { key_type: 2, n: 3 },
      { key_type: 3, n: 1 },
    ],
  });
  assert.deepEqual(p.identityKeys, { phone: 2, email: 3, source: 1 });
  assert.ok(!/key_hash|[0-9a-f]{32}/.test(JSON.stringify(p)), "key material reached the payload");
});

test("no identity keys reads as zero of each, never as missing", () => {
  const p = shapeProvenance({ card: card() });
  assert.deepEqual(p.identityKeys, { phone: 0, email: 0, source: 0 });
});

test("merged duplicates are counted and attributed", () => {
  const p = shapeProvenance({
    card: card(),
    mergeRows: [
      { id: 7, absorbed_ids: ["a", "b"], origin: "auto", rule: "collapse", merged_at: new Date() },
      { id: 8, absorbed_ids: ["c"], origin: "user", rule: null, merged_at: new Date() },
    ],
  });
  assert.equal(p.merges.length, 2);
  assert.equal(p.merges[0].absorbed, 2);
  assert.equal(p.merges[0].origin, "auto");
  assert.equal(p.merges[1].origin, "user");
});

test("the summary names the sources and the duplicates folded in", () => {
  const p = shapeProvenance({
    card: card(),
    sourceRows: [{ source: "apple" }, { source: "google" }, { source: "clay" }],
    mergeRows: [{ id: 1, absorbed_ids: ["a", "b"], merged_at: new Date() }],
  });
  assert.equal(p.summary, "Built from apple, google and clay, with 2 duplicates merged in.");
});

test("one source and no merges reads as a sentence, not a fragment", () => {
  const p = shapeProvenance({ card: card(), sourceRows: [{ source: "apple" }] });
  assert.equal(p.summary, "Built from apple.");
});

test("one duplicate is singular", () => {
  const p = shapeProvenance({
    card: card(),
    sourceRows: [{ source: "apple" }],
    mergeRows: [{ id: 1, absorbed_ids: ["a"], merged_at: new Date() }],
  });
  assert.match(p.summary, /1 duplicate merged in\.$/);
});

test("the same source claiming twice is named once in the summary", () => {
  const p = shapeProvenance({
    card: card(),
    sourceRows: [{ source: "google" }, { source: "google" }],
  });
  assert.equal(p.summary, "Built from google.");
});

test("a card nothing claimed says so honestly", () => {
  const p = shapeProvenance({ card: card() });
  assert.match(p.summary, /No recorded source/);
});

test("the primary tier falls back to the source label when the column is unset", () => {
  const p = shapeProvenance({ card: card({ source: "clay", source_tier: null }) });
  assert.equal(p.primarySource, "clay");
  assert.equal(p.primaryTrust, 0);
});
