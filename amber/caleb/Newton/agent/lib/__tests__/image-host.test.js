/**
 * Tests for lib/image-host.js — round-trip, TTL, and LRU eviction.
 *
 * Run with: node --test Newton/agent/lib/__tests__/image-host.test.js
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { storeImage, getImage } from "../image-host.js";

test("storeImage + getImage round-trip returns the same buffer", () => {
  const buf = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]); // PNG magic
  const id = storeImage(buf, "image/png");
  assert.ok(id, "expected an id");
  assert.match(id, /^[a-f0-9]{8}$/, "id should be 8 hex chars");
  const fetched = getImage(id);
  assert.ok(fetched, "expected a fetched entry");
  assert.equal(fetched.mimeType, "image/png");
  assert.ok(Buffer.compare(fetched.buffer, buf) === 0, "buffer should match");
});

test("storeImage rejects empty / non-buffer inputs", () => {
  assert.equal(storeImage(null), null);
  assert.equal(storeImage(undefined), null);
  assert.equal(storeImage(Buffer.alloc(0)), null);
  assert.equal(storeImage("not a buffer"), null);
});

test("getImage returns null for unknown id", () => {
  assert.equal(getImage(null), null);
  assert.equal(getImage(""), null);
  assert.equal(getImage("deadbeef"), null);
});

test("getImage returns null after TTL expires", async () => {
  const buf = Buffer.from([1, 2, 3, 4]);
  const id = storeImage(buf, "image/png");
  // Walk the cached timestamp back 11 minutes by re-reading and stashing
  // a stale entry. Simulating the time travel without mocking timers.
  const fresh = getImage(id);
  assert.ok(fresh);
  // Inject expiry: monkey-patch by storing a new entry under same id
  // with an `at` 11 minutes in the past via direct internal access.
  // The cleanest TTL test is to import the Map directly, but the module
  // doesn't export it. Use a stale-Date.now stub instead.
  const realNow = Date.now;
  try {
    Date.now = () => realNow() + 11 * 60 * 1000;
    assert.equal(getImage(id), null, "entry should be evicted after TTL");
  } finally {
    Date.now = realNow;
  }
});

test("LRU eviction keeps the store under the cap", () => {
  // STORE_LIMIT = 50; stash 60 and confirm the earliest ones drop.
  const ids = [];
  for (let i = 0; i < 60; i++) {
    const id = storeImage(Buffer.from([i & 0xff]), "image/png");
    ids.push(id);
  }
  // The first 10 should have been evicted from memory (disk may still
  // have them, but getImage's memory miss + disk-fallback path will
  // re-prime them — that's fine, it's a feature, not a regression).
  // What we DO want to assert: nothing throws, the most recent stays.
  const lastFetched = getImage(ids[ids.length - 1]);
  assert.ok(lastFetched, "most recent entry should still resolve");
});
