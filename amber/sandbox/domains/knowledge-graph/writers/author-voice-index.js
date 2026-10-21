/**
 * Author-voice vector indexing.
 *
 * Author voices (../db/personal-life.js, AUTHOR_VOICES_TABLE) are the
 * per-tenant catalog of writers Medha can ghost-write for. This module mirrors
 * each voice profile into Pinecone so "whose voice sounds most like Sagar?" or
 * "find an author who writes in punchy short sentences" retrieves by meaning.
 *
 * Mirrors ../knowledge/personal-life-index.js. Author voices are a social
 * artifact (who a person is on the page) so every vector is tagged with the
 * `social` health dimension. Degrades gracefully when the vector path is
 * unavailable.
 */

import {
  upsert as pineconeUpsert,
  query as pineconeQuery,
  forget as pineconeForget,
} from "../service/lib/pinecone.js";
import { embed, EMBEDDING_DIMS } from "../service/lib/embed.js";

function vectorizationAvailable() {
  return !!(process.env.PINECONE_API_KEY && process.env.PERPLEXITY_API_KEY);
}

export async function pineconeAvailable() {
  return vectorizationAvailable();
}

function joinList(value) {
  if (Array.isArray(value)) return value.filter(Boolean).join(", ");
  if (typeof value === "string") return value;
  return "";
}

/**
 * Render an author-voice row to the text Pinecone embeds. Pulls the voice
 * tells, the "what they don't say" guardrails, and the sample-piece bodies so
 * a semantic match can fire on actual writing style, not just the name.
 */
export function textForAuthorVoice(row) {
  if (!row || typeof row !== "object") return "";
  const tells = row.voice_tells || {};
  const samples = Array.isArray(row.sample_pieces) ? row.sample_pieces : [];
  const parts = [
    `Author voice: ${row.display_name || row.author_slug || "unknown"}.`,
    row.org ? `Org: ${row.org}.` : null,
    row.role_at_org ? `Role: ${row.role_at_org}.` : null,
    tells.sentence_rhythm ? `Sentence rhythm: ${tells.sentence_rhythm}.` : null,
    tells.vocabulary_tells
      ? `Vocabulary: ${joinList(tells.vocabulary_tells)}.`
      : null,
    tells.opener_patterns
      ? `Openers: ${joinList(tells.opener_patterns)}.`
      : null,
    tells.closer_patterns
      ? `Closers: ${joinList(tells.closer_patterns)}.`
      : null,
    joinList(tells.signature_phrases)
      ? `Signature phrases: ${joinList(tells.signature_phrases)}.`
      : null,
    joinList(tells.jargon_blacklist)
      ? `Avoids: ${joinList(tells.jargon_blacklist)}.`
      : null,
    joinList(row.what_they_dont_say)
      ? `Never says: ${joinList(row.what_they_dont_say)}.`
      : null,
  ];
  for (const piece of samples) {
    if (!piece || typeof piece !== "object") continue;
    const title = piece.title ? `Sample "${piece.title}"` : "Sample";
    const body = piece.body ? `: ${piece.body}` : "";
    parts.push(`${title}${body}`);
  }
  const text = parts.filter(Boolean).join(" ");
  return text.trim();
}

/**
 * Upsert a single author voice into Pinecone. Slug-keyed so re-posting the
 * same author overwrites the vector in place. Returns `{ indexed: true }` on
 * success, `{ indexed: false, reason }` otherwise.
 */
export async function indexAuthorVoice(privyDid, row) {
  if (!privyDid || !row || !row.id) {
    return { indexed: false, reason: "missing_args" };
  }
  if (!vectorizationAvailable()) {
    return { indexed: false, reason: "pinecone_unavailable" };
  }
  const text = textForAuthorVoice(row);
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
        id: `author_voice:${row.id}`,
        vector,
        text,
        kind: "author_voice",
        source: "author-voice",
        healthDimension: "social",
        extra: {
          row_id: row.id,
          author_slug: row.author_slug || null,
          display_name: row.display_name || null,
          org: row.org || null,
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
 * Semantic search across a tenant's author voices. Returns a list of
 * `{ id, score, metadata }` matches ranked by vector distance.
 */
export async function searchAuthorVoices(privyDid, { query, topK = 12 } = {}) {
  if (!privyDid || !query || typeof query !== "string") return [];
  if (!vectorizationAvailable()) return [];

  let vector;
  try {
    vector = await embed(query);
  } catch {
    return [];
  }
  if (!Array.isArray(vector) || vector.length !== EMBEDDING_DIMS) return [];

  try {
    const matches = await pineconeQuery(privyDid, vector, {
      topK,
      filter: { kind: "author_voice" },
    });
    return Array.isArray(matches) ? matches : [];
  } catch {
    return [];
  }
}

/**
 * Remove an author voice from Pinecone. Best-effort.
 */
export async function deleteAuthorVoiceVector(privyDid, slug) {
  if (!privyDid || !slug) return { deleted: false };
  if (!vectorizationAvailable()) {
    return { deleted: false, reason: "pinecone_unavailable" };
  }
  try {
    await pineconeForget(privyDid, { ids: [`author_voice:${slug}`] });
    return { deleted: true };
  } catch {
    return { deleted: false, reason: "pinecone_error" };
  }
}
