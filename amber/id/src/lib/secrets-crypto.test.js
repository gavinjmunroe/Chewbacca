/**
 * Tests for secrets-crypto:
 *  - encryption round-trips with the v1 prefix
 *  - unprefixed (legacy v0) blobs decrypt cleanly when V0 == current key
 *  - unprefixed blobs decrypt with SECRETS_MASTER_KEY_V0 when set
 *  - rotation: a v1 blob decrypts under SECRETS_MASTER_KEY even after V0
 *    is changed
 *
 * Run with:  node --test src/lib/secrets-crypto.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

function freshKeyB64() {
  return crypto.randomBytes(32).toString("base64");
}

async function loadFresh() {
  const url = new URL("./secrets-crypto.js", import.meta.url);
  // Bust the module cache so each test sees the current env.
  url.searchParams.set("t", String(Date.now()) + Math.random());
  return await import(url.href);
}

test("encryptSecret round-trips with v1 prefix", async () => {
  process.env.SECRETS_MASTER_KEY = freshKeyB64();
  delete process.env.SECRETS_MASTER_KEY_V0;
  const { encryptSecret, decryptSecret } = await loadFresh();
  const blob = encryptSecret("hello world");
  assert.match(blob, /^v1:/);
  assert.equal(decryptSecret(blob), "hello world");
});

test("unprefixed legacy blob decrypts when V0 == current key", async () => {
  // Encrypt with the current master, but strip the v1: prefix so the blob
  // looks like a pre-versioning value. With V0 unset, decryptSecret falls
  // back to SECRETS_MASTER_KEY — which matches, so it round-trips.
  process.env.SECRETS_MASTER_KEY = freshKeyB64();
  delete process.env.SECRETS_MASTER_KEY_V0;
  const { encryptSecret, decryptSecret } = await loadFresh();
  const blob = encryptSecret("legacy value");
  const stripped = blob.replace(/^v1:/, "");
  assert.equal(decryptSecret(stripped), "legacy value");
});

test("unprefixed blob decrypts with SECRETS_MASTER_KEY_V0 after rotation", async () => {
  // Simulate rotation: V0 holds the old key, current master holds a new key.
  const oldKey = freshKeyB64();
  process.env.SECRETS_MASTER_KEY = oldKey;
  delete process.env.SECRETS_MASTER_KEY_V0;
  let mod = await loadFresh();
  const legacyBlob = mod.encryptSecret("rotated value").replace(/^v1:/, "");

  // Rotate: new master key, V0 = old key.
  process.env.SECRETS_MASTER_KEY = freshKeyB64();
  process.env.SECRETS_MASTER_KEY_V0 = oldKey;
  mod = await loadFresh();
  assert.equal(mod.decryptSecret(legacyBlob), "rotated value");
});

test("decryptSecret throws on non-string input", async () => {
  process.env.SECRETS_MASTER_KEY = freshKeyB64();
  const { decryptSecret } = await loadFresh();
  assert.throws(() => decryptSecret(42), /string/);
  assert.throws(() => decryptSecret({ a: 1 }), /string/);
});

test("decryptSecret returns null for null/empty inputs", async () => {
  process.env.SECRETS_MASTER_KEY = freshKeyB64();
  const { decryptSecret } = await loadFresh();
  assert.equal(decryptSecret(null), null);
  assert.equal(decryptSecret(undefined), null);
  assert.equal(decryptSecret(""), null);
});
