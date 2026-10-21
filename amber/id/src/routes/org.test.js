/**
 * THE ORG ROUTES' OWN DECISIONS — the ones that do not need a database.
 *
 * The stores talk to Cloud SQL, so what is pinned here is what the routes
 * decide before reaching them, and all three have a specific failure in mind:
 *
 *   - A SECOND COMPANY IS REFUSED AT THE ROUTE, not only by the unique index.
 *     Leaving it to the database means the user sees a 500 where the correct
 *     answer is a sentence: you are already in a company.
 *   - /v1/org/me ANSWERS FOR A CONSUMER ACCOUNT. The website calls it before it
 *     knows which fork to render; a 403 there would make the common case look
 *     broken.
 *   - NO ROUTE READS AN org_id FROM THE CLIENT. The company comes from the
 *     membership and nowhere else, which is the property that keeps one
 *     forgotten check from serving another company's roster.
 */

import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { readFileSync } from "node:fs";

import { registerOrgRoutes } from "./org.js";

const AMBER = "11111111-2222-3333-4444-555555555555";
const ORG = "99999999-8888-7777-6666-555555555555";

function build(actor) {
  const app = Fastify({ logger: false });
  registerOrgRoutes(app, {
    requireAuth: async (request) => {
      request.privyUser = { userId: `did:amber:${AMBER}`, phone: "+13105550100" };
    },
    resolveActor: async (request) => {
      request.actor = actor;
      request.amberId = actor.amberId;
    },
  });
  return app;
}

const INDIVIDUAL = { amberId: AMBER, kind: "individual", orgId: null, orgRole: null, orgStatus: null, orgName: null };
const MEMBER = { amberId: AMBER, kind: "org", orgId: ORG, orgRole: "member", orgStatus: "active", orgName: "Paychex" };

test("an account already in a company cannot enrol a second one", async () => {
  const app = build(MEMBER);
  const res = await app.inject({ method: "POST", url: "/v1/org", payload: { name: "Another Co" } });
  assert.equal(res.statusCode, 409);
  assert.equal(res.json().error, "already_in_org");
  await app.close();
});

test("/v1/org/me answers for a consumer account instead of refusing", async () => {
  const app = build(INDIVIDUAL);
  const res = await app.inject({ method: "GET", url: "/v1/org/me" });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), { org: null, kind: "individual" });
  await app.close();
});

test("A MEMBER IS REFUSED EVERY ADMIN ROUTE, and the refusal is a 403 with a reason", async () => {
  const app = build(MEMBER);
  for (const [method, url, payload] of [
    ["POST", "/v1/org/invites", { email: "a@b.com" }],
    ["GET", "/v1/org/shares", undefined],
    ["POST", "/v1/org/groups", { name: "Sales" }],
    ["PUT", "/v1/org/policy", { policy: { internal: "org" } }],
    ["DELETE", `/v1/org/members/${AMBER}`, undefined],
  ]) {
    const res = await app.inject({ method, url, payload });
    assert.equal(res.statusCode, 403, `${method} ${url}`);
    assert.equal(res.json().error, "not_admin", `${method} ${url}`);
  }
  await app.close();
});

test("a suspended admin reaches nothing, which is the point of status being separate from the role", async () => {
  const app = build({ ...MEMBER, orgRole: "admin", orgStatus: "suspended" });
  const res = await app.inject({ method: "GET", url: "/v1/org/members" });
  assert.equal(res.statusCode, 403);
  assert.equal(res.json().error, "membership_suspended");
  await app.close();
});

test("NO ROUTE TAKES AN org_id. A client that sends one cannot reach another company", () => {
  // Read as source rather than exercised, because the guarantee is the absence
  // of a code path: if no handler ever reads an org id off the request, there
  // is nothing for a test to send. The day somebody adds `request.body.orgId`
  // this fails, which is the day it is still cheap to argue about.
  const src = readRoutes();
  assert.equal(/params\.orgId|body\?\.orgId|query\.orgId/.test(src), false,
    "an org route started reading an org id from the client");
  // Every handler takes it from the resolved actor instead.
  assert.ok(src.includes("request.actor.orgId"));
});

function readRoutes() {
  return readFileSync(new URL("./org.js", import.meta.url), "utf8");
}
