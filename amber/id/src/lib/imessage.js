/**
 * iMessage / SMS interaction normalization + dedupe helpers.
 *
 * Pure functions, no I/O. Used by /ingest/imessage and friends. Tested
 * directly in src/lib/imessage.test.js.
 *
 * The contract for an inbound interaction memory from amber-agent is:
 *
 *   {
 *     source_channel:    "imessage" | "sms",
 *     direction:         "inbound" | "outbound",
 *     speaker_role:      "user" | "contact" | "agent",
 *     message_id:        Photon/Spectrum canonical id (string),
 *     thread_id?:        provider thread / conversation id (string),
 *     participant: {
 *       phone_hash?:     pre-hashed E.164 (sha256 hex)
 *       contact_id?:     canonical contact id (preferred over phone_hash)
 *       display_name?:   pretty name for citations
 *     },
 *     occurred_at:       ISO-8601 (when message was sent/received)
 *     raw_text?:         original body
 *     normalized_text:   text we will embed (raw cleaned, redactions, etc.)
 *     relationship_context?: free-form short string ("co-founder, @amber")
 *     health_dimension:  one of the six dims or "*" (REQUIRED downstream)
 *     secondary_dimensions?: string[] (max 2)
 *     style_signals?:    { register?, tone?, formality?, warmth?, ... }
 *     dedupe_key?:       client-supplied stable id; we recompute if absent
 *     consent: {
 *       redacted?:       bool (caller already redacted PII)
 *       store_raw?:      bool (default false — we drop raw_text unless true)
 *       privacy_tier?:   "private" | "shared_with_contact" | "public"
 *     },
 *     metadata?:         arbitrary small object (flat, scalar values)
 *   }
 */

import crypto from "crypto";

export const SUPPORTED_CHANNELS = Object.freeze(["imessage", "sms"]);
export const SUPPORTED_DIRECTIONS = Object.freeze(["inbound", "outbound"]);
export const SUPPORTED_ROLES = Object.freeze(["user", "contact", "agent"]);

/**
 * Compute a deterministic dedupe key for an iMessage interaction.
 *
 * Order of preference:
 *   1. caller-supplied `dedupe_key` (trusted — already idempotent)
 *   2. sha256(channel | message_id | speaker_role) — Photon/Spectrum guarantees
 *      message_id uniqueness per-channel, so this is collision-free.
 *   3. sha256(channel | thread_id | occurred_at | normalized_text-prefix)
 *      — last-resort fallback when message_id is missing.
 *
 * Returns a 32-char hex string.
 */
export function deriveDedupeKey(item) {
  if (item && typeof item.dedupe_key === "string" && item.dedupe_key.trim()) {
    return item.dedupe_key.trim().slice(0, 64);
  }
  const channel = item?.source_channel || "unknown";
  const role = item?.speaker_role || "unknown";
  if (item?.message_id) {
    const base = `${channel}|${item.message_id}|${role}`;
    return crypto.createHash("sha256").update(base).digest("hex").slice(0, 32);
  }
  const fallback = [
    channel,
    item?.thread_id || "",
    item?.occurred_at || "",
    (item?.normalized_text || item?.raw_text || "").slice(0, 256),
    role,
  ].join("|");
  return crypto.createHash("sha256").update(fallback).digest("hex").slice(0, 32);
}

/**
 * Validate the structural shape of an interaction. Returns an array of
 * error messages — empty array means valid. Cheap, schema-style checks
 * only; the Fastify schema covers basic types but this layer enforces
 * cross-field invariants.
 */
export function validateInteraction(item) {
  const errs = [];
  if (!item || typeof item !== "object") {
    errs.push("interaction must be an object");
    return errs;
  }
  if (!SUPPORTED_CHANNELS.includes(item.source_channel)) {
    errs.push(
      `source_channel must be one of [${SUPPORTED_CHANNELS.join(", ")}]`,
    );
  }
  if (!SUPPORTED_DIRECTIONS.includes(item.direction)) {
    errs.push(
      `direction must be one of [${SUPPORTED_DIRECTIONS.join(", ")}]`,
    );
  }
  if (!SUPPORTED_ROLES.includes(item.speaker_role)) {
    errs.push(`speaker_role must be one of [${SUPPORTED_ROLES.join(", ")}]`);
  }
  const text =
    typeof item.normalized_text === "string" && item.normalized_text.trim()
      ? item.normalized_text
      : typeof item.raw_text === "string" && item.raw_text.trim()
        ? item.raw_text
        : "";
  if (!text) {
    errs.push("normalized_text or raw_text is required and must be non-empty");
  }
  if (text.length > 8000) {
    errs.push("normalized_text/raw_text exceeds 8000 chars");
  }
  if (!item.health_dimension) {
    errs.push("health_dimension is required");
  }
  if (item.occurred_at && Number.isNaN(Date.parse(item.occurred_at))) {
    errs.push("occurred_at must be a parseable ISO-8601 string");
  }
  if (
    item.participant &&
    typeof item.participant === "object" &&
    !item.participant.contact_id &&
    !item.participant.phone_hash
  ) {
    errs.push("participant requires contact_id or phone_hash");
  }
  return errs;
}

/**
 * Reduce a raw interaction into the (a) Pinecone item and (b) Firestore
 * audit row. Both share the same dedupe_key so the two stores stay in
 * sync. The Pinecone item conforms to the existing pinecone.upsert()
 * contract — `text`, `healthDimension`, `kind`, `extra`, etc.
 *
 * Caller is responsible for filling in `vector` after embedding.
 */
export function buildIngestArtifacts(item) {
  const dedupeKey = deriveDedupeKey(item);
  const consent = item.consent || {};
  const storeRaw = consent.store_raw === true;
  const visibility =
    consent.privacy_tier === "shared_with_contact" ||
    consent.privacy_tier === "public"
      ? consent.privacy_tier
      : "private";
  const text =
    (typeof item.normalized_text === "string" && item.normalized_text.trim()) ||
    (typeof item.raw_text === "string" && item.raw_text.trim()) ||
    "";

  const styleSignals =
    item.style_signals && typeof item.style_signals === "object"
      ? item.style_signals
      : null;
  const metadata =
    item.metadata && typeof item.metadata === "object" ? item.metadata : null;

  // Pinecone metadata must be flat (string/number/bool/string[]). We use
  // pinecone.upsert()'s `extra` field for the iMessage-specific bits;
  // upsert() JSON-stringifies any object value automatically.
  const pineconeItem = {
    id: dedupeKey,
    text,
    kind: "imessage_interaction",
    source: "imessage", // pipe is "agent" but source narrows it
    healthDimension: item.health_dimension,
    secondaryDimensions: Array.isArray(item.secondary_dimensions)
      ? item.secondary_dimensions
      : undefined,
    personId: item.participant?.contact_id,
    personName: item.participant?.display_name,
    visibility,
    createdAt: item.occurred_at,
    extra: {
      source_channel: item.source_channel,
      direction: item.direction,
      speaker_role: item.speaker_role,
      message_id: item.message_id || null,
      thread_id: item.thread_id || null,
      participant_phone_hash: item.participant?.phone_hash || null,
      relationship_context: item.relationship_context || null,
      style_signals: styleSignals,
      dedupe_key: dedupeKey,
      consent_redacted: consent.redacted === true,
      consent_store_raw: storeRaw,
      consent_privacy_tier: visibility,
    },
  };

  // Firestore audit/dedupe row — keyed on dedupeKey so retries no-op.
  // raw_text dropped unless caller explicitly opted in via consent.store_raw.
  const auditRow = {
    dedupe_key: dedupeKey,
    source_channel: item.source_channel,
    direction: item.direction,
    speaker_role: item.speaker_role,
    message_id: item.message_id || null,
    thread_id: item.thread_id || null,
    occurred_at: item.occurred_at || null,
    participant: item.participant || null,
    normalized_text: text,
    raw_text: storeRaw ? item.raw_text || null : null,
    relationship_context: item.relationship_context || null,
    health_dimension: item.health_dimension,
    secondary_dimensions: Array.isArray(item.secondary_dimensions)
      ? item.secondary_dimensions
      : null,
    style_signals: styleSignals,
    consent: {
      redacted: consent.redacted === true,
      store_raw: storeRaw,
      privacy_tier: visibility,
    },
    metadata: metadata,
  };

  return { dedupeKey, pineconeItem, auditRow };
}
