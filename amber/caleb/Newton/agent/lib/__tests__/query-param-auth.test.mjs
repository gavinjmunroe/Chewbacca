/**
 * Tests that query-param token auth is blocked in production.
 *
 * ?token= in a URL ends up in access logs, proxy logs, Referer headers,
 * and browser history. It must never work in production.
 *
 * Run with:  node --test Newton/agent/lib/__tests__/query-param-auth.test.mjs
 */

import { test } from "node:test";
import assert from "node:assert/strict";

async function withEnv(overrides, fn) {
  const before = {};
  for (const k of Object.keys(overrides)) before[k] = process.env[k];
  Object.assign(process.env, overrides);
  try {
    await fn();
  } finally {
    for (const k of Object.keys(overrides)) {
      if (before[k] === undefined) delete process.env[k];
      else process.env[k] = before[k];
    }
  }
}

// Cache-bust the module so NODE_ENV changes take effect.
async function loadPrivy() {
  return import(`../privy.js?cb=${Math.random()}`);
}

function makeReq({ headers = {}, url = "/" } = {}) {
  return { headers, url };
}

// ── Production gating ────────────────────────────────────────────────────

test("query-param auth: ?token= is BLOCKED in production by default", async () => {
  await withEnv({ NODE_ENV: "production", ALLOW_QUERY_TOKEN: "" }, async () => {
    const { extractPrivyToken } = await loadPrivy();
    const req = makeReq({ url: "/api/identity/me?token=secret-prod-token" });
    const result = extractPrivyToken(req);
    assert.equal(
      result,
      null,
      "?token= must return null in production to prevent token leakage in logs",
    );
  });
});

test("query-param auth: ?token= is BLOCKED in production even with other params", async () => {
  await withEnv({ NODE_ENV: "production", ALLOW_QUERY_TOKEN: "" }, async () => {
    const { extractPrivyToken } = await loadPrivy();
    const req = makeReq({ url: "/api/ask?foo=bar&token=secret&baz=1" });
    assert.equal(extractPrivyToken(req), null);
  });
});

test("query-param auth: ?apiKey= style is not accepted at all (uses ?token=)", async () => {
  await withEnv({ NODE_ENV: "development" }, async () => {
    const { extractPrivyToken } = await loadPrivy();
    // privy.js only reads `token`, not `apiKey`
    const req = makeReq({ url: "/api/ask?apiKey=somekey" });
    assert.equal(
      extractPrivyToken(req),
      null,
      "?apiKey= must not be accepted; only Authorization header or x-privy-token",
    );
  });
});

// ── Development permissiveness (ALLOW_QUERY_TOKEN=1 opt-in) ─────────────

test("query-param auth: ?token= accepted in development (non-prod)", async () => {
  await withEnv({ NODE_ENV: "development", ALLOW_QUERY_TOKEN: "" }, async () => {
    const { extractPrivyToken } = await loadPrivy();
    const req = makeReq({ url: "/api/identity/me?token=dev-token-ok" });
    assert.equal(extractPrivyToken(req), "dev-token-ok");
  });
});

test("query-param auth: ALLOW_QUERY_TOKEN=1 overrides production gate", async () => {
  await withEnv({ NODE_ENV: "production", ALLOW_QUERY_TOKEN: "1" }, async () => {
    const { extractPrivyToken } = await loadPrivy();
    const req = makeReq({ url: "/api/identity/me?token=staging-probe" });
    assert.equal(
      extractPrivyToken(req),
      "staging-probe",
      "ALLOW_QUERY_TOKEN=1 should be the explicit staging probe override",
    );
  });
});

// ── Canonical header auth always works ──────────────────────────────────

test("query-param auth: Authorization Bearer always works in prod", async () => {
  await withEnv({ NODE_ENV: "production", ALLOW_QUERY_TOKEN: "" }, async () => {
    const { extractPrivyToken } = await loadPrivy();
    const req = makeReq({
      headers: { authorization: "Bearer prod-jwt-here" },
      url: "/api/tiwari/peoplerank",
    });
    assert.equal(extractPrivyToken(req), "prod-jwt-here");
  });
});

test("query-param auth: x-privy-token header always works in prod", async () => {
  await withEnv({ NODE_ENV: "production", ALLOW_QUERY_TOKEN: "" }, async () => {
    const { extractPrivyToken } = await loadPrivy();
    const req = makeReq({
      headers: { "x-privy-token": "ios-jwt-here" },
      url: "/api/ask",
    });
    assert.equal(extractPrivyToken(req), "ios-jwt-here");
  });
});
