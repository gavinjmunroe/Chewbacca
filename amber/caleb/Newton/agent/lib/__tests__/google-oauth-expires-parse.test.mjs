/**
 * Tests for parseExpiresMs — the dual-format expiry parser that lets the
 * Google OAuth token cache survive the medha-id (ISO) ↔ medha-platform
 * (unix-ms) key/format drift.
 *
 * Run: node --test Newton/agent/lib/__tests__/google-oauth-expires-parse.test.mjs
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { parseExpiresMs } from "../tools/gcal/client.js";

test("parses ISO 8601 strings (medha-id callback format)", () => {
  const iso = "2026-05-27T20:00:00.000Z";
  const ms = parseExpiresMs(iso);
  assert.equal(ms, Date.UTC(2026, 4, 27, 20, 0, 0));
});

test("parses ISO without milliseconds", () => {
  const iso = "2026-05-27T20:00:00Z";
  const ms = parseExpiresMs(iso);
  assert.equal(ms, Date.UTC(2026, 4, 27, 20, 0, 0));
});

test("parses ISO with timezone offset", () => {
  const iso = "2026-05-27T13:00:00-07:00";
  const ms = parseExpiresMs(iso);
  assert.equal(ms, Date.UTC(2026, 4, 27, 20, 0, 0));
});

test("parses unix-ms number-as-string (legacy format)", () => {
  const ms = parseExpiresMs("1748376000000");
  assert.equal(ms, 1748376000000);
});

test("returns 0 for null / undefined / empty", () => {
  assert.equal(parseExpiresMs(null), 0);
  assert.equal(parseExpiresMs(undefined), 0);
  assert.equal(parseExpiresMs(""), 0);
  assert.equal(parseExpiresMs("   "), 0);
});

test("returns 0 for unparseable strings", () => {
  assert.equal(parseExpiresMs("not a date"), 0);
  assert.equal(parseExpiresMs("2026-99-99"), 0);
});

test("returns 0 for non-string inputs (defensive)", () => {
  assert.equal(parseExpiresMs(123456), 0);
  assert.equal(parseExpiresMs({ ms: 1 }), 0);
  assert.equal(parseExpiresMs([]), 0);
});

test("legacy and ISO formats agree on the same instant", () => {
  const instant = Date.UTC(2026, 4, 27, 20, 0, 0);
  const iso = new Date(instant).toISOString();
  const legacy = String(instant);
  assert.equal(parseExpiresMs(iso), parseExpiresMs(legacy));
});
