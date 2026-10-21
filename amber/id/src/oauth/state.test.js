/**
 * Unit tests for the pure pieces of src/oauth/state.js:
 *
 *  - HMAC token shape (64-char lowercase hex)
 *  - per-call randomness (no collisions across consecutive calls)
 *  - required-arg + required-env guards
 *  - consumePending(null/undefined) short-circuits without hitting Firestore
 *
 * The Firestore-backed round-trip (storePending → consumePending winning
 * a race) lives in an integration test that runs against a live emulator
 * — not included here to match the user-store.test.js convention of
 * keeping unit tests dependency-free.
 *
 * Run with:  node --test src/oauth/state.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

function freshSecretB64() {
  return crypto.randomBytes(32).toString("base64");
}

async function loadFresh() {
  // Bust the module cache so each test sees the current env.
  const url = new URL("./state.js", import.meta.url);
  url.searchParams.set("t", String(Date.now()) + Math.random());
  return await import(url.href);
}

test("generateState returns a 64-char lowercase hex string", async () => {
  process.env.OAUTH_STATE_SECRET = freshSecretB64();
  const { generateState } = await loadFresh();
  const state = generateState("did:privy:user1", "google");
  assert.equal(typeof state, "string");
  assert.equal(state.length, 64);
  assert.match(state, /^[0-9a-f]{64}$/);
});

test("generateState produces different tokens across repeated calls", async () => {
  process.env.OAUTH_STATE_SECRET = freshSecretB64();
  const { generateState } = await loadFresh();
  const a = generateState("did:privy:user1", "google");
  const b = generateState("did:privy:user1", "google");
  const c = generateState("did:privy:user1", "google");
  assert.notEqual(a, b);
  assert.notEqual(b, c);
  assert.notEqual(a, c);
});

test("generateState produces different tokens for different platforms", async () => {
  // Same user, different platform — the HMAC input differs by the
  // platform tag, so even if the random32 collided (~0 probability) the
  // tokens still wouldn't match.
  process.env.OAUTH_STATE_SECRET = freshSecretB64();
  const { generateState } = await loadFresh();
  const a = generateState("did:privy:user1", "google");
  const b = generateState("did:privy:user1", "slack");
  assert.notEqual(a, b);
});

test("generateState throws when OAUTH_STATE_SECRET is unset", async () => {
  delete process.env.OAUTH_STATE_SECRET;
  const { generateState } = await loadFresh();
  assert.throws(
    () => generateState("did:privy:user1", "google"),
    /OAUTH_STATE_SECRET/,
  );
});

test("generateState throws when did is missing", async () => {
  process.env.OAUTH_STATE_SECRET = freshSecretB64();
  const { generateState } = await loadFresh();
  assert.throws(() => generateState("", "google"), /did/);
  assert.throws(() => generateState(null, "google"), /did/);
  assert.throws(() => generateState(undefined, "google"), /did/);
});

test("generateState throws when platform is missing", async () => {
  process.env.OAUTH_STATE_SECRET = freshSecretB64();
  const { generateState } = await loadFresh();
  assert.throws(() => generateState("did:privy:user1", ""), /platform/);
  assert.throws(() => generateState("did:privy:user1", null), /platform/);
});

test("storePending throws on missing args without touching Firestore", async () => {
  process.env.OAUTH_STATE_SECRET = freshSecretB64();
  const { storePending } = await loadFresh();
  await assert.rejects(
    () => storePending("", "did:privy:user1", "google", "/connect"),
    /state/,
  );
  await assert.rejects(
    () => storePending("abc", "", "google", "/connect"),
    /did/,
  );
  await assert.rejects(
    () => storePending("abc", "did:privy:user1", "", "/connect"),
    /platform/,
  );
});

test("consumePending(falsy) returns null without hitting Firestore", async () => {
  process.env.OAUTH_STATE_SECRET = freshSecretB64();
  const { consumePending } = await loadFresh();
  // No env, no live Firestore — these still resolve to null because the
  // early-return guards run before the data-layer call.
  assert.equal(await consumePending(null), null);
  assert.equal(await consumePending(undefined), null);
  assert.equal(await consumePending(""), null);
});
