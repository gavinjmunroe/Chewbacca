/**
 * Tests for lib/secrets.js — env fallback resolution.
 *
 * Regression coverage for the GCAL_* vs GOOGLE_* env-name mismatch bug:
 * the agent shipped with `fallbackEnv: "GOOGLE_OAUTH_CLIENT_ID"` for the
 * GCAL_OAUTH_CLIENT_ID lookup, but the deployed Railway env var was named
 * GCAL_OAUTH_CLIENT_ID. The env fallback returned undefined and OAuth
 * refresh failed. The fix accepts `fallbackEnv` as a string OR an array
 * of names, tried in order.
 *
 * Run with:
 *   node --test Newton/agent/lib/__tests__/secrets.test.js
 */

import { test } from "node:test";
import assert from "node:assert/strict";

// AMBER_ID_API_URL / AMBER_ID_API_KEY come from constants.js at module-load
// time. Leaving them unset makes fetchSecret() short-circuit before any
// network call, so these tests exercise the env-fallback path in isolation.
delete process.env.AMBER_ID_API_URL;
delete process.env.AMBER_ID_API_KEY;

const { getSecret, resolveEnvFallback } = await import("../secrets.js");

// Stable test tenant: no phone, so the person-id bridge is a no-op and the
// resolver goes straight from "tenant bag miss" to env fallback.
const TENANT = { privyDid: "did:test:env-fallback" };

// ── resolveEnvFallback (pure helper) ──────────────────────────────────────

test("resolveEnvFallback: null fallbackEnv returns null", () => {
  assert.equal(resolveEnvFallback(null), null);
  assert.equal(resolveEnvFallback(undefined), null);
  assert.equal(resolveEnvFallback(""), null);
});

test("resolveEnvFallback: string form reads process.env", () => {
  process.env.TEST_SECRETS_SINGLE = "single-value";
  try {
    assert.equal(resolveEnvFallback("TEST_SECRETS_SINGLE"), "single-value");
    assert.equal(resolveEnvFallback("TEST_SECRETS_MISSING"), null);
  } finally {
    delete process.env.TEST_SECRETS_SINGLE;
  }
});

test("resolveEnvFallback: array form returns first hit, in order", () => {
  process.env.TEST_SECRETS_B = "value-b";
  process.env.TEST_SECRETS_C = "value-c";
  try {
    // First name misses, second hits.
    assert.equal(
      resolveEnvFallback(["TEST_SECRETS_A", "TEST_SECRETS_B"]),
      "value-b",
    );
    // First name hits — second is never consulted.
    assert.equal(
      resolveEnvFallback(["TEST_SECRETS_B", "TEST_SECRETS_C"]),
      "value-b",
    );
    // All miss.
    assert.equal(
      resolveEnvFallback(["TEST_SECRETS_X", "TEST_SECRETS_Y"]),
      null,
    );
  } finally {
    delete process.env.TEST_SECRETS_B;
    delete process.env.TEST_SECRETS_C;
  }
});

test("resolveEnvFallback: empty array entries are skipped", () => {
  process.env.TEST_SECRETS_REAL = "real";
  try {
    assert.equal(resolveEnvFallback(["", null, "TEST_SECRETS_REAL"]), "real");
  } finally {
    delete process.env.TEST_SECRETS_REAL;
  }
});

// ── getSecret (integration with env fallback) ─────────────────────────────

test("getSecret: no fallbackEnv, no amber-id, returns null", async () => {
  const value = await getSecret(TENANT, "TEST_SECRETS_NO_FALLBACK");
  assert.equal(value, null);
});

test("getSecret: string fallbackEnv resolves when env is set", async () => {
  process.env.TEST_SECRETS_STRING_FB = "from-env-string";
  try {
    const value = await getSecret(TENANT, "TEST_SECRETS_STRING_FB_KEY", {
      fallbackEnv: "TEST_SECRETS_STRING_FB",
    });
    assert.equal(value, "from-env-string");
  } finally {
    delete process.env.TEST_SECRETS_STRING_FB;
  }
});

test("getSecret: array fallbackEnv finds value under second alias (GCAL vs GOOGLE regression)", async () => {
  // Simulates Caleb's actual Railway config: per-tenant key
  // GCAL_OAUTH_CLIENT_ID is not in the bag, env var GCAL_OAUTH_CLIENT_ID
  // IS set, env var GOOGLE_OAUTH_CLIENT_ID is not. Before the fix, the
  // caller passed fallbackEnv: "GOOGLE_OAUTH_CLIENT_ID" and got null.
  // After the fix, fallbackEnv: ["GCAL_...", "GOOGLE_..."] hits the
  // first alias.
  process.env.TEST_GCAL_OAUTH_CLIENT_ID = "deployed-gcal-id";
  try {
    const value = await getSecret(TENANT, "GCAL_OAUTH_CLIENT_ID_TEST", {
      fallbackEnv: ["TEST_GCAL_OAUTH_CLIENT_ID", "TEST_GOOGLE_OAUTH_CLIENT_ID"],
    });
    assert.equal(value, "deployed-gcal-id");
  } finally {
    delete process.env.TEST_GCAL_OAUTH_CLIENT_ID;
  }
});

test("getSecret: array fallbackEnv falls through to legacy alias when canonical is unset", async () => {
  // The reverse direction: only the legacy env is set. Both aliases
  // should be tried so users on the old convention still resolve.
  // Distinct cache key from the previous test so this exercises the env
  // path fresh rather than a cached value from the prior call.
  process.env.TEST_GOOGLE_OAUTH_CLIENT_ID = "legacy-google-id";
  try {
    const value = await getSecret(TENANT, "GCAL_OAUTH_CLIENT_ID_LEGACY_ONLY", {
      fallbackEnv: ["TEST_GCAL_OAUTH_CLIENT_ID", "TEST_GOOGLE_OAUTH_CLIENT_ID"],
    });
    assert.equal(value, "legacy-google-id");
  } finally {
    delete process.env.TEST_GOOGLE_OAUTH_CLIENT_ID;
  }
});

test("getSecret: array fallbackEnv all-miss returns null", async () => {
  const value = await getSecret(TENANT, "GCAL_OAUTH_CLIENT_ID_ALLMISS", {
    fallbackEnv: ["TEST_NONE_A", "TEST_NONE_B"],
  });
  assert.equal(value, null);
});

test("getSecret: cached env value persists across calls without re-reading process.env", async () => {
  // First call: env IS set, value is cached.
  process.env.TEST_SECRETS_CACHED = "first-read";
  let value1, value2;
  try {
    value1 = await getSecret(TENANT, "TEST_SECRETS_CACHED_KEY", {
      fallbackEnv: "TEST_SECRETS_CACHED",
    });
  } finally {
    // Clear env between reads — the cache should still return the old value.
    delete process.env.TEST_SECRETS_CACHED;
  }
  value2 = await getSecret(TENANT, "TEST_SECRETS_CACHED_KEY", {
    fallbackEnv: "TEST_SECRETS_CACHED",
  });
  assert.equal(value1, "first-read");
  assert.equal(value2, "first-read");
});
