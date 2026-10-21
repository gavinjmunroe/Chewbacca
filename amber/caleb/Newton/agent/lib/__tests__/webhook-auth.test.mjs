/**
 * Tests for webhook-auth: signature verification, shared-secret check,
 * admin auth, CORS allowlist.
 *
 * Run with:  node --test Newton/agent/lib/__tests__/webhook-auth.test.mjs
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "crypto";

import {
  verifyHmacSha256,
  verifyWebhook,
  checkAdminAuth,
  resolveCorsOrigin,
  getAllowedOrigins,
} from "../webhook-auth.js";

function reqOf({
  url = "/webhook",
  method = "POST",
  headers = {},
  origin,
} = {}) {
  if (origin) headers.origin = origin;
  return { url, method, headers };
}

test("verifyHmacSha256: hex match", () => {
  const body = '{"event":"x"}';
  const secret = "shh";
  const sig = createHmac("sha256", secret).update(body).digest("hex");
  assert.equal(verifyHmacSha256(body, secret, sig), true);
  assert.equal(verifyHmacSha256(body, secret, "deadbeef"), false);
});

test("verifyHmacSha256: base64 match and sha256= prefix", () => {
  const body = "abc";
  const secret = "k";
  const sig = createHmac("sha256", secret).update(body).digest("base64");
  assert.equal(verifyHmacSha256(body, secret, sig), true);
  const hex = createHmac("sha256", secret).update(body).digest("hex");
  assert.equal(verifyHmacSha256(body, secret, "sha256=" + hex), true);
});

test("verifyWebhook: dev permissive when no secrets configured", () => {
  const orig = { ...process.env };
  delete process.env.LOOP_WEBHOOK_SECRET;
  delete process.env.TWILIO_AUTH_TOKEN;
  delete process.env.WEBHOOK_SECRET;
  delete process.env.NODE_ENV;
  try {
    const r = verifyWebhook(reqOf(), "{}");
    assert.equal(r.ok, true);
    assert.equal(r.reason, "dev-permissive");
  } finally {
    Object.assign(process.env, orig);
  }
});

test("verifyWebhook: prod refuses when nothing configured", () => {
  const orig = { ...process.env };
  delete process.env.LOOP_WEBHOOK_SECRET;
  delete process.env.TWILIO_AUTH_TOKEN;
  delete process.env.WEBHOOK_SECRET;
  process.env.NODE_ENV = "production";
  try {
    const r = verifyWebhook(reqOf(), "{}");
    assert.equal(r.ok, false);
  } finally {
    Object.assign(process.env, orig);
  }
});

test("verifyWebhook: shared-secret via header", () => {
  const orig = { ...process.env };
  process.env.WEBHOOK_SECRET = "abc123";
  delete process.env.LOOP_WEBHOOK_SECRET;
  delete process.env.TWILIO_AUTH_TOKEN;
  try {
    assert.equal(
      verifyWebhook(reqOf({ headers: { "x-webhook-secret": "abc123" } }), "{}")
        .ok,
      true,
    );
    assert.equal(
      verifyWebhook(reqOf({ headers: { "x-webhook-secret": "wrong" } }), "{}")
        .ok,
      false,
    );
    assert.equal(
      verifyWebhook(
        reqOf({ headers: { authorization: "Bearer abc123" } }),
        "{}",
      ).ok,
      true,
    );
  } finally {
    Object.assign(process.env, orig);
  }
});

test("verifyWebhook: Loop signature required when secret configured + Loop UA", () => {
  const orig = { ...process.env };
  process.env.LOOP_WEBHOOK_SECRET = "loop-secret";
  process.env.WEBHOOK_SECRET = "shared-only";
  try {
    const body = '{"event":"message_inbound"}';
    const sig = createHmac("sha256", "loop-secret").update(body).digest("hex");

    // Missing signature on Loop-shaped request: rejected even though
    // shared secret would match.
    const missing = verifyWebhook(
      reqOf({
        headers: {
          "user-agent": "loopmessage/1.0",
          "x-webhook-secret": "shared-only",
        },
      }),
      body,
    );
    assert.equal(missing.ok, false);

    // Valid signature: accepted.
    const ok = verifyWebhook(
      reqOf({
        headers: {
          "user-agent": "loopmessage/1.0",
          "loop-signature": sig,
        },
      }),
      body,
    );
    assert.equal(ok.ok, true);
    assert.equal(ok.reason, "loop-signature");

    // Wrong signature: rejected.
    const bad = verifyWebhook(
      reqOf({
        headers: {
          "user-agent": "loopmessage/1.0",
          "loop-signature": "deadbeefcafe",
        },
      }),
      body,
    );
    assert.equal(bad.ok, false);
  } finally {
    Object.assign(process.env, orig);
  }
});

test("checkAdminAuth: dev allows when unset; prod refuses", () => {
  const orig = { ...process.env };
  delete process.env.ADMIN_TOKEN;
  delete process.env.NODE_ENV;
  try {
    assert.equal(checkAdminAuth(reqOf({ url: "/debug/x" })), true);
    process.env.NODE_ENV = "production";
    assert.equal(checkAdminAuth(reqOf({ url: "/debug/x" })), false);
  } finally {
    Object.assign(process.env, orig);
  }
});

test("checkAdminAuth: token comparison is constant-time-safe", () => {
  const orig = { ...process.env };
  process.env.ADMIN_TOKEN = "secret-token";
  try {
    assert.equal(
      checkAdminAuth(
        reqOf({ url: "/debug/x", headers: { "x-admin-token": "secret-token" } }),
      ),
      true,
    );
    assert.equal(
      checkAdminAuth(
        reqOf({ url: "/debug/x", headers: { "x-admin-token": "nope" } }),
      ),
      false,
    );
    // Different lengths must not throw / match.
    assert.equal(
      checkAdminAuth(
        reqOf({ url: "/debug/x", headers: { "x-admin-token": "x" } }),
      ),
      false,
    );
  } finally {
    Object.assign(process.env, orig);
  }
});

test("getAllowedOrigins parses CSV", () => {
  const orig = { ...process.env };
  process.env.CORS_ALLOWED_ORIGINS = "https://a.com, https://b.com";
  try {
    const set = getAllowedOrigins();
    assert.equal(set.has("https://a.com"), true);
    assert.equal(set.has("https://b.com"), true);
    assert.equal(set.has("https://c.com"), false);
  } finally {
    Object.assign(process.env, orig);
  }
});

test("resolveCorsOrigin: production with allowlist denies unknown origins", () => {
  const orig = { ...process.env };
  process.env.CORS_ALLOWED_ORIGINS = "https://app.amber.so";
  process.env.NODE_ENV = "production";
  try {
    assert.equal(
      resolveCorsOrigin(reqOf({ origin: "https://app.amber.so" })),
      "https://app.amber.so",
    );
    assert.equal(resolveCorsOrigin(reqOf({ origin: "https://evil.com" })), null);
    assert.equal(resolveCorsOrigin(reqOf({})), null);
  } finally {
    Object.assign(process.env, orig);
  }
});

test("resolveCorsOrigin: dev permissive when no allowlist", () => {
  const orig = { ...process.env };
  delete process.env.CORS_ALLOWED_ORIGINS;
  delete process.env.NODE_ENV;
  try {
    const got = resolveCorsOrigin(reqOf({ origin: "http://localhost:3000" }));
    assert.equal(got, "http://localhost:3000");
    assert.equal(resolveCorsOrigin(reqOf({})), "*");
  } finally {
    Object.assign(process.env, orig);
  }
});
