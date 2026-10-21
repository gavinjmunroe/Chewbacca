import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { registerPeopleRankRoutes } from "./people-rank.js";

const did = "a".repeat(32);

async function withApp({ authenticated = true, rank } = {}) {
  const app = Fastify();
  registerPeopleRankRoutes(app, {
    requireAuth: async (request) => {
      if (authenticated) request.privyUser = { userId: did, source: "medha-id" };
    },
    rank: rank || (async () => ({
      ok: true,
      result: {
        query: "design leaders",
        count: 1,
        people: [{ contactId: "contact-1", name: "A Person", score: 0.9 }],
        answer: "A Person is a strong match.",
        answer_status: "ok",
        citations: [],
      },
    })),
  });
  return app;
}

test("PeopleRank is authenticated, owner-scoped, and returns the app response shape", async () => {
  let call;
  const app = await withApp({ authenticated: false, rank: async () => {
    assert.fail("unauthenticated PeopleRank request must not rank");
  } });
  try {
    const missing = await app.inject({ method: "POST", url: "/v1/me/people-rank", payload: {} });
    assert.equal(missing.statusCode, 401);
  } finally {
    await app.close();
  }

  const authenticatedApp = await withApp({ rank: async (...args) => {
    call = args;
    return {
      ok: true,
      result: {
        query: "design leaders",
        count: 1,
        people: [{ contactId: "contact-1", name: "A Person", score: 0.9 }],
        answer: "A Person is a strong match.",
        answer_status: "ok",
        citations: [],
      },
    };
  } });
  try {
    const response = await authenticatedApp.inject({
      method: "POST",
      url: "/v1/me/people-rank",
      payload: { query: "  design leaders  ", limit: 12, me: { city: "Palo Alto" } },
    });
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().people[0].contactId, "contact-1");
    assert.deepEqual(call, [did, { query: "design leaders", limit: 12 }]);
  } finally {
    await authenticatedApp.close();
  }
});

test("an account without contacts gets a successful empty result", async () => {
  const app = await withApp({ rank: async () => ({ ok: false, error: "no_contacts" }) });
  try {
    const response = await app.inject({
      method: "POST",
      url: "/v1/me/people-rank",
      payload: { query: "people at Acme" },
    });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), {
      query: "people at Acme",
      count: 0,
      people: [],
      answer: null,
      answer_status: "no_contacts",
      citations: [],
    });
  } finally {
    await app.close();
  }
});

test("an unavailable rank engine returns a retryable service error", async () => {
  const app = await withApp({ rank: async () => ({ ok: false, error: "engine_unavailable" }) });
  try {
    const response = await app.inject({
      method: "POST",
      url: "/v1/me/people-rank",
      payload: { query: "people at Acme" },
    });
    assert.equal(response.statusCode, 503);
    assert.equal(response.json().error, "people_rank_unavailable");
  } finally {
    await app.close();
  }
});

test("PeopleRank rejects an invalid result limit", async () => {
  const app = await withApp();
  try {
    const response = await app.inject({
      method: "POST",
      url: "/v1/me/people-rank",
      payload: { limit: 51 },
    });
    assert.equal(response.statusCode, 400);
  } finally {
    await app.close();
  }
});
