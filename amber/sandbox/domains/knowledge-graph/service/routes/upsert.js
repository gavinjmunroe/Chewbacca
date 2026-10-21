/**
 * POST /upsert — write records into a tenant's private namespace.
 *
 * Body: { did, kind, records: [{ person, text, createdAt, metadata? }] }
 *
 * The service derives the vector id (`deriveId`) and the embedding
 * (`embed`) before handing the batch to the sandbox-owned Pinecone
 * client. Callers never see the vector values.
 *
 * All amber-id writer flows (contacts, events, partnerships, …) come
 * through here; the /writers/ modules are thin wrappers that shape the
 * `records` payload for their kind.
 */

import { embedMany } from "../lib/embed.js";
import { upsert as pineconeUpsert } from "../lib/pinecone.js";

export async function upsertRoute(app) {
  app.post("/upsert", async (req, reply) => {
    const { did, kind, records, opts } = req.body || {};
    if (!did || typeof did !== "string") {
      return reply
        .code(400)
        .send({ error: "invalid_request", message: "did is required" });
    }
    if (!Array.isArray(records) || records.length === 0) {
      return reply.send({ upserted: 0 });
    }

    // Embed all texts in one batched call.
    const texts = records.map((r) => (r && r.text) || "");
    const vectors = await embedMany(texts);

    const items = records.map((r, i) => {
      const meta = (r && r.metadata) || {};
      return {
        id: r.id || undefined,
        vector: vectors[i],
        text: r.text,
        kind: r.kind || kind,
        source: r.source || meta.source,
        personId: r.personId || meta.person_id,
        personName: r.personName || meta.person_name,
        healthDimension: r.healthDimension || meta.health_dimension,
        secondaryDimensions: r.secondaryDimensions || meta.secondary_dimensions,
        dimensionScores: r.dimensionScores || meta.dimension_scores,
        visibility: r.visibility || meta.visibility,
        trust: r.trust ?? meta.trust,
        createdAt: r.createdAt || meta.created_at,
        extra: r.extra || meta.extra,
      };
    });

    const result = await pineconeUpsert(did, items, opts || {});
    return reply.send(result);
  });
}
