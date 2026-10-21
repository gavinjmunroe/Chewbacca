/**
 * Tests for Privy JWT extraction.
 *
 * The full verifyPrivyJwt pathway needs a remote JWKS, so it is not
 * unit-tested here. This file covers the parts we own end-to-end:
 *   - Bearer / x-privy-token / ?token extraction
 *   - Production gating of the ?token fallback (sensitive query string)
 *
 * Run with:  node --test Newton/agent/lib/__tests__/privy.test.mjs
 */

import { test } from "node:test";
import assert from "node:assert/strict";

function makeReq({ headers = {}, url = "/" } = {}) {
  return { headers, url };
}

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

// Re-import the module fresh so NODE_ENV reads at import time pick up.
async function loadPrivy() {
  const mod = await import(`../privy.js?cb=${Math.random()}`);
  return mod;
}

test("extractPrivyToken: prefers Authorization Bearer", async () => {
  const { extractPrivyToken } = await loadPrivy();
  const req = makeReq({
    headers: { authorization: "Bearer abc.def.ghi", "x-privy-token": "other" },
  });
  assert.equal(extractPrivyToken(req), "abc.def.ghi");
});

test("extractPrivyToken: falls back to x-privy-token", async () => {
  const { extractPrivyToken } = await loadPrivy();
  const req = makeReq({ headers: { "x-privy-token": "tok-2" } });
  assert.equal(extractPrivyToken(req), "tok-2");
});

test("extractPrivyToken: in dev, ?token= is accepted", async () => {
  await withEnv({ NODE_ENV: "development", ALLOW_QUERY_TOKEN: "" }, async () => {
    const { extractPrivyToken } = await loadPrivy();
    const req = makeReq({ url: "/api/identity/me?token=t-q" });
    assert.equal(extractPrivyToken(req), "t-q");
  });
});

test("extractPrivyToken: in prod, ?token= is rejected by default", async () => {
  await withEnv({ NODE_ENV: "production", ALLOW_QUERY_TOKEN: "" }, async () => {
    const { extractPrivyToken } = await loadPrivy();
    const req = makeReq({ url: "/api/identity/me?token=t-q" });
    assert.equal(extractPrivyToken(req), null);
  });
});

test("extractPrivyToken: in prod, ALLOW_QUERY_TOKEN=1 lets it through", async () => {
  await withEnv({ NODE_ENV: "production", ALLOW_QUERY_TOKEN: "1" }, async () => {
    const { extractPrivyToken } = await loadPrivy();
    const req = makeReq({ url: "/api/identity/me?token=t-q" });
    assert.equal(extractPrivyToken(req), "t-q");
  });
});

test("extractPrivyToken: returns null when nothing is supplied", async () => {
  const { extractPrivyToken } = await loadPrivy();
  assert.equal(extractPrivyToken(makeReq()), null);
});

test("verifyPrivyJwt: refuses without configured PRIVY_APP_ID", async () => {
  await withEnv({ PRIVY_APP_ID: "" }, async () => {
    const { verifyPrivyJwt } = await loadPrivy();
    await assert.rejects(
      () => verifyPrivyJwt("anything"),
      /PRIVY_APP_ID not configured/,
    );
  });
});

test("verifyPrivyJwt: rejects empty/non-string token", async () => {
  await withEnv({ PRIVY_APP_ID: "test-app" }, async () => {
    const { verifyPrivyJwt } = await loadPrivy();
    await assert.rejects(() => verifyPrivyJwt(""), /Privy JWT required/);
    await assert.rejects(() => verifyPrivyJwt(null), /Privy JWT required/);
  });
});
