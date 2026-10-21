// relationship-trajectory.test.mjs
// Tab 32 - guards + summary rendering for the relationship_trajectory tool.
// Env is set before importing so constants.js sees a configured amber-id.

import test from "node:test";
import assert from "node:assert/strict";

process.env.AMBER_ID_API_URL = "https://amber-id.test";
process.env.AMBER_ID_API_KEY = "test-key";

const { executeRelationshipTrajectoryTool, RELATIONSHIP_TRAJECTORY_TOOLS } =
  await import("../tools/relationship-trajectory.js");

const TENANT = { tenant: { privyDid: "did:privy:medha" } };

function mockFetch(payload) {
  const orig = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    async json() {
      return payload;
    },
    async text() {
      return JSON.stringify(payload);
    },
  });
  return () => {
    globalThis.fetch = orig;
  };
}

test("tool schema exposes relationship_trajectory with the three intents", () => {
  const tool = RELATIONSHIP_TRAJECTORY_TOOLS.find(
    (t) => t.name === "relationship_trajectory",
  );
  assert.ok(tool);
  assert.deepEqual(tool.input_schema.properties.intent.enum, [
    "trajectory",
    "warming",
    "cooling",
  ]);
  assert.deepEqual(tool.input_schema.required, ["intent"]);
});

test("rejects an unknown tool name", async () => {
  const r = await executeRelationshipTrajectoryTool("nope", {}, TENANT);
  assert.ok(r.error);
});

test("requires a resolved tenant", async () => {
  const r = await executeRelationshipTrajectoryTool(
    "relationship_trajectory",
    { intent: "warming" },
    {},
  );
  assert.match(r.error, /resolved tenant/);
});

test("returns empty for synthetic expert tenants", async () => {
  const r = await executeRelationshipTrajectoryTool(
    "relationship_trajectory",
    { intent: "warming" },
    { tenant: { privyDid: "did:expert:foo" } },
  );
  assert.equal(r.ok, true);
  assert.equal(r.rows.length, 0);
});

test("rejects an invalid intent", async () => {
  const r = await executeRelationshipTrajectoryTool(
    "relationship_trajectory",
    { intent: "sideways" },
    TENANT,
  );
  assert.match(r.error, /intent must be one of/);
});

test("trajectory requires a contact", async () => {
  const r = await executeRelationshipTrajectoryTool(
    "relationship_trajectory",
    { intent: "trajectory" },
    TENANT,
  );
  assert.match(r.error, /contact_name or contact_id/);
});

test("warming renders a ranked list from amber-id rows", async () => {
  const restore = mockFetch({
    ok: true,
    rows: [
      {
        contact_name: "Shirley",
        composite_score: 0.7,
        score_delta: 0.2,
        talk_frequency: 8,
      },
      {
        contact_name: "Sagar",
        composite_score: 0.5,
        score_delta: 0.1,
        talk_frequency: 3,
      },
    ],
  });
  try {
    const r = await executeRelationshipTrajectoryTool(
      "relationship_trajectory",
      { intent: "warming" },
      TENANT,
    );
    assert.equal(r.ok, true);
    assert.equal(r.count, 2);
    assert.match(r.summary, /Warming relationships/);
    assert.match(r.summary, /Shirley/);
    assert.match(r.summary, /\+0\.2/);
  } finally {
    restore();
  }
});

test("trajectory classifies direction from the series", async () => {
  const restore = mockFetch({
    ok: true,
    contact_id: "name:shirley",
    rows: [
      {
        week_key: "2026-W20",
        composite_score: 0.2,
        sentiment_score: 0.1,
        score_delta: 0,
      },
      {
        week_key: "2026-W22",
        composite_score: 0.6,
        sentiment_score: 0.5,
        score_delta: 0.4,
      },
    ],
  });
  try {
    const r = await executeRelationshipTrajectoryTool(
      "relationship_trajectory",
      { intent: "trajectory", contact_name: "Shirley" },
      TENANT,
    );
    assert.equal(r.ok, true);
    assert.match(r.summary, /Shirley is warming/);
  } finally {
    restore();
  }
});
