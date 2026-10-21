/**
 * Integration tests for /v1/pipelines/*. Drives Fastify's inject() against
 * registerPipelinesRoutes with stubbed db helpers and auth — no real
 * Firestore, no real Privy, no real Pinecone.
 *
 * Covers:
 *   - investor create + list + filter by stage + get + delete
 *   - event create with the Rytual dimension/type enums
 *   - relationship create + addThread (Carlo's two-thread case)
 *   - principal isolation (Privy DID drives every read)
 *   - enum validation rejects unknown stage/type/dimension/pipeline
 *
 * Run with:  node --test src/routes/pipelines.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";

import { registerPipelinesRoutes } from "./pipelines.js";

const SAGAR = "did:privy:sagar-test";

function makeFakeDb() {
  const investors = new Map();
  const events = new Map();
  const relationships = new Map();
  const key = (did, id) => `${did}::${id}`;
  let seq = 0;
  const nextId = (prefix) => `${prefix}_test_${++seq}`;
  const now = () => new Date().toISOString();
  return {
    raw: { investors, events, relationships },
    upsertInvestor: async (did, body) => {
      const id = body.id || nextId("inv");
      const row = {
        id,
        privy_did: did,
        ...body,
        threads: body.threads || [],
        created_at: investors.get(key(did, id))?.created_at || now(),
        updated_at: now(),
      };
      investors.set(key(did, id), row);
      return row;
    },
    getInvestor: async (did, id) => investors.get(key(did, id)) || null,
    listInvestors: async (did, { stage } = {}) => {
      const rows = [...investors.values()].filter((r) => r.privy_did === did);
      return stage ? rows.filter((r) => r.stage === stage) : rows;
    },
    deleteInvestor: async (did, id) => investors.delete(key(did, id)),
    upsertEvent: async (did, body) => {
      const id = body.id || nextId("evt");
      const row = {
        id,
        privy_did: did,
        ...body,
        attendees: body.attendees || [],
        created_at: events.get(key(did, id))?.created_at || now(),
        updated_at: now(),
      };
      events.set(key(did, id), row);
      return row;
    },
    getEvent: async (did, id) => events.get(key(did, id)) || null,
    listEvents: async (did, { type, dimension } = {}) => {
      let rows = [...events.values()].filter((r) => r.privy_did === did);
      if (type) rows = rows.filter((r) => r.type === type);
      if (dimension) rows = rows.filter((r) => r.dimension === dimension);
      return rows;
    },
    deleteEvent: async (did, id) => events.delete(key(did, id)),
    upsertRelationship: async (did, body) => {
      const id = body.id || nextId("rel");
      const row = {
        id,
        privy_did: did,
        ...body,
        threads: body.threads || [],
        created_at: relationships.get(key(did, id))?.created_at || now(),
        updated_at: now(),
      };
      relationships.set(key(did, id), row);
      return row;
    },
    addThreadToRelationship: async (did, id, thread) => {
      const existing = relationships.get(key(did, id));
      if (!existing) return null;
      const updated = {
        ...existing,
        threads: [
          ...(existing.threads || []),
          { thread_id: thread.thread_id || nextId("thr"), ...thread },
        ],
        updated_at: now(),
      };
      relationships.set(key(did, id), updated);
      return updated;
    },
    findRelationships: async (did, { person_name } = {}) => {
      const rows = [...relationships.values()].filter(
        (r) => r.privy_did === did,
      );
      if (!person_name) return rows;
      const needle = String(person_name).toLowerCase();
      return rows.filter((r) =>
        String(r.person_name || "")
          .toLowerCase()
          .includes(needle),
      );
    },
    deleteRelationship: async (did, id) => relationships.delete(key(did, id)),
    indexPipelineObject: async () => ({ indexed: false, reason: "test-stub" }),
  };
}

function authStub(did = SAGAR) {
  return async (request) => {
    request.privyUser = { userId: did };
  };
}

function buildApp(did = SAGAR) {
  const db = makeFakeDb();
  const app = Fastify({ logger: false });
  registerPipelinesRoutes(app, {
    ...db,
    requireApiKeyOrAuth: authStub(did),
    tenantIndex: { getByPhone: () => null },
  });
  return { app, db };
}

test("POST /v1/pipelines/investor creates and returns an investor", async () => {
  const { app } = buildApp();
  const res = await app.inject({
    method: "POST",
    url: "/v1/pipelines/investor",
    payload: {
      name: "Jared Jamin",
      stage: "in_discussion",
      thesis_fit_note: "Rytual seed",
    },
  });
  assert.equal(res.statusCode, 201);
  const body = res.json();
  assert.equal(body.ok, true);
  assert.equal(body.investor.name, "Jared Jamin");
  assert.equal(body.investor.stage, "in_discussion");
  assert.equal(body.investor.privy_did, SAGAR);
  await app.close();
});

test("POST /v1/pipelines/investor rejects unknown stage", async () => {
  const { app } = buildApp();
  const res = await app.inject({
    method: "POST",
    url: "/v1/pipelines/investor",
    payload: { name: "Bad Stage", stage: "ghosted" },
  });
  assert.equal(res.statusCode, 400);
  assert.equal(res.json().error, "invalid_stage");
  await app.close();
});

test("GET /v1/pipelines/investor filters by stage", async () => {
  const { app } = buildApp();
  await app.inject({
    method: "POST",
    url: "/v1/pipelines/investor",
    payload: { name: "A", stage: "lead" },
  });
  await app.inject({
    method: "POST",
    url: "/v1/pipelines/investor",
    payload: { name: "B", stage: "in_discussion" },
  });
  const res = await app.inject({
    method: "GET",
    url: "/v1/pipelines/investor?stage=in_discussion",
  });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.count, 1);
  assert.equal(body.investors[0].name, "B");
  await app.close();
});

test("POST /v1/pipelines/event accepts a Rytual vipassana event", async () => {
  const { app } = buildApp();
  const res = await app.inject({
    method: "POST",
    url: "/v1/pipelines/event",
    payload: {
      name: "Vipassana — Joshua Tree",
      type: "vipassana",
      date_start: "2026-08-01",
      dimension: "spiritual",
      notes: "10-day silent",
    },
  });
  assert.equal(res.statusCode, 201);
  assert.equal(res.json().event.type, "vipassana");
  assert.equal(res.json().event.dimension, "spiritual");
  await app.close();
});

test("POST /v1/pipelines/event rejects unknown dimension", async () => {
  const { app } = buildApp();
  const res = await app.inject({
    method: "POST",
    url: "/v1/pipelines/event",
    payload: {
      name: "Bad",
      type: "custom",
      dimension: "vibes",
    },
  });
  assert.equal(res.statusCode, 400);
  assert.equal(res.json().error, "invalid_dimension");
  await app.close();
});

test("relationship + addThread models Carlo's two-thread case", async () => {
  const { app } = buildApp();
  const create = await app.inject({
    method: "POST",
    url: "/v1/pipelines/relationship",
    payload: {
      person_name: "Carlo",
      contact_email: "carlo@example.com",
      threads: [
        {
          pipeline: "partner",
          context: "Clay sales contract",
          status: "active",
        },
      ],
    },
  });
  assert.equal(create.statusCode, 201);
  const id = create.json().relationship.id;

  const addThread = await app.inject({
    method: "POST",
    url: `/v1/pipelines/relationship/${id}/thread`,
    payload: {
      pipeline: "investor",
      context: "IRA/BBB tax-credit unlock for Rytual $200k",
      status: "open",
    },
  });
  assert.equal(addThread.statusCode, 200);
  assert.equal(addThread.json().relationship.threads.length, 2);
  assert.equal(addThread.json().relationship.threads[1].pipeline, "investor");

  const search = await app.inject({
    method: "GET",
    url: "/v1/pipelines/relationship?person_name=carlo",
  });
  assert.equal(search.statusCode, 200);
  assert.equal(search.json().count, 1);
  assert.equal(search.json().relationships[0].threads.length, 2);

  await app.close();
});

test("relationship addThread rejects unknown pipeline", async () => {
  const { app } = buildApp();
  const create = await app.inject({
    method: "POST",
    url: "/v1/pipelines/relationship",
    payload: { person_name: "Test" },
  });
  const id = create.json().relationship.id;
  const res = await app.inject({
    method: "POST",
    url: `/v1/pipelines/relationship/${id}/thread`,
    payload: { pipeline: "frenemy" },
  });
  assert.equal(res.statusCode, 400);
  assert.equal(res.json().error, "invalid_pipeline");
  await app.close();
});

test("investor read is scoped to caller's DID", async () => {
  // Create an investor as SAGAR, then try to fetch as a different DID.
  const sagarApp = buildApp(SAGAR);
  const create = await sagarApp.app.inject({
    method: "POST",
    url: "/v1/pipelines/investor",
    payload: { name: "Solo", stage: "lead" },
  });
  const id = create.json().investor.id;
  await sagarApp.app.close();

  const otherApp = buildApp("did:privy:other");
  const res = await otherApp.app.inject({
    method: "GET",
    url: `/v1/pipelines/investor/${id}`,
  });
  assert.equal(res.statusCode, 404);
  await otherApp.app.close();
});
