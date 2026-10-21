/**
 * Smoke tests for lib/transports/slack/identity.js lookupTenantByEmail.
 *
 * Run with:
 *   node Newton/agent/lib/__tests__/slack-identity-by-email.test.mjs
 *
 * Exits non-zero on failure. Mirrors the *.test.mjs pattern in this directory.
 * We stub global.fetch so no real medha-id is contacted.
 */

import assert from "node:assert/strict";

process.env.MEDHA_ID_URL = "https://stub.invalid";
process.env.MEDHA_ID_API_KEY = "test-key";

const { lookupTenantByEmail } = await import("../transports/slack/identity.js");

let passed = 0;
let failed = 0;
const originalFetch = global.fetch;

async function test(name, fn) {
  global.fetch = originalFetch;
  try {
    await fn();
    passed += 1;
    console.log(`  ok  ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`  FAIL ${name}`);
    console.error(err);
  } finally {
    global.fetch = originalFetch;
  }
}

function fakeResponse({ status = 200, body = null }) {
  return {
    status,
    ok: status >= 200 && status < 300,
    async json() {
      return body;
    },
  };
}

console.log("slack-identity by-email");

await test("returns null when medha-id 404s — caller falls through to Option C", async () => {
  global.fetch = async () => fakeResponse({ status: 404, body: {} });
  const result = await lookupTenantByEmail("nope@example.com");
  assert.equal(result, null);
});

await test("surfaces matchedVia + matchedKey when amber-id reports an oauth_account match", async () => {
  global.fetch = async () =>
    fakeResponse({
      body: {
        data: {
          kind: "tenant_owner",
          id: "did:privy:abc",
          privyDid: "did:privy:abc",
          phoneNumber: "+15551112222",
          displayName: "Sagar",
          ownerName: "Sagar Tiwari",
          matchedVia: "oauth_account",
          matchedKey: "MS_OAUTH_ACCOUNT_EMAIL",
        },
      },
    });
  const result = await lookupTenantByEmail("caleb@bluemodernadvisory.com");
  assert.ok(result, "should resolve");
  assert.equal(result.did, "did:privy:abc");
  assert.equal(result.phone, "+15551112222");
  assert.equal(result.matchedVia, "oauth_account");
  assert.equal(result.matchedKey, "MS_OAUTH_ACCOUNT_EMAIL");
});

await test("defaults matchedVia + matchedKey to null when amber-id omits them (back-compat)", async () => {
  global.fetch = async () =>
    fakeResponse({
      body: {
        data: {
          id: "did:privy:legacy",
          phoneNumber: "+15553334444",
        },
      },
    });
  const result = await lookupTenantByEmail("legacy@example.com");
  assert.ok(result, "should still resolve");
  assert.equal(result.matchedVia, null);
  assert.equal(result.matchedKey, null);
});

await test("returns null when tenant has no phone (not a candidate for auto-bind)", async () => {
  global.fetch = async () =>
    fakeResponse({
      body: {
        data: { id: "did:privy:no-phone", matchedVia: "privy_primary" },
      },
    });
  const result = await lookupTenantByEmail("no-phone@example.com");
  assert.equal(result, null);
});

await test("returns null for malformed input", async () => {
  global.fetch = async () => {
    throw new Error("should not be called");
  };
  assert.equal(await lookupTenantByEmail(null), null);
  assert.equal(await lookupTenantByEmail(""), null);
  assert.equal(await lookupTenantByEmail("  "), null);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
