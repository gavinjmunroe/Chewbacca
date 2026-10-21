/**
 * Tests for list_content_seeds (Tab 13 read-side).
 *
 * Wraps medha-id GET /v1/content-seeds. Mocks global.fetch so the test
 * never hits a real backend.
 *
 * Run: node --test Newton/agent/lib/__tests__/list-content-seeds.test.mjs
 */

process.env.AMBER_ID_API_URL =
  process.env.AMBER_ID_API_URL || "https://amber-id-test.invalid";
process.env.AMBER_ID_API_KEY = process.env.AMBER_ID_API_KEY || "test-key";

import { test } from "node:test";
import assert from "node:assert/strict";

const { executePolishDraftTool, POLISH_DRAFT_TOOLS } =
  await import("../tools/polish-draft.js");

const TENANT = { phoneNumber: "+15555550100" };

test("POLISH_DRAFT_TOOLS includes list_content_seeds with status enum", () => {
  const tool = POLISH_DRAFT_TOOLS.find((t) => t.name === "list_content_seeds");
  assert.ok(tool, "list_content_seeds tool missing from POLISH_DRAFT_TOOLS");
  assert.equal(tool.input_schema.type, "object");
  const statusEnum = tool.input_schema.properties.status.enum;
  assert.deepEqual(statusEnum.sort(), ["all", "polished", "raw", "shipped"]);
});

test("list_content_seeds happy path returns ok + seeds + count", async (t) => {
  const captured = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    captured.push({ url: String(url), init });
    return new Response(
      JSON.stringify({
        data: [
          {
            id: "seed_abc",
            status: "raw",
            intent: "newsletter",
            author_slug: "sagar-tiwari",
            raw_text: "hello world this is the opener of a draft",
            created_at: "2026-05-28T10:00:00Z",
          },
        ],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const result = await executePolishDraftTool(
    "list_content_seeds",
    {},
    { tenant: TENANT },
  );

  assert.equal(result.ok, true);
  assert.equal(result.count, 1);
  assert.equal(result.seeds.length, 1);
  assert.equal(result.seeds[0].seed_id, "seed_abc");
  assert.equal(result.seeds[0].status, "raw");
  assert.equal(result.seeds[0].author_slug, "sagar-tiwari");
  assert.ok(result.seeds[0].opener.startsWith("hello world"));
  assert.equal(captured.length, 1);
  assert.equal(captured[0].init.method, "GET");
  assert.equal(captured[0].init.headers["x-amber-phone"], TENANT.phoneNumber);
  assert.equal(captured[0].init.headers["x-api-key"], "test-key");
});

test("list_content_seeds passes status filter into the URL", async (t) => {
  const captured = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    captured.push({ url: String(url), init });
    return new Response(JSON.stringify({ data: [] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const result = await executePolishDraftTool(
    "list_content_seeds",
    { status: "polished" },
    { tenant: TENANT },
  );

  assert.equal(result.ok, true);
  assert.equal(captured.length, 1);
  assert.ok(
    captured[0].url.includes("status=polished"),
    `URL should include status=polished, got: ${captured[0].url}`,
  );
});

test("list_content_seeds surfaces backend error on non-200", async (t) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ error: "boom" }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const result = await executePolishDraftTool(
    "list_content_seeds",
    {},
    { tenant: TENANT },
  );

  assert.ok(result.error, "expected an error field on 500");
  assert.equal(result.status, 500);
});
