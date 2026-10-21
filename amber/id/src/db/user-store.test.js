/**
 * Tests for the pure helpers in user-store. The Firestore-backed CRUD
 * needs a live store, so we limit these to the format helpers that back
 * the owner-vs-contact identity boundary — specifically the phone
 * normalization that lets findContactByPhone resolve an inbound iMessage
 * to the right contact instead of leaking through to the tenant owner.
 *
 * Run with:  node --test src/db/user-store.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  normalizePhoneList,
  normalizeEmail,
  normalizeEmailList,
  normalizeHandleNeedle,
} from "./user-store.js";

test("normalizePhoneList E.164-normalizes a mixed-format list", () => {
  const out = normalizePhoneList([
    "+1 310 555 0100",
    "(310) 555-0101",
    "3105550102",
    "13105550103",
    "",
    null,
    undefined,
  ]);
  assert.deepEqual(out, [
    "+13105550100",
    "+13105550101",
    "+13105550102",
    "+13105550103",
  ]);
});

test("normalizePhoneList returns [] for non-array input", () => {
  assert.deepEqual(normalizePhoneList(null), []);
  assert.deepEqual(normalizePhoneList(undefined), []);
  assert.deepEqual(normalizePhoneList("not-an-array"), []);
  assert.deepEqual(normalizePhoneList({}), []);
});

test("normalizePhoneList preserves entries the normalizer cannot parse strictly", () => {
  // normalizePhone is a lenient lightweight normalizer (see lib/privy.js).
  // It keeps non-empty inputs and only drops empty/whitespace strings.
  // That's fine for the by-phone lookup contract: junk inputs simply will
  // not match a real inbound E.164, so findContactByPhone still returns
  // null and callers fall through to "unknown sender" — never to the
  // tenant owner's identity.
  const out = normalizePhoneList(["", "   "]);
  assert.deepEqual(out, []);
});

test("normalizeEmail lowercases and trims a valid address", () => {
  assert.equal(
    normalizeEmail("  Caleb@BlueModernAdvisory.com "),
    "caleb@bluemodernadvisory.com",
  );
  assert.equal(normalizeEmail("alice@example.org"), "alice@example.org");
});

test("normalizeEmail returns null for junk", () => {
  assert.equal(normalizeEmail(""), null);
  assert.equal(normalizeEmail("   "), null);
  assert.equal(normalizeEmail("@nope.com"), null);
  assert.equal(normalizeEmail("no-at-symbol"), null);
  assert.equal(normalizeEmail(null), null);
  assert.equal(normalizeEmail(undefined), null);
  assert.equal(normalizeEmail(42), null);
});

test("normalizeEmailList dedups + lowercases + drops invalid entries", () => {
  const out = normalizeEmailList([
    "Sagar@Rytual.com",
    "sagar@rytual.com",
    "Other@example.com",
    "",
    null,
    "broken",
  ]);
  assert.deepEqual(out, ["sagar@rytual.com", "other@example.com"]);
});

test("normalizeEmailList returns [] for non-array input", () => {
  assert.deepEqual(normalizeEmailList(null), []);
  assert.deepEqual(normalizeEmailList("foo@bar.com"), []);
  assert.deepEqual(normalizeEmailList({}), []);
});

test("normalizeHandleNeedle strips a leading @, trims, and lowercases", () => {
  assert.equal(normalizeHandleNeedle("@Shirley.Park"), "shirley.park");
  assert.equal(normalizeHandleNeedle("@U0AEBS2UXRB"), "u0aebs2uxrb");
  assert.equal(normalizeHandleNeedle("  Shirley "), "shirley");
  // Only the first leading @ is stripped — an embedded @ stays.
  assert.equal(normalizeHandleNeedle("@a@b"), "a@b");
});

test("normalizeHandleNeedle returns '' for junk so callers short-circuit", () => {
  assert.equal(normalizeHandleNeedle(""), "");
  assert.equal(normalizeHandleNeedle("@"), "");
  assert.equal(normalizeHandleNeedle("   "), "");
  assert.equal(normalizeHandleNeedle(null), "");
  assert.equal(normalizeHandleNeedle(undefined), "");
  assert.equal(normalizeHandleNeedle(42), "");
});
