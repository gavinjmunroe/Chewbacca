/**
 * Personal-life vector indexing.
 *
 * Tab 8 writes structured rows to Firestore (../db/personal-life.js); this
 * module mirrors the human-readable text of each row into Pinecone so the
 * search route can retrieve "what brand decisions touched the name 'rave'"
 * or "journal entries from conversations with Shirley" by meaning rather
 * than exact-string match.
 *
 * Every function degrades gracefully: if PINECONE_API_KEY or
 * PERPLEXITY_API_KEY is missing, or either upstream returns an error, we
 * return `{ indexed: false, reason }` (and `[]` for search) instead of
 * throwing — the Firestore source of truth keeps serving traffic.
 */

import {
  upsert as pineconeUpsert,
  query as pineconeQuery,
  forget as pineconeForget,
} from "../service/lib/pinecone.js";
import { embed, EMBEDDING_DIMS } from "../service/lib/embed.js";

// These vectors predate the healthDimension write contract that
// pinecone-client.upsert() now enforces for every other writer (the contract
// the retired cNFT client owned). Opting out keeps them flowing instead of
// silently 400ing; classifying them into the six dimensions is follow-up work.
const DIMENSIONLESS = { requireDimension: false };

function vectorizationAvailable() {
  return !!(process.env.PINECONE_API_KEY && process.env.PERPLEXITY_API_KEY);
}

export async function pineconeAvailable() {
  return vectorizationAvailable();
}

/**
 * Render a row to the text Pinecone embeds. Each kind contributes its
 * distinctive fields so retrieval by meaning still works even when only
 * one of brand/teammate/topic is searched.
 */
export function textForRow(row) {
  if (!row || typeof row !== "object") return "";
  switch (row.kind) {
    case "brand_decision":
      return [
        `Brand decision for ${row.brand}.`,
        `Key: ${row.key}.`,
        `Value: ${row.value}.`,
        row.rationale ? `Rationale: ${row.rationale}.` : null,
        Array.isArray(row.decided_with) && row.decided_with.length
          ? `Decided with: ${row.decided_with.join(", ")}.`
          : null,
      ]
        .filter(Boolean)
        .join(" ");
    case "teammate_pursuit":
      return [
        `Teammate pursuit: ${row.teammate_name}.`,
        `Pursuit: ${row.pursuit_name}.`,
        `Kind: ${row.pursuit_kind}.`,
        `Status: ${row.status}.`,
        row.notes ? `Notes: ${row.notes}.` : null,
      ]
        .filter(Boolean)
        .join(" ");
    case "journal_entry":
      return [
        `Journal entry on ${row.written_at || "unknown date"}.`,
        `Topic: ${row.topic}.`,
        Array.isArray(row.with) && row.with.length
          ? `With: ${row.with.join(", ")}.`
          : null,
        row.dimension ? `Dimension: ${row.dimension}.` : null,
        `Body: ${row.body}`,
      ]
        .filter(Boolean)
        .join(" ");
    default:
      return "";
  }
}

/**
 * Upsert a single personal-life row into Pinecone. Returns
 * `{ indexed: true }` on success, `{ indexed: false, reason }` when the
 * Pinecone path is unavailable or produces no text.
 */
export async function indexPersonalLifeRow(privyDid, row) {
  if (!privyDid || !row || !row.id) {
    return { indexed: false, reason: "missing_args" };
  }
  if (!vectorizationAvailable()) {
    return { indexed: false, reason: "pinecone_unavailable" };
  }
  const text = textForRow(row);
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
        id: `${row.kind}:${row.id}`,
        vector,
        text,
        kind: row.kind,
        source: "personal-life",
        extra: {
          row_id: row.id,
          row_created_at:
            row.created_at || row.written_at || row.decided_at || null,
        },
      },
    ], DIMENSIONLESS);
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
 * Semantic search across a tenant's personal-life corpus. `kind` narrows the
 * results to one of the three object kinds when set, otherwise all kinds are
 * searched. Returns a list of `{ id, score, metadata }` matches.
 */
export async function searchPersonalLife(
  privyDid,
  { query, kind, topK = 12 } = {},
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

  const filter = kind ? { kind } : undefined;
  try {
    const matches = await pineconeQuery(privyDid, vector, { topK, filter });
    return Array.isArray(matches) ? matches : [];
  } catch {
    return [];
  }
}

/**
 * Remove a row from Pinecone. Used when the Firestore row is deleted so the
 * vector store doesn't keep returning ghost matches. Best-effort.
 */
export async function deletePersonalLifeVector(privyDid, kind, id) {
  if (!privyDid || !kind || !id) return { deleted: false };
  if (!vectorizationAvailable()) {
    return { deleted: false, reason: "pinecone_unavailable" };
  }
  try {
    await pineconeForget(privyDid, { ids: [`${kind}:${id}`] });
    return { deleted: true };
  } catch {
    return { deleted: false, reason: "pinecone_error" };
  }
}
