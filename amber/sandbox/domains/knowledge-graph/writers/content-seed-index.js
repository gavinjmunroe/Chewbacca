/**
 * Content-seed vector indexing.
 *
 * The content-seed pipeline (../db/content-seeds.js) writes raw + polished
 * newsletter / LinkedIn / Twitter material to Firestore. This module mirrors
 * the human-readable text of each seed into Pinecone so "find a piece I wrote
 * that sounds like Sagar's funnel hypothesis" retrieves by meaning rather
 * than exact-string filter.
 *
 * Mirrors ../knowledge/personal-life-index.js. Every function degrades
 * gracefully: if PINECONE_API_KEY or PERPLEXITY_API_KEY is missing, or either
 * upstream errors, we return `{ indexed: false, reason }` (and `[]` for
 * search) instead of throwing. The Firestore source of truth keeps serving.
 */

import {
  upsert as pineconeUpsert,
  query as pineconeQuery,
  forget as pineconeForget,
} from "../service/lib/pinecone.js";
import { embed, EMBEDDING_DIMS } from "../service/lib/embed.js";

/**
 * A content seed's intent is the strongest signal for which health dimension
 * it belongs to: audience-facing posts read as social, idea-driven pieces
 * read as intellectual. Falls back to intellectual (writing is thought work).
 */
const INTENT_DIMENSION = {
  newsletter: "social",
  linkedin: "social",
  twitter: "social",
  opinion: "intellectual",
  hypothesis: "intellectual",
  stories_watching: "intellectual",
};

export function dimensionForSeed(row) {
  return INTENT_DIMENSION[row?.intent] || "intellectual";
}

function vectorizationAvailable() {
  return !!(process.env.PINECONE_API_KEY && process.env.PERPLEXITY_API_KEY);
}

export async function pineconeAvailable() {
  return vectorizationAvailable();
}

/**
 * Render a seed to the text Pinecone embeds. Prefers the polished draft once
 * it exists (that is what the author actually ships) but always carries the
 * raw material + provenance so recall works before and after polish.
 */
export function textForContentSeed(row) {
  if (!row || typeof row !== "object") return "";
  const body = row.polished_draft || row.raw_text || row.source_url || "";
  if (!body) return "";
  return [
    `Content seed for ${row.author_slug || "unknown author"} (${
      row.org || "personal"
    }).`,
    `Intent: ${row.intent || "unspecified"}.`,
    row.section_hint ? `Section: ${row.section_hint}.` : null,
    row.status ? `Status: ${row.status}.` : null,
    row.polished_draft ? `Polished: ${body}` : `Draft: ${body}`,
  ]
    .filter(Boolean)
    .join(" ");
}

/**
 * Upsert a single content seed into Pinecone. Returns `{ indexed: true }` on
 * success, `{ indexed: false, reason }` when the path is unavailable or the
 * seed produces no text.
 */
export async function indexContentSeed(privyDid, row) {
  if (!privyDid || !row || !row.id) {
    return { indexed: false, reason: "missing_args" };
  }
  if (!vectorizationAvailable()) {
    return { indexed: false, reason: "pinecone_unavailable" };
  }
  const text = textForContentSeed(row);
  if (!text) return { indexed: false, reason: "empty_text" };

  let vector;
  try {
    vector = await embed(text);
  } catch (err) {
    return {
      indexed: false,
      reason: "embed_failed",
      message: err?.message || String(err),
    };
  }
  if (!Array.isArray(vector) || vector.length !== EMBEDDING_DIMS) {
    return { indexed: false, reason: "embed_wrong_dim" };
  }

  try {
    await pineconeUpsert(privyDid, [
      {
        id: `content_seed:${row.id}`,
        vector,
        text,
        kind: "content_seed",
        source: "content-seeds",
        healthDimension: dimensionForSeed(row),
        extra: {
          row_id: row.id,
          author_slug: row.author_slug || null,
          org: row.org || null,
          intent: row.intent || null,
          status: row.status || null,
          drive_doc_url: row.drive_doc_url || null,
          row_created_at: row.created_at || null,
        },
      },
    ]);
    return { indexed: true };
  } catch (err) {
    return {
      indexed: false,
      reason: "pinecone_error",
      message: err?.message || String(err),
    };
  }
}

/**
 * Semantic search across a tenant's content seeds. `filter` narrows by any
 * metadata field Pinecone holds (e.g. `{ author_slug: "sagar-tiwari" }`).
 * Returns a list of `{ id, score, metadata }` matches.
 */
export async function searchContentSeeds(
  privyDid,
  { query, filter, topK = 12 } = {},
) {
  if (!privyDid || !query || typeof query !== "string") return [];
  if (!vectorizationAvailable()) return [];

  let vector;
  try {
    vector = await embed(query);
  } catch {
    return [];
  }
  if (!Array.isArray(vector) || vector.length !== EMBEDDING_DIMS) return [];

  const baseFilter = { kind: "content_seed" };
  const merged = filter ? { ...baseFilter, ...filter } : baseFilter;
  try {
    const matches = await pineconeQuery(privyDid, vector, {
      topK,
      filter: merged,
    });
    return Array.isArray(matches) ? matches : [];
  } catch {
    return [];
  }
}

/**
 * Remove a seed from Pinecone. Best-effort, used when the Firestore row is
 * deleted so the vector store stops returning ghosts.
 */
export async function deleteContentSeedVector(privyDid, id) {
  if (!privyDid || !id) return { deleted: false };
  if (!vectorizationAvailable()) {
    return { deleted: false, reason: "pinecone_unavailable" };
  }
  try {
    await pineconeForget(privyDid, { ids: [`content_seed:${id}`] });
    return { deleted: true };
  } catch {
    return { deleted: false, reason: "pinecone_error" };
  }
}
