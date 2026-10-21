/**
 * Partnership → Pinecone indexing. Mirrors contacts-index.js: every
 * partnership becomes a semantically-queryable vector in the tenant's
 * Pinecone namespace, plus each appended history note gets its own
 * vector so "what did Carlo propose at the IRA meeting?" resolves to
 * the specific note rather than just the partnership header.
 *
 * Failures NEVER throw. Firestore is the source of truth; Pinecone is
 * the search accelerator and can be rebuilt by re-running the upsert.
 */

import {
  upsert as pineconeUpsert,
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

/**
 * Render a partnership row to the natural-language text Pinecone embeds.
 * Includes pitch (truncated) + primary contacts + open next-actions so
 * search by any of those finds the right partnership.
 */
export function textForPartnership(partnership) {
  if (!partnership || typeof partnership !== "object") return "";
  const parts = [];
  if (partnership.name) parts.push(`Partnership: ${partnership.name}.`);
  if (partnership.kind) parts.push(`Kind: ${partnership.kind}.`);
  if (partnership.status) parts.push(`Status: ${partnership.status}.`);
  if (partnership.org_name) parts.push(`Org: ${partnership.org_name}.`);
  const contacts = Array.isArray(partnership.primary_contacts)
    ? partnership.primary_contacts
        .map((c) => (c?.role ? `${c.name} (${c.role})` : c?.name))
        .filter(Boolean)
        .join(", ")
    : "";
  if (contacts) parts.push(`Contacts: ${contacts}.`);
  if (partnership.pitch) {
    const trimmed =
      partnership.pitch.length > 2000
        ? `${partnership.pitch.slice(0, 2000)}…`
        : partnership.pitch;
    parts.push(`Pitch: ${trimmed}`);
  }
  const openActions = Array.isArray(partnership.next_actions)
    ? partnership.next_actions
        .filter((a) => a?.status === "open")
        .map((a) => a.description)
        .filter(Boolean)
    : [];
  if (openActions.length) {
    parts.push(`Open next-actions: ${openActions.join("; ")}.`);
  }
  return parts.filter(Boolean).join(" ");
}

export function partnershipVectorId(partnership) {
  const id = partnership?.id || "anon";
  return `partnership:${id}`;
}

export function partnershipNoteVectorId(partnershipId, ts) {
  const safeTs = String(ts || "").replace(/[^a-zA-Z0-9._-]/g, "_");
  return `partnership_note:${partnershipId}:${safeTs}`;
}

/**
 * Best-effort vector upsert for a single partnership row. Never throws.
 */
export async function indexPartnership(privyDid, partnership) {
  if (!privyDid || !partnership || !partnership.name) {
    return { indexed: false, reason: "missing_args" };
  }
  if (!vectorizationAvailable()) {
    return { indexed: false, reason: "pinecone_unavailable" };
  }
  const text = textForPartnership(partnership);
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
        id: partnershipVectorId(partnership),
        vector,
        text,
        kind: "partnership",
        source: `partnerships/${partnership.kind || "other"}`,
        personName: partnership.name,
        extra: {
          partnership_id: partnership.id || null,
          partnership_kind: partnership.kind || null,
          partnership_status: partnership.status || null,
          partnership_org: partnership.org_name || null,
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
 * Embed a single appended history note. The partnership header vector
 * still gets refreshed by the caller after the append so the rolled-up
 * representation stays current.
 */
export async function indexPartnershipNote(privyDid, partnership, entry) {
  if (!privyDid || !partnership?.id || !entry?.note) {
    return { indexed: false, reason: "missing_args" };
  }
  if (!vectorizationAvailable()) {
    return { indexed: false, reason: "pinecone_unavailable" };
  }
  const header = partnership.name
    ? `Note on partnership "${partnership.name}" (${partnership.kind || "partner"})`
    : "Partnership note";
  const text = `${header} at ${entry.ts}: ${entry.note}`;

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
        id: partnershipNoteVectorId(partnership.id, entry.ts),
        vector,
        text,
        kind: "partnership_note",
        source: `partnerships/${partnership.kind || "other"}`,
        personName: partnership.name || null,
        extra: {
          partnership_id: partnership.id,
          partnership_kind: partnership.kind || null,
          note_ts: entry.ts,
          note_source: entry.source || null,
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

export async function deletePartnershipVectors(privyDid, partnershipId) {
  if (!privyDid || !partnershipId) return { deleted: false };
  if (!vectorizationAvailable()) {
    return { deleted: false, reason: "pinecone_unavailable" };
  }
  try {
    await pineconeForget(privyDid, {
      ids: [`partnership:${partnershipId}`],
    });
    return { deleted: true };
  } catch {
    return { deleted: false, reason: "pinecone_error" };
  }
}
