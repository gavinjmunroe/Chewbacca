// conversation-index.js
//
// Wave 1 / Tab 16: embed raw conversation turns into the tenant's Pinecone
// namespace so the actual back-and-forth is semantically recallable later
// ("what did Sagar say about Carlo's pitch?"), not just the distilled facts
// that auto-memory.js already captures.
//
// This supersedes the older single-turn ingestConversation() helper: it folds
// up to the last five turns into one composite chunk for retrieval context,
// skips trivial exchanges, respects a per-tenant opt-out, and tags each chunk
// with one of the six health dimensions. It writes through the existing
// ingestToAmberID() path (kind="conversation"), so per-tenant isolation,
// E.164 normalization, and upsert-by-key dedupe all come for free.
//
// Fire-and-forget: the caller never blocks on this and we never throw into the
// reply path.

import { ingestToAmberID } from "./amber-id-ingest.js";

// How many recent turns (including the current user+agent pair) are folded into
// a single embedded chunk. The dispatch calls for ~5 turns of context so a
// retrieval lands on the surrounding conversation, not an isolated sentence.
const MAX_BUFFERED_TURNS = 5;

// Skip embedding when the current exchange carries no real signal: combined
// user+agent text shorter than this is treated as noise.
const MIN_COMBINED_LENGTH = 30;

// Bound the in-memory rolling-context buffer so a long-lived process can't grow
// it without limit. Oldest conversation key is evicted first.
const BUFFER_MAX_KEYS = 500;

// Low-signal acknowledgements that should never be embedded on their own.
const TRIVIAL_TURNS = new Set([
  "ok",
  "okay",
  "k",
  "kk",
  "thanks",
  "thank you",
  "ty",
  "yes",
  "no",
  "yep",
  "nope",
  "sure",
  "cool",
  "nice",
  "lol",
  "haha",
  "got it",
]);

// Keyword cues for the six-dimension ontology (see CLAUDE.md). Order matters
// only for readability; scoring picks the dimension with the most hits and
// falls back to "emotional" (the prior default of ingestConversation) on a tie
// or a miss.
const DIMENSION_KEYWORDS = {
  financial: [
    "money",
    "revenue",
    "invoice",
    "budget",
    "raise",
    "investor",
    "valuation",
    "salary",
    "pricing",
    "cost",
    "payment",
    "funding",
    "equity",
  ],
  intellectual: [
    "learn",
    "read",
    "book",
    "idea",
    "study",
    "research",
    "code",
    "design",
    "build",
    "strategy",
    "plan",
    "analysis",
    "problem",
  ],
  social: [
    "friend",
    "meet",
    "dinner",
    "party",
    "call",
    "team",
    "intro",
    "network",
    "hang",
    "family",
    "relationship",
    "community",
  ],
  spiritual: [
    "pray",
    "prayer",
    "god",
    "jesus",
    "church",
    "faith",
    "scripture",
    "worship",
    "meditate",
    "gratitude",
    "soul",
  ],
  physical: [
    "workout",
    "gym",
    "run",
    "sleep",
    "tired",
    "sick",
    "eat",
    "food",
    "health",
    "doctor",
    "body",
    "energy",
    "rest",
  ],
  emotional: [
    "feel",
    "feeling",
    "anxious",
    "stressed",
    "happy",
    "sad",
    "angry",
    "scared",
    "excited",
    "lonely",
    "overwhelmed",
    "grateful",
    "love",
  ],
};

// Rolling per-conversation context: key -> array of { label, text }.
const buffers = new Map();

/**
 * Decide whether the current turn is too trivial to embed. True when the user
 * message is a bare acknowledgement, has no alphanumeric content (an emoji-only
 * reply), or the combined user+agent text is too short to be worth a vector.
 *
 * @param {string} [userText]
 * @param {string} [finalText]
 * @returns {boolean}
 */
export function isTrivialTurn(userText = "", finalText = "") {
  const user = String(userText || "").trim();
  const combined = `${user} ${String(finalText || "").trim()}`.trim();

  if (combined.length < MIN_COMBINED_LENGTH) return true;

  if (TRIVIAL_TURNS.has(user.toLowerCase())) return true;

  // Emoji-only / punctuation-only user turns carry no searchable text.
  if (user && !/[a-z0-9]/i.test(user)) return true;

  return false;
}

/**
 * Pick a health dimension from free text via keyword hits. Deterministic and
 * dependency-free so it is trivially unit-testable. Defaults to "emotional",
 * matching the prior ingestConversation behavior.
 *
 * @param {string} [text]
 * @returns {"financial"|"intellectual"|"social"|"spiritual"|"physical"|"emotional"}
 */
export function classifyDimension(text = "") {
  // Token set, not substring search, so "eat" doesn't match "great" and
  // "rest" doesn't match "interest".
  const tokens = new Set(
    String(text || "")
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(Boolean),
  );
  let best = "emotional";
  let bestScore = 0;
  for (const [dimension, words] of Object.entries(DIMENSION_KEYWORDS)) {
    let score = 0;
    for (const w of words) {
      if (tokens.has(w)) score += 1;
    }
    if (score > bestScore) {
      bestScore = score;
      best = dimension;
    }
  }
  return best;
}

/**
 * Map a stored role onto the speaker label used inside an embedded chunk.
 * Anything that is not clearly the user is treated as Medha.
 *
 * @param {string} [role]
 * @returns {"USER"|"MEDHA"}
 */
function speakerLabel(role) {
  return String(role || "").toLowerCase() === "user" ? "USER" : "MEDHA";
}

/**
 * Render an array of { label, text } turns into the composite chunk string,
 * keeping at most the last MAX_BUFFERED_TURNS turns.
 *
 * @param {Array<{label?: string, text?: string}>} turns
 * @returns {string}
 */
export function buildCompositeContent(turns) {
  return (Array.isArray(turns) ? turns : [])
    .slice(-MAX_BUFFERED_TURNS)
    .map((t) => `${speakerLabel(t.label)}: ${String(t.text || "").trim()}`)
    .join("\n\n");
}

/**
 * Stable key for one conversation thread: tenant + channel + the other party.
 *
 * @param {Object|null} tenant
 * @param {string} channel
 * @param {string|null} contact
 * @returns {string}
 */
function bufferKey(tenant, channel, contact) {
  const did = tenant?.privyDid || tenant?.id || "unknown";
  return `${did}|${channel || "imessage"}|${contact || "unknown"}`;
}

/**
 * Append the current user + agent turns to the thread's rolling buffer and
 * return the trimmed recent window (oldest first, current pair last).
 *
 * @param {string} key
 * @param {string} userText
 * @param {string} finalText
 * @returns {Array<{label: string, text: string}>}
 */
function pushTurns(key, userText, finalText) {
  let turns = buffers.get(key);
  if (!turns) {
    if (buffers.size >= BUFFER_MAX_KEYS) {
      const oldest = buffers.keys().next().value;
      buffers.delete(oldest);
    }
    turns = [];
  } else {
    // Refresh LRU position.
    buffers.delete(key);
  }
  turns.push({ label: "USER", text: String(userText || "").trim() });
  turns.push({ label: "MEDHA", text: String(finalText || "").trim() });
  // Keep a little more than we embed so context survives across turns.
  const trimmed = turns.slice(-(MAX_BUFFERED_TURNS * 2));
  buffers.set(key, trimmed);
  return trimmed.slice(-MAX_BUFFERED_TURNS);
}

/** Clear the rolling buffer. Exported for test isolation. */
export function _resetBuffers() {
  buffers.clear();
}

/**
 * Embed one conversation turn (with recent context) into the tenant's Pinecone
 * namespace, unless the tenant opted out or the turn is trivial.
 *
 * Never throws for expected skips; returns a small status object. The ingest
 * backend is injectable via `_ingest` so the logic is unit-testable without
 * touching the network.
 *
 * @param {Object} args
 * @param {string} args.userText            Inbound user message.
 * @param {string} args.finalText           Agent reply.
 * @param {string|null} [args.contact]      The other party's handle (phone / slack id).
 * @param {string} [args.channel]           "imessage" | "imessage-group" | "slack".
 * @param {string|null} [args.messageId]    Transport message id, used as the vector source.
 * @param {string|null} [args.phone]        Tenant phone (E.164); falls back to tenant.phoneNumber.
 * @param {Object|null} [args.tenant]
 * @param {Function} [args._ingest]         Injected ingest fn (defaults to ingestToAmberID).
 * @returns {Promise<{ok: boolean, skipped?: string}>}
 */
export async function maybeIndexConversation({
  userText,
  finalText,
  contact = null,
  channel = "imessage",
  messageId = null,
  phone = null,
  tenant = null,
  _ingest = ingestToAmberID,
} = {}) {
  // Privacy: per-tenant opt-out. Default ON (privacy is via deletion, not
  // opt-out, per the dispatch). A tenant with embedConversations === false is
  // excluded entirely.
  if (tenant?.preferences?.embedConversations === false) {
    return { ok: false, skipped: "disabled" };
  }

  if (isTrivialTurn(userText, finalText)) {
    return { ok: false, skipped: "trivial" };
  }

  const key = bufferKey(tenant, channel, contact);
  const turns = pushTurns(key, userText, finalText);
  const content = buildCompositeContent(turns);

  // Classify on the current exchange so the dimension reflects this turn, not
  // stale older context.
  const dimension = classifyDimension(`${userText || ""} ${finalText || ""}`);

  const res = await _ingest({
    pipe: "agent",
    phone: phone || tenant?.phoneNumber,
    tenant,
    items: [
      {
        text: content.slice(0, 4000),
        healthDimension: dimension,
        kind: "conversation",
        source: messageId || undefined,
        extra: {
          contact: contact || null,
          channel,
          ts: new Date().toISOString(),
          replyToId: messageId || null,
          bufferedTurns: turns.length,
        },
        createdAt: new Date().toISOString(),
      },
    ],
  });

  return res || { ok: true, indexed: true };
}
