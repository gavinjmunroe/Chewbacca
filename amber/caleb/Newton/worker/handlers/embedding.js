// embedding job handler.
//
// Computes an embedding for the supplied text via the existing
// embeddings module. No production code enqueues here yet; this is
// plumbing for the follow-up that moves embedding work off the hot path.

import {
  embedText,
  isAvailable as isEmbeddingsAvailable,
} from "../../agent/lib/embeddings.js";

export async function handle(payload) {
  if (!isEmbeddingsAvailable()) {
    console.warn("[worker:embedding] embeddings not configured; dropping job");
    return { skipped: true, reason: "embeddings-not-ready" };
  }
  const { text } = payload || {};
  if (typeof text !== "string" || text.length === 0) {
    return { skipped: true, reason: "no-text" };
  }
  return embedText(text);
}
