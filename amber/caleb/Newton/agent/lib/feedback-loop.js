/**
 * Feedback loop: track how Caleb/contacts react to Amber's replies and
 * surface patterns so Amber can adjust its style over time.
 *
 * Inspired by Archeb/CyberGroupmate's feedback-loop design. When Amber
 * sends a message, we remember the message id and wait for the next
 * inbound message from the same chat. If that next message contains
 * praise / criticism / a tapback toward Amber's message, we log it.
 *
 * Writes to amber-id as a "relationship" pipe item so Pinecone can
 * surface "Caleb tends to love short replies; he pushes back on
 * bullet-heavy ones" on future turns.
 *
 * Storage: in-memory Map keyed on chat key, {messageId, text, sentAt}.
 * Evicted after 30min if no reaction arrives.
 */

import { ingestToAmberID } from "./amber-id-ingest.js";
import { registerCapability } from "./capabilities.js";

registerCapability(
  "Feedback",
  "Tracks praise/criticism/tapback reactions to Amber's replies; logs them to amber-id relationship pipe so future turns can learn what lands",
);

const REACTION_WINDOW_MS = 30 * 60 * 1000; // 30 min
const pending = new Map(); // chatKey -> { messageId, text, sentAt }

const PRAISE_RE =
  /\b(good|great|nice|perfect|love|amazing|awesome|tuff|fire|banger|killer|exactly|spot\s*on|well\s*said|thanks|thank\s*you|ty|tysm|appreciated|helpful|solid|clean|slick)\b/i;
const CRITICISM_RE =
  /\b(no|nope|wrong|incorrect|bad|actually|you're\s*missing|you\s*missed|doesn't\s*help|useless|not\s*quite|stop|too\s*long|too\s*much|shorter|too\s*formal|weird|off|try\s*again|redo)\b/i;
// Single tapbacks on Amber's message register as positive if "love"/"like"/"laugh"
const POSITIVE_TAPBACKS = new Set(["love", "like", "laugh", "emphasize"]);
const NEGATIVE_TAPBACKS = new Set(["dislike", "question"]);

/**
 * Record that Amber just sent a message.
 */
export function recordOutboundMessage(chatKey, messageId, text) {
  if (!chatKey || !messageId) return;
  pending.set(chatKey, {
    messageId,
    text: String(text || "").slice(0, 500),
    sentAt: Date.now(),
  });
  // Opportunistic eviction
  for (const [key, rec] of pending.entries()) {
    if (Date.now() - rec.sentAt > REACTION_WINDOW_MS) {
      pending.delete(key);
    }
  }
}

/**
 * Given an incoming message, check whether it appears to be a reaction
 * to Amber's last message in this chat. Returns
 *   { sentiment: "positive" | "negative" | "neutral", signal: string }
 * or null if no pending Amber message is within the window.
 */
export function classifyReaction({
  chatKey,
  text,
  tapbackType,
  replyToId,
}) {
  if (!chatKey) return null;
  const pendingMsg = pending.get(chatKey);
  if (!pendingMsg) return null;
  if (Date.now() - pendingMsg.sentAt > REACTION_WINDOW_MS) {
    pending.delete(chatKey);
    return null;
  }
  // If the incoming is a tapback OR a reply explicitly threaded to
  // Amber's message, we have a very strong signal.
  const directlyTargeted =
    (replyToId && replyToId === pendingMsg.messageId) ||
    (tapbackType && POSITIVE_TAPBACKS.has(tapbackType)) ||
    (tapbackType && NEGATIVE_TAPBACKS.has(tapbackType));

  let sentiment = "neutral";
  let signal = "";

  if (tapbackType && POSITIVE_TAPBACKS.has(tapbackType)) {
    sentiment = "positive";
    signal = `tapback:${tapbackType}`;
  } else if (tapbackType && NEGATIVE_TAPBACKS.has(tapbackType)) {
    sentiment = "negative";
    signal = `tapback:${tapbackType}`;
  } else if (text) {
    const t = String(text);
    const hasPraise = PRAISE_RE.test(t);
    const hasCriticism = CRITICISM_RE.test(t);
    if (hasPraise && !hasCriticism) {
      sentiment = "positive";
      signal = "text:praise";
    } else if (hasCriticism && !hasPraise) {
      sentiment = "negative";
      signal = "text:criticism";
    } else if (hasPraise && hasCriticism) {
      sentiment = "neutral";
      signal = "text:mixed";
    }
  }

  // Only log non-neutral OR directly-targeted reactions
  if (sentiment === "neutral" && !directlyTargeted) return null;

  // Consume the pending record so a later unrelated message doesn't
  // double-count.
  if (directlyTargeted || sentiment !== "neutral") {
    pending.delete(chatKey);
  }

  return {
    sentiment,
    signal,
    amberText: pendingMsg.text,
    amberMessageId: pendingMsg.messageId,
    latencyMs: Date.now() - pendingMsg.sentAt,
  };
}

/**
 * Push a classified reaction to amber-id so it lands in the
 * relationship Pinecone namespace for future retrieval.
 */
export async function logReactionToAmberID(
  { chatKey, from, classification, tenant },
) {
  if (!classification) return;
  try {
    await ingestToAmberID({
      pipe: "relationship",
      phone: tenant?.phoneNumber,
      tenant,
      items: [
        {
          text: `Feedback on Amber reply (${classification.sentiment}, ${classification.signal}). Amber said: "${classification.amberText}"`,
          healthDimension: "social",
          kind: "reply_feedback",
          extra: {
            chatKey,
            from,
            sentiment: classification.sentiment,
            signal: classification.signal,
            amberMessageId: classification.amberMessageId,
            latencyMs: classification.latencyMs,
          },
          createdAt: new Date().toISOString(),
        },
      ],
    });
    console.log(
      `[feedback] logged ${classification.sentiment} reaction (${classification.signal}) from ${from} on ${chatKey}`,
    );
  } catch (err) {
    console.warn("[feedback] log error:", err.message);
  }
}

/**
 * Convenience: one-shot capture + log. Safe to call fire-and-forget.
 */
export async function captureReaction(opts) {
  const classification = classifyReaction(opts);
  if (!classification) return null;
  await logReactionToAmberID({ ...opts, classification });
  return classification;
}
