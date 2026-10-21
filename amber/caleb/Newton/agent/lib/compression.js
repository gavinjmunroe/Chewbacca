/**
 * Conversation compression: summarize older messages to save tokens while preserving context.
 * Inspired by Memori's structured extraction approach.
 *
 * Strategy:
 * - Keep the last N messages verbatim (recent context)
 * - Summarize older messages into a compact block
 * - Extract facts/entities into structured data
 * - 80%+ token reduction on long conversations
 */

import { callPerplexityLight } from "./tiwari/context.js";
import { wrapGroupMessageAsConversation } from "./safety.js";
import { CALEB_PHONE } from "./constants.js";
import { normalizeHandle } from "./permissions.js";

const RECENT_VERBATIM_COUNT = 8; // Keep last 8 messages as-is
const COMPRESSION_THRESHOLD = 15; // Only compress if > 15 messages
const SUMMARY_CACHE = new Map(); // chatKey -> { summary, messageCount, timestamp }
const SUMMARY_CACHE_TTL = 10 * 60 * 1000; // 10 minutes

/**
 * Compress a conversation history for injection into the system prompt.
 * Returns { summary, recentMessages } where summary covers older messages
 * and recentMessages are the last N verbatim.
 */
export async function compressConversation(chatKey, history) {
  if (!history || history.length <= COMPRESSION_THRESHOLD) {
    return { summary: null, recentMessages: history || [] };
  }

  const recentMessages = history.slice(-RECENT_VERBATIM_COUNT);
  const olderMessages = history.slice(0, -RECENT_VERBATIM_COUNT);

  // Check cache
  const cached = SUMMARY_CACHE.get(chatKey);
  if (
    cached &&
    cached.messageCount === olderMessages.length &&
    Date.now() - cached.timestamp < SUMMARY_CACHE_TTL
  ) {
    return { summary: cached.summary, recentMessages };
  }

  // Build the summary via Haiku (fast + cheap)
  const summary = await summarizeMessages(olderMessages);
  if (summary) {
    SUMMARY_CACHE.set(chatKey, {
      summary,
      messageCount: olderMessages.length,
      timestamp: Date.now(),
    });
  }

  return { summary, recentMessages };
}

/**
 * Summarize a batch of messages into a structured block.
 */
async function summarizeMessages(messages) {
  if (messages.length === 0) return null;

  const transcript = messages
    .map((m) => {
      const label =
        m.role === "assistant" ? "Amber" : m.senderLabel || m.from || "Unknown";
      return `${label}: ${m.content}`;
    })
    .join("\n");

  try {
    // Perplexity Sonar (via callPerplexityLight) for background compression
    const result = await callPerplexityLight(
      `Summarize this conversation excerpt in 3-5 bullet points. Focus on:
- Key topics discussed
- Any facts revealed about people (names, jobs, interests, feelings)
- Decisions made or actions taken
- The emotional tone/vibe, especially across health dimensions (social, financial, intellectual, spiritual, physical, emotional)
- Anything Amber promised or committed to

Keep it concise. Use present tense. Format as bullet points.

CONVERSATION:
${transcript}`,
      { maxTokens: 400 },
    );
    return result;
  } catch (err) {
    console.warn("[compression] Summary failed:", err.message);
    return null;
  }
}

/**
 * Build compressed history for injection into the AI messages array.
 * Returns an array of messages ready for the Anthropic API.
 */
export function buildCompressedMessages(
  summary,
  recentMessages,
  tenant = null,
) {
  const messages = [];

  if (summary) {
    messages.push({
      role: "user",
      content: `[EARLIER IN THIS CONVERSATION]\n${summary}\n[END SUMMARY]`,
    });
    messages.push({
      role: "assistant",
      content:
        "Got it, I remember the context from earlier. Continuing the conversation.",
    });
  }

  for (const msg of recentMessages) {
    if (msg.role === "assistant") {
      messages.push({
        role: "assistant",
        content: msg.content,
      });
    } else {
      const label = msg.senderLabel || msg.from || "Someone";
      const ownerPhone = tenant?.phoneNumber || CALEB_PHONE;
      const isCalebMsg = msg.from === normalizeHandle(ownerPhone);
      messages.push({
        role: "user",
        content: msg.isGroup
          ? wrapGroupMessageAsConversation(msg.content, label, isCalebMsg)
          : msg.content,
      });
    }
  }

  return messages;
}
