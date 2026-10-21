/**
 * Pin the deriveId contract. This hash is the primary key across every
 * writer, every Python re-run of the seed, and the future data in the
 * `amber-people` Pinecone index. If any of these assertions ever fail,
 * DO NOT relax the assertion — you have broken the seed key and every
 * re-upsert will duplicate.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { deriveId } from "./deriveId.js";

const DID = "did:privy:cmo0ay9oy001u0cl7h1wb7thy";

function expected({ did, personId, kind, text, createdAt }) {
  const base = JSON.stringify({
    did,
    person: personId || null,
    kind: kind || null,
    text: text || "",
    createdAt: createdAt || null,
  });
  return crypto.createHash("sha256").update(base).digest("hex").slice(0, 32);
}

test("deriveId returns the item.id verbatim when set", () => {
  assert.equal(deriveId(DID, { id: "already-set-123" }), "already-set-123");
});

test("deriveId is deterministic for the same inputs", () => {
  const item = {
    personId: "person:helene",
    kind: "person",
    text: "Helene Servillon",
    createdAt: "2026-08-26T00:00:00.000Z",
  };
  assert.equal(deriveId(DID, item), deriveId(DID, item));
});

test("deriveId matches the byte-identical formula from amber-id", () => {
  const item = {
    personId: "person:sagar",
    kind: "person",
    text: "Sagar Yadav",
    createdAt: "2026-08-26T00:00:00.000Z",
  };
  assert.equal(deriveId(DID, item), expected({ did: DID, ...item }));
});

test("deriveId slices to 32 hex chars", () => {
  const id = deriveId(DID, { kind: "person", text: "x" });
  assert.equal(id.length, 32);
  assert.match(id, /^[0-9a-f]{32}$/);
});

test("deriveId treats missing fields as null / empty string, not undefined", () => {
  const id = deriveId(DID, {});
  assert.equal(
    id,
    expected({ did: DID, personId: null, kind: null, text: "", createdAt: null }),
  );
});

test("deriveId changes when any tracked field changes", () => {
  const base = { personId: "p", kind: "k", text: "t", createdAt: "c" };
  const id0 = deriveId(DID, base);
  assert.notEqual(id0, deriveId(DID, { ...base, personId: "p2" }));
  assert.notEqual(id0, deriveId(DID, { ...base, kind: "k2" }));
  assert.notEqual(id0, deriveId(DID, { ...base, text: "t2" }));
  assert.notEqual(id0, deriveId(DID, { ...base, createdAt: "c2" }));
  assert.notEqual(id0, deriveId("did:privy:other", base));
});
