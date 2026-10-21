/**
 * POST /clear — cleared-to-share projection.
 *
 * Body: { did, ids, cleared_scope }
 *
 * Refetches the named vectors from `tenant-<did>`, strips sensitive
 * metadata, stamps clearance provenance, upserts to `share-<did>`.
 * Idempotent under the same id — a private edit followed by a re-clear
 * updates the shared copy in place.
 *
 * `cleared_scope` is opaque to the KG layer. It's whatever your policy
 * layer means by "who can see this" — a circle id, a DID, a space id.
 * Readers of share-<did> filter on `cleared_scope` to enforce the
 * intended audience.
 */

import { clearVectors, unshareVectors } from "../lib/pinecone.js";

export async function clearRoute(app) {
  app.post("/clear", async (req, reply) => {
    const { did, ids, cleared_scope } = req.body || {};
    if (!did || typeof did !== "string") {
      return reply
        .code(400)
        .send({ error: "invalid_request", message: "did is required" });
    }
    if (!Array.isArray(ids)) {
      return reply
        .code(400)
        .send({ error: "invalid_request", message: "ids array is required" });
    }
    if (!cleared_scope || typeof cleared_scope !== "string") {
      return reply.code(400).send({
        error: "invalid_request",
        message: "cleared_scope string is required",
      });
    }
    const result = await clearVectors(did, ids, cleared_scope);
    return reply.send(result);
  });

  // Reverse of /clear — drop the shared copies. Private truth untouched.
  app.post("/unshare", async (req, reply) => {
    const { did, ids } = req.body || {};
    if (!did || typeof did !== "string") {
      return reply
        .code(400)
        .send({ error: "invalid_request", message: "did is required" });
    }
    if (!Array.isArray(ids)) {
      return reply
        .code(400)
        .send({ error: "invalid_request", message: "ids array is required" });
    }
    const result = await unshareVectors(did, ids);
    return reply.send(result);
  });
}
