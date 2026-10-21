/**
 * Tests that the identity/CRM MCP tools (a) advertise requiresOwnerDid so the
 * MCP server defaults `did` to the API-key-bound owner, and (b) return a clean
 * missing_did error (never a crash or an empty success) when no DID resolves.
 *
 * Run with:  node --test src/mcp/tools/owner-did.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import * as searchPeople from "./search-people.js";
import * as peopleRank from "./people-rank.js";
import * as upsertContact from "./upsert-contact.js";

const DID_TOOLS = [
  { mod: searchPeople, args: { query: "anything" } },
  { mod: peopleRank, args: {} },
  { mod: upsertContact, args: { contact: { name: "Test" } } },
];

test("identity/CRM tools declare requiresOwnerDid", () => {
  for (const { mod } of DID_TOOLS) {
    assert.equal(
      mod.requiresOwnerDid,
      true,
      `${mod.name} must declare requiresOwnerDid so the server injects the owner DID`,
    );
  }
});

test("identity/CRM tools error cleanly when no DID is provided or bound", async () => {
  for (const { mod, args } of DID_TOOLS) {
    const res = await mod.handler({ ...args });
    assert.equal(res.isError, true, `${mod.name} should error without a DID`);
    const payload = JSON.parse(res.content[0].text);
    assert.equal(
      payload.error,
      "missing_did",
      `${mod.name} should return a missing_did error, not crash or return empty`,
    );
  }
});
