/**
 * Tests for the content-addressed ingest key. amber-id is expected to
 * upsert vectors by this key so retries don't accumulate duplicate
 * embeddings in Pinecone.
 *
 * Run with:  node --test Newton/agent/lib/__tests__/amber-id-ingest-keys.test.mjs
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { ingestItemKey } from "../amber-id-ingest.js";

test("ingestItemKey: same item -> same key", () => {
  const phone = "+15551234567";
  const item = {
    text: "User: hi\nAmber: hey",
    healthDimension: "social",
    kind: "conversation",
  };
  assert.equal(ingestItemKey(phone, item), ingestItemKey(phone, item));
});

test("ingestItemKey: text change -> key change", () => {
  const phone = "+15551234567";
  const a = ingestItemKey(phone, { text: "hi", healthDimension: "social", kind: "conversation" });
  const b = ingestItemKey(phone, { text: "bye", healthDimension: "social", kind: "conversation" });
  assert.notEqual(a, b);
});

test("ingestItemKey: dimension change -> key change", () => {
  const phone = "+1";
  const base = { text: "x", kind: "conversation" };
  assert.notEqual(
    ingestItemKey(phone, { ...base, healthDimension: "social" }),
    ingestItemKey(phone, { ...base, healthDimension: "physical" }),
  );
});

test("ingestItemKey: phone scope isolates users", () => {
  const item = { text: "x", healthDimension: "social", kind: "conversation" };
  assert.notEqual(ingestItemKey("+1", item), ingestItemKey("+2", item));
});

test("ingestItemKey: source field changes the key", () => {
  const phone = "+1";
  const base = { text: "x", healthDimension: "social", kind: "conversation" };
  const a = ingestItemKey(phone, base);
  const b = ingestItemKey(phone, { ...base, source: "github:repo/file.md#chunk-0" });
  assert.notEqual(a, b);
});

test("ingestItemKey: returns 32-char hex prefix", () => {
  const k = ingestItemKey("+1", { text: "x", healthDimension: "social", kind: "conversation" });
  assert.equal(k.length, 32);
  assert.match(k, /^[0-9a-f]+$/);
});
