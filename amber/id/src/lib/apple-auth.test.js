/**
 * Sign in with Apple token verification.
 *
 * These tests mint REAL RS256 tokens with a real keypair generated in-process and
 * inject the public half as Apple's JWKS, so the signature path is exercised for
 * real rather than stubbed. Every negative case below is an actual way to sign in
 * as someone else, which is why each one gets its own test:
 *
 *   alg=none / alg=HS256   algorithm confusion
 *   wrong key              forged token
 *   wrong aud              a token Apple issued to a DIFFERENT app
 *   wrong iss              a token from an issuer we do not trust
 *   expired                replay of an old token
 *   wrong / missing nonce  replay of a captured token from another session
 *   tampered payload       sub swapped after signing
 */

import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { verifyAppleIdentityToken, _resetJwksCacheForTests } from "./apple-auth.js";

const AUD = "com.joinrytual.amber";
const KID = "test-kid-1";
const SUB = "001234.abcdef0123456789.0000";
const RAW_NONCE = "a-random-client-nonce-value";

const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const { publicKey: otherPub, privateKey: otherPriv } = crypto.generateKeyPairSync("rsa", {
  modulusLength: 2048,
});

function jwkFor(pub, kid = KID) {
  return { ...pub.export({ format: "jwk" }), kid, alg: "RS256", use: "sig", kty: "RSA" };
}
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");

function mint({
  claims = {},
  key = privateKey,
  header = {},
  nonce = crypto.createHash("sha256").update(RAW_NONCE).digest("hex"),
  sign = true,
} = {}) {
  const now = Math.floor(Date.now() / 1000);
  const h = b64({ alg: "RS256", kid: KID, ...header });
  const p = b64({
    iss: "https://appleid.apple.com",
    aud: AUD,
    sub: SUB,
    iat: now,
    exp: now + 600,
    ...(nonce === null ? {} : { nonce }),
    ...claims,
  });
  const body = `${h}.${p}`;
  const sig = sign
    ? crypto.sign("RSA-SHA256", Buffer.from(body), key).toString("base64url")
    : "";
  return `${body}.${sig}`;
}

test.beforeEach(() => {
  process.env.APPLE_BUNDLE_IDS = AUD;
  _resetJwksCacheForTests([jwkFor(publicKey)]);
});

test("a valid token verifies and returns only what Apple signed", async () => {
  const res = await verifyAppleIdentityToken(mint({ claims: { email: "A@Example.com", email_verified: "true", is_private_email: false } }), { rawNonce: RAW_NONCE });
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.equal(res.sub, SUB);
  assert.equal(res.email, "a@example.com", "email is normalized to lower case");
  assert.equal(res.emailVerified, true, 'Apple sends the string "true", not a boolean');
  assert.equal(res.isPrivateEmail, false);
});

test("email is null when Apple omits it (every authorization after the first)", async () => {
  const res = await verifyAppleIdentityToken(mint(), { rawNonce: RAW_NONCE });
  assert.equal(res.ok, true);
  assert.equal(res.email, null);
});

test("alg=none is rejected before any key is touched", async () => {
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${b64({ alg: "none", kid: KID })}.${b64({ iss: "https://appleid.apple.com", aud: AUD, sub: SUB, exp: now + 600 })}.`;
  const res = await verifyAppleIdentityToken(unsigned, { rawNonce: RAW_NONCE });
  assert.deepEqual(res, { ok: false, reason: "bad_alg" });
});

test("alg=HS256 is rejected — Apple's public key must never be used as an HMAC secret", async () => {
  const now = Math.floor(Date.now() / 1000);
  const h = b64({ alg: "HS256", kid: KID });
  const p = b64({ iss: "https://appleid.apple.com", aud: AUD, sub: SUB, exp: now + 600 });
  const pub = JSON.stringify(jwkFor(publicKey));
  const sig = crypto.createHmac("sha256", pub).update(`${h}.${p}`).digest("base64url");
  const res = await verifyAppleIdentityToken(`${h}.${p}.${sig}`, { rawNonce: RAW_NONCE });
  assert.deepEqual(res, { ok: false, reason: "bad_alg" });
});

test("a token signed by the wrong key is rejected", async () => {
  const res = await verifyAppleIdentityToken(mint({ key: otherPriv }), { rawNonce: RAW_NONCE });
  assert.deepEqual(res, { ok: false, reason: "bad_signature" });
});

test("a tampered sub invalidates the signature", async () => {
  const good = mint();
  const [h, , s] = good.split(".");
  const now = Math.floor(Date.now() / 1000);
  const evil = b64({ iss: "https://appleid.apple.com", aud: AUD, sub: "somebody.else", iat: now, exp: now + 600, nonce: crypto.createHash("sha256").update(RAW_NONCE).digest("hex") });
  const res = await verifyAppleIdentityToken(`${h}.${evil}.${s}`, { rawNonce: RAW_NONCE });
  assert.deepEqual(res, { ok: false, reason: "bad_signature" });
});

test("a token issued to another app is rejected", async () => {
  const res = await verifyAppleIdentityToken(mint({ claims: { aud: "com.someoneelse.app" } }), { rawNonce: RAW_NONCE });
  assert.deepEqual(res, { ok: false, reason: "bad_aud" });
});

test("a token from another issuer is rejected", async () => {
  const res = await verifyAppleIdentityToken(mint({ claims: { iss: "https://evil.example.com" } }), { rawNonce: RAW_NONCE });
  assert.deepEqual(res, { ok: false, reason: "bad_iss" });
});

test("an expired token is rejected, and clock skew is bounded", async () => {
  const now = Math.floor(Date.now() / 1000);
  assert.deepEqual(
    await verifyAppleIdentityToken(mint({ claims: { exp: now - 3600 } }), { rawNonce: RAW_NONCE }),
    { ok: false, reason: "expired" },
  );
  // Inside the skew window it still passes, so a slightly slow clock is survivable.
  const res = await verifyAppleIdentityToken(mint({ claims: { exp: now - 30 } }), { rawNonce: RAW_NONCE });
  assert.equal(res.ok, true);
});

test("a token issued far in the future is rejected", async () => {
  const now = Math.floor(Date.now() / 1000);
  const res = await verifyAppleIdentityToken(mint({ claims: { iat: now + 7200, exp: now + 8000 } }), { rawNonce: RAW_NONCE });
  assert.deepEqual(res, { ok: false, reason: "issued_in_future" });
});

test("the nonce must match, and a missing raw nonce fails closed", async () => {
  assert.deepEqual(
    await verifyAppleIdentityToken(mint(), { rawNonce: "some-other-nonce" }),
    { ok: false, reason: "bad_nonce" },
  );
  assert.deepEqual(await verifyAppleIdentityToken(mint()), { ok: false, reason: "bad_nonce" });
});

test("every nonce convention a client might use is accepted", async () => {
  const sha = crypto.createHash("sha256").update(RAW_NONCE).digest();
  for (const claim of [RAW_NONCE, sha.toString("hex"), sha.toString("base64url")]) {
    const res = await verifyAppleIdentityToken(mint({ nonce: claim }), { rawNonce: RAW_NONCE });
    assert.equal(res.ok, true, `nonce form ${claim.slice(0, 12)} should verify`);
  }
});

test("an unknown kid is rejected once the refetch also misses", async () => {
  _resetJwksCacheForTests([jwkFor(otherPub, "a-different-kid")]);
  const res = await verifyAppleIdentityToken(mint(), { rawNonce: RAW_NONCE });
  // The forced refetch hits the network and fails offline, so the stale cache is
  // reused and the kid is still absent.
  assert.equal(res.ok, false);
  assert.ok(["unknown_kid", "jwks_unavailable"].includes(res.reason), res.reason);
});

test("garbage input is rejected without throwing", async () => {
  for (const bad of ["", "x", "a.b", "a.b.c.d", null, undefined, 42, {}]) {
    const res = await verifyAppleIdentityToken(bad, { rawNonce: RAW_NONCE });
    assert.equal(res.ok, false);
  }
});

test("multiple bundle ids are supported for TestFlight/enterprise builds", async () => {
  process.env.APPLE_BUNDLE_IDS = "com.other.app, com.joinrytual.amber";
  const res = await verifyAppleIdentityToken(mint(), { rawNonce: RAW_NONCE });
  assert.equal(res.ok, true);
});
