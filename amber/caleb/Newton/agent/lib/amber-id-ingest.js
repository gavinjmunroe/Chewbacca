/**
 * Client for posting data to amber-id's ingest API.
 *
 * All data Amber captures — conversations, check-in responses, inferred
 * health signals — flows through here into Pinecone via amber-id. This is
 * the ONLY place amber-agent writes to amber-id's knowledge graph.
 *
 * Auth: service API key + x-amber-phone header (no Privy JWT needed).
 * The phone identifies whose Pinecone namespace to write to.
 */

import { createHash, randomUUID } from "crypto";
import { AMBER_ID_API_URL, AMBER_ID_API_KEY } from "./constants.js";
import { markSeen } from "./idempotency.js";

function ingestAvailable() {
  return !!(AMBER_ID_API_URL && AMBER_ID_API_KEY);
}

/**
 * Coerce whatever the tenant carries into the E.164 format medha-id's ingest
 * route requires (e.g. "+15551234567"). Strips spaces, dashes, parens,
 * dots, and leading "tel:" / "sms:" prefixes. Prepends "+1" for bare
 * 10-digit US numbers. Returns null if the input doesn't look like a
 * phone at all so the caller can skip-and-log rather than 400.
 *
 * Without this normalization, any tenant whose phoneNumber was stored as
 * "(310) 555-1234" or "310-555-1234" or "13105551234" (no plus) fails
 * the ingest with `invalid_phone_header` and every conversation message
 * silently misses Pinecone, defeating the whole agent-memory loop (T9).
 */
function toE164(value) {
  if (!value) return null;
  let s = String(value).trim();
  s = s.replace(/^(?:tel:|sms:)/i, "");
  const hadPlus = s.startsWith("+");
  s = s.replace(/[^\d]/g, "");
  if (!s) return null;
  if (hadPlus) return `+${s}`;
  if (s.length === 10) return `+1${s}`;
  if (s.length === 11 && s.startsWith("1")) return `+${s}`;
  return `+${s}`;
}

/**
 * Build a stable idempotency key for an ingest item. amber-id can use
 * this to upsert-with-dedupe in Pinecone (same content + same dimension
 * + same kind → same vector id) instead of re-embedding the same chunk
 * on every redelivery. The key is content-addressed, so two callers
 * sending the same item independently still collapse to one vector.
 */
function ingestItemKey(phone, item) {
  const h = createHash("sha256");
  h.update(String(phone || ""));
  h.update("|");
  h.update(String(item.healthDimension || ""));
  h.update("|");
  h.update(String(item.kind || ""));
  h.update("|");
  h.update(String(item.text || "").slice(0, 4000));
  if (item.source) {
    h.update("|");
    h.update(String(item.source));
  }
  return h.digest("hex").slice(0, 32);
}

function attachIngestKeys(phone, items) {
  return items.map((item) => {
    if (item.ingestKey) return item;
    return { ...item, ingestKey: ingestItemKey(phone, item) };
  });
}

/**
 * Post items to amber-id's ingest endpoint.
 *
 * @param {Object} opts
 * @param {string} opts.pipe - "agent" | "health" | "checkin" | "relationship"
 * @param {string} opts.phone - E.164 phone number of the user whose data this is
 * @param {Array}  opts.items - Array of ingest items. Each must have `text` and `healthDimension`.
 * @param {Object} [opts.tenant] - Tenant object (used to read phone if not supplied)
 * @returns {Promise<Object|null>}
 */
export async function ingestToAmberID({ pipe, phone, items, tenant }) {
  if (!ingestAvailable()) return null;
  if (!items || items.length === 0) return null;

  const rawPhone = phone || tenant?.phoneNumber;
  if (!rawPhone) {
    console.warn("[amber-id-ingest] no phone provided, skipping ingest");
    return null;
  }
  const resolvedPhone = toE164(rawPhone);
  if (!resolvedPhone || !/^\+\d{8,15}$/.test(resolvedPhone)) {
    console.warn(
      `[amber-id-ingest] phone could not be normalized to E.164: ${JSON.stringify(rawPhone)}, skipping ingest`,
    );
    return null;
  }

  // Local dedupe: drop items we've already shipped within the in-memory
  // TTL window. Prevents a webhook redelivery from re-ingesting the same
  // conversation twice into Pinecone before amber-id's upsert-by-key
  // even sees it. amber-id should still treat ingestKey as primary.
  const decoratedAll = attachIngestKeys(resolvedPhone, items);
  const decorated = decoratedAll.filter((it) =>
    markSeen(`ingest:${pipe}:${it.ingestKey}`, 10 * 60 * 1000),
  );
  if (decorated.length === 0) {
    return { ok: true, deduped: decoratedAll.length, ingested: 0 };
  }

  // Correlation ID for tracing a single ingest call across logs.
  const correlationId = randomUUID();

  try {
    const res = await fetch(`${AMBER_ID_API_URL}/ingest/${pipe}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": AMBER_ID_API_KEY,
        "x-amber-phone": resolvedPhone,
        "x-correlation-id": correlationId,
        // Hint to amber-id that these items carry stable ingestKeys and
        // should be upserted by key rather than blindly inserted.
        "x-ingest-mode": "upsert-by-key",
      },
      body: JSON.stringify({ items: decorated }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.warn(
        `[amber-id-ingest] ${pipe} cid=${correlationId} failed ${res.status}: ${body.slice(0, 200)}`,
      );
      return null;
    }

    const json = await res.json();
    return { ...json, correlationId };
  } catch (err) {
    console.warn(
      `[amber-id-ingest] ${pipe} cid=${correlationId} error:`,
      err.message,
    );
    return null;
  }
}

// Exported for unit tests.
export { ingestItemKey };

/**
 * Ingest a conversation exchange (incoming + outgoing message).
 * Runs in background — never awaited in the hot path.
 *
 * @param {string} incomingText - What the user said
 * @param {string} replyText - What Amber replied
 * @param {string} phone - The user's phone (E.164)
 * @param {string} healthDimension - Primary dimension for this exchange
 * @param {Object} [tenant]
 */
export function ingestConversation(
  incomingText,
  replyText,
  phone,
  healthDimension = "emotional",
  tenant,
) {
  if (!ingestAvailable()) return;
  const combined = `User: ${incomingText}\nAmber: ${replyText}`;
  ingestToAmberID({
    pipe: "agent",
    phone: phone || tenant?.phoneNumber,
    tenant,
    items: [
      {
        text: combined.slice(0, 4000),
        healthDimension,
        kind: "conversation",
        createdAt: new Date().toISOString(),
      },
    ],
  }).catch(() => {});
}

/**
 * Ingest a check-in response with dimension scores.
 * Uses the "checkin" pipe (trust=1.0 — user self-authored).
 *
 * @param {string} phone - User's phone
 * @param {Object} scores - { emotional: 7, physical: 6, ... }
 * @param {string} rawMessage - The raw text the user sent
 * @param {string} checkinType - "morning" | "evening" | "spiritual_weekly"
 * @param {Object} [tenant]
 */
export async function ingestCheckin(
  phone,
  scores,
  rawMessage,
  checkinType,
  tenant,
) {
  if (!ingestAvailable()) return;

  const HEALTH_DIMS = [
    "social",
    "financial",
    "intellectual",
    "spiritual",
    "physical",
    "emotional",
  ];
  const items = [];

  for (const [dim, score] of Object.entries(scores)) {
    if (!HEALTH_DIMS.includes(dim) || score == null) continue;
    const scoreLabel =
      score >= 8 ? "thriving" : score >= 5 ? "okay" : "struggling";
    items.push({
      text: `${checkinType} check-in: ${dim} score ${score}/10 (${scoreLabel}). Raw: "${rawMessage?.slice(0, 200) || ""}". Type: ${checkinType}`,
      healthDimension: dim,
      dimensionScores: { [dim]: score },
      kind: "checkin",
      extra: { checkinType, score, allScores: scores },
      createdAt: new Date().toISOString(),
    });
  }

  if (items.length === 0) return;

  await ingestToAmberID({
    pipe: "checkin",
    phone: phone || tenant?.phoneNumber,
    tenant,
    items,
  });
}

/**
 * Ingest a single inbound or outbound message as its own Pinecone vector.
 *
 * Complements `ingestConversation` (which writes one combined "User: X /
 * Amber: Y" chunk per turn). The per-direction shape carries role +
 * direction + channel metadata, so future tools can filter for
 * "messages I sent" vs "messages I received" or scope by channel.
 *
 * Fire-and-forget. Never throws, never blocks the caller. Same dedupe
 * window as every other ingest call.
 *
 * @param {Object} opts
 * @param {string} opts.text          - The message body.
 * @param {"user"|"agent"} opts.role  - "user" = the human; "agent" = Medha.
 * @param {"inbound"|"outbound"} opts.direction
 * @param {string} opts.phone         - Tenant phone (E.164). Falls back to tenant.
 * @param {Object} [opts.tenant]
 * @param {string} [opts.channel]     - "imessage" | "sms" | "slack" | other.
 * @param {string} [opts.peerHandle]  - The other party's identifier
 *   (sender phone for inbound, recipient handle for outbound). Used for
 *   future "messages with X" filtering. NEVER pass anything that contains
 *   a secret (Slack channel IDs and phones are fine; tokens are not).
 * @param {string} [opts.messageId]   - Transport message id, if available.
 * @param {string} [opts.healthDimension] - Defaults to "emotional".
 */
export function ingestMessageEvent({
  text,
  role,
  direction,
  phone,
  tenant,
  channel = "imessage",
  peerHandle = null,
  messageId = null,
  healthDimension = "emotional",
} = {}) {
  if (!ingestAvailable()) return;
  if (!text || typeof text !== "string") return;
  if (role !== "user" && role !== "agent") return;
  if (direction !== "inbound" && direction !== "outbound") return;

  const resolvedPhone = phone || tenant?.phoneNumber;
  if (!resolvedPhone) return;

  const speaker = role === "user" ? "User" : "Medha";
  const arrow = direction === "inbound" ? "→ Medha" : "→ user";
  const labeled = `[${channel} ${arrow}] ${speaker}: ${text}`.slice(0, 4000);

  ingestToAmberID({
    pipe: "agent",
    phone: resolvedPhone,
    tenant,
    items: [
      {
        text: labeled,
        healthDimension,
        kind: "message",
        extra: {
          role,
          direction,
          channel,
          peer_handle: peerHandle || null,
          message_id: messageId || null,
        },
        createdAt: new Date().toISOString(),
      },
    ],
  }).catch(() => {});
}

/**
 * Ingest an inferred health signal detected from conversation.
 * Uses "agent" pipe (trust=0.65 — AI inference).
 */
export async function ingestInferredSignal(phone, signal, scores, tenant) {
  if (!ingestAvailable() || !signal) return;

  const items = Object.entries(scores || {}).map(([dim, score]) => ({
    text: `Inferred health signal: ${signal}. ${dim}: ${score}/10.`,
    healthDimension: dim,
    dimensionScores: { [dim]: score },
    kind: "inferred_signal",
    createdAt: new Date().toISOString(),
  }));

  if (items.length === 0) return;

  await ingestToAmberID({
    pipe: "agent",
    phone: phone || tenant?.phoneNumber,
    tenant,
    items,
  });
}
