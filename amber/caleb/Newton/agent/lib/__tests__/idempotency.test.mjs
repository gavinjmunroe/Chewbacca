/**
 * Tests for the idempotency tracker.
 *
 * Run with:  node --test Newton/agent/lib/__tests__/idempotency.test.mjs
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  markSeen,
  wasSeen,
  clearKey,
  inboundDedupeKey,
} from "../idempotency.js";

test("markSeen: returns true on first, false on duplicate", () => {
  const key = `test-key-${Math.random()}`;
  assert.equal(markSeen(key), true);
  assert.equal(markSeen(key), false);
  assert.equal(wasSeen(key), true);
  clearKey(key);
});

test("markSeen: TTL expiry", async () => {
  const key = `ttl-${Math.random()}`;
  assert.equal(markSeen(key, 5), true);
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(wasSeen(key), false);
  assert.equal(markSeen(key, 5), true);
  clearKey(key);
});

test("markSeen: empty key is a no-op (caller still proceeds)", () => {
  assert.equal(markSeen(""), true);
  assert.equal(markSeen(null), true);
});

test("inboundDedupeKey: prefers message_id when present", () => {
  const k = inboundDedupeKey({ message_id: "abc123" });
  assert.equal(k, "loop:msg:abc123");
});

test("inboundDedupeKey: composite when no message_id", () => {
  const k = inboundDedupeKey({
    sender: "uuid-x",
    contact: "+1555",
    text: "hi",
  });
  assert.match(k, /^loop:composite:uuid-x:\+1555:/);
});

test("inboundDedupeKey: same payload yields same key", () => {
  const a = inboundDedupeKey({ sender: "u", contact: "c", text: "hello" });
  const b = inboundDedupeKey({ sender: "u", contact: "c", text: "hello" });
  assert.equal(a, b);
});

test("inboundDedupeKey: different text yields different key", () => {
  const a = inboundDedupeKey({ sender: "u", contact: "c", text: "hello" });
  const b = inboundDedupeKey({ sender: "u", contact: "c", text: "goodbye" });
  assert.notEqual(a, b);
});
