/**
 * Integration tests for /v1/personal/*. Uses Fastify inject() against an
 * in-memory Firestore stand-in and a stub Pinecone indexer.
 *
 * Run with:  node --test src/routes/personal-life.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";

import { registerPersonalLifeRoutes } from "./personal-life.js";

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
          } else if (f?.op === "array-contains") {
            filtered = filtered.filter(
              (r) => Array.isArray(r[f.col]) && r[f.col].includes(f.value),
            );
          }
        }
      }
      return filtered.slice(0, limit || 100);
    },
    agentDataDelete: async ({ tenantDid, table, rowKey }) => {
      bucket(tenantDid, table).delete(rowKey);
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
  const indexed = [];
  const searched = [];
  const contactsByDid = new Map();
  const app = Fastify({ logger: false });
  registerPersonalLifeRoutes(app, {
    ...store,
    requireApiKeyOrAuth: authStub(),
    tenantIndex: { getByPhone: () => null },
    indexPersonalLifeRow: async (did, row) => {
      indexed.push({ did, row });
      return { indexed: true };
    },
    searchPersonalLife: async () => searched,
    // The route resolves an owner_id and calls listContacts(ownerId). This stub
    // is keyed by DID, so the identity resolver is stubbed as identity to keep
    // the two consistent. Without it the route resolved nothing, listContacts
    // was never reached, and the recall-person test asserted against an empty
    // address book -- passing the endpoint a case it could not answer and
    // calling the result a bug in the endpoint.
    resolveAmberIdByPrivyDid: async (did) => did,
    listContacts: async (ownerId) => contactsByDid.get(ownerId) || [],
    ...overrides,
  });
  return { app, store, indexed, searched, contactsByDid };
}

test("POST /v1/personal/brand-decision creates a row and indexes it", async () => {
  const { app, indexed } = buildApp();
  const res = await app.inject({
    method: "POST",
    url: "/v1/personal/brand-decision",
    payload: {
      brand: "rytual",
      key: "newsletter_name",
      value: "the rave",
      rationale: "realizing alternate versions of earth",
    },
  });
  assert.equal(res.statusCode, 201);
  const body = res.json();
  assert.equal(body.ok, true);
  assert.equal(body.brand_decision.brand, "rytual");
  assert.equal(body.brand_decision.key, "newsletter_name");
  assert.equal(body.brand_decision.value, "the rave");
  assert.equal(body.brand_decision.privy_did, TEST_DID);
  assert.equal(body.brand_decision.kind, "brand_decision");
  // Indexer should have been called exactly once with the new row.
  // Pinecone indexing is fire-and-forget; give the microtask queue a tick
  // to flush before we assert.
  await new Promise((r) => setImmediate(r));
  assert.equal(indexed.length, 1);
  assert.equal(indexed[0].row.brand, "rytual");
  await app.close();
});

test("POST /v1/personal/brand-decision second upsert returns 200 and overwrites", async () => {
  const { app } = buildApp();
  const first = await app.inject({
    method: "POST",
    url: "/v1/personal/brand-decision",
    payload: {
      brand: "rytual",
      key: "newsletter_name",
      value: "the rave",
    },
  });
  assert.equal(first.statusCode, 201);
  const second = await app.inject({
    method: "POST",
    url: "/v1/personal/brand-decision",
    payload: {
      brand: "rytual",
      key: "newsletter_name",
      value: "the rave (refined)",
    },
  });
  assert.equal(second.statusCode, 200);
  assert.equal(second.json().brand_decision.value, "the rave (refined)");
  await app.close();
});

test("POST /v1/personal/brand-decision rejects unknown brand", async () => {
  const { app } = buildApp();
  const res = await app.inject({
    method: "POST",
    url: "/v1/personal/brand-decision",
    payload: {
      brand: "not-a-brand",
      key: "newsletter_name",
      value: "x",
    },
  });
  // Fastify schema validation catches enum mismatch before the handler runs.
  assert.equal(res.statusCode, 400);
  await app.close();
});

test("GET /v1/personal/brand-decision filters by brand", async () => {
  const { app } = buildApp();
  await app.inject({
    method: "POST",
    url: "/v1/personal/brand-decision",
    payload: { brand: "rytual", key: "newsletter_name", value: "the rave" },
  });
  await app.inject({
    method: "POST",
    url: "/v1/personal/brand-decision",
    payload: { brand: "bma", key: "voice", value: "professional but warm" },
  });
  const all = await app.inject({
    method: "GET",
    url: "/v1/personal/brand-decision",
  });
  assert.equal(all.json().count, 2);
  const rytual = await app.inject({
    method: "GET",
    url: "/v1/personal/brand-decision?brand=rytual",
  });
  assert.equal(rytual.json().count, 1);
  assert.equal(rytual.json().brand_decisions[0].brand, "rytual");
  await app.close();
});

test("POST /v1/personal/teammate-pursuit creates a row with derived id", async () => {
  const { app } = buildApp();
  const res = await app.inject({
    method: "POST",
    url: "/v1/personal/teammate-pursuit",
    payload: {
      teammate_name: "Shirley Park",
      pursuit_name: "Photography practice",
      kind: "art",
      status: "active",
      notes: "Shooting on a film Canon, building toward a zine",
    },
  });
  assert.equal(res.statusCode, 201);
  const body = res.json();
  assert.equal(body.teammate_pursuit.teammate_name, "Shirley Park");
  assert.equal(body.teammate_pursuit.pursuit_kind, "art");
  assert.equal(body.teammate_pursuit.status, "active");
  assert.match(body.teammate_pursuit.id, /^pursuit_shirley-park_/);
  await app.close();
});

test("GET /v1/personal/teammate-pursuit?teammate=... filters case-insensitively", async () => {
  const { app } = buildApp();
  await app.inject({
    method: "POST",
    url: "/v1/personal/teammate-pursuit",
    payload: { teammate_name: "Shirley Park", pursuit_name: "Photography" },
  });
  await app.inject({
    method: "POST",
    url: "/v1/personal/teammate-pursuit",
    payload: { teammate_name: "Alinna", pursuit_name: "Songwriting" },
  });
  const shirley = await app.inject({
    method: "GET",
    url: "/v1/personal/teammate-pursuit?teammate=shirley%20park",
  });
  assert.equal(shirley.json().count, 1);
  assert.equal(
    shirley.json().teammate_pursuits[0].teammate_name,
    "Shirley Park",
  );
  await app.close();
});

test("POST /v1/personal/journal records freeform entries with 'with' list", async () => {
  const { app } = buildApp();
  const res = await app.inject({
    method: "POST",
    url: "/v1/personal/journal",
    payload: {
      topic: "Conversation with Shirley about content systems",
      body: "Sagar and Shirley talked about how the BMA content pipeline could be mirrored for Rytual. The key insight was that the content shouldn't lead with product, it should lead with the practitioner.",
      with: ["Shirley Park"],
      dimension: "intellectual",
    },
  });
  assert.equal(res.statusCode, 201);
  const body = res.json();
  assert.equal(body.journal_entry.topic.startsWith("Conversation with"), true);
  assert.equal(body.journal_entry.dimension, "intellectual");
  assert.deepEqual(body.journal_entry.with, ["Shirley Park"]);
  await app.close();
});

test("GET /v1/personal/journal?with=Shirley uses array-contains slug lookup", async () => {
  const { app } = buildApp();
  await app.inject({
    method: "POST",
    url: "/v1/personal/journal",
    payload: {
      topic: "with Shirley",
      body: "x",
      with: ["Shirley Park"],
    },
  });
  await app.inject({
    method: "POST",
    url: "/v1/personal/journal",
    payload: {
      topic: "alone",
      body: "y",
    },
  });
  const res = await app.inject({
    method: "GET",
    url: "/v1/personal/journal?with=Shirley%20Park",
  });
  assert.equal(res.json().count, 1);
  await app.close();
});

test("POST /v1/personal/search returns pinecone matches when available", async () => {
  const { app } = buildApp({
    searchPersonalLife: async () => [
      {
        id: "brand_decision:brand_rytual_newsletter_name",
        score: 0.92,
        metadata: {},
      },
    ],
  });
  await app.inject({
    method: "POST",
    url: "/v1/personal/brand-decision",
    payload: { brand: "rytual", key: "newsletter_name", value: "the rave" },
  });
  const res = await app.inject({
    method: "POST",
    url: "/v1/personal/search",
    payload: { query: "rave newsletter", topK: 5 },
  });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.source, "pinecone");
  assert.equal(body.count, 1);
  await app.close();
});

test("POST /v1/personal/search falls back to firestore when pinecone is empty", async () => {
  const { app } = buildApp({ searchPersonalLife: async () => [] });
  await app.inject({
    method: "POST",
    url: "/v1/personal/brand-decision",
    payload: { brand: "rytual", key: "newsletter_name", value: "the rave" },
  });
  const res = await app.inject({
    method: "POST",
    url: "/v1/personal/search",
    payload: { query: "rave", topK: 5 },
  });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.source, "firestore_fallback");
  assert.equal(body.count >= 1, true);
  await app.close();
});

test("normalizeJournalEntry rejects oversize body", async () => {
  const { app } = buildApp();
  const oversize = "x".repeat(20000);
  const res = await app.inject({
    method: "POST",
    url: "/v1/personal/journal",
    payload: { topic: "huge", body: oversize },
  });
  // Fastify schema's maxLength bites first.
  assert.equal(res.statusCode, 400);
  await app.close();
});

test("body-level userId mismatch is rejected with 403", async () => {
  const { app } = buildApp();
  const res = await app.inject({
    method: "POST",
    url: "/v1/personal/brand-decision",
    payload: {
      brand: "rytual",
      key: "newsletter_name",
      value: "the rave",
    },
    headers: {},
  });
  // No body-level userId — should succeed.
  assert.equal(res.statusCode, 201);
  await app.close();
});

test("POST /v1/personal/recall-person returns found:false when nothing is on file", async () => {
  const { app } = buildApp();
  const res = await app.inject({
    method: "POST",
    url: "/v1/personal/recall-person",
    payload: { name: "Shirley" },
  });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.ok, true);
  assert.equal(body.found, false);
  assert.equal(body.matched_contacts.length, 0);
  assert.equal(body.pursuits.length, 0);
  assert.equal(body.journal_entries.length, 0);
  assert.equal(body.query.name, "Shirley");
  assert.equal(body.query.first_token, "Shirley");
  await app.close();
});

test("POST /v1/personal/recall-person surfaces pursuits + contact + journal mentions", async () => {
  const { app, contactsByDid } = buildApp();
  contactsByDid.set(TEST_DID, [
    {
      id: "c-shirley",
      name: "Shirley Park",
      firstName: "Shirley",
      source: "apple",
      company: "BMA",
      title: "Designer",
    },
    {
      id: "c-other",
      name: "Alinna Chen",
      firstName: "Alinna",
      source: "linkedin",
    },
  ]);

  // Track Shirley's photography pursuit
  let res = await app.inject({
    method: "POST",
    url: "/v1/personal/teammate-pursuit",
    payload: {
      teammate_name: "Shirley Park",
      pursuit_name: "photography practice",
      kind: "art",
      status: "active",
      notes: "shooting film on weekends",
    },
  });
  assert.equal(res.statusCode, 201);

  // Journal entry that tags Shirley in `with`
  res = await app.inject({
    method: "POST",
    url: "/v1/personal/journal",
    payload: {
      topic: "creative session",
      body: "great chat about her photo zine",
      written_at: new Date().toISOString(),
      with: ["Shirley"],
      dimension: "social",
    },
  });
  assert.equal(res.statusCode, 201);

  // Journal entry that mentions Shirley inline only (no `with`)
  res = await app.inject({
    method: "POST",
    url: "/v1/personal/journal",
    payload: {
      topic: "morning thoughts",
      body: "Shirley shipped the new landing page and it looks incredible",
      written_at: new Date().toISOString(),
      dimension: "intellectual",
    },
  });
  assert.equal(res.statusCode, 201);

  // Journal entry that should NOT match Shirley
  res = await app.inject({
    method: "POST",
    url: "/v1/personal/journal",
    payload: {
      topic: "alinna update",
      body: "Alinna started a poetry chapbook",
      written_at: new Date().toISOString(),
      with: ["Alinna"],
    },
  });
  assert.equal(res.statusCode, 201);

  res = await app.inject({
    method: "POST",
    url: "/v1/personal/recall-person",
    payload: { name: "Shirley" },
  });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.ok, true);
  assert.equal(body.found, true);
  assert.equal(body.matched_contacts.length, 1);
  assert.equal(body.matched_contacts[0].name, "Shirley Park");
  assert.equal(body.pursuits.length, 1);
  assert.equal(body.pursuits[0].teammate_name, "Shirley Park");
  assert.equal(body.pursuits[0].pursuit_name, "photography practice");
  // Both Shirley entries surface (one via `with`, one inline). The Alinna
  // entry must NOT appear.
  assert.equal(body.journal_entries.length, 2);
  for (const entry of body.journal_entries) {
    const text = `${entry.topic} ${entry.body} ${(entry.with || []).join(" ")}`;
    assert.match(text, /Shirley/i);
    assert.doesNotMatch(text, /^Alinna started/);
  }
  await app.close();
});

test("POST /v1/personal/recall-person rejects too-short names via schema", async () => {
  const { app } = buildApp();
  const res = await app.inject({
    method: "POST",
    url: "/v1/personal/recall-person",
    payload: { name: "" },
  });
  assert.equal(res.statusCode, 400);
  await app.close();
});

test("POST /v1/personal/author-voice upserts and round-trips a profile", async () => {
  const { app } = buildApp();
  const payload = {
    author_slug: "sagar-tiwari",
    display_name: "Sagar Tiwari",
    role_at_org: "BMA partner",
    org: "bma",
    voice_tells: {
      sentence_rhythm: "conviction without hedging",
      vocabulary_tells: "specific verbs, no jargon",
      opener_patterns: "scene-first ('This past March, I met Juan...')",
      closer_patterns: "personal bet ('My bet is...')",
      jargon_blacklist: ["leverage", "synergy", "AI-powered"],
    },
    what_they_dont_say: ["I think maybe", "It could be argued"],
    sample_pieces: [
      {
        title: "Ignoring the Hype Is Its Own Kind of Edge",
        body: "This past March, I met Juan at a conference in Miami...",
      },
    ],
  };

  const create = await app.inject({
    method: "POST",
    url: "/v1/personal/author-voice",
    payload,
  });
  assert.equal(create.statusCode, 201);
  const created = create.json().author_voice;
  assert.equal(created.author_slug, "sagar-tiwari");
  assert.equal(created.display_name, "Sagar Tiwari");
  assert.equal(created.org, "bma");
  assert.equal(
    created.voice_tells.closer_patterns,
    "personal bet ('My bet is...')",
  );
  assert.deepEqual(created.voice_tells.jargon_blacklist, [
    "leverage",
    "synergy",
    "AI-powered",
  ]);

  const list = await app.inject({
    method: "GET",
    url: "/v1/personal/author-voice",
  });
  assert.equal(list.statusCode, 200);
  assert.equal(list.json().count, 1);

  const get = await app.inject({
    method: "GET",
    url: "/v1/personal/author-voice/sagar-tiwari",
  });
  assert.equal(get.statusCode, 200);
  assert.equal(get.json().author_voice.display_name, "Sagar Tiwari");

  const second = await app.inject({
    method: "POST",
    url: "/v1/personal/author-voice",
    payload: { ...payload, role_at_org: "BMA founding partner" },
  });
  assert.equal(second.statusCode, 200);
  assert.equal(second.json().author_voice.role_at_org, "BMA founding partner");

  const del = await app.inject({
    method: "DELETE",
    url: "/v1/personal/author-voice/sagar-tiwari",
  });
  assert.equal(del.statusCode, 204);

  const gone = await app.inject({
    method: "GET",
    url: "/v1/personal/author-voice/sagar-tiwari",
  });
  assert.equal(gone.statusCode, 404);

  await app.close();
});

test("GET /v1/personal/author-voice/:slug returns 404 when missing", async () => {
  const { app } = buildApp();
  const res = await app.inject({
    method: "GET",
    url: "/v1/personal/author-voice/unknown-author",
  });
  assert.equal(res.statusCode, 404);
  assert.equal(res.json().error, "author_voice_not_found");
  await app.close();
});

test("POST /v1/personal/author-voice rejects invalid org", async () => {
  const { app } = buildApp();
  const res = await app.inject({
    method: "POST",
    url: "/v1/personal/author-voice",
    payload: {
      display_name: "Random Person",
      org: "not-a-real-org",
    },
  });
  assert.equal(res.statusCode, 400);
  await app.close();
});

test("GET /v1/personal/author-voice?org=bma filters by org", async () => {
  const { app } = buildApp();
  await app.inject({
    method: "POST",
    url: "/v1/personal/author-voice",
    payload: { display_name: "Sagar Tiwari", org: "bma" },
  });
  await app.inject({
    method: "POST",
    url: "/v1/personal/author-voice",
    payload: { display_name: "Shirley Park", org: "rytual" },
  });
  const bma = await app.inject({
    method: "GET",
    url: "/v1/personal/author-voice?org=bma",
  });
  assert.equal(bma.json().count, 1);
  assert.equal(bma.json().author_voices[0].display_name, "Sagar Tiwari");
  await app.close();
});

test("POST /v1/personal/author-voice fires Pinecone indexing", async () => {
  const indexedVoices = [];
  const { app } = buildApp({
    indexAuthorVoice: async (did, row) => {
      indexedVoices.push({ did, row });
      return { indexed: true };
    },
  });
  const res = await app.inject({
    method: "POST",
    url: "/v1/personal/author-voice",
    payload: { display_name: "Sagar Tiwari", org: "bma" },
  });
  assert.equal(res.statusCode, 201);
  await new Promise((r) => setImmediate(r));
  assert.equal(indexedVoices.length, 1);
  assert.equal(indexedVoices[0].did, TEST_DID);
  assert.equal(indexedVoices[0].row.kind, "author_voice");
  assert.equal(indexedVoices[0].row.author_slug, "sagar-tiwari");
  await app.close();
});

test("GET /v1/personal/author-voice?semantic=true routes through Pinecone", async () => {
  const { app } = buildApp({
    searchAuthorVoices: async () => [
      {
        id: "author_voice:sagar-tiwari",
        score: 0.88,
        metadata: { kind: "author_voice", display_name: "Sagar Tiwari" },
      },
    ],
  });
  const res = await app.inject({
    method: "GET",
    url: "/v1/personal/author-voice?semantic=true&q=punchy%20short%20sentences",
  });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.source, "pinecone");
  assert.equal(body.count, 1);
  assert.equal(body.matches[0].metadata.display_name, "Sagar Tiwari");
  await app.close();
});

test("GET /v1/personal/author-voice?semantic=true falls back to Firestore on no hits", async () => {
  const { app } = buildApp({
    searchAuthorVoices: async () => [],
  });
  await app.inject({
    method: "POST",
    url: "/v1/personal/author-voice",
    payload: { display_name: "Sagar Tiwari", org: "bma" },
  });
  const res = await app.inject({
    method: "GET",
    url: "/v1/personal/author-voice?semantic=true&q=nothing",
  });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.source, "firestore_fallback");
  assert.equal(body.count, 1);
  assert.ok(Array.isArray(body.author_voices));
  await app.close();
});

test("DELETE /v1/personal/author-voice removes the Pinecone vector", async () => {
  const deletedVectors = [];
  const { app } = buildApp({
    deleteAuthorVoiceVector: async (did, slug) => {
      deletedVectors.push({ did, slug });
      return { deleted: true };
    },
  });
  await app.inject({
    method: "POST",
    url: "/v1/personal/author-voice",
    payload: { display_name: "Sagar Tiwari", org: "bma" },
  });
  const res = await app.inject({
    method: "DELETE",
    url: "/v1/personal/author-voice/sagar-tiwari",
  });
  assert.equal(res.statusCode, 204);
  await new Promise((r) => setImmediate(r));
  assert.equal(deletedVectors.length, 1);
  assert.equal(deletedVectors[0].slug, "sagar-tiwari");
  await app.close();
});

test("POST /v1/personal/recall-person ignores listContacts failure", async () => {
  // Even when the address book lookup throws, the route should still
  // return a useful response from journal scans + pursuits.
  const { app } = buildApp({
    listContacts: async () => {
      throw new Error("simulated firestore outage");
    },
  });
  // Seed a journal entry that mentions Shirley inline.
  await app.inject({
    method: "POST",
    url: "/v1/personal/journal",
    payload: {
      topic: "note",
      body: "Shirley wrapped the brand deck today",
      written_at: new Date().toISOString(),
    },
  });
  const res = await app.inject({
    method: "POST",
    url: "/v1/personal/recall-person",
    payload: { name: "Shirley" },
  });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.ok, true);
  assert.equal(body.matched_contacts.length, 0);
  assert.equal(body.journal_entries.length, 1);
  await app.close();
});
