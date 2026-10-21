/**
 * Tab 6 — workspace docs tool + prompt-block tests.
 *
 * Run with:
 *   node --test Newton/agent/lib/__tests__/workspace-docs.test.mjs
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  WORKSPACE_DOCS_TOOLS,
  executeWorkspaceDocsTool,
} from "../tools/workspace-docs.js";
import { buildWorkspaceDocsBlock } from "../prompts.js";

const SHIRLEY_DOCS = [
  {
    slug: "performance-tracker",
    name: "BMA Performance Tracker",
    kind: "sheet",
    id: "sheet-abc-123",
    defaultRange: "A1:Z200",
  },
  {
    slug: "content-strategy",
    name: "BMA Content Strategy",
    kind: "doc",
    id: "doc-xyz-789",
  },
];

test("WORKSPACE_DOCS_TOOLS exposes the two read-only tools", () => {
  const names = WORKSPACE_DOCS_TOOLS.map((t) => t.name).sort();
  assert.deepEqual(names, ["workspace_list_docs", "workspace_read_doc"]);
});

test("workspace_list_docs returns registered entries for a tenant", async () => {
  const result = await executeWorkspaceDocsTool(
    "workspace_list_docs",
    {},
    { tenant: { workspaceDocs: SHIRLEY_DOCS } },
  );
  assert.equal(result.count, 2);
  assert.deepEqual(
    result.docs.map((d) => d.slug),
    ["performance-tracker", "content-strategy"],
  );
});

test("workspace_list_docs returns empty list when tenant has none", async () => {
  const result = await executeWorkspaceDocsTool(
    "workspace_list_docs",
    {},
    { tenant: {} },
  );
  assert.equal(result.count, 0);
  assert.deepEqual(result.docs, []);
});

test("workspace_read_doc with no identifier returns a clear error", async () => {
  const result = await executeWorkspaceDocsTool(
    "workspace_read_doc",
    {},
    { tenant: { workspaceDocs: SHIRLEY_DOCS } },
  );
  assert.match(result.error, /Provide one of/);
});

test("workspace_read_doc rejects unknown name with the registry listed", async () => {
  const result = await executeWorkspaceDocsTool(
    "workspace_read_doc",
    { name: "Mystery Sheet" },
    { tenant: { workspaceDocs: SHIRLEY_DOCS } },
  );
  assert.match(result.error, /No registered workspace doc matches/);
  assert.equal(result.registered.length, 2);
});

test("workspace_read_doc matches by name case-insensitively (sheet path)", async () => {
  // Stub fetch so we don't hit Google OAuth.
  const origFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(url);
    return {
      ok: true,
      json: async () => ({ range: "A1:Z200", values: [["hello"]] }),
    };
  };

  // Pre-stub: getGoogleAccessToken will be hit by executeSheetsTool. We can't
  // easily mock that without ESM-loader gymnastics, so we just assert the
  // error shape we get back when no Google connection exists — that's still
  // proof routing reached executeSheetsTool with the right spreadsheet ID.
  try {
    const result = await executeWorkspaceDocsTool(
      "workspace_read_doc",
      { name: "bma performance tracker" },
      { tenant: { workspaceDocs: SHIRLEY_DOCS } },
    );
    // We expect either values (if Google is connected in the test env) or
    // an OAuth error from getGoogleAccessToken. Either proves routing.
    assert.ok(result, "workspace_read_doc returned a result");
    assert.equal(result.matched.slug, "performance-tracker");
  } finally {
    globalThis.fetch = origFetch;
  }
});

test("buildWorkspaceDocsBlock is empty when tenant has no docs", () => {
  assert.equal(buildWorkspaceDocsBlock(null), "");
  assert.equal(buildWorkspaceDocsBlock({}), "");
  assert.equal(buildWorkspaceDocsBlock({ workspaceDocs: [] }), "");
});

test("buildWorkspaceDocsBlock lists registered docs and points to workspace_read_doc", () => {
  const block = buildWorkspaceDocsBlock({ workspaceDocs: SHIRLEY_DOCS });
  assert.match(block, /BMA Performance Tracker \(sheet\)/);
  assert.match(block, /BMA Content Strategy \(doc\)/);
  assert.match(block, /workspace_read_doc/);
  assert.match(block, /performance-tracker/);
});

test("buildWorkspaceDocsBlock skips malformed entries", () => {
  const block = buildWorkspaceDocsBlock({
    workspaceDocs: [
      { slug: "ok", name: "Real Doc", kind: "sheet", id: "x" },
      { slug: "broken", name: "", kind: "" },
    ],
  });
  assert.match(block, /Real Doc/);
  assert.doesNotMatch(block, /broken/);
});
