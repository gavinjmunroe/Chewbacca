/**
 * Tests for the recall_by_dimension agent tool.
 *
 * Run with:  node --test Newton/agent/lib/__tests__/recall-by-dimension.test.mjs
 *
 * We stub global.fetch so the test exercises argument validation, filter
 * assembly, and result shaping without a live amber-id.
 */

import test from "node:test";
import assert from "node:assert/strict";

// constants.js reads env at import time, so set before importing the tool.
process.env.AMBER_ID_API_URL = "https://amber-id.test";
process.env.AMBER_ID_API_KEY = "test-key";

const { executeRecallByDimensionTool, RECALL_BY_DIMENSION_TOOLS } =
  await import("../tools/recall-by-dimension.js");

const TENANT = { privyDid: "did:privy:abc123" };

function stubFetch(captured, matches = []) {
  global.fetch = async (url, opts) => {
    captured.url = url;
    captured.body = JSON.parse(opts.body);
    return {
      ok: true,
      status: 200,
      json: async () => ({ ok: true, matches }),
    };
  };
}

test("rejects unknown tool name", async () => {
  const out = await executeRecallByDimensionTool(
    "nope",
    {},
    { tenant: TENANT },
  );
  assert.match(out.error, /Unknown recall tool/);
});

test("requires a resolved tenant", async () => {
  const out = await executeRecallByDimensionTool(
    "recall_by_dimension",
    { query: "x" },
    {},
  );
  assert.match(out.error, /resolved tenant/);
});

test("requires a query", async () => {
  const out = await executeRecallByDimensionTool(
    "recall_by_dimension",
    {},
    { tenant: TENANT },
  );
  assert.match(out.error, /query is required/);
});

test("rejects an invalid dimension before any network call", async () => {
  let called = false;
  global.fetch = async () => {
    called = true;
    throw new Error("should not be called");
  };
  const out = await executeRecallByDimensionTool(
    "recall_by_dimension",
    { query: "x", healthDimension: ["wealth"] },
    { tenant: TENANT },
  );
  assert.match(out.error, /invalid healthDimension/);
  assert.equal(called, false);
});

test("sends healthDimension + kind in the query-as body", async () => {
  const captured = {};
  stubFetch(captured);
  await executeRecallByDimensionTool(
    "recall_by_dimension",
    {
      query: "spiritual stuff",
      healthDimension: "spiritual",
      kind: "conversation",
    },
    { tenant: TENANT },
  );
  assert.equal(captured.url, "https://amber-id.test/knowledge/query-as");
  assert.equal(captured.body.target_did, "did:privy:abc123");
  assert.equal(captured.body.text, "spiritual stuff");
  assert.deepEqual(captured.body.healthDimension, ["spiritual"]);
  assert.deepEqual(captured.body.kind, ["conversation"]);
});

test("accepts the `dimension` alias and omits empty filters", async () => {
  const captured = {};
  stubFetch(captured);
  await executeRecallByDimensionTool(
    "recall_by_dimension",
    { query: "anything", dimension: "financial" },
    { tenant: TENANT },
  );
  assert.deepEqual(captured.body.healthDimension, ["financial"]);
  assert.equal("kind" in captured.body, false);
});

test("shapes matches and clamps topK", async () => {
  const captured = {};
  stubFetch(captured, [
    {
      score: 0.91,
      metadata: {
        health_dimension: "spiritual",
        kind: "conversation",
        text: "prayed about the launch",
        created_at: "2026-05-20T10:00:00Z",
        source: "msg-1",
      },
    },
  ]);
  const out = await executeRecallByDimensionTool(
    "recall_by_dimension",
    { query: "prayer", topK: 999 },
    { tenant: TENANT },
  );
  assert.equal(captured.body.topK, 50); // clamped to MAX_TOP_K
  assert.equal(out.ok, true);
  assert.equal(out.count, 1);
  assert.equal(out.matches[0].healthDimension, "spiritual");
  assert.equal(out.matches[0].kind, "conversation");
  assert.match(out.summary, /\[spiritual\/conversation\]/);
});

test("empty result returns a friendly summary, not an error", async () => {
  const captured = {};
  stubFetch(captured, []);
  const out = await executeRecallByDimensionTool(
    "recall_by_dimension",
    { query: "nothing here", healthDimension: "physical" },
    { tenant: TENANT },
  );
  assert.equal(out.ok, true);
  assert.deepEqual(out.matches, []);
  assert.match(out.summary, /No matching memories/);
});

test("tool schema is well-formed", () => {
  assert.equal(RECALL_BY_DIMENSION_TOOLS.length, 1);
  const t = RECALL_BY_DIMENSION_TOOLS[0];
  assert.equal(t.name, "recall_by_dimension");
  assert.deepEqual(t.input_schema.required, ["query"]);
  assert.deepEqual(t.input_schema.properties.healthDimension.items.enum, [
    "spiritual",
    "emotional",
    "physical",
    "intellectual",
    "social",
    "financial",
  ]);
});
