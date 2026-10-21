/**
 * Tests for the iMessage interaction normalization helpers.
 *
 * Run with:  node --test src/lib/imessage.test.js
 *
 * These exercise the pure-function layer that backs /ingest/imessage —
 * dedupe-key derivation, structural validation, and the artifact split
 * between the Pinecone item and the Firestore audit row. We deliberately
 * keep these tests off the network so CI runs fast and deterministically.
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  deriveDedupeKey,
  validateInteraction,
  buildIngestArtifacts,
  SUPPORTED_CHANNELS,
  SUPPORTED_DIRECTIONS,
  SUPPORTED_ROLES,
} from "./imessage.js";

const baseItem = () => ({
  source_channel: "imessage",
  direction: "outbound",
  speaker_role: "user",
  message_id: "photon:msg-12345",
  thread_id: "thread:abc",
  participant: { contact_id: "contact:dev", display_name: "Dev" },
  occurred_at: "2026-04-27T15:00:00Z",
  raw_text: "yo",
  normalized_text: "yo",
  health_dimension: "social",
  consent: { redacted: true, store_raw: false, privacy_tier: "private" },
});

test("supported enums are non-empty and frozen", () => {
  assert.ok(SUPPORTED_CHANNELS.length > 0);
  assert.ok(SUPPORTED_DIRECTIONS.length > 0);
  assert.ok(SUPPORTED_ROLES.length > 0);
  assert.throws(() => SUPPORTED_CHANNELS.push("foo"));
});

test("deriveDedupeKey prefers caller-supplied dedupe_key", () => {
  const item = { ...baseItem(), dedupe_key: "caller-supplied-key" };
  assert.equal(deriveDedupeKey(item), "caller-supplied-key");
});

test("deriveDedupeKey is deterministic on channel+message_id+role", () => {
  const a = deriveDedupeKey(baseItem());
  const b = deriveDedupeKey(baseItem());
  assert.equal(a, b);
  assert.equal(typeof a, "string");
  assert.equal(a.length, 32);
});

test("deriveDedupeKey changes when message_id changes", () => {
  const a = deriveDedupeKey(baseItem());
  const b = deriveDedupeKey({ ...baseItem(), message_id: "photon:other" });
  assert.notEqual(a, b);
});

test("deriveDedupeKey changes with speaker_role", () => {
  const a = deriveDedupeKey(baseItem());
  const b = deriveDedupeKey({ ...baseItem(), speaker_role: "contact" });
  assert.notEqual(a, b);
});

test("deriveDedupeKey falls back when message_id is missing", () => {
  const item = { ...baseItem(), message_id: undefined };
  const key = deriveDedupeKey(item);
  assert.equal(typeof key, "string");
  assert.equal(key.length, 32);
});

test("validateInteraction passes a well-formed item", () => {
  assert.deepEqual(validateInteraction(baseItem()), []);
});

test("validateInteraction rejects unknown channel", () => {
  const errs = validateInteraction({ ...baseItem(), source_channel: "telegram" });
  assert.ok(errs.some((e) => e.includes("source_channel")));
});

test("validateInteraction rejects unknown direction and role", () => {
  const errs1 = validateInteraction({ ...baseItem(), direction: "sideways" });
  assert.ok(errs1.some((e) => e.includes("direction")));
  const errs2 = validateInteraction({ ...baseItem(), speaker_role: "ghost" });
  assert.ok(errs2.some((e) => e.includes("speaker_role")));
});

test("validateInteraction requires non-empty text", () => {
  const errs = validateInteraction({
    ...baseItem(),
    raw_text: "",
    normalized_text: "",
  });
  assert.ok(errs.some((e) => e.toLowerCase().includes("text")));
});

test("validateInteraction requires health_dimension", () => {
  const item = baseItem();
  delete item.health_dimension;
  const errs = validateInteraction(item);
  assert.ok(errs.some((e) => e.includes("health_dimension")));
});

test("validateInteraction rejects malformed occurred_at", () => {
  const errs = validateInteraction({ ...baseItem(), occurred_at: "yesterday" });
  assert.ok(errs.some((e) => e.includes("occurred_at")));
});

test("validateInteraction requires participant identifier when participant present", () => {
  const errs = validateInteraction({
    ...baseItem(),
    participant: { display_name: "Anon" },
  });
  assert.ok(
    errs.some((e) => e.includes("contact_id") || e.includes("phone_hash")),
  );
});

test("buildIngestArtifacts attaches dedupe_key to the Pinecone item id", () => {
  const { dedupeKey, pineconeItem } = buildIngestArtifacts(baseItem());
  assert.equal(pineconeItem.id, dedupeKey);
  assert.equal(pineconeItem.kind, "imessage_interaction");
  assert.equal(pineconeItem.source, "imessage");
  assert.equal(pineconeItem.healthDimension, "social");
  assert.equal(pineconeItem.personId, "contact:dev");
  assert.equal(pineconeItem.text, "yo");
});

test("buildIngestArtifacts: extra carries channel/direction/role/dedupe", () => {
  const { dedupeKey, pineconeItem } = buildIngestArtifacts(baseItem());
  assert.equal(pineconeItem.extra.source_channel, "imessage");
  assert.equal(pineconeItem.extra.direction, "outbound");
  assert.equal(pineconeItem.extra.speaker_role, "user");
  assert.equal(pineconeItem.extra.dedupe_key, dedupeKey);
});

test("buildIngestArtifacts: privacy_tier defaults to private when invalid", () => {
  const { pineconeItem } = buildIngestArtifacts({
    ...baseItem(),
    consent: { privacy_tier: "world" },
  });
  assert.equal(pineconeItem.visibility, "private");
});

test("buildIngestArtifacts: drops raw_text from audit row by default", () => {
  const { auditRow } = buildIngestArtifacts(baseItem());
  assert.equal(auditRow.raw_text, null);
  assert.equal(auditRow.normalized_text, "yo");
});

test("buildIngestArtifacts: keeps raw_text when consent.store_raw is true", () => {
  const { auditRow } = buildIngestArtifacts({
    ...baseItem(),
    raw_text: "raw original",
    consent: { store_raw: true },
  });
  assert.equal(auditRow.raw_text, "raw original");
  assert.equal(auditRow.consent.store_raw, true);
});

test("buildIngestArtifacts: respects shared_with_contact privacy_tier", () => {
  const { pineconeItem, auditRow } = buildIngestArtifacts({
    ...baseItem(),
    consent: { privacy_tier: "shared_with_contact" },
  });
  assert.equal(pineconeItem.visibility, "shared_with_contact");
  assert.equal(auditRow.consent.privacy_tier, "shared_with_contact");
});

test("buildIngestArtifacts: passes style_signals into Pinecone extra and audit row", () => {
  const styles = { register: "casual", warmth: 0.8 };
  const { pineconeItem, auditRow } = buildIngestArtifacts({
    ...baseItem(),
    style_signals: styles,
  });
  assert.deepEqual(pineconeItem.extra.style_signals, styles);
  assert.deepEqual(auditRow.style_signals, styles);
});

test("buildIngestArtifacts: same input → same dedupe key (idempotent)", () => {
  const a = buildIngestArtifacts(baseItem());
  const b = buildIngestArtifacts(baseItem());
  assert.equal(a.dedupeKey, b.dedupeKey);
});
