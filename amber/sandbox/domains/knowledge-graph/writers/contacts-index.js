/**
 * Cross-platform contacts → Pinecone indexing.
 *
 * Every contact, no matter the source platform (Apple Contacts via iOS,
 * LinkedIn via amber-chrome, Gmail "to" headers, X followers, Instagram
 * follows, GitHub followers, etc.), lands here so it becomes searchable
 * by meaning in the user's per-tenant Pinecone namespace.
 *
 *   indexContact(privyDid, contact)
 *
 * The contact's free-text representation (name + source + handle + notes)
 * is embedded through Perplexity and upserted into the namespace with a
 * stable ID of `contact:{source}:{externalId|name}` so the same person
 * from the same source overwrites rather than duplicates.
 *
 * Failures NEVER throw. Firestore is the source of truth for the contact
 * row; Pinecone is the search accelerator and can always be rebuilt via
 * scripts/pinecone-backfill.js. The endpoint that calls this treats the
 * indexing as fire-and-forget.
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

/**
 * Supported source platforms. New sources can be added without a code
 * change here — anything is accepted — but the canonical list keeps the
 * downstream filters honest.
 */
export const CONTACT_SOURCES = [
  "apple",
  "linkedin",
  "twitter",
  "instagram",
  "tiktok",
  "snapchat",
  "google",
  "gmail",
  "github",
  "slack",
  "chrome",
  "manual",
];

function vectorizationAvailable() {
  return !!(process.env.PINECONE_API_KEY && process.env.PERPLEXITY_API_KEY);
}

/**
 * Render a contact row to the natural-language text Pinecone embeds. Pulls
 * every distinctive field so retrieval by meaning works whether the user
 * searches by name, source, handle, location, or notes.
 */
export function textForContact(contact) {
  if (!contact || typeof contact !== "object") return "";
  const parts = [];
  if (contact.name) parts.push(`Contact: ${contact.name}.`);
  const source = contact.source || contact.sourcePlatform || "manual";
  parts.push(`Source: ${source}.`);
  if (contact.sourceHandle) parts.push(`Handle: ${contact.sourceHandle}.`);
  if (Array.isArray(contact.phoneNumbers) && contact.phoneNumbers.length) {
    parts.push(`Phones: ${contact.phoneNumbers.join(", ")}.`);
  }
  if (Array.isArray(contact.emails) && contact.emails.length) {
    parts.push(`Emails: ${contact.emails.join(", ")}.`);
  }
  // Apple contacts misuse the "company" field as a freeform relationship note
  // ("USC Neighbor", "PR x LA"), not an employer. For apple-sourced contacts
  // embed it under Notes so it isn't read (or enriched) as a real company.
  const isApple = String(source).toLowerCase().includes("apple");
  if (contact.company) {
    parts.push(
      isApple ? `Notes: ${contact.company}.` : `Company: ${contact.company}.`,
    );
  }
  if (contact.title) parts.push(`Title: ${contact.title}.`);
  if (contact.location) parts.push(`Location: ${contact.location}.`);
  if (contact.notes) parts.push(`Notes: ${contact.notes}.`);
  // Longform context curated by Medha across conversations. Truncate so a
  // contact with a huge accumulated context doesn't blow out the embedding
  // input; Pinecone still surfaces the row by the most distinctive prefix.
  if (contact.context) {
    const ctx =
      contact.context.length > 4000
        ? `${contact.context.slice(0, 4000)}…`
        : contact.context;
    parts.push(`Context: ${ctx}`);
  }
  // Structured relationship graph (PRD §6). Render into the embedding so
  // semantic queries like "who drains me?", "who do I have tension with?",
  // "who do I trust most?", or "who should I reconnect with?" surface the right
  // people — not just exact-name lookups.
  const r = contact.relationship;
  if (r && typeof r === "object") {
    const rel = [];
    if (r.category) rel.push(`type ${r.category}`);
    if (r.emotionalTone) rel.push(`emotional tone ${r.emotionalTone}`);
    if (r.energyType) rel.push(`this person is ${r.energyType}`);
    if (typeof r.closeness === "number") rel.push(`closeness ${r.closeness}`);
    if (typeof r.trustLevel === "number") rel.push(`trust ${r.trustLevel}`);
    if (r.tension) rel.push(`unresolved tension: ${r.tension}`);
    if (r.boundaries) rel.push(`boundaries: ${r.boundaries}`);
    if (r.appreciates) rel.push(`appreciates: ${r.appreciates}`);
    if (r.avoids) rel.push(`avoids or fears: ${r.avoids}`);
    if (r.nextAction) rel.push(`next relational step: ${r.nextAction}`);
    if (rel.length) parts.push(`Relationship: ${rel.join("; ")}.`);
  }
  return parts.filter(Boolean).join(" ");
}

/**
 * Build the stable Pinecone vector ID for a contact. Same source + same
 * external handle = same vector ID, so refreshing the platform overwrites
 * the prior vector instead of accumulating duplicates.
 */
function vectorIdFor(contact) {
  const source = (contact.source || contact.sourcePlatform || "manual")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  const handle =
    contact.sourceHandle ||
    contact.externalId ||
    contact.id ||
    (contact.name || "anon").toLowerCase().replace(/[^a-z0-9]/g, "");
  return `contact:${source}:${handle}`;
}

/**
 * Best-effort vector upsert for a single contact row. Returns
 * `{ indexed: true }` on success, `{ indexed: false, reason }` otherwise.
 * Never throws.
 */
export async function indexContact(privyDid, contact) {
  if (!privyDid || !contact || !contact.name) {
    return { indexed: false, reason: "missing_args" };
  }
  if (!vectorizationAvailable()) {
    return { indexed: false, reason: "pinecone_unavailable" };
  }
  const text = textForContact(contact);
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

  const source = contact.source || contact.sourcePlatform || "manual";
  try {
    await pineconeUpsert(privyDid, [
      {
        id: vectorIdFor(contact),
        vector,
        text,
        kind: "contact",
        source: `contacts/${source}`,
        personName: contact.name,
        extra: {
          contact_source: source,
          contact_handle: contact.sourceHandle || null,
          contact_external_id: contact.externalId || null,
          contact_doc_id: contact.id || null,
          // Structured relationship metadata (PRD §6) for precise filters
          // ("energyType=draining", "trust<0.3") on top of semantic search.
          rel_category: contact.relationship?.category || null,
          rel_energy: contact.relationship?.energyType || null,
          rel_trust:
            typeof contact.relationship?.trustLevel === "number"
              ? contact.relationship.trustLevel
              : null,
          rel_closeness:
            typeof contact.relationship?.closeness === "number"
              ? contact.relationship.closeness
              : null,
          rel_privacy: contact.relationship?.privacyLevel || null,
          rel_shareable_with_togari:
            contact.relationship?.shareableWithTogari ?? null,
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
 * Batched variant — useful when amber-chrome or an OAuth-platform sync job
 * sends N new contacts at once. Returns a per-contact result array so the
 * caller can surface which rows failed without failing the whole batch.
 */
export async function indexContacts(privyDid, contacts) {
  if (!Array.isArray(contacts) || contacts.length === 0) return [];
  const out = [];
  for (const c of contacts) {
    out.push(await indexContact(privyDid, c));
  }
  return out;
}

/**
 * Remove a contact's vector when the Firestore row is deleted. Best-effort.
 */
export async function deleteContactVector(privyDid, contact) {
  if (!privyDid || !contact) return { deleted: false };
  if (!vectorizationAvailable()) {
    return { deleted: false, reason: "pinecone_unavailable" };
  }
  try {
    await pineconeForget(privyDid, { ids: [vectorIdFor(contact)] });
    return { deleted: true };
  } catch {
    return { deleted: false, reason: "pinecone_error" };
  }
}
