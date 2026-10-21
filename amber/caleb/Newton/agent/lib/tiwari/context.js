/**
 * Tiwari Context Bucket: Perplexity API as primary AI engine.
 * Handles: main conversation AI, lightweight background tasks, deep research, embeddings.
 *
 * Models:
 * - sonar-pro: primary conversational AI (callPerplexity)
 * - sonar: lightweight background tasks (callPerplexityLight)
 * - sonar-deep-research: complex multi-step research (perplexityDeepResearch)
 * - pplx-embed-v1-4b: vector embeddings (perplexityEmbed)
 */

import { PERPLEXITY_API_KEY } from "../constants.js";

const PRIMARY_MODEL = process.env.PERPLEXITY_CHAT_MODEL || "sonar-pro";
const LIGHT_MODEL = "sonar";
const DEEP_MODEL = "sonar-deep-research";

/**
 * Enforce strict user/assistant alternation required by Perplexity Sonar.
 * Merges consecutive same-role messages, ensures conversation starts and ends with user.
 */
function enforcePerplexityAlternation(messages) {
  const system = messages.filter((m) => m.role === "system");
  const convo = messages.filter((m) => m.role !== "system");
  if (convo.length === 0)
    return [...system, { role: "user", content: "(empty)" }];

  // Merge consecutive same-role messages
  const merged = [];
  for (const m of convo) {
    if (merged.length > 0 && merged[merged.length - 1].role === m.role) {
      merged[merged.length - 1].content += "\n\n" + m.content;
    } else {
      merged.push({ ...m });
    }
  }

  // Must start with user
  if (merged[0].role !== "user") {
    merged.unshift({ role: "user", content: "(continue)" });
  }
  // Must end with user (drop trailing assistant)
  while (merged.length > 0 && merged[merged.length - 1].role === "assistant") {
    merged.pop();
  }
  if (merged.length === 0) {
    merged.push({ role: "user", content: "(continue)" });
  }

  return [...system, ...merged];
}

/**
 * Main AI call: Perplexity sonar-pro for primary conversation.
 *
 * @param {string} systemPrompt - System prompt text
 * @param {Array} messages - Array of {role, content} messages
 * @param {object} options - { maxTokens, temperature, timeoutMs }
 * @returns {{ content: Array, stopReason: string, usage: object }}
 */
export async function callPerplexity(systemPrompt, messages, options = {}) {
  if (!PERPLEXITY_API_KEY) {
    throw new Error("PERPLEXITY_API_KEY not configured");
  }

  const { maxTokens = 1024, temperature = 0.7, timeoutMs = 60_000 } = options;

  const allMessages = [];
  if (systemPrompt) {
    allMessages.push({ role: "system", content: systemPrompt });
  }
  for (const msg of messages) {
    const content = Array.isArray(msg.content)
      ? msg.content
          .filter((b) => b.type === "text")
          .map((b) => b.text)
          .join("\n")
      : msg.content;
    allMessages.push({ role: msg.role, content });
  }

  const prepared = enforcePerplexityAlternation(allMessages);

  const res = await fetch("https://api.perplexity.ai/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${PERPLEXITY_API_KEY}`,
    },
    body: JSON.stringify({
      model: PRIMARY_MODEL,
      messages: prepared,
      max_tokens: maxTokens,
      temperature,
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Perplexity API error (${res.status}): ${errText}`);
  }

  const data = await res.json();
  const replyText = data.choices?.[0]?.message?.content || "";

  return {
    content: [{ type: "text", text: replyText }],
    stopReason: "end_turn",
    usage: data.usage || {},
  };
}

/**
 * Lightweight AI call: Perplexity Sonar for background tasks.
 *
 * @param {string} prompt - The user message
 * @param {object} options - { maxTokens, system, timeoutMs }
 * @returns {string|null} The response text, or null on failure
 */
export async function callPerplexityLight(prompt, options = {}) {
  if (!PERPLEXITY_API_KEY) return null;

  const { maxTokens = 400, system = "", timeoutMs = 15_000 } = options;

  const messages = [];
  if (system) messages.push({ role: "system", content: system });
  messages.push({ role: "user", content: prompt });

  try {
    const res = await fetch("https://api.perplexity.ai/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${PERPLEXITY_API_KEY}`,
      },
      body: JSON.stringify({
        model: LIGHT_MODEL,
        messages,
        max_tokens: maxTokens,
        temperature: 0.3,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!res.ok) {
      console.warn(`[perplexity-light] HTTP ${res.status}`);
      return null;
    }

    const data = await res.json();
    return data.choices?.[0]?.message?.content?.trim() || null;
  } catch (e) {
    console.warn("[perplexity-light] error:", e.message);
    return null;
  }
}

/**
 * Deep research: Perplexity sonar-deep-research for complex multi-step queries.
 *
 * @param {string} query - The research query
 * @returns {string|null} Research results text
 */
export async function perplexityDeepResearch(query) {
  if (!PERPLEXITY_API_KEY) return null;

  try {
    const res = await fetch("https://api.perplexity.ai/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${PERPLEXITY_API_KEY}`,
      },
      body: JSON.stringify({
        model: DEEP_MODEL,
        messages: [
          {
            role: "system",
            content:
              "You are a deep research assistant. Provide thorough, well-sourced analysis.",
          },
          { role: "user", content: query },
        ],
        max_tokens: 2000,
        temperature: 0.5,
      }),
      signal: AbortSignal.timeout(120_000),
    });

    if (!res.ok) {
      console.warn(`[perplexity-deep] HTTP ${res.status}`);
      return null;
    }

    const data = await res.json();
    const text = data.choices?.[0]?.message?.content?.trim() || null;
    if (text) {
      console.log(
        `[perplexity-deep] Got ${text.length} chars for "${query.slice(0, 60)}"`,
      );
    }
    return text;
  } catch (e) {
    console.warn("[perplexity-deep] error:", e.message);
    return null;
  }
}

/**
 * Embeddings: generate vector embeddings for semantic search.
 * Uses pplx-embed-v1-4b model (3416 dimensions).
 *
 * @param {string|string[]} texts - Text(s) to embed
 * @returns {Array|null} Array of embedding vectors
 */
export async function perplexityEmbed(texts) {
  if (!PERPLEXITY_API_KEY) return null;

  try {
    const res = await fetch("https://api.perplexity.ai/v1/embeddings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${PERPLEXITY_API_KEY}`,
      },
      body: JSON.stringify({
        input: Array.isArray(texts) ? texts : [texts],
        model: "pplx-embed-v1-4b",
      }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      console.warn(`[perplexity-embed] HTTP ${res.status}`);
      return null;
    }

    const data = await res.json();
    const embeddings = (data.data || []).map((d) => d.embedding);
    console.log(
      `[perplexity-embed] Generated ${embeddings.length} embeddings (${embeddings[0]?.length || 0} dims)`,
    );
    return embeddings;
  } catch (e) {
    console.warn("[perplexity-embed] error:", e.message);
    return null;
  }
}
