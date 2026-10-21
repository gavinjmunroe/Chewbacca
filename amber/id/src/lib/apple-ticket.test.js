/**
 * The Apple link ticket.
 *
 * The property that matters: a client cannot manufacture an Apple identity. Every
 * test below is a way someone might try — forge a signature, edit the payload,
 * replay an old ticket, or pass a SESSION token where a ticket is expected.
 */

import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { issueAppleTicket, verifyAppleTicket, issueLinkTicket, verifyLinkTicket, } from "./apple-ticket.js";

const SECRET = "a".repeat(48);
const IDENTITY = {
  sub: "001234.abcdef.0000",
  email: "someone@privaterelay.appleid.com",
  emailVerified: true,
  isPrivateEmail: true,
};

test.beforeEach(() => {
  process.env.MEDHA_JWT_SECRET = SECRET;
});

test("a freshly issued ticket verifies and round-trips the identity", () => {
  const { ticket, expiresIn } = issueAppleTicket(IDENTITY);
  assert.equal(expiresIn, 600);
  const res = verifyAppleTicket(ticket);
  assert.deepEqual(res, {
    ok: true,
    // v2 tickets say which provider earned them. See "wrong_provider" below.
    provider: "apple",
    sub: IDENTITY.sub,
    email: IDENTITY.email,
    emailVerified: true,
    isPrivateEmail: true,
  });
});

test("the email survives, because Apple will never send it again", () => {
  const res = verifyAppleTicket(issueAppleTicket({ sub: "x", email: "a@b.com" }).ticket);
  assert.equal(res.email, "a@b.com");
  // And absence stays absence rather than becoming the string "undefined".
  assert.equal(verifyAppleTicket(issueAppleTicket({ sub: "x" }).ticket).email, null);
});

test("editing the payload invalidates it — this is the account-takeover case", () => {
  const { ticket } = issueAppleTicket(IDENTITY);
  const [body, sig] = ticket.split(".");
  const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  payload.sub = "somebody.elses.apple.id";
  const forged = Buffer.from(JSON.stringify(payload)).toString("base64url");
  assert.deepEqual(verifyAppleTicket(`${forged}.${sig}`), { ok: false, reason: "bad_ticket" });
});

test("a ticket signed with the raw secret is rejected — the key is derived", () => {
  const { ticket } = issueAppleTicket(IDENTITY);
  const body = ticket.split(".")[0];
  const rawSig = crypto.createHmac("sha256", SECRET).update(body).digest().toString("base64url");
  assert.deepEqual(verifyAppleTicket(`${body}.${rawSig}`), { ok: false, reason: "bad_ticket" });
});

test("a ticket issued under a different secret is rejected", () => {
  const { ticket } = issueAppleTicket(IDENTITY);
  process.env.MEDHA_JWT_SECRET = "b".repeat(48);
  assert.deepEqual(verifyAppleTicket(ticket), { ok: false, reason: "bad_ticket" });
});

test("an expired ticket is rejected with no skew allowance", () => {
  const past = { v: 1, sub: "x", email: null, ev: false, pe: false, exp: Math.floor(Date.now() / 1000) - 1 };
  const body = Buffer.from(JSON.stringify(past)).toString("base64url");
  const key = crypto.createHmac("sha256", SECRET).update("amber:apple-link-ticket:v1").digest();
  const sig = crypto.createHmac("sha256", key).update(body).digest().toString("base64url");
  assert.deepEqual(verifyAppleTicket(`${body}.${sig}`), { ok: false, reason: "ticket_expired" });
});

test("garbage is rejected without throwing", () => {
  for (const bad of ["", "abc", "a.b.c", null, undefined, 42, {}, "....", "x."]) {
    const res = verifyAppleTicket(bad);
    assert.equal(res.ok, false, `${JSON.stringify(bad)} must not verify`);
  }
});

test("a missing secret fails closed rather than accepting anything", () => {
  const { ticket } = issueAppleTicket(IDENTITY);
  delete process.env.MEDHA_JWT_SECRET;
  assert.deepEqual(verifyAppleTicket(ticket), { ok: false, reason: "not_configured" });
  assert.throws(() => issueAppleTicket(IDENTITY), /MEDHA_JWT_SECRET/);
});

/**
 * PROVIDER BINDING — added when Google sign-in joined the same two-step flow.
 *
 * Both providers redeem their ticket against the same HMAC key at different
 * endpoints. Without a provider inside the payload, a ticket earned by verifying
 * an APPLE token could be posted to the Google link endpoint, and the server
 * would write (provider='google', subject=<an Apple sub>) into user_identities:
 * a Google login nobody holds, bound to a real account, sitting in a namespace
 * where that subject can never legitimately appear.
 */
test("AN APPLE TICKET CANNOT BE REDEEMED AS GOOGLE, or the other way round", () => {
  const apple = issueLinkTicket("apple", { sub: "apple-sub-1" }).ticket;
  const google = issueLinkTicket("google", { sub: "google-sub-1" }).ticket;

  assert.equal(verifyLinkTicket("apple", apple).ok, true);
  assert.equal(verifyLinkTicket("google", google).ok, true);

  assert.deepEqual(verifyLinkTicket("google", apple), { ok: false, reason: "wrong_provider" });
  assert.deepEqual(verifyLinkTicket("apple", google), { ok: false, reason: "wrong_provider" });
});

test("the redeemed subject is the one that was verified, per provider", () => {
  const google = issueLinkTicket("google", {
    sub: "1078...google",
    email: "k@example.com",
    emailVerified: true,
  }).ticket;
  const res = verifyLinkTicket("google", google);
  assert.equal(res.provider, "google");
  assert.equal(res.sub, "1078...google");
  assert.equal(res.email, "k@example.com");
  assert.equal(res.emailVerified, true);
  // Google has no Hide My Email, and the ticket must not invent one.
  assert.equal(res.isPrivateEmail, false);
});

test("A v1 TICKET STILL WORKS, AND ONLY AS APPLE", () => {
  /**
   * Tickets live ten minutes. Rejecting v1 outright would fail sign-in for
   * anybody mid-flow across the deploy that shipped v2 -- and "apple" is the
   * only thing a v1 ticket could ever have meant, because it is the only
   * provider that existed when v1 was written.
   */
  // crypto is already imported at the top of this file.
  const key = crypto
    .createHmac("sha256", process.env.MEDHA_JWT_SECRET)
    .update("amber:apple-link-ticket:v1")
    .digest();
  const payload = {
    v: 1,
    sub: "legacy-apple-sub",
    email: null,
    ev: false,
    pe: false,
    exp: Math.floor(Date.now() / 1000) + 300,
  };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto.createHmac("sha256", key).update(body).digest().toString("base64url");
  const legacy = `${body}.${sig}`;

  const asApple = verifyLinkTicket("apple", legacy);
  assert.equal(asApple.ok, true);
  assert.equal(asApple.sub, "legacy-apple-sub");
  // It must not become a wildcard that any provider can redeem.
  assert.deepEqual(verifyLinkTicket("google", legacy), { ok: false, reason: "wrong_provider" });
});

test("a provider we do not issue for is refused at issue time", () => {
  // Never a silent ticket for a provider nothing can verify.
  assert.throws(() => issueLinkTicket("facebook", { sub: "x" }), /unknown_ticket_provider/);
  assert.throws(() => issueLinkTicket("", { sub: "x" }), /unknown_ticket_provider/);
  assert.throws(() => issueLinkTicket(undefined, { sub: "x" }), /unknown_ticket_provider/);
});
