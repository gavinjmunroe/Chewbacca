/**
 * The rules this cache has to keep, because it sits on the critical path of
 * every people question and holds contact data.
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  getPreparedInput,
  setPreparedInput,
  invalidatePreparedInput,
  _clearPreparedInputCache,
} from "./people-rank-prep-cache.js";

const PREP = { contacts: [{ id: "c1", name: "Mei" }], me: { displayName: "K" } };

test("a second question in the same minute is served from the cache", () => {
  _clearPreparedInputCache();
  setPreparedInput("owner:a", PREP);
  assert.deepEqual(getPreparedInput("owner:a"), PREP);
});

test("it expires, so a stale address book cannot outlive the TTL", () => {
  _clearPreparedInputCache();
  const t0 = 1_000_000;
  setPreparedInput("owner:a", PREP, { nowMs: t0 });
  assert.ok(getPreparedInput("owner:a", { nowMs: t0 + 59_000 }));
  assert.equal(getPreparedInput("owner:a", { nowMs: t0 + 61_000 }), null);
});

test("a capture drops it — the next question is usually about what was just said", () => {
  _clearPreparedInputCache();
  setPreparedInput("owner:a", PREP);
  invalidatePreparedInput("owner:a");
  assert.equal(getPreparedInput("owner:a"), null);
});

test("one owner's entry is never served to another", () => {
  _clearPreparedInputCache();
  setPreparedInput("owner:a", PREP);
  assert.equal(getPreparedInput("owner:b"), null);
  // And an absent key never reads the map at all.
  assert.equal(getPreparedInput(null), null);
  assert.equal(getPreparedInput(""), null);
});

test("it is bounded: a busy fleet evicts the oldest owner rather than growing", () => {
  _clearPreparedInputCache();
  const max = Number(process.env.PEOPLERANK_PREP_CACHE_MAX || 200);
  for (let i = 0; i < max + 5; i += 1) setPreparedInput(`owner:${i}`, PREP);
  // The first writes are gone; the last are held.
  assert.equal(getPreparedInput("owner:0"), null);
  assert.ok(getPreparedInput(`owner:${max + 4}`));
});
