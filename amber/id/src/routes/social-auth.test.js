/**
 * SIGN IN WITH APPLE AND SIGN IN WITH GOOGLE — the flow they share.
 *
 * These did not exist before Google joined. The Apple route had good tests on
 * its VERIFIER and none on the route, so the reconciliation logic -- the part
 * that decides which account a social login lands on -- was covered by nothing.
 * Merging the two providers into one file without writing them first would have
 * been a refactor of the most security-critical route in the service with no net
 * under it.
 *
 * WHAT MATTERS HERE IS NOT THE HAPPY PATH. It is the four ways a social sign-in
 * can hand somebody an account that is not theirs:
 *
 *   a token issued to a different app being accepted
 *   a provider subject being re-pointed at a new account
 *   an unverified provider email claiming an existing person's identity
 *   a ticket from one provider being redeemed as another
 *
 * Run with:  node --test src/routes/social-auth.test.js
 */
import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";

import { registerSocialAuthRoutes } from "./social-auth.js";
import { issueLinkTicket } from "../lib/apple-ticket.js";

/**
 * The ticket is a real HMAC, so it needs a real key. Set here rather than in
 * scripts/test-env.js because apple-ticket.test.js deliberately deletes it to
 * prove a missing secret is a refusal, and a value in the shared env would make
 * that test unable to fail.
 */
const SECRET = "s".repeat(48);
test.beforeEach(() => {
  process.env.MEDHA_JWT_SECRET = SECRET;
});

const AMBER_ID = "11111111-1111-4111-8111-111111111111";
const PHONE = "+13105550100";
const SUB = "provider-subject-1";

/**
 * The route reaches for a lot of collaborators through module imports rather
 * than injection. Rather than reshape a working auth route to be testable, the
 * two things a test can genuinely control are exercised: the token verifier,
 * which is passed in by config, and the ticket, which is a real signed value.
 * Everything past the ticket needs a database and is covered by the store's own
 * tests.
 */
function buildApp({ provider = "google", tokenField = "idToken", verify } = {}) {
  const app = Fastify({ logger: false });
  registerSocialAuthRoutes(app, {
    provider,
    label: provider,
    tokenField,
    verifyToken: verify ?? (async () => ({ ok: false, reason: "bad_signature" })),
  });
  return app;
}

test("A TOKEN THE VERIFIER REJECTS IS A 401 THAT SAYS NOTHING", async () => {
  /**
   * The reason distinguishes "expired" from "wrong audience" from "forged", and
   * handing that back is a map of the verifier for anyone probing it. It is
   * logged; it is not returned.
   */
  for (const reason of ["bad_aud", "bad_signature", "expired", "bad_nonce", "unknown_kid"]) {
    const app = buildApp({ verify: async () => ({ ok: false, reason }) });
    const res = await app.inject({
      method: "POST",
      url: "/v1/auth/google",
      payload: { idToken: "x".repeat(60) },
    });
    assert.equal(res.statusCode, 401, reason);
    assert.equal(res.json().error, "google_auth_failed");
    assert.equal(res.json().reason, undefined, `leaked why: ${reason}`);
    await app.close();
  }
});

test("AN UNKNOWN IDENTITY GETS A TICKET, NOT A SESSION", async () => {
  /**
   * The heart of the model. A verified Apple or Google token proves the person
   * holds that provider account; it proves nothing about which Amber account is
   * theirs, and neither provider tells us a phone. Minting a session here -- or
   * creating a user -- would make a social login a way in that never touched a
   * phone OTP.
   */
  const app = buildApp({
    verify: async () => ({ ok: true, sub: SUB, email: null, emailVerified: false, isPrivateEmail: false }),
  });
  const res = await app.inject({
    method: "POST",
    url: "/v1/auth/google",
    payload: { idToken: "x".repeat(60) },
  });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.needsPhone, true);
  assert.ok(body.ticket, "no ticket to carry into the phone step");
  assert.equal(body.token, undefined, "minted a session without a phone");
  assert.equal(body.refreshToken, undefined);
  assert.equal(body.amberId, undefined, "named an account before one was resolved");
  await app.close();
});

test("A TICKET FROM ONE PROVIDER IS NOT VALID AT THE OTHER'S ENDPOINT", async () => {
  /**
   * Both endpoints sign with the same key. Without the provider inside the
   * payload, a ticket earned by verifying an APPLE token could be posted here
   * and would write (provider='google', subject=<an Apple sub>) into
   * user_identities: a Google login nobody holds, bound to a real account.
   */
  const appleTicket = issueLinkTicket("apple", { sub: "an-apple-sub" }).ticket;
  const app = buildApp();
  const res = await app.inject({
    method: "POST",
    url: "/v1/auth/google/link",
    payload: { ticket: appleTicket, phone: PHONE, code: "123456" },
  });
  assert.equal(res.statusCode, 401);
  assert.equal(res.json().error, "bad_ticket");
  await app.close();
});

test("A FORGED TICKET NEVER REACHES THE OTP STEP", async () => {
  /**
   * TWO REFUSALS, AND BOTH ARE CORRECT. Short garbage is caught by the schema's
   * minLength and comes back 400; anything long enough to look like a ticket
   * reaches the HMAC check and comes back 401. The first draft of this test
   * asserted 401 for both and failed on "not-a-ticket" -- twelve characters, so
   * the schema had already refused it.
   *
   * What matters is not which layer says no. It is that a body carrying a
   * self-signed payload is refused by SOMETHING before a phone and a code are
   * ever looked at, because the ticket is the only thing binding this request to
   * a provider identity anybody actually verified.
   */
  const app = buildApp();
  const forged = [
    "not-a-ticket",
    "a.b",
    // A well-formed payload with a signature the server never produced. This is
    // the real attack: claim any subject you like and hope nobody checks.
    `${Buffer.from('{"v":2,"p":"google","sub":"somebody-elses-google-id","exp":9999999999}').toString("base64url")}.zzzzzzzzzzzzzzzzzzzz`,
  ];
  for (const ticket of forged) {
    const res = await app.inject({
      method: "POST",
      url: "/v1/auth/google/link",
      payload: { ticket, phone: PHONE, code: "123456" },
    });
    assert.ok(res.statusCode === 400 || res.statusCode === 401, `${ticket.slice(0, 24)} -> ${res.statusCode}`);
    assert.equal(res.json().token, undefined, `minted a session for: ${ticket.slice(0, 24)}`);
    assert.equal(res.json().amberId, undefined);
  }
  await app.close();
});

test("an expired ticket is told apart from a bad one, because the fix differs", async () => {
  // "Start again" versus "something is wrong". A user who took eleven minutes to
  // type a code should be told to retry, not shown a security error.
  const app = buildApp();
  const stale = issueLinkTicket("google", { sub: SUB }).ticket;
  const [body, sig] = stale.split(".");
  const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  payload.exp = Math.floor(Date.now() / 1000) - 10;
  // Re-sign so this tests expiry rather than tampering.
  const crypto = await import("node:crypto");
  const key = crypto
    .createHmac("sha256", process.env.MEDHA_JWT_SECRET)
    .update("amber:apple-link-ticket:v1")
    .digest();
  const b2 = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const s2 = crypto.createHmac("sha256", key).update(b2).digest().toString("base64url");
  const res = await app.inject({
    method: "POST",
    url: "/v1/auth/google/link",
    payload: { ticket: `${b2}.${s2}`, phone: PHONE, code: "123456" },
  });
  assert.equal(res.statusCode, 401);
  assert.equal(res.json().error, "ticket_expired");
  assert.notEqual(sig, s2);
  await app.close();
});

test("a phone that is not a phone is refused before any OTP is checked", async () => {
  const app = buildApp();
  const ticket = issueLinkTicket("google", { sub: SUB }).ticket;
  const res = await app.inject({
    method: "POST",
    url: "/v1/auth/google/link",
    payload: { ticket, phone: "notaphone", code: "123456" },
  });
  assert.equal(res.statusCode, 400);
  assert.equal(res.json().error, "invalid_phone");
  await app.close();
});

test("THE SCHEMA REFUSES A MISSING OR ABSURD TOKEN before the verifier runs", async () => {
  // A verifier is the wrong place to discover the body was empty, and an 8KB cap
  // keeps an unauthenticated endpoint from being a place to post megabytes.
  let called = 0;
  const app = buildApp({
    verify: async () => {
      called += 1;
      return { ok: true, sub: SUB };
    },
  });
  for (const payload of [{}, { idToken: "short" }, { identityToken: "x".repeat(60) }]) {
    const res = await app.inject({ method: "POST", url: "/v1/auth/google", payload });
    assert.equal(res.statusCode, 400, JSON.stringify(payload));
  }
  assert.equal(called, 0, "the verifier ran on a body the schema should have refused");
  await app.close();
});

test("each provider answers only at its own path", async () => {
  // Apple clients send `identityToken`; Google clients send `idToken`. The paths
  // and the field names are part of the contract with shipped app builds.
  const google = buildApp({ provider: "google", tokenField: "idToken" });
  assert.equal(
    (await google.inject({ method: "POST", url: "/v1/auth/apple", payload: {} })).statusCode,
    404,
  );
  await google.close();

  const apple = buildApp({ provider: "apple", tokenField: "identityToken" });
  assert.equal(
    (await apple.inject({ method: "POST", url: "/v1/auth/google", payload: {} })).statusCode,
    404,
  );
  // And the Apple field name is still the Apple field name.
  const res = await apple.inject({
    method: "POST",
    url: "/v1/auth/apple",
    payload: { idToken: "x".repeat(60) },
  });
  assert.equal(res.statusCode, 400, "accepted Google's field name on the Apple route");
  await apple.close();
});
