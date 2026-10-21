/**
 * Integration tests for /v1/content-seeds/*. Uses Fastify inject() against an
 * in-memory Firestore stand-in.
 *
 * Run with:  node --test src/routes/content-seeds.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";

import { registerContentSeedsRoutes } from "./content-seeds.js";

const TEST_DID = "did:privy:sagar-test";

function makeFakeStore() {
  const data = new Map();
  const key = (did, table) => `${did}::${table}`;
  function bucket(did, table) {
    const k = key(did, table);
    if (!data.has(k)) data.set(k, new Map());
    return data.get(k);
  }
  return {
    data,
    agentDataGet: async ({ tenantDid, table, rowKey }) => {
      return bucket(tenantDid, table).get(rowKey) || null;
    },
    agentDataUpsert: async ({ tenantDid, table, rowKey, row }) => {
      const existing = bucket(tenantDid, table).get(rowKey) || {};
      bucket(tenantDid, table).set(rowKey, { ...existing, ...row });
    },
    agentDataQuery: async ({ tenantDid, table, filters, limit }) => {
      const out = [...bucket(tenantDid, table).values()];
      let filtered = out;
      if (Array.isArray(filters)) {
        for (const f of filters) {
          if (f?.op === "eq") {
            filtered = filtered.filter((r) => r[f.col] === f.value);
          }
        }
      }
      return filtered.slice(0, limit || 100);
    },
  };
}

function authStub() {
  return async (request) => {
    request.privyUser = { userId: TEST_DID };
  };
}

function buildApp(overrides = {}) {
  const store = makeFakeStore();
  const app = Fastify({ logger: false });
  registerContentSeedsRoutes(app, {
    ...store,
    requireApiKeyOrAuth: authStub(),
    tenantIndex: { getByPhone: () => null },
    ...overrides,
  });
  return { app, store };
}

test("POST /v1/content-seeds creates a raw seed", async () => {
  const { app } = buildApp();
  const res = await app.inject({
    method: "POST",
    url: "/v1/content-seeds",
    payload: {
      raw_text: "This past March, I met Juan at the Clay summit...",
      author_slug: "sagar-tiwari",
      org: "bma",
      intent: "newsletter",
      section_hint: "hypothesis",
    },
  });
  assert.equal(res.statusCode, 201);
  const body = res.json();
  assert.equal(body.ok, true);
  assert.equal(body.content_seed.kind, "content_seed");
  assert.equal(body.content_seed.author_slug, "sagar-tiwari");
  assert.equal(body.content_seed.org, "bma");
  assert.equal(body.content_seed.intent, "newsletter");
  assert.equal(body.content_seed.section_hint, "hypothesis");
  assert.equal(body.content_seed.status, "raw");
  assert.equal(body.content_seed.polished_draft, null);
  assert.match(body.content_seed.id, /^seed_[a-f0-9]+$/);
  await app.close();
});

test("POST /v1/content-seeds rejects missing source (no raw_text AND no source_url)", async () => {
  const { app } = buildApp();
  const res = await app.inject({
    method: "POST",
    url: "/v1/content-seeds",
    payload: { author_slug: "sagar-tiwari", org: "bma", intent: "newsletter" },
  });
  assert.equal(res.statusCode, 400);
  assert.equal(res.json().error, "missing_source");
  await app.close();
});

test("POST /v1/content-seeds rejects unknown org via schema", async () => {
  const { app } = buildApp();
  const res = await app.inject({
    method: "POST",
    url: "/v1/content-seeds",
    payload: {
      raw_text: "hi",
      author_slug: "sagar-tiwari",
      org: "not-a-real-org",
      intent: "newsletter",
    },
  });
  assert.equal(res.statusCode, 400);
  await app.close();
});

test("GET /v1/content-seeds/:id returns the stored seed", async () => {
  const { app } = buildApp();
  const created = await app.inject({
    method: "POST",
    url: "/v1/content-seeds",
    payload: {
      raw_text: "draft body here",
      author_slug: "sagar-tiwari",
      org: "bma",
      intent: "newsletter",
    },
  });
  const id = created.json().content_seed.id;

  const got = await app.inject({
    method: "GET",
    url: `/v1/content-seeds/${id}`,
  });
  assert.equal(got.statusCode, 200);
  assert.equal(got.json().content_seed.id, id);
  await app.close();
});

test("GET /v1/content-seeds lists and filters", async () => {
  const { app } = buildApp();
  await app.inject({
    method: "POST",
    url: "/v1/content-seeds",
    payload: {
      raw_text: "a",
      author_slug: "sagar-tiwari",
      org: "bma",
      intent: "newsletter",
    },
  });
  await app.inject({
    method: "POST",
    url: "/v1/content-seeds",
    payload: {
      raw_text: "b",
      author_slug: "sagar-tiwari",
      org: "rytual",
      intent: "linkedin",
    },
  });
  const all = await app.inject({ method: "GET", url: "/v1/content-seeds" });
  assert.equal(all.json().count, 2);
  const justBma = await app.inject({
    method: "GET",
    url: "/v1/content-seeds?org=bma",
  });
  assert.equal(justBma.json().count, 1);
  assert.equal(justBma.json().content_seeds[0].org, "bma");
  await app.close();
});

test("POST /v1/content-seeds/:id/polish writes polish result back", async () => {
  const { app } = buildApp();
  const created = await app.inject({
    method: "POST",
    url: "/v1/content-seeds",
    payload: {
      raw_text: "raw draft",
      author_slug: "sagar-tiwari",
      org: "bma",
      intent: "newsletter",
    },
  });
  const id = created.json().content_seed.id;

  const polished = await app.inject({
    method: "POST",
    url: `/v1/content-seeds/${id}/polish`,
    payload: {
      polished_draft: "Polished body, first person, lands cleanly.",
      polish_score: 8.5,
      doctrine_violations: [],
      drive_doc_url: "https://docs.google.com/document/d/abc123/edit",
      status: "polished",
    },
  });
  assert.equal(polished.statusCode, 200);
  const seed = polished.json().content_seed;
  assert.equal(seed.status, "polished");
  assert.equal(seed.polish_score, 8.5);
  assert.equal(
    seed.polished_draft,
    "Polished body, first person, lands cleanly.",
  );
  assert.equal(
    seed.drive_doc_url,
    "https://docs.google.com/document/d/abc123/edit",
  );

  // Re-fetch to confirm persistence
  const refetch = await app.inject({
    method: "GET",
    url: `/v1/content-seeds/${id}`,
  });
  assert.equal(refetch.json().content_seed.status, "polished");
  await app.close();
});

test("POST /v1/content-seeds/:id/polish 404 on missing seed", async () => {
  const { app } = buildApp();
  const res = await app.inject({
    method: "POST",
    url: "/v1/content-seeds/seed_doesnotexist/polish",
    payload: { status: "polishing" },
  });
  assert.equal(res.statusCode, 404);
  await app.close();
});

test("POST /v1/content-seeds accepts source_url without raw_text", async () => {
  const { app } = buildApp();
  const res = await app.inject({
    method: "POST",
    url: "/v1/content-seeds",
    payload: {
      source_url: "https://substack.com/p/foo",
      author_slug: "sagar-tiwari",
      org: "bma",
      intent: "newsletter",
    },
  });
  assert.equal(res.statusCode, 201);
  assert.equal(
    res.json().content_seed.source_url,
    "https://substack.com/p/foo",
  );
  assert.equal(res.json().content_seed.raw_text, "");
  await app.close();
});

test("POST /v1/content-seeds fires Pinecone indexing with the stored seed", async () => {
  const indexed = [];
  const { app } = buildApp({
    indexContentSeed: async (did, row) => {
      indexed.push({ did, row });
      return { indexed: true };
    },
  });
  const res = await app.inject({
    method: "POST",
    url: "/v1/content-seeds",
    payload: {
      raw_text: "the funnel observation",
      author_slug: "sagar-tiwari",
      org: "bma",
      intent: "newsletter",
    },
  });
  assert.equal(res.statusCode, 201);
  // indexAsync is fire-and-forget; give the microtask queue a tick to flush.
  await new Promise((r) => setImmediate(r));
  assert.equal(indexed.length, 1);
  assert.equal(indexed[0].did, TEST_DID);
  assert.equal(indexed[0].row.kind, "content_seed");
  assert.equal(indexed[0].row.intent, "newsletter");
  await app.close();
});

test("GET /v1/content-seeds?semantic=true routes through Pinecone", async () => {
  const calls = [];
  const { app } = buildApp({
    searchContentSeeds: async (did, opts) => {
      calls.push({ did, opts });
      return [
        {
          id: "content_seed:seed_x",
          score: 0.91,
          metadata: { kind: "content_seed" },
        },
      ];
    },
  });
  const res = await app.inject({
    method: "GET",
    url: "/v1/content-seeds?semantic=true&q=funnel%20observation&org=bma",
  });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.source, "pinecone");
  assert.equal(body.count, 1);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].opts.query, "funnel observation");
  assert.deepEqual(calls[0].opts.filter, { org: "bma" });
  await app.close();
});

test("GET /v1/content-seeds?semantic=true falls back to Firestore on no hits", async () => {
  const { app } = buildApp({
    searchContentSeeds: async () => [],
  });
  await app.inject({
    method: "POST",
    url: "/v1/content-seeds",
    payload: {
      raw_text: "a draft",
      author_slug: "sagar-tiwari",
      org: "bma",
      intent: "newsletter",
    },
  });
  const res = await app.inject({
    method: "GET",
    url: "/v1/content-seeds?semantic=true&q=nothing-matches",
  });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.source, "firestore_fallback");
  assert.equal(body.count, 1);
  assert.ok(Array.isArray(body.content_seeds));
  await app.close();
});

test("GET /v1/content-seeds without semantic flag stays on Firestore", async () => {
  let searched = false;
  const { app } = buildApp({
    searchContentSeeds: async () => {
      searched = true;
      return [];
    },
  });
  const res = await app.inject({ method: "GET", url: "/v1/content-seeds" });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().source, "firestore");
  assert.equal(searched, false);
  await app.close();
});
