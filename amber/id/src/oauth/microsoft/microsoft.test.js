/**
 * Unit tests for the Microsoft OAuth helpers.
 *
 *   node --test src/oauth/microsoft/microsoft.test.js
 *
 * The tests stub out the Tab 1.1 state module and the secrets DB so they
 * run with zero network / Firestore dependency.
 */

import test from "node:test";
import assert from "node:assert/strict";

process.env.MS_OAUTH_CLIENT_ID = "test-client-id";
process.env.MS_OAUTH_CLIENT_SECRET = "test-client-secret";
process.env.MEDHA_ID_PUBLIC_URL = "https://amber-id.example.com";
process.env.MEDHA_FRONTEND_URL = "https://medha.example.com";

// These tests cover scopes.js + callback.js. init.js depends on Tab 1.1's
// state helpers, which land in a separate branch; init.js is exercised
// end-to-end via the integration tests Caleb runs after the batch mount.

test("MICROSOFT_SCOPES covers Outlook + Calendar + OneDrive + Teams", async () => {
  const { MICROSOFT_SCOPES, MICROSOFT_AUTHORIZE_URL, MICROSOFT_TOKEN_URL } =
    await import("./scopes.js");

  assert.ok(
    MICROSOFT_SCOPES.includes("offline_access"),
    "needs offline_access for refresh",
  );
  assert.ok(MICROSOFT_SCOPES.includes("User.Read"));
  assert.ok(MICROSOFT_SCOPES.includes("Calendars.ReadWrite"));
  assert.ok(MICROSOFT_SCOPES.includes("Mail.Send"));
  assert.ok(MICROSOFT_SCOPES.includes("Mail.Read"));
  assert.ok(
    MICROSOFT_SCOPES.includes("Files.ReadWrite"),
    "OneDrive surface needs Files.ReadWrite",
  );
  assert.ok(
    MICROSOFT_SCOPES.includes("Chat.ReadWrite"),
    "Teams chat needs Chat.ReadWrite",
  );
  assert.ok(
    MICROSOFT_SCOPES.includes("ChatMessage.Send"),
    "Teams send needs ChatMessage.Send (separate from Chat.ReadWrite)",
  );
  assert.ok(
    MICROSOFT_SCOPES.includes("Presence.Read"),
    "Teams presence needs Presence.Read",
  );
  assert.match(MICROSOFT_AUTHORIZE_URL, /login\.microsoftonline\.com/);
  assert.match(MICROSOFT_TOKEN_URL, /login\.microsoftonline\.com/);
});

test("exchangeCode throws missing_code when given an empty code", async () => {
  const { exchangeCode } = await import("./callback.js");
  await assert.rejects(() => exchangeCode(""), /missing_code/);
  await assert.rejects(() => exchangeCode(null), /missing_code/);
});

test("exchangeCode posts client creds + parses token response", async () => {
  const { exchangeCode } = await import("./callback.js");

  const originalFetch = globalThis.fetch;
  let capturedUrl;
  let capturedBody;
  globalThis.fetch = async (url, init) => {
    capturedUrl = url;
    capturedBody = init.body;
    return {
      ok: true,
      status: 200,
      json: async () => ({
        access_token: "AT123",
        refresh_token: "RT456",
        expires_in: 3599,
        scope: "User.Read Mail.Send offline_access",
        token_type: "Bearer",
      }),
    };
  };

  try {
    const tokens = await exchangeCode("authcode");
    assert.equal(tokens.access_token, "AT123");
    assert.equal(tokens.refresh_token, "RT456");
    assert.equal(tokens.expires_in, 3599);
    assert.match(tokens.scope, /User\.Read/);
    assert.match(capturedUrl, /\/oauth2\/v2\.0\/token/);
    assert.match(capturedBody, /grant_type=authorization_code/);
    assert.match(capturedBody, /code=authcode/);
    assert.match(capturedBody, /client_id=test-client-id/);
    assert.match(capturedBody, /client_secret=test-client-secret/);
    assert.match(
      capturedBody,
      /redirect_uri=https%3A%2F%2Famber-id\.example\.com%2Fv1%2Foauth%2Fmicrosoft%2Fcallback/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("exchangeCode surfaces error.code from Microsoft's error_description", async () => {
  const { exchangeCode } = await import("./callback.js");

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: false,
    status: 400,
    json: async () => ({
      error: "invalid_grant",
      error_description: "AADSTS70008: refresh token expired",
    }),
  });

  try {
    await assert.rejects(
      () => exchangeCode("badcode"),
      (err) => err.code === "invalid_grant" && err.status === 400,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("exchangeCode rejects when no access_token in response", async () => {
  const { exchangeCode } = await import("./callback.js");

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({ token_type: "Bearer" }),
  });

  try {
    await assert.rejects(
      () => exchangeCode("c"),
      (err) => err.code === "no_access_token_returned",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// Build a fake id_token payload. Microsoft's id_token is a JWT whose middle
// segment is base64url-encoded JSON. We don't verify the signature, so any
// string in the signature slot works.
function fakeIdToken(claims) {
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" }))
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  const payload = Buffer.from(JSON.stringify(claims))
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return `${header}.${payload}.signature-not-verified`;
}

test("accountFromIdToken prefers the `email` claim when present", async () => {
  const { accountFromIdToken } = await import("./callback.js");
  const idToken = fakeIdToken({
    email: "caleb@outlook.com",
    preferred_username: "caleb_aad_upn@example.com",
  });
  assert.equal(accountFromIdToken(idToken), "caleb@outlook.com");
});

test("accountFromIdToken falls back to preferred_username when email missing", async () => {
  const { accountFromIdToken } = await import("./callback.js");
  const idToken = fakeIdToken({
    preferred_username: "caleb@contoso.onmicrosoft.com",
  });
  assert.equal(
    accountFromIdToken(idToken),
    "caleb@contoso.onmicrosoft.com",
    "AAD work account: preferred_username is the UPN",
  );
});

test("accountFromIdToken returns null for empty / malformed / claimless tokens", async () => {
  const { accountFromIdToken } = await import("./callback.js");
  assert.equal(accountFromIdToken(null), null);
  assert.equal(accountFromIdToken(""), null);
  assert.equal(accountFromIdToken("not-a-jwt"), null);
  assert.equal(accountFromIdToken("only.two"), null);
  assert.equal(accountFromIdToken(fakeIdToken({ sub: "abc" })), null);
});

test("MICROSOFT_SECRET_KEYS includes the account email + connected_at keys", async () => {
  const { MICROSOFT_SECRET_KEYS } = await import("./callback.js");
  // Regression: the Google grind found that callback storage and the
  // `connections.js` registry must agree on every key, otherwise the
  // /connect page reports stale "not connected" rows after disconnect.
  assert.ok(MICROSOFT_SECRET_KEYS.includes("MS_OAUTH_REFRESH"));
  assert.ok(MICROSOFT_SECRET_KEYS.includes("MS_OAUTH_ACCESS"));
  assert.ok(MICROSOFT_SECRET_KEYS.includes("MS_OAUTH_EXPIRES_AT"));
  assert.ok(MICROSOFT_SECRET_KEYS.includes("MS_OAUTH_SCOPES"));
  assert.ok(MICROSOFT_SECRET_KEYS.includes("MS_OAUTH_ACCOUNT_EMAIL"));
  assert.ok(MICROSOFT_SECRET_KEYS.includes("MS_OAUTH_CONNECTED_AT"));
});

test("MICROSOFT_SECRET_KEYS includes MS_OAUTH_CLIENT_ID + MS_OAUTH_CLIENT_SECRET", async () => {
  const { MICROSOFT_SECRET_KEYS } = await import("./callback.js");
  // Regression: T4 — every OAuth callback must persist the platform's
  // client credentials into the per-tenant bag, so downstream consumers
  // never silently fall back to a process.env value that might not
  // resolve on a given host. The corresponding clearTokens path must
  // also include both keys, which is what this list drives.
  assert.ok(
    MICROSOFT_SECRET_KEYS.includes("MS_OAUTH_CLIENT_ID"),
    "clearTokens must wipe MS_OAUTH_CLIENT_ID",
  );
  assert.ok(
    MICROSOFT_SECRET_KEYS.includes("MS_OAUTH_CLIENT_SECRET"),
    "clearTokens must wipe MS_OAUTH_CLIENT_SECRET",
  );
});
