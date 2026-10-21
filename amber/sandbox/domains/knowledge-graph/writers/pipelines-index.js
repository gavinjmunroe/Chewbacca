/**
 * Pinecone indexing for pipeline objects (investor, event, relationship).
 *
 * Each pipeline write also lands a per-DID vector so semantic search across
 * Sagar's investor / Rytual event / multi-thread relationship objects works
 * the same as any other knowledge namespace.
 *
 *   indexPipelineObject(tenantDid, { kind, id, text, metadata })
 *
 * `kind` is one of: investor, event, relationship.
 * `text` is the natural-language string we embed.
 * `metadata` is merged into the vector's metadata blob.
 *
 * Failures NEVER throw — Firestore is the source of truth for these rows
 * and a Pinecone outage must not break a pipeline POST. The vectors can
 * always be rebuilt from Firestore via scripts/pinecone-backfill.js.
 */

import { upsert as pineconeUpsert } from "../service/lib/pinecone.js";
import { embed, EMBEDDING_DIMS } from "../service/lib/embed.js";

// These vectors predate the healthDimension write contract that
// pinecone-client.upsert() now enforces for every other writer (the contract
// the retired cNFT client owned). Opting out keeps them flowing instead of
// silently 400ing; classifying them into the six dimensions is follow-up work.
const DIMENSIONLESS = { requireDimension: false };

const SUPPORTED_KINDS = new Set(["investor", "event", "relationship"]);

/**
 * Best-effort vector upsert. Always resolves; never throws so the
 * write-path stays available even if Pinecone or the embedder is down.
 * The caller treats this as fire-and-forget.
 */
export async function indexPipelineObject(
  tenantDid,
  { kind, id, text, metadata = {} } = {},
) {
  if (!tenantDid || !id || !text)
    return { indexed: false, reason: "missing_args" };
  if (!SUPPORTED_KINDS.has(kind)) {
    return { indexed: false, reason: `unknown_kind:${kind}` };
  }
  if (!process.env.PINECONE_API_KEY || !process.env.PERPLEXITY_API_KEY) {
    return { indexed: false, reason: "embedding_or_pinecone_disabled" };
  }

  let vector;
  try {
    vector = await embed(text);
  } catch (err) {
    console.warn(
      `[pipelines-index] embed failed for ${kind}:${id} (${err?.message || err})`,
    );
    return { indexed: false, reason: "embed_failed" };
  }
  if (!Array.isArray(vector) || vector.length !== EMBEDDING_DIMS) {
    return { indexed: false, reason: "embed_wrong_dim" };
  }

  try {
    const res = await pineconeUpsert(tenantDid, [
      {
        id: `pipeline:${kind}:${id}`,
        vector,
        text,
        kind: `pipeline_${kind}`,
        source: "amber-id/pipelines",
        extra: metadata,
      },
    ], DIMENSIONLESS);
    return { indexed: true, namespace: res?.namespace };
  } catch (err) {
    console.warn(
      `[pipelines-index] pinecone upsert failed for ${kind}:${id} (${err?.message || err})`,
    );
    return { indexed: false, reason: "pinecone_error" };
  }
}
