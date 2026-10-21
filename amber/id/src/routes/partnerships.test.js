/**
 * Integration tests for /v1/partnerships/*. Uses Fastify's inject()
 * against an in-memory store injected through registerPartnershipsRoutes'
 * `deps` parameter — no real Firestore, no real Pinecone.
 *
 * Covers Sagar's canonical prompts:
 *   - "track that we're building an enterprise partnership with Perplexity,
 *     main contact Alex Tsai"
 *   - subsequent "what do you know about Perplexity?" → recall by name
 *   - long-form Carlo pitch persists as appendable history
 *   - body-level userId mismatch is rejected
 *
 * Run with:  node --test src/routes/partnerships.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";

import { registerPartnershipsRoutes } from "./partnerships.js";
import { buildPartnershipId } from "../db/partnerships.js";

const TEST_DID = "did:privy:sagar-test";

function makeFakeStore() {
  const rows = new Map();
  return {
    async upsertPartnership(did, patch) {
      assert.equal(did, TEST_DID);
      const id = patch.id || buildPartnershipId(patch.name);
      const existing = rows.get(`${did}::${id}`) || {};
      const now = new Date().toISOString();
      const row = {
        id,
        privy_did: did,
        name: patch.name || existing.name,
        kind: patch.kind || existing.kind || "partner",
        status: patch.status || existing.status || "exploring",
        org_name:
          patch.org_name !== undefined
            ? patch.org_name
            : existing.org_name || null,
        pitch: patch.pitch !== undefined ? patch.pitch : existing.pitch || null,
        primary_contacts:
          patch.primary_contacts !== undefined
            ? patch.primary_contacts
            : existing.primary_contacts || [],
        next_actions:
          patch.next_actions !== undefined
            ? patch.next_actions
            : existing.next_actions || [],
        history:
          patch.history !== undefined ? patch.history : existing.history || [],
        created_at: existing.created_at || now,
        updated_at: now,
      };
      rows.set(`${did}::${id}`, row);
      return row;
    },
    async getPartnership(did, id) {
      return rows.get(`${did}::${id}`) || null;
    },
    async listPartnerships(did, { kind, status, limit } = {}) {
      let out = [...rows.values()].filter((r) => r.privy_did === did);
      if (kind) out = out.filter((r) => r.kind === kind);
      if (status) out = out.filter((r) => r.status === status);
      return out.slice(0, limit || 100);
    },
    async findPartnershipByName(did, name) {
      const id = buildPartnershipId(name);
      return (
        rows.get(`${did}::${id}`) ||
        [...rows.values()].find(
          (r) =>
            r.privy_did === did &&
            String(r.name).toLowerCase() === String(name).toLowerCase(),
        ) ||
        null
      );
    },
    async appendPartnershipNote(did, id, { note, source }) {
      const row = rows.get(`${did}::${id}`);
      if (!row) return null;
      const entry = {
        ts: new Date().toISOString(),
        note,
        source: source || null,
      };
      row.history = [...(row.history || []), entry];
      row.updated_at = entry.ts;
      rows.set(`${did}::${id}`, row);
      return { row, entry };
    },
    async addNextAction(did, id, { description, due_date }) {
      const row = rows.get(`${did}::${id}`);
      if (!row) return null;
      const action = {
        id: `na_${Math.random().toString(36).slice(2, 8)}`,
        description,
        due_date: due_date || null,
        status: "open",
        created_at: new Date().toISOString(),
        completed_at: null,
      };
      row.next_actions = [...(row.next_actions || []), action];
      rows.set(`${did}::${id}`, row);
      return { row, action };
    },
    async completeNextAction(did, id, actionId) {
      const row = rows.get(`${did}::${id}`);
      if (!row) return null;
      let found = false;
      row.next_actions = (row.next_actions || []).map((a) => {
        if (a.id !== actionId) return a;
        found = true;
        return { ...a, status: "done", completed_at: new Date().toISOString() };
      });
      if (!found) return { row, found: false };
      rows.set(`${did}::${id}`, row);
      return { row, found: true };
    },
    async deletePartnership(did, id) {
      rows.delete(`${did}::${id}`);
    },
  };
}

function authStub(did = TEST_DID) {
  return async (request) => {
    request.privyUser = { userId: did };
  };
}

function noopIndex() {
  return async () => ({ indexed: true });
}

function buildApp() {
  const store = makeFakeStore();
  const app = Fastify({ logger: false });
  registerPartnershipsRoutes(app, {
    ...store,
    requireApiKeyOrAuth: authStub(),
    tenantIndex: { getByPhone: () => null },
    indexPartnership: noopIndex(),
    indexPartnershipNote: noopIndex(),
    deletePartnershipVectors: noopIndex(),
  });
  return { app, store };
}

test("POST /v1/partnerships creates a record from Sagar's Perplexity prompt", async () => {
  const { app } = buildApp();
  const res = await app.inject({
    method: "POST",
    url: "/v1/partnerships",
    payload: {
      name: "Perplexity",
      kind: "partner",
      org_name: "Perplexity AI",
      pitch: "Enterprise partnership exploration, Sagar leading from BMA side.",
      primary_contacts: [{ name: "Alex Tsai", role: "main contact" }],
    },
  });
  assert.equal(res.statusCode, 201);
  const body = res.json();
  assert.equal(body.ok, true);
  assert.equal(body.partnership.name, "Perplexity");
  assert.equal(body.partnership.kind, "partner");
  assert.equal(body.partnership.status, "exploring");
  assert.equal(body.partnership.primary_contacts[0].name, "Alex Tsai");
  assert.equal(body.partnership.primary_contacts[0].role, "main contact");
});

test("GET /v1/partnerships/by-name resolves the Perplexity record", async () => {
  const { app } = buildApp();
  await app.inject({
    method: "POST",
    url: "/v1/partnerships",
    payload: { name: "Perplexity", kind: "partner" },
  });
  const res = await app.inject({
    method: "GET",
    url: "/v1/partnerships/by-name?name=Perplexity",
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().partnership.name, "Perplexity");
});

test("by-name match is case-insensitive (Sagar may say 'perplexity')", async () => {
  const { app } = buildApp();
  await app.inject({
    method: "POST",
    url: "/v1/partnerships",
    payload: { name: "Perplexity", kind: "partner" },
  });
  const res = await app.inject({
    method: "GET",
    url: "/v1/partnerships/by-name?name=perplexity",
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().partnership.name, "Perplexity");
});

test("appending a history note persists the Carlo pitch", async () => {
  const { app } = buildApp();
  const created = await app.inject({
    method: "POST",
    url: "/v1/partnerships",
    payload: {
      name: "Cory Reeder / Carlo — federal tax credits",
      kind: "advisor",
    },
  });
  const id = created.json().partnership.id;
  const appended = await app.inject({
    method: "POST",
    url: `/v1/partnerships/${id}/notes`,
    payload: {
      note: "Carlo pitched solar battery investment + IRA tax credits as a path to the $200K Rytual is raising. Federal credits, not state.",
      source: "slack-thread-2026-05-26",
    },
  });
  assert.equal(appended.statusCode, 200);
  const body = appended.json();
  assert.equal(body.partnership.history.length, 1);
  assert.match(body.partnership.history[0].note, /Carlo pitched solar/);
  assert.equal(body.note.source, "slack-thread-2026-05-26");
});

test("invalid kind is rejected with structured error", async () => {
  const { app } = buildApp();
  const res = await app.inject({
    method: "POST",
    url: "/v1/partnerships",
    payload: { name: "X", kind: "competitor" },
  });
  assert.equal(res.statusCode, 400);
  assert.equal(res.json().error, "invalid_kind");
});

test("next-actions can be added and completed", async () => {
  const { app } = buildApp();
  const created = await app.inject({
    method: "POST",
    url: "/v1/partnerships",
    payload: { name: "Perplexity", kind: "partner" },
  });
  const id = created.json().partnership.id;
  const added = await app.inject({
    method: "POST",
    url: `/v1/partnerships/${id}/next-actions`,
    payload: {
      description: "Email Alex Tsai re: pilot scope",
      due_date: "2026-06-01",
    },
  });
  assert.equal(added.statusCode, 200);
  const naId = added.json().next_action.id;
  const done = await app.inject({
    method: "POST",
    url: `/v1/partnerships/${id}/next-actions/${naId}/complete`,
  });
  assert.equal(done.statusCode, 200);
  const completed = done.json().partnership.next_actions[0];
  assert.equal(completed.status, "done");
  assert.ok(completed.completed_at);
});

test("x-amber-phone resolving to a different DID is rejected", async () => {
  const store = makeFakeStore();
  const app = Fastify({ logger: false });
  registerPartnershipsRoutes(app, {
    ...store,
    requireApiKeyOrAuth: authStub(),
    tenantIndex: {
      // Header resolves to a tenant whose DID is NOT the authed principal.
      getByPhone: (p) =>
        p === "+15555550100" ? { id: "did:privy:someone-else" } : null,
    },
    indexPartnership: noopIndex(),
    indexPartnershipNote: noopIndex(),
    deletePartnershipVectors: noopIndex(),
  });
  const res = await app.inject({
    method: "POST",
    url: "/v1/partnerships",
    headers: { "x-amber-phone": "+15555550100" },
    payload: { name: "Perplexity", kind: "partner" },
  });
  assert.equal(res.statusCode, 403);
  assert.equal(res.json().error, "principal_mismatch");
});

test("missing auth returns 401 (no permissive fallback)", async () => {
  const app = Fastify({ logger: false });
  registerPartnershipsRoutes(app, {
    ...makeFakeStore(),
    requireApiKeyOrAuth: async () => {},
    tenantIndex: { getByPhone: () => null },
    indexPartnership: noopIndex(),
    indexPartnershipNote: noopIndex(),
    deletePartnershipVectors: noopIndex(),
  });
  const res = await app.inject({
    method: "POST",
    url: "/v1/partnerships",
    payload: { name: "Perplexity" },
  });
  assert.equal(res.statusCode, 401);
});

test("GET on missing partnership returns 404", async () => {
  const { app } = buildApp();
  const res = await app.inject({
    method: "GET",
    url: "/v1/partnerships/by-name?name=DoesNotExist",
  });
  assert.equal(res.statusCode, 404);
});
