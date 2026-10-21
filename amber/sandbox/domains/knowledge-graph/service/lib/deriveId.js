/**
 * Deterministic stable record ID for the Amber knowledge graph.
 *
 * BYTE-IDENTICAL CONTRACT — this hash is the primary key for every vector
 * in the `amber-people` Pinecone index. It is also the key the Python
 * toolkit (`python/build_people.py`, `python/seed_01.py`, `python/upload.py`,
 * `python/migrate_memory.py`) uses when it upserts. If the JSON layout,
 * key order, hash algorithm, digest encoding, or slice length ever change,
 * every existing seed becomes a duplicate on the next re-run.
 *
 * Do not "improve" this function. Do not sort keys. Do not switch to
 * canonical JSON. Do not swap to blake3. The contract is:
 *
 *   sha256(JSON.stringify({did, person, kind, text, createdAt}))[:32]
 *
 * where the object literal is written IN THAT KEY ORDER, and each value
 * defaults to null (person/kind/createdAt) or "" (text) when absent.
 *
 * Callers can override with `item.id` — used when the caller has its own
 * external primary key (e.g. Firestore doc ids, `dh-<date>-<n>` for daily
 * highlights) that should own the vector's identity.
 *
 * Ported verbatim from `amber-id/src/knowledge/pinecone-client.js`
 * (function `deriveId`, PR #186 era).
 */

import crypto from "node:crypto";

export function deriveId(privyDid, item) {
  if (item && item.id) return String(item.id);
  const base = JSON.stringify({
    did: privyDid,
    person: (item && item.personId) || null,
    kind: (item && item.kind) || null,
    text: (item && item.text) || "",
    createdAt: (item && item.createdAt) || null,
  });
  return crypto.createHash("sha256").update(base).digest("hex").slice(0, 32);
}
