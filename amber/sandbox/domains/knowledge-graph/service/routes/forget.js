/**
 * POST /forget — delete vectors from tenant-<did> and share-<did>.
 *
 * Body: { did, ids?, all? }
 *
 * If `all: true`, wipes both namespaces for the tenant. Otherwise deletes
 * the named ids. In private-scope deletion (the default), the same ids
 * are also removed from `share-<did>` so /forget cannot leave dangling
 * cleared copies. This matches the trust model — the private truth is
 * always the source; the shared copy is a projection.
 */

import { forget } from "../lib/pinecone.js";

export async function forgetRoute(app) {
  app.post("/forget", async (req, reply) => {
    const { did, ids, all = false } = req.body || {};
    if (!did || typeof did !== "string") {
      return reply
        .code(400)
        .send({ error: "invalid_request", message: "did is required" });
    }
    if (!all && (!Array.isArray(ids) || ids.length === 0)) {
      return reply.code(400).send({
        error: "invalid_request",
        message: "either ids array or all: true is required",
      });
    }
    const result = await forget(did, { ids, all });
    return reply.send(result);
  });
}
