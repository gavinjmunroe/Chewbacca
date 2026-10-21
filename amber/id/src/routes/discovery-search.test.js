import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { registerDiscoverySearchRoutes } from "./discovery-search.js";
const id = "11111111-1111-4111-8111-111111111111";
test("global searches are owner isolated, resumable and cannot re-spend an existing request", async () => {
  const app = Fastify();
  const jobs = new Map();
  let calls = 0;
  registerDiscoverySearchRoutes(app, {
    auth: async (r) => {
      if (r.headers.authorization)
        r.privyUser = { phone: r.headers.authorization };
    },
    resolve: async (p) => p,
    get: async (owner, id) => jobs.get(owner + id),
    reserve: async (owner, j) => {
      const job = { ...j, status: "pending" };
      jobs.set(owner + j.id, job);
      return { created: true, job };
    },
    update: async (owner, id, p) => {
      const job = { ...jobs.get(owner + id), ...p };
      jobs.set(owner + id, job);
      return job;
    },
    search: async (i) => {
      calls++;
      return { provider: "exa", scope: i.scope, results: [] };
    },
  });
  const send = (owner, patch = {}) =>
    app.inject({
      method: "POST",
      url: "/v1/me/discovery/search",
      headers: owner ? { authorization: owner } : {},
      payload: { requestId: id, query: "walks", scope: "plans", location: "Chicago", ...patch },
    });
  try {
    assert.equal((await send()).statusCode, 401);
    assert.equal((await send("a", {location:" "})).statusCode, 400);
    assert.equal(calls,0);
    assert.equal((await send("a")).json().status, "complete");
    assert.equal((await send("a", {location:"Boston"})).statusCode, 409);
    await send("a");
    assert.equal(calls, 1);
    assert.equal(
      (await send("a", { query: "something else" })).statusCode,
      409,
    );
    assert.equal(
      (
        await app.inject({
          url: `/v1/me/discovery/jobs/${id}`,
          headers: { authorization: "b" },
        })
      ).statusCode,
      404,
    );
    assert.equal((await send("b", { scope: "people" })).statusCode, 200);
    assert.equal(calls, 2);
  } finally {
    await app.close();
  }
});


test("missing provider configuration does not reserve a paid job; old jobs remain readable", async () => {
  const previous = process.env.EXA_API_KEY;
  delete process.env.EXA_API_KEY;
  const app = Fastify();
  let saved = null;
  registerDiscoverySearchRoutes(app, {
    auth: async r => { r.privyUser = {phone:"owner"}; },
    resolve: async p => p,
    get: async () => saved,
    reserve: async () => assert.fail("must not reserve without credentials"),
  });
  try {
    const response = await app.inject({method:"POST",url:"/v1/me/discovery/search",payload:{requestId:id,query:"engineers",scope:"people"}});
    assert.equal(response.statusCode,503);
    assert.equal(response.json().error,"exa_not_configured");
    saved = {id,kind:"search",status:"complete",input:{provider:"exa"},output:{results:[]}};
    assert.equal((await app.inject({url:`/v1/me/discovery/jobs/${id}`})).json().status,"complete");
    saved = {...saved,status:"pending",created_at:new Date(Date.now()-180000).toISOString(),output:null};
    assert.equal((await app.inject({url:`/v1/me/discovery/jobs/${id}`})).json().status,"error");
  } finally {
    if (previous === undefined) delete process.env.EXA_API_KEY; else process.env.EXA_API_KEY=previous;
    await app.close();
  }
});
