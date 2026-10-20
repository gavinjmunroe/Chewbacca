/**
 * Amber LinkedIn Chrome Extension: Test Suite
 *
 * Tests all background.js logic with fully mocked chrome.* APIs.
 * Run with: node tests/background.test.js
 *
 * No browser, no Chrome, no network. Pure Node.js.
 */

// ─── Mock chrome APIs ─────────────────────────────────────────────────────────

const messageListeners = [];
const externalMessageListeners = [];
const startupListeners = [];
const installedListeners = [];

const chrome = {
  cookies: {
    _store: {},
    get: async ({ url, name }) => {
      const key = `${url}::${name}`;
      const val = chrome.cookies._store[key];
      return val ? { value: val } : null;
    },
    _set: (url, name, value) => {
      chrome.cookies._store[`${url}::${name}`] = value;
    },
    _clear: () => {
      chrome.cookies._store = {};
    },
  },
  storage: {
    local: {
      _data: {},
      get: (keys, callback) => {
        const result = {};
        const arr = Array.isArray(keys) ? keys : [keys];
        for (const k of arr) result[k] = chrome.storage.local._data[k];
        if (callback) {
          callback(result);
          return;
        }
        return Promise.resolve(result);
      },
      set: (obj, callback) => {
        Object.assign(chrome.storage.local._data, obj);
        if (callback) callback();
        return Promise.resolve();
      },
      remove: (keys, callback) => {
        const arr = Array.isArray(keys) ? keys : [keys];
        for (const k of arr) delete chrome.storage.local._data[k];
        if (callback) callback();
        return Promise.resolve();
      },
      _clear: () => {
        chrome.storage.local._data = {};
      },
    },
  },
  runtime: {
    onMessageExternal: {
      addListener: (fn) => externalMessageListeners.push(fn),
    },
    onMessage: {
      addListener: (fn) => messageListeners.push(fn),
    },
    onStartup: {
      addListener: (fn) => startupListeners.push(fn),
    },
    onInstalled: {
      addListener: (fn) => installedListeners.push(fn),
    },
    getManifest: () => ({ version: "1.0.0" }),
  },
  action: {
    _badge: { text: "", color: "" },
    setBadgeText: async ({ text }) => {
      chrome.action._badge.text = text;
    },
    setBadgeBackgroundColor: async ({ color }) => {
      chrome.action._badge.color = color;
    },
  },
};

global.chrome = chrome;

// ─── Constants ───────────────────────────────────────────────────────────────

const BACKEND = "https://medha-id-production.up.railway.app";
const FRONTEND = "https://medha-frontend-production-5f4f.up.railway.app";
const EXPECTED_ENDPOINT = `${BACKEND}/v1/oauth/linkedin/cookies`;

// ─── Mock fetch ───────────────────────────────────────────────────────────────

let mockFetchResponse = {
  ok: true,
  status: 200,
  body: { ok: true, connections_synced: 1234 },
};

function makeMockFetch() {
  return async (url, opts) => {
    global._lastFetchCall = { url, opts };
    return {
      ok: mockFetchResponse.ok,
      status: mockFetchResponse.status,
      json: async () => mockFetchResponse.body,
      text: async () => JSON.stringify(mockFetchResponse.body),
    };
  };
}

global.fetch = makeMockFetch();

// ─── Load background.js ───────────────────────────────────────────────────────
// We eval it because it uses top-level chrome.runtime.on* calls and exports
// nothing. eval lets the test pull syncLinkedIn / isTrustedBackend / etc.
// into scope.

const fs = require("fs");
const path = require("path");
const code = fs.readFileSync(path.join(__dirname, "../background.js"), "utf8");
eval(code); // eslint-disable-line no-eval

// ─── Test helpers ─────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

async function test(name, fn) {
  // Reset state between tests
  chrome.cookies._clear();
  chrome.storage.local._clear();
  global._lastFetchCall = null;
  global.fetch = makeMockFetch();
  mockFetchResponse = {
    ok: true,
    status: 200,
    body: { ok: true, connections_synced: 1234 },
  };

  try {
    await fn();
    console.log(`  ok  ${name}`);
    passed++;
  } catch (err) {
    console.log(`  FAIL  ${name}`);
    console.log(`        ${err.message}`);
    failed++;
  }
}

function assert(condition, msg) {
  if (!condition) throw new Error(msg || "Assertion failed");
}

function assertEqual(a, b, msg) {
  if (a !== b)
    throw new Error(
      msg || `Expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`,
    );
}

// Simulate sending an external message and getting a response.
function sendExternalMessage(message, sender = {}) {
  return new Promise((resolve) => {
    const handler = externalMessageListeners[0];
    if (!handler) throw new Error("No external message listener registered");
    const keepOpen = handler(message, sender, resolve);
    if (!keepOpen) resolve(undefined);
  });
}

function sendInternalMessage(message) {
  return new Promise((resolve) => {
    const handler = messageListeners[0];
    if (!handler) throw new Error("No internal message listener registered");
    const keepOpen = handler(message, {}, resolve);
    if (!keepOpen) resolve(undefined);
  });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

async function runTests() {
  console.log("\nAmber LinkedIn Extension: Test Suite\n");

  // ── isLinkedInLoggedIn ────────────────────────────────────────────────────

  console.log("isLinkedInLoggedIn()");

  await test("returns true when li_at cookie exists", async () => {
    chrome.cookies._set("https://www.linkedin.com", "li_at", "AQED_test");
    const result = await isLinkedInLoggedIn();
    assert(result === true);
  });

  await test("returns false when li_at cookie is missing", async () => {
    const result = await isLinkedInLoggedIn();
    assert(result === false);
  });

  await test("returns false when li_at cookie value is empty", async () => {
    chrome.cookies._set("https://www.linkedin.com", "li_at", "");
    const result = await isLinkedInLoggedIn();
    assert(result === false);
  });

  // ── getLinkedInCookies ────────────────────────────────────────────────────

  console.log("\ngetLinkedInCookies()");

  await test("returns both cookies when present", async () => {
    chrome.cookies._set("https://www.linkedin.com", "li_at", "AQED_abc");
    chrome.cookies._set("https://www.linkedin.com", "JSESSIONID", "ajax:9876");
    const cookies = await getLinkedInCookies();
    assertEqual(cookies["li_at"], "AQED_abc");
    assertEqual(cookies["JSESSIONID"], "ajax:9876");
  });

  await test("returns only present cookies when one is missing", async () => {
    chrome.cookies._set("https://www.linkedin.com", "li_at", "AQED_abc");
    const cookies = await getLinkedInCookies();
    assertEqual(cookies["li_at"], "AQED_abc");
    assert(!cookies["JSESSIONID"], "JSESSIONID should be absent");
  });

  await test("returns empty object when no cookies present", async () => {
    const cookies = await getLinkedInCookies();
    assertEqual(Object.keys(cookies).length, 0);
  });

  // ── syncLinkedIn ──────────────────────────────────────────────────────────

  console.log("\nsyncLinkedIn()");

  await test("succeeds when logged in and backend returns 200", async () => {
    chrome.cookies._set("https://www.linkedin.com", "li_at", "AQED_abc");
    chrome.cookies._set("https://www.linkedin.com", "JSESSIONID", "ajax:9876");
    const result = await syncLinkedIn(BACKEND, "test_auth_token");
    assert(result.success === true, `Expected success, got: ${result.message}`);
    assertEqual(result.connections_synced, 1234);
  });

  await test("hits the cookie-sync endpoint at the right path", async () => {
    chrome.cookies._set("https://www.linkedin.com", "li_at", "AQED_abc");
    chrome.cookies._set("https://www.linkedin.com", "JSESSIONID", "ajax:9876");
    await syncLinkedIn(BACKEND, "bearer_token_xyz");
    assert(global._lastFetchCall, "fetch was not called");
    assertEqual(global._lastFetchCall.url, EXPECTED_ENDPOINT);
    const body = JSON.parse(global._lastFetchCall.opts.body);
    assertEqual(body.li_at, "AQED_abc");
    assertEqual(body.jsessionid, "ajax:9876");
  });

  await test("sends Authorization header with bearer token", async () => {
    chrome.cookies._set("https://www.linkedin.com", "li_at", "AQED_abc");
    await syncLinkedIn(BACKEND, "my_jwt_token");
    const authHeader = global._lastFetchCall.opts.headers["Authorization"];
    assertEqual(authHeader, "Bearer my_jwt_token");
  });

  await test("saves connected + lastSyncAt + lastSyncedCount after success", async () => {
    chrome.cookies._set("https://www.linkedin.com", "li_at", "AQED_abc");
    await syncLinkedIn(BACKEND, "token");
    const stored = await chrome.storage.local.get([
      "connected",
      "backendUrl",
      "lastSyncAt",
      "lastSyncedCount",
    ]);
    assert(stored.connected === true);
    assertEqual(stored.backendUrl, BACKEND);
    assertEqual(stored.lastSyncedCount, 1234);
    assert(
      typeof stored.lastSyncAt === "string" && stored.lastSyncAt.length > 0,
      "lastSyncAt should be an ISO timestamp",
    );
  });

  await test("re-sync overwrites lastSyncAt with a newer timestamp", async () => {
    chrome.cookies._set("https://www.linkedin.com", "li_at", "AQED_abc");
    await syncLinkedIn(BACKEND, "token");
    const first = (await chrome.storage.local.get(["lastSyncAt"])).lastSyncAt;
    await new Promise((r) => setTimeout(r, 5));
    mockFetchResponse = {
      ok: true,
      status: 200,
      body: { ok: true, connections_synced: 9999 },
    };
    await syncLinkedIn(BACKEND, "token");
    const second = await chrome.storage.local.get([
      "lastSyncAt",
      "lastSyncedCount",
    ]);
    assert(second.lastSyncAt > first, "second sync should be newer");
    assertEqual(second.lastSyncedCount, 9999);
  });

  await test("returns not_logged_in error when no li_at cookie", async () => {
    const result = await syncLinkedIn(BACKEND, "token");
    assert(result.success === false);
    assertEqual(result.error, "not_logged_in");
    assert(!global._lastFetchCall, "fetch should not be called");
  });

  await test("returns backend_error when backend returns non-200", async () => {
    chrome.cookies._set("https://www.linkedin.com", "li_at", "AQED_abc");
    mockFetchResponse = {
      ok: false,
      status: 401,
      body: { error: "Unauthorized" },
    };
    const result = await syncLinkedIn(BACKEND, "bad_token");
    assert(result.success === false);
    assertEqual(result.error, "backend_error");
    assert(result.message.includes("401"));
  });

  await test("returns backend_error when fetch throws (network failure)", async () => {
    chrome.cookies._set("https://www.linkedin.com", "li_at", "AQED_abc");
    global.fetch = async () => {
      throw new Error("Network error");
    };
    const result = await syncLinkedIn(BACKEND, "token");
    assert(result.success === false);
    assertEqual(result.error, "backend_error");
    assert(result.message.includes("Network error"));
  });

  await test("success message includes count when backend returns one", async () => {
    chrome.cookies._set("https://www.linkedin.com", "li_at", "AQED_abc");
    mockFetchResponse = {
      ok: true,
      status: 200,
      body: { ok: true, connections_synced: 42 },
    };
    const result = await syncLinkedIn(BACKEND, "token");
    assert(result.message.includes("42"), `message was: ${result.message}`);
  });

  await test("success message falls back when backend omits count", async () => {
    chrome.cookies._set("https://www.linkedin.com", "li_at", "AQED_abc");
    mockFetchResponse = { ok: true, status: 200, body: { ok: true } };
    const result = await syncLinkedIn(BACKEND, "token");
    assert(result.success === true);
    assertEqual(result.connections_synced, null);
    assert(result.message.length > 0, "message should still be set");
  });

  // ── isTrustedBackend ──────────────────────────────────────────────────────

  console.log("\nisTrustedBackend()");

  await test("returns true for medha-id-production", async () => {
    assert(isTrustedBackend(BACKEND) === true);
  });

  await test("returns true for backend with a path", async () => {
    assert(isTrustedBackend(`${BACKEND}/v1/oauth/linkedin/cookies`) === true);
  });

  await test("returns false for the frontend origin", async () => {
    // Frontend can DRIVE the extension via externally_connectable, but it is
    // not a trusted COOKIE recipient.
    assert(isTrustedBackend(FRONTEND) === false);
  });

  await test("returns false for localhost (deliberately stripped in prod build)", async () => {
    assert(isTrustedBackend("http://localhost:3000") === false);
  });

  await test("returns false for substring-style spoof of allowed host", async () => {
    assert(
      isTrustedBackend(
        "https://evil.medha-id-production.up.railway.app.attacker.com",
      ) === false,
    );
  });

  await test("returns false for attacker.com", async () => {
    assert(isTrustedBackend("https://attacker.com") === false);
  });

  await test("returns false for malformed URL", async () => {
    assert(isTrustedBackend("not a url") === false);
  });

  await test("returns false for empty string", async () => {
    assert(isTrustedBackend("") === false);
  });

  // ── syncLinkedIn allowlist enforcement ────────────────────────────────────

  console.log("\nsyncLinkedIn() backend allowlist");

  await test("rejects untrusted backend with untrusted_backend error", async () => {
    chrome.cookies._set("https://www.linkedin.com", "li_at", "AQED_abc");
    const result = await syncLinkedIn("https://attacker.com", "tok");
    assert(result.success === false);
    assertEqual(result.error, "untrusted_backend");
    assert(
      !global._lastFetchCall,
      "fetch must not be called for untrusted backend",
    );
  });

  await test("rejects substring-spoof host even when LinkedIn cookie is present", async () => {
    chrome.cookies._set("https://www.linkedin.com", "li_at", "AQED_abc");
    const result = await syncLinkedIn(
      "https://evil.medha-id-production.up.railway.app.attacker.com",
      "tok",
    );
    assert(result.success === false);
    assertEqual(result.error, "untrusted_backend");
    assert(!global._lastFetchCall);
  });

  await test("rejects untrusted backend BEFORE checking LinkedIn cookies", async () => {
    // Untrusted-backend rejection comes first. Ensures we don't leak the
    // presence/absence of a LinkedIn cookie via error type or timing.
    const result = await syncLinkedIn("https://attacker.com", "tok");
    assertEqual(result.error, "untrusted_backend");
  });

  await test("accepts medha-id-production and proceeds to backend", async () => {
    chrome.cookies._set("https://www.linkedin.com", "li_at", "AQED_abc");
    const result = await syncLinkedIn(BACKEND, "tok");
    assert(result.success === true);
    assert(global._lastFetchCall, "fetch should have been called");
  });

  // ── isTrustedSender ───────────────────────────────────────────────────────

  console.log("\nisTrustedSender()");

  await test("accepts frontend origin", async () => {
    assert(isTrustedSender(FRONTEND) === true);
  });

  await test("accepts backend origin", async () => {
    assert(isTrustedSender(BACKEND) === true);
  });

  await test("rejects unknown origin", async () => {
    assert(isTrustedSender("https://random.com") === false);
  });

  await test("rejects substring-spoof origin", async () => {
    assert(
      isTrustedSender(
        "https://evil.medha-frontend-production-5f4f.up.railway.app.attacker.com",
      ) === false,
    );
  });

  await test("rejects empty origin", async () => {
    assert(isTrustedSender("") === false);
    assert(isTrustedSender(null) === false);
    assert(isTrustedSender(undefined) === false);
  });

  // ── External message handler ──────────────────────────────────────────────

  console.log("\nExternal message handler (from Amber frontend)");

  await test("ping returns installed:true and version", async () => {
    const response = await sendExternalMessage({ action: "ping" });
    assert(response.installed === true);
    assertEqual(response.version, "1.0.0");
  });

  await test("sync_linkedin triggers full flow when logged in", async () => {
    chrome.cookies._set("https://www.linkedin.com", "li_at", "AQED_abc");
    chrome.cookies._set("https://www.linkedin.com", "JSESSIONID", "ajax:9876");
    const response = await sendExternalMessage({
      action: "sync_linkedin",
      backendUrl: BACKEND,
      authToken: "ext_token_abc",
    });
    assert(
      response.success === true,
      `Expected success, got: ${JSON.stringify(response)}`,
    );
    assertEqual(response.connections_synced, 1234);
  });

  await test("sync_linkedin falls back to DEFAULT_BACKEND when backendUrl absent", async () => {
    chrome.cookies._set("https://www.linkedin.com", "li_at", "AQED_abc");
    const response = await sendExternalMessage({
      action: "sync_linkedin",
      authToken: "ext_token_abc",
    });
    assert(
      response.success === true,
      `Expected success via default backend, got: ${JSON.stringify(response)}`,
    );
    assertEqual(global._lastFetchCall.url, EXPECTED_ENDPOINT);
  });

  await test("sync_linkedin returns missing_auth_token when authToken absent", async () => {
    const response = await sendExternalMessage({
      action: "sync_linkedin",
      backendUrl: BACKEND,
    });
    assert(response.success === false);
    assertEqual(response.error, "missing_auth_token");
  });

  await test("get_status returns stored connection state", async () => {
    chrome.storage.local._data.connected = true;
    chrome.storage.local._data.connectedAt = "2026-05-27T00:00:00.000Z";
    chrome.storage.local._data.lastSyncAt = "2026-05-27T00:05:00.000Z";
    chrome.storage.local._data.lastSyncedCount = 2481;
    const response = await sendExternalMessage({ action: "get_status" });
    assert(response.installed === true);
    assert(response.connected === true);
    assertEqual(response.lastSyncedCount, 2481);
    assertEqual(response.lastSyncAt, "2026-05-27T00:05:00.000Z");
  });

  await test("get_status returns installed:true even when never synced", async () => {
    const response = await sendExternalMessage({ action: "get_status" });
    assert(response.installed === true);
    assert(!response.connected);
  });

  await test("set_auth_token from trusted sender stores token", async () => {
    const response = await sendExternalMessage(
      {
        action: "set_auth_token",
        authToken: "amber_jwt_value",
        backendUrl: BACKEND,
      },
      { origin: FRONTEND },
    );
    assert(response.success === true, JSON.stringify(response));
    const stored = await chrome.storage.local.get(["authToken", "backendUrl"]);
    assertEqual(stored.authToken, "amber_jwt_value");
    assertEqual(stored.backendUrl, BACKEND);
  });

  await test("set_auth_token from untrusted sender is rejected", async () => {
    const response = await sendExternalMessage(
      {
        action: "set_auth_token",
        authToken: "stolen_jwt",
        backendUrl: BACKEND,
      },
      { origin: "https://attacker.com" },
    );
    assert(response.success === false);
    assertEqual(response.error, "untrusted_sender");
    const stored = await chrome.storage.local.get(["authToken"]);
    assert(!stored.authToken, "auth token must NOT be stored");
  });

  await test("clear_auth_token from trusted sender wipes state", async () => {
    chrome.storage.local._data.authToken = "old_token";
    chrome.storage.local._data.connected = true;
    chrome.storage.local._data.lastSyncedCount = 99;
    const response = await sendExternalMessage(
      { action: "clear_auth_token" },
      { origin: FRONTEND },
    );
    assert(response.success === true, JSON.stringify(response));
    const stored = await chrome.storage.local.get([
      "authToken",
      "connected",
      "lastSyncedCount",
    ]);
    assert(!stored.authToken);
    assert(!stored.connected);
    assert(!stored.lastSyncedCount);
  });

  await test("clear_auth_token from untrusted sender is rejected", async () => {
    chrome.storage.local._data.authToken = "real_token";
    const response = await sendExternalMessage(
      { action: "clear_auth_token" },
      { origin: "https://attacker.com" },
    );
    assert(response.success === false);
    assertEqual(response.error, "untrusted_sender");
    const stored = await chrome.storage.local.get(["authToken"]);
    assertEqual(stored.authToken, "real_token", "token must NOT be cleared");
  });

  await test("unknown action returns undefined (no crash)", async () => {
    const response = await sendExternalMessage({
      action: "unknown_action_xyz",
    });
    assert(response === undefined);
  });

  // ── Internal message handler ──────────────────────────────────────────────

  console.log("\nInternal message handler (from popup)");

  await test("check_linkedin returns loggedIn:true when cookie present", async () => {
    chrome.cookies._set("https://www.linkedin.com", "li_at", "AQED_abc");
    const response = await sendInternalMessage({ action: "check_linkedin" });
    assert(response.loggedIn === true);
  });

  await test("check_linkedin returns loggedIn:false when no cookie", async () => {
    const response = await sendInternalMessage({ action: "check_linkedin" });
    assert(response.loggedIn === false);
  });

  await test("sync_linkedin_from_popup triggers full flow", async () => {
    chrome.cookies._set("https://www.linkedin.com", "li_at", "AQED_abc");
    const response = await sendInternalMessage({
      action: "sync_linkedin_from_popup",
      backendUrl: BACKEND,
      authToken: "popup_token",
    });
    assert(
      response.success === true,
      `Expected success, got: ${JSON.stringify(response)}`,
    );
  });

  await test("sync_linkedin_from_popup falls back to DEFAULT_BACKEND when absent", async () => {
    chrome.cookies._set("https://www.linkedin.com", "li_at", "AQED_abc");
    const response = await sendInternalMessage({
      action: "sync_linkedin_from_popup",
      authToken: "popup_token",
    });
    assert(response.success === true);
    assertEqual(global._lastFetchCall.url, EXPECTED_ENDPOINT);
  });

  // ── Summary ───────────────────────────────────────────────────────────────

  console.log(`\n${"-".repeat(40)}`);
  console.log(`  ${passed} passed, ${failed} failed, ${passed + failed} total`);
  console.log(`${"-".repeat(40)}\n`);

  if (failed > 0) process.exit(1);
}

runTests().catch((err) => {
  console.error("Test runner crashed:", err);
  process.exit(1);
});
