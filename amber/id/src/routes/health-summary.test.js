import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { registerHealthSummaryRoutes } from "./health-summary.js";
test("Health requires consent and stores only owner-scoped private summary", async () => {
  const writes = [];
  const app = Fastify();
  registerHealthSummaryRoutes(app, {
    auth: async (req) => {
      req.privyUser = { phone: "fixture" };
    },
    resolve: async () => "owner",
    insert: async (input) => {
      writes.push(input);
    },
  });
  const payload = {
    requestId: "00000000-0000-4000-a000-000000000001",
    from: "2026-01-01T00:00:00Z",
    to: "2026-01-01T12:00:00Z",
    steps: 1234,
    consent: true,
  };
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: "/v1/me/health-summary",
        payload: { ...payload, consent: false },
      })
    ).statusCode,
    400,
  );
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: "/v1/me/health-summary",
        payload: { ...payload, contactId: "other" },
      })
    ).statusCode,
    200,
  );
  assert.equal(writes[0].contactId, undefined); // Fastify strips additional fields; handler never accepts a subject.
  const response = await app.inject({
    method: "POST",
    url: "/v1/me/health-summary",
    payload,
  });
  assert.equal(response.statusCode, 200);
  await app.inject({ method: "POST", url: "/v1/me/health-summary", payload });
  assert.equal(writes[0].observationId, writes[1].observationId);
  assert.equal(writes[0].ownerId, "owner");
  assert.equal(writes[0].createEvent, false);
  assert.deepEqual(writes[0].dimensions, []);
  assert.equal(writes[0].contactId, undefined);
  assert.match(writes[0].body, /Apple Health.*1234/);
  await app.close();
});
