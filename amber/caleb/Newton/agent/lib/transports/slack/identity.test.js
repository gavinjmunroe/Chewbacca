/**
 * Tests for lookupSenderByEmail — the medha-id /internal/contacts/by-email
 * client used by the Slack envelope to identify an unlinked sender by their
 * Slack profile email. The function must:
 *   - return null on miss / config gap / network error (the envelope falls
 *     through to the unidentified path so a slow medha-id never strands
 *     the user)
 *   - cache positive AND negative results for 1h per email
 *   - never log the email or the response payload
 *
 * Run with:  node --test Newton/agent/lib/transports/slack/identity.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

// Stub the medha-id env BEFORE importing the module so isConfigured() sees
// the values. Identity.js reads the env once at module import via
// constants.js — set the env, set those constants to match.
process.env.MEDHA_ID_URL = "https://medha-id-test.invalid";
process.env.MEDHA_ID_API_KEY = "test-key";

const { lookupSenderByEmail, _resetSenderEmailCacheForTests } =
  await import("./identity.js");

const originalFetch = globalThis.fetch;

function mockFetch(responses) {
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    const next = responses.shift();
    if (!next) throw new Error(`no mock response for ${url}`);
    if (next instanceof Error) throw next;
    return next;
  };
  return calls;
}

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

test.afterEach(() => {
  globalThis.fetch = originalFetch;
  _resetSenderEmailCacheForTests();
});

test("lookupSenderByEmail returns null for non-string and empty inputs", async () => {
  assert.equal(await lookupSenderByEmail(null), null);
  assert.equal(await lookupSenderByEmail(undefined), null);
  assert.equal(await lookupSenderByEmail(""), null);
  assert.equal(await lookupSenderByEmail("   "), null);
});

test("lookupSenderByEmail parses a tenant_owner hit", async () => {
  mockFetch([
    jsonResponse(200, {
      found: true,
      kind: "tenant_owner",
      did: "did:privy:abc",
      displayName: "Sagar",
      matchedVia: "privy_primary",
    }),
  ]);
  const out = await lookupSenderByEmail("Sagar@Rytual.com");
  assert.deepEqual(out, {
    kind: "tenant_owner",
    did: "did:privy:abc",
    displayName: "Sagar",
    matchedVia: "privy_primary",
  });
});

test("lookupSenderByEmail parses a contact hit and prefers firstName", async () => {
  mockFetch([
    jsonResponse(200, {
      found: true,
      kind: "contact",
      did: "did:privy:sagar",
      contactId: "contact_abc",
      contact: {
        id: "contact_abc",
        name: "Caleb Newton",
        firstName: "Caleb",
        lastName: "Newton",
      },
    }),
  ]);
  const out = await lookupSenderByEmail("caleb@bluemodernadvisory.com");
  assert.equal(out.kind, "contact");
  assert.equal(out.did, "did:privy:sagar");
  assert.equal(out.contactId, "contact_abc");
  assert.equal(out.displayName, "Caleb");
  assert.equal(out.firstName, "Caleb");
  assert.equal(out.name, "Caleb Newton");
});

test("lookupSenderByEmail falls back to name when firstName missing", async () => {
  mockFetch([
    jsonResponse(200, {
      found: true,
      kind: "contact",
      did: "did:privy:sagar",
      contactId: "contact_z",
      contact: { id: "contact_z", name: "Onlyname", firstName: null },
    }),
  ]);
  const out = await lookupSenderByEmail("onlyname@example.com");
  assert.equal(out.displayName, "Onlyname");
});

test("lookupSenderByEmail returns null when service reports found: false", async () => {
  mockFetch([jsonResponse(200, { found: false })]);
  const out = await lookupSenderByEmail("nope@example.com");
  assert.equal(out, null);
});

test("lookupSenderByEmail returns null on 5xx and does NOT cache the error", async () => {
  // First call: 500 — should return null, NOT cache.
  // Second call: 200 hit — should reach the server again (no stale null).
  mockFetch([
    jsonResponse(500, { error: "boom" }),
    jsonResponse(200, {
      found: true,
      kind: "tenant_owner",
      did: "did:privy:abc",
      displayName: "After",
    }),
  ]);
  assert.equal(await lookupSenderByEmail("retry@example.com"), null);
  const second = await lookupSenderByEmail("retry@example.com");
  assert.equal(second?.displayName, "After");
});

test("lookupSenderByEmail caches positive hits for repeat calls", async () => {
  const calls = mockFetch([
    jsonResponse(200, {
      found: true,
      kind: "contact",
      did: "did:privy:sagar",
      contactId: "c1",
      contact: { id: "c1", name: "Caleb", firstName: "Caleb" },
    }),
  ]);
  const first = await lookupSenderByEmail("Caleb@example.com");
  const second = await lookupSenderByEmail("caleb@EXAMPLE.com");
  assert.equal(first?.contactId, "c1");
  assert.equal(second?.contactId, "c1");
  // Only one fetch call: cache hit on the second (case-insensitive).
  assert.equal(calls.length, 1);
});

test("lookupSenderByEmail caches negative hits (found: false)", async () => {
  const calls = mockFetch([jsonResponse(200, { found: false })]);
  assert.equal(await lookupSenderByEmail("none@example.com"), null);
  assert.equal(await lookupSenderByEmail("none@example.com"), null);
  // The second call must NOT re-hit the network — that's the whole point
  // of the negative cache. Otherwise a single unknown sender DMing
  // repeatedly would hammer medha-id.
  assert.equal(calls.length, 1);
});

test("lookupSenderByEmail returns null on fetch throw and does not cache", async () => {
  const calls = mockFetch([
    new Error("network down"),
    jsonResponse(200, { found: false }),
  ]);
  assert.equal(await lookupSenderByEmail("flaky@example.com"), null);
  // Second call retries because we don't cache transient errors.
  assert.equal(await lookupSenderByEmail("flaky@example.com"), null);
  assert.equal(calls.length, 2);
});
