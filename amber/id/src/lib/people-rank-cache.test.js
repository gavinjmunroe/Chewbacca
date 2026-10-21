/**
 * Tests for the PeopleRank computed-rank cache (items 164 + 155).
 *
 * Run with:  node --test src/lib/people-rank-cache.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  rankCacheKey,
  getCachedRank,
  setCachedRank,
  invalidateRank,
  _clearRankCache,
} from "./people-rank-cache.js";

test("rankCacheKey is stable across weight key order", () => {
  const a = rankCacheKey({
    query: "ceo",
    weights: { warmth: 0.4, recency: 0.25 },
    flags: { relevance: false },
  });
  const b = rankCacheKey({
    query: "CEO",
    weights: { recency: 0.25, warmth: 0.4 },
    flags: { relevance: false },
  });
  assert.equal(a, b); // query is lowercased, weights serialized in fixed order
});

test("different query or weights produce different keys", () => {
  const base = rankCacheKey({ query: "a", weights: { warmth: 1 } });
  assert.notEqual(base, rankCacheKey({ query: "b", weights: { warmth: 1 } }));
  assert.notEqual(base, rankCacheKey({ query: "a", weights: { warmth: 2 } }));
});

test("set then get returns the stored list within TTL", () => {
  _clearRankCache();
  const key = rankCacheKey({ query: "x" });
  const people = [{ contactId: "c1" }];
  setCachedRank("did:1", key, people, { nowMs: 1000 });
  assert.deepEqual(getCachedRank("did:1", key, { nowMs: 1500 }), people);
});

test("entries expire after the TTL", () => {
  _clearRankCache();
  const key = rankCacheKey({ query: "x" });
  setCachedRank("did:1", key, [{ contactId: "c1" }], { nowMs: 0 });
  const hit = getCachedRank("did:1", key, {
    nowMs: 10 * 60 * 1000,
    ttlMs: 60 * 1000,
  });
  assert.equal(hit, null);
});

test("invalidateRank drops every entry for a DID only", () => {
  _clearRankCache();
  const k1 = rankCacheKey({ query: "a" });
  const k2 = rankCacheKey({ query: "b" });
  setCachedRank("did:1", k1, [{ contactId: "x" }], { nowMs: 0 });
  setCachedRank("did:1", k2, [{ contactId: "y" }], { nowMs: 0 });
  setCachedRank("did:2", k1, [{ contactId: "z" }], { nowMs: 0 });
  invalidateRank("did:1");
  assert.equal(getCachedRank("did:1", k1, { nowMs: 1 }), null);
  assert.equal(getCachedRank("did:1", k2, { nowMs: 1 }), null);
  // Other tenants untouched.
  assert.deepEqual(getCachedRank("did:2", k1, { nowMs: 1 }), [
    { contactId: "z" },
  ]);
});

test("a miss returns null without throwing", () => {
  _clearRankCache();
  assert.equal(getCachedRank("nope", "k", { nowMs: 1 }), null);
  assert.equal(getCachedRank(null, "k", { nowMs: 1 }), null);
});
