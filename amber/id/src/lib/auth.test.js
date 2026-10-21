/**
 * Tests for shared validators and verifyApiKey buffer hardening.
 *
 * Run with:  node --test src/lib/auth.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  validateUserId,
  validateDid,
  validatePhone,
  verifyApiKey,
  identifyApiKey,
} from "./auth.js";
import { _resetNamedApiKeysCache } from "./instance.js";

test("validateUserId rejects empty / non-string / path-traversal / overlong", () => {
  assert.match(validateUserId(""), /non-empty/);
  assert.match(validateUserId(123), /non-empty/);
  assert.match(validateUserId("a/b"), /disallowed/);
  assert.match(validateUserId("a\\b"), /disallowed/);
  assert.match(validateUserId("a..b"), /disallowed/);
  assert.match(validateUserId("<script>"), /disallowed/);
  assert.match(validateUserId("x".repeat(257)), /too long/);
  assert.equal(validateUserId("did:privy:abc123"), null);
});

test("validateDid requires did: prefix and rejects path chars", () => {
  assert.match(validateDid("not-a-did"), /did:/);
  assert.match(validateDid("did:privy:a/b"), /disallowed/);
  assert.equal(validateDid("did:privy:abc123_-."), null);
});

test("validatePhone requires E.164", () => {
  assert.match(validatePhone("5551234"), /E\.164/);
  assert.match(validatePhone("+0123"), /E\.164/);
  assert.match(validatePhone(123), /string/);
  assert.equal(validatePhone("+15551234567"), null);
  assert.equal(validatePhone("+447911123456"), null);
});

test("verifyApiKey rejects array / undefined / non-string / empty", () => {
  process.env.AMBER_ID_API_KEY = "sekret-token";
  assert.equal(verifyApiKey(undefined), false);
  assert.equal(verifyApiKey(null), false);
  assert.equal(verifyApiKey(""), false);
  assert.equal(verifyApiKey(123), false);
  assert.equal(verifyApiKey(["sekret-token"]), false);
  assert.equal(verifyApiKey({}), false);
  assert.equal(verifyApiKey("wrong"), false);
  assert.equal(verifyApiKey("sekret-token"), true);
});

test("verifyApiKey returns false when expected key is unset", () => {
  delete process.env.AMBER_ID_API_KEY;
  assert.equal(verifyApiKey("anything"), false);
});

test("verifyApiKey is timing-safe-friendly: different lengths short-circuit", () => {
  process.env.AMBER_ID_API_KEY = "abc";
  // Just confirm wrong-length input does not throw.
  assert.equal(verifyApiKey("abcdef"), false);
  assert.equal(verifyApiKey("a"), false);
});

test("identifyApiKey matches legacy single key as 'legacy'", () => {
  process.env.AMBER_ID_API_KEY = "legacy-token";
  delete process.env.AMBER_ID_API_KEYS;
  delete process.env.DEFAULT_OWNER_DID;
  _resetNamedApiKeysCache();
  assert.deepEqual(identifyApiKey("legacy-token"), {
    name: "legacy",
    did: null,
  });
  assert.equal(identifyApiKey("wrong"), null);
});

test("identifyApiKey binds DEFAULT_OWNER_DID to the legacy key", () => {
  // A single-key deployment can bind every authenticated call to one tenant
  // (e.g. a CEO's own account) without per-key config.
  process.env.AMBER_ID_API_KEY = "legacy-token";
  delete process.env.AMBER_ID_API_KEYS;
  process.env.DEFAULT_OWNER_DID = "did:privy:owner999";
  _resetNamedApiKeysCache();
  assert.deepEqual(identifyApiKey("legacy-token"), {
    name: "legacy",
    did: "did:privy:owner999",
  });
  delete process.env.DEFAULT_OWNER_DID;
});

test("identifyApiKey matches a named SERVICE caller from AMBER_ID_API_KEYS", () => {
  // Named API keys identify upstream services (amber-imessage, amber-ios-dev,
  // amber-agent, …), never individual users. End users authenticate with a
  // Privy JWT against the same shared multi-tenant amber-id.
  delete process.env.AMBER_ID_API_KEY;
  delete process.env.DEFAULT_OWNER_DID;
  process.env.AMBER_ID_API_KEYS = JSON.stringify([
    { name: "amber-imessage", key: "sk_imessage_aaa" },
    { name: "ceo", key: "sk_ceo_bbb", did: "did:privy:ceo123" },
  ]);
  _resetNamedApiKeysCache();
  // No per-key DID and no DEFAULT_OWNER_DID → did is null.
  assert.deepEqual(identifyApiKey("sk_imessage_aaa"), {
    name: "amber-imessage",
    did: null,
  });
  // Per-key DID is surfaced so the MCP layer can default the `did` arg,
  // letting a CEO with their own key call the CRM tools without a DID.
  assert.deepEqual(identifyApiKey("sk_ceo_bbb"), {
    name: "ceo",
    did: "did:privy:ceo123",
  });
  assert.equal(identifyApiKey("sk_other_ccc"), null);
});

test("identifyApiKey legacy + named coexist; legacy wins on its own key", () => {
  process.env.AMBER_ID_API_KEY = "legacy-shared";
  process.env.AMBER_ID_API_KEYS = "amber-imessage:sk_imessage_xxx";
  delete process.env.DEFAULT_OWNER_DID;
  _resetNamedApiKeysCache();
  assert.deepEqual(identifyApiKey("legacy-shared"), {
    name: "legacy",
    did: null,
  });
  assert.deepEqual(identifyApiKey("sk_imessage_xxx"), {
    name: "amber-imessage",
    did: null,
  });
  assert.equal(identifyApiKey(""), null);
  assert.equal(identifyApiKey(undefined), null);
});

test("verifyApiKey returns true for any matching named key", () => {
  delete process.env.AMBER_ID_API_KEY;
  process.env.AMBER_ID_API_KEYS = "amber-imessage:sk_imessage_xxx";
  _resetNamedApiKeysCache();
  assert.equal(verifyApiKey("sk_imessage_xxx"), true);
  assert.equal(verifyApiKey("nope"), false);
});
