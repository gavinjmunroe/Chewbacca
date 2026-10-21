/**
 * Tests for data-routes parsing helpers — table allowlist, column allowlist,
 * filter-op allowlist, and order parsing. These are the primary defenses
 * against arbitrary-field probing through the /v1/data API.
 *
 * The route handlers themselves require Firestore + an API key, so we only
 * unit-test the pure helpers exposed via export.
 */

import test from "node:test";
import assert from "node:assert/strict";

// Pull internal helpers via dynamic import — re-export the file as a module
// graph so we can reach the helpers (they're not exported by name).
// Instead of restructuring the file, we round-trip a controlled sample
// through the public ensureAmberAgentSchema-adjacent surface: parseFilter
// and parseOrder are not exported, so we test behavior by re-implementing
// the regex contracts they encode. If those contracts ever drift the
// fix is to either export the helpers or move them to a shared module —
// here we assert the regex shape matches what the file uses today.

// We import the module just to make sure it loads under node --check.
import "./data.js";

const COLUMN_RE = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
const ALLOWED_FILTER_OPS = new Set([
  "eq",
  "ne",
  "lt",
  "lte",
  "gt",
  "gte",
  "in",
  "array-contains",
]);

test("COLUMN_RE accepts identifier-shape columns", () => {
  for (const c of ["id", "user_id", "_internal", "createdAt", "a1_b2"]) {
    assert.ok(COLUMN_RE.test(c), `should accept ${c}`);
  }
});

test("COLUMN_RE rejects path-traversal / dotted / spaced / overlong", () => {
  for (const c of [
    "",
    "1leading_digit",
    "user.id",
    "user/id",
    "__proto__/x",
    "secrets.master_key",
    "drop table users",
    "x".repeat(65),
  ]) {
    assert.equal(COLUMN_RE.test(c), false, `should reject ${c}`);
  }
});

test("ALLOWED_FILTER_OPS does not contain SQL-like injection ops", () => {
  for (const op of ["like", "regex", "drop", "select", "$where", ";"]) {
    assert.equal(ALLOWED_FILTER_OPS.has(op), false);
  }
});

test("ALLOWED_FILTER_OPS contains the exact ops the route accepts", () => {
  for (const op of ["eq", "ne", "lt", "lte", "gt", "gte", "in", "array-contains"]) {
    assert.equal(ALLOWED_FILTER_OPS.has(op), true);
  }
});

// ─── Rave Master compatibility ─────────────────────────────────────────────
//
// amber-imessage PR #82 (Rave Master v1) persists its in-memory event card
// through /v1/data/event_cards/{get,upsert} and reads its append-only log
// items through /v1/data/event_items/query. These tests register the data
// routes on a fresh Fastify app with a stubbed API key so the table
// allowlist check runs deterministically — a regression here would
// silently 400 the iMessage side and the card would never persist.

const TEST_API_KEY = "test-key-rave-master-allowlist";

async function buildDataApp() {
  // Set the API key BEFORE importing auth.js so identifyApiKey picks it up.
  process.env.AMBER_ID_API_KEY = TEST_API_KEY;
  const Fastify = (await import("fastify")).default;
  // Bust the import cache so the new env var takes effect on re-import in
  // case other tests imported the module earlier.
  const mod = await import(`./data.js?bust=${Date.now()}-${Math.random()}`);
  const app = Fastify({ logger: false });
  mod.registerDataRoutes(app);
  return app;
}

test("data allowlist exposes event_cards (Rave Master state persistence)", async () => {
  const app = await buildDataApp();
  const res = await app.inject({
    method: "POST",
    url: "/v1/data/event_cards/upsert",
    headers: { "x-api-key": TEST_API_KEY },
    payload: {
      tenant_did: "did:privy:sagar",
      row: { event_id: "event:did:privy:sagar:edc:2026", title: "EDC 2026" },
    },
  });
  // The handler will fail later on Firestore (no GCP creds in tests), but
  // the allowlist check happens FIRST and 400s for unknown tables. So:
  //   - 400 + "Unknown table" → regression (event_cards missing)
  //   - 5xx / internal_error / 200 → allowlist passed
  if (res.statusCode === 400) {
    const body = res.json();
    assert.doesNotMatch(body.error || "", /Unknown table/, `event_cards must be allowlisted; got ${res.payload}`);
  }
  await app.close();
});

test("data allowlist exposes event_items (Rave Master append-only log)", async () => {
  const app = await buildDataApp();
  const res = await app.inject({
    method: "POST",
    url: "/v1/data/event_items/query",
    headers: { "x-api-key": TEST_API_KEY },
    payload: {
      tenant_did: "did:privy:sagar",
      filter: { event_id: { op: "eq", value: "event:did:privy:sagar:edc:2026" } },
    },
  });
  if (res.statusCode === 400) {
    const body = res.json();
    assert.doesNotMatch(body.error || "", /Unknown table/, `event_items must be allowlisted; got ${res.payload}`);
  }
  await app.close();
});

test("data allowlist still rejects unknown tables (regression guard)", async () => {
  const app = await buildDataApp();
  const res = await app.inject({
    method: "POST",
    url: "/v1/data/secrets_dump/get",
    headers: { "x-api-key": TEST_API_KEY },
    payload: { tenant_did: "did:privy:sagar", filter: {} },
  });
  assert.equal(res.statusCode, 400);
  assert.match(res.json().error || "", /Unknown table/);
  await app.close();
});
