/**
 * THE ROUTE THE APP HAS BEEN 404-ING ON SINCE THE PERSON SCREEN WAS WRITTEN.
 *
 * Every open of a person's card logged
 *
 *   Route GET:/v1/me/people/<uuid>/enrich not found
 *
 * and the client reads a 404 there as "not in your book yet", so the What's New
 * panel showed an empty state forever -- in front of an enrichment engine that
 * is fully built and tested and whose only callers were its own tests.
 *
 * enrichPerson is injected here, so these test the ROUTE: who may call it, what
 * it passes through, and that a disabled or unkeyed feature still returns the
 * shape the card renders rather than an error.
 */
import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import rateLimit from "@fastify/rate-limit";

import { registerContactEnrichmentRoutes } from "./contacts-enrich.js";

const PHONE = "+13105550100";
const CONTACT = "ceef9c79-64c4-440e-a3c3-0ce7c816d16f";

const OWNER = "35a94acc-5d39-488b-9b01-a239c8255076";

async function buildApp(over = {}) {
  const app = Fastify({ logger: false });
  await app.register(rateLimit, { global: false });
  registerContactEnrichmentRoutes(app, {
    requireAuth: async (request) => {
      request.privyUser = { userId: "did:privy:x", phone: PHONE };
    },
    resolveAmberIdByPhone: async () => OWNER,
    getContactById: async (_owner, id) =>
      id === CONTACT ? { id: CONTACT, name: "Neel Patel", company: "Springdale", title: "Partner" } : null,
    enrichPerson: async () => ({ status: "ok", contactId: CONTACT, whats_new: "Raised a seed round." }),
    ...over,
  });
  return app;
}

test("a malformed contact id is refused before it reaches a uuid cast", async () => {
  const app = await buildApp();
  for (const bad of ["abc", "1", "not-a-uuid"]) {
    const res = await app.inject({ method: "GET", url: `/v1/me/people/${bad}/enrich` });
    assert.equal(res.statusCode, 400, bad);
    assert.equal(res.json().error, "invalid_contact");
  }
});

test("the route exists for both verbs — which is the whole bug", async () => {
  const app = await buildApp();
  for (const method of ["GET", "POST"]) {
    const res = await app.inject({ method, url: `/v1/me/people/${CONTACT}/enrich` });
    assert.notEqual(res.statusCode, 404, `${method} still 404s`);
  }
});

test("a contact that is not the caller's own is a 404, not somebody else's brief", async () => {
  const app = await buildApp();
  const res = await app.inject({
    method: "GET",
    url: "/v1/me/people/11111111-2222-3333-4444-555555555555/enrich",
  });
  assert.equal(res.statusCode, 404);
  assert.equal(res.json().error, "contact_not_found");
});

test("the brief comes back, and the contact goes in scoped to its owner", async () => {
  const seen = [];
  const app = await buildApp({
    enrichPerson: async (ownerId, contact, opts) => {
      seen.push({ ownerId, contact, force: opts?.force });
      return { status: "ok", contactId: contact.id, whats_new: "Raised a seed round." };
    },
  });
  const res = await app.inject({ method: "GET", url: `/v1/me/people/${CONTACT}/enrich` });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().whats_new, "Raised a seed round.");
  assert.equal(seen[0].ownerId, OWNER, "the account id, not the privy did: it is also the vector owner");
  assert.equal(seen[0].contact.name, "Neel Patel");
  assert.equal(seen[0].force, false, "a GET honors the cache");
});

test("POST forces a re-pull; GET does not", async () => {
  const forces = [];
  const app = await buildApp({
    enrichPerson: async (_o, c, opts) => {
      forces.push(opts?.force);
      return { status: "ok", contactId: c.id };
    },
  });
  await app.inject({ method: "GET", url: `/v1/me/people/${CONTACT}/enrich` });
  await app.inject({ method: "POST", url: `/v1/me/people/${CONTACT}/enrich` });
  assert.deepEqual(forces, [false, true]);
});

test("a disabled or unkeyed feature still returns the shape the card renders", async () => {
  // enrichPerson never throws and always returns a full object; the route must
  // pass that through rather than turning it into an error, or the panel blanks.
  for (const status of ["disabled", "no_key", "error"]) {
    const app = await buildApp({
      enrichPerson: async () => ({ status, contactId: CONTACT, whats_new: null, sources: [] }),
    });
    const res = await app.inject({ method: "GET", url: `/v1/me/people/${CONTACT}/enrich` });
    assert.equal(res.statusCode, 200, status);
    assert.equal(res.json().status, status);
    assert.deepEqual(res.json().sources, []);
  }
});

test("an unauthenticated call gets 401 and never reaches the engine", async () => {
  let called = false;
  const app = await buildApp({
    requireAuth: async () => {},
    enrichPerson: async () => {
      called = true;
      return { status: "ok" };
    },
  });
  const res = await app.inject({ method: "GET", url: `/v1/me/people/${CONTACT}/enrich` });
  assert.equal(res.statusCode, 401);
  assert.equal(called, false);
});
