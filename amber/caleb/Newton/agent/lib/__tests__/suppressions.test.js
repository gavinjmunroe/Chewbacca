/**
 * Tests for lib/suppressions.js — global "do not DM" list (flaw #95).
 *
 * Covers in-memory state mutations (add / remove / isSuppressed /
 * listSuppressed / filterSuppressed). The write-through to medha-id is
 * fire-and-forget and intentionally not exercised here — the in-memory
 * cache is what protects each send.
 *
 * Run with:
 *   node --test Newton/agent/lib/__tests__/suppressions.test.js
 */

import { test } from "node:test";
import assert from "node:assert/strict";

// Force no medha-id URL so writeThrough is a no-op (no real network).
delete process.env.MEDHA_ID_URL;
delete process.env.AMBER_ID_API_URL;

const {
  addSuppression,
  removeSuppression,
  isSuppressed,
  listSuppressed,
  filterSuppressed,
} = await import("../suppressions.js");

const A = "+15551112222";
const B = "+15553334444";
const C = "+15555556666";

test("addSuppression: marks a handle as suppressed", () => {
  addSuppression(A);
  assert.equal(isSuppressed(A), true);
});

test("addSuppression: is idempotent", () => {
  addSuppression(A);
  addSuppression(A);
  addSuppression(A);
  assert.equal(isSuppressed(A), true);
  assert.equal(listSuppressed().filter((h) => h === A).length, 1);
});

test("removeSuppression: lifts a previously-suppressed handle", () => {
  addSuppression(B);
  assert.equal(isSuppressed(B), true);
  removeSuppression(B);
  assert.equal(isSuppressed(B), false);
});

test("removeSuppression: no-op on never-suppressed handle is safe", () => {
  assert.doesNotThrow(() => removeSuppression(C));
  assert.equal(isSuppressed(C), false);
});

test("listSuppressed: returns the current set as an array", () => {
  // A was added above (and not removed). C never was.
  const list = listSuppressed();
  assert.ok(Array.isArray(list));
  assert.ok(list.includes(A));
  assert.equal(list.includes(C), false);
});

test("filterSuppressed: drops STOPped handles, keeps the rest", () => {
  // A is currently suppressed, C is not. B was removed above.
  const survivors = filterSuppressed([A, B, C]);
  assert.deepEqual(survivors.sort(), [B, C].sort());
});

test("filterSuppressed: handles non-array input gracefully", () => {
  assert.deepEqual(filterSuppressed(null), []);
  assert.deepEqual(filterSuppressed(undefined), []);
  assert.deepEqual(filterSuppressed("not an array"), []);
});

test("isSuppressed: null / empty handle returns false (no false positives)", () => {
  assert.equal(isSuppressed(null), false);
  assert.equal(isSuppressed(""), false);
  assert.equal(isSuppressed(undefined), false);
});
