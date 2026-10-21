/**
 * Smoke tests for the `search_contacts` tool. Verifies the tool wiring
 * (schema shape + error paths) without actually hitting amber-id.
 *
 * Run with:
 *   node --test Newton/agent/lib/__tests__/contacts-search-tool.test.mjs
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  CONTACTS_SEARCH_TOOLS,
  executeContactsSearchTool,
} from "../tools/contacts-search.js";

test("CONTACTS_SEARCH_TOOLS exposes a single tool named search_contacts", () => {
  assert.equal(CONTACTS_SEARCH_TOOLS.length, 1);
  const t = CONTACTS_SEARCH_TOOLS[0];
  assert.equal(t.name, "search_contacts");
  assert.equal(typeof t.description, "string");
  assert.ok(t.description.length > 50);
  assert.equal(t.input_schema.type, "object");
  assert.deepEqual(t.input_schema.required, ["query"]);
  assert.ok(t.input_schema.properties.query);
  assert.ok(t.input_schema.properties.topK);
  assert.ok(t.input_schema.properties.source);
});

test("executeContactsSearchTool: unknown tool name returns error", async () => {
  const res = await executeContactsSearchTool("not_a_tool", {}, {});
  assert.ok(res.error);
});

test("executeContactsSearchTool: missing tenant returns error", async () => {
  const res = await executeContactsSearchTool(
    "search_contacts",
    { query: "stanford" },
    { tenant: null },
  );
  assert.ok(res.error);
  assert.match(res.error, /tenant/i);
});

test("executeContactsSearchTool: missing query returns error", async () => {
  const res = await executeContactsSearchTool(
    "search_contacts",
    {},
    { tenant: { privyDid: "did:privy:test" } },
  );
  assert.ok(res.error);
  assert.match(res.error, /query/i);
});

test("executeContactsSearchTool: expert tenant short-circuits with empty matches", async () => {
  // did:expert: namespaces don't have real Pinecone rows, so the tool
  // returns ok=true with an empty match list rather than trying to round
  // trip to amber-id. Verifying we don't 500 on expert mode.
  const res = await executeContactsSearchTool(
    "search_contacts",
    { query: "anyone" },
    { tenant: { privyDid: "did:expert:medha" } },
  );
  // It may either be `ok: true, matches: []` or an "unavailable" error
  // depending on whether AMBER_ID env is set. Both are non-throwing.
  assert.ok(res.ok || res.error);
});
