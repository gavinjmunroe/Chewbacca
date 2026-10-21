/**
 * Unit tests for the contact-edge read surface (Tab 33).
 *
 * Graceful degradation: with PINECONE_API_KEY / PERPLEXITY_API_KEY absent, every
 * read short-circuits to an empty result before touching Pinecone or Perplexity
 * (mirrors the other *-index.js modules). The graph-walk LOGIC lives in pure
 * helpers covered by contact-edge.test.js; here we assert the no-network path.
 *
 * Run with:  node --test src/knowledge/contact-edges-index.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

// Ensure the vectorization gate is closed for these tests.
delete process.env.PINECONE_API_KEY;
delete process.env.PERPLEXITY_API_KEY;

const {
  findNeighborhood,
  findMutualConnections,
  findIntroPath,
  resolveContactId,
} = await import("./contact-edges-index.js");

test("findNeighborhood degrades to empty without vectorization", async () => {
  const r = await findNeighborhood("did:privy:test", { contactId: "name:sagar" });
  assert.deepEqual(r, { contact_id: "name:sagar", neighbors: [] });
});

test("findNeighborhood requires a contact id", async () => {
  const r = await findNeighborhood("did:privy:test", {});
  assert.deepEqual(r, { contact_id: null, neighbors: [] });
});

test("findMutualConnections degrades to empty without vectorization", async () => {
  const r = await findMutualConnections("did:privy:test", {
    contactIdA: "name:a",
    contactIdB: "name:b",
  });
  assert.deepEqual(r, { mutuals: [] });
});

test("findMutualConnections requires both anchors", async () => {
  const r = await findMutualConnections("did:privy:test", { contactIdA: "name:a" });
  assert.deepEqual(r, { mutuals: [] });
});

test("findIntroPath returns a trivial path when from === to", async () => {
  const r = await findIntroPath("did:privy:test", {
    fromId: "name:x",
    toId: "name:x",
  });
  assert.equal(r.found, true);
  assert.equal(r.hops, 0);
  assert.deepEqual(r.path, [{ id: "name:x", name: "name:x" }]);
});

test("findIntroPath degrades to not-found without vectorization", async () => {
  const r = await findIntroPath("did:privy:test", {
    fromId: "name:a",
    toId: "name:b",
  });
  assert.equal(r.found, false);
  assert.deepEqual(r.path, []);
});

test("resolveContactId falls back to the name slug without vectorization", async () => {
  // No edges retrievable, so it slugs the name deterministically.
  const id = await resolveContactId("did:privy:test", {
    contactName: "Shirley Park",
  });
  assert.equal(id, "name:shirley-park");
  // Explicit id always wins.
  assert.equal(
    await resolveContactId("did:privy:test", { contactId: "name:given" }),
    "name:given",
  );
  // Nothing usable supplied.
  assert.equal(await resolveContactId("did:privy:test", {}), null);
});
