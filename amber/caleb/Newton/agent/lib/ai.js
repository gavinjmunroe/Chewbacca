/**
 * AI call chain, Perplexity-only: Agent API (Claude Sonnet 4.6) for tool
 * calling, Sonar for plain chat, Ollama as a local last resort if the
 * operator wires one up. Groq and Anthropic direct were both removed —
 * Perplexity is the single paid provider, which is simpler and keeps
 * search + embeddings + agent all on the same account.
 *
 * The function is still called callClaudeRaw and the request body still
 * uses Anthropic's shape so callers don't have to change.
 */

import {
  OLLAMA_BASE_URL,
  OLLAMA_MODEL,
  PERPLEXITY_API_KEY,
} from "./constants.js";

const PERPLEXITY_MODEL = process.env.PERPLEXITY_CHAT_MODEL || "sonar-pro";

/**
 * Perplexity Sonar requires strict user/assistant alternation after the
 * optional system message. Merge consecutive same-role messages, drop
 * any trailing assistant message (must end with user), and ensure at
 * least one user message exists.
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

// Deeply sanitize a JSON Schema so it satisfies OpenAI / Sonar's
// function-parameters validator. Sonar rejects anything it can't
// statically validate: missing types, wrong types, $ref, allOf/oneOf,
// bad property shapes, etc. We strip and coerce until it's strictly
// a simple "object with string/number/boolean/array properties" schema.
function sanitizeSchema(schema) {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
    return { type: "object", properties: {} };
  }
  const out = { type: "object", properties: {} };

  // properties
  if (schema.properties && typeof schema.properties === "object") {
    for (const [key, prop] of Object.entries(schema.properties)) {
      if (!prop || typeof prop !== "object" || Array.isArray(prop)) continue;
      const cleanProp = {};
      // type: coerce to a supported scalar type
      const allowedTypes = [
        "string",
        "number",
        "integer",
        "boolean",
        "array",
        "object",
      ];
      if (allowedTypes.includes(prop.type)) {
        cleanProp.type = prop.type;
      } else {
        cleanProp.type = "string";
      }
      if (typeof prop.description === "string") {
        cleanProp.description = prop.description.slice(0, 512);
      }
      if (Array.isArray(prop.enum)) {
        cleanProp.enum = prop.enum.filter(
          (e) => typeof e === "string" || typeof e === "number",
        );
      }
      // array items: minimal shape
      if (cleanProp.type === "array") {
        cleanProp.items =
          prop.items && prop.items.type
            ? {
                type: allowedTypes.includes(prop.items.type)
                  ? prop.items.type
                  : "string",
              }
            : { type: "string" };
      }
      out.properties[key] = cleanProp;
    }
  }

  // required: keep only strings that reference real properties
  if (Array.isArray(schema.required)) {
    const req = schema.required.filter(
      (r) => typeof r === "string" && out.properties[r],
    );
    if (req.length > 0) out.required = req;
  }

  return out;
}

// Strip Perplexity Sonar's default search-style artifacts so fallback
// replies read like a normal iMessage from Amber, not a research report.
export function stripSonarArtifacts(text) {
  if (!text) return text;
  let out = text;
  // Numeric citation markers: [1], [2][3], [1, 2], [^1]
  out = out.replace(/\[\^?\d+(?:\s*,\s*\d+)*\]/g, "");
  // Markdown link wrappers: [label](url) -> label
  out = out.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
  // Bold and italic markers
  out = out.replace(/\*\*([^*]+)\*\*/g, "$1");
  out = out.replace(/(?<!\w)\*([^*\n]+)\*(?!\w)/g, "$1");
  // Heading markers at line start
  out = out.replace(/^#{1,6}\s+/gm, "");
  // Bare URLs
  out = out.replace(/https?:\/\/\S+/g, "");
  // Em dashes: replace with comma + space
  out = out.replace(/\u2014/g, ", ");
  // Collapse duplicate whitespace left behind
  out = out
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return out;
}

// Convert Anthropic message format to OpenAI-style chat format (Sonar / Ollama)
export function anthropicToOpenAIMessages(
  requestBody,
  maxSystemChars = Infinity,
) {
  let systemMsg = requestBody.system
    ? typeof requestBody.system === "string"
      ? requestBody.system
      : requestBody.system.map((b) => b.text).join("\n")
    : "";
  if (systemMsg.length > maxSystemChars) {
    systemMsg =
      systemMsg.slice(0, maxSystemChars) +
      "\n\n[Context truncated for token limits]";
  }
  const messages = [];
  if (systemMsg) messages.push({ role: "system", content: systemMsg });
  for (const msg of requestBody.messages || []) {
    const content = Array.isArray(msg.content)
      ? msg.content
          .filter((b) => b.type === "text")
          .map((b) => b.text)
          .join("\n")
      : msg.content;
    messages.push({ role: msg.role, content });
  }
  return messages;
}

// Direct Ollama call (bypasses the fallback chain)
export async function callOllamaDirect(system, messages, maxTokens) {
  const ollamaMessages = [
    { role: "system", content: system },
    ...messages.map((m) => ({
      role: m.role,
      content: Array.isArray(m.content)
        ? m.content
            .filter((b) => b.type === "text")
            .map((b) => b.text)
            .join("\n")
        : m.content,
    })),
  ];
  const res = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      messages: ollamaMessages,
      stream: false,
      options: { num_predict: maxTokens, temperature: 0.8 },
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Ollama error: ${err}`);
  }
  const data = await res.json();
  const text = data.message?.content || data.response || "";
  return {
    content: [{ type: "text", text }],
    stopReason: "end_turn",
    usage: {},
  };
}

// Voice-taming preamble injected ahead of the caller's system prompt.
// Keeps Sonar replies short, conversational, and free of markdown
// or citation noise. Mirrors the rules Amber's main system prompt enforces.
const AMBER_VOICE_PREAMBLE = [
  "You are a personal AI agent speaking over iMessage. Your exact identity and owner are set by the system prompt that follows — use that, not this preamble, for names.",
  "This is a private chat, not a research task. Do not act like a search engine.",
  "",
  "Hard rules, non-negotiable:",
  "- Never cite sources. Never include bracket references like [1], [2], [^1].",
  "- Never include URLs, domain names, or 'according to ...' phrasing.",
  "- No markdown. No bold, no italics, no headings, no bullet lists, no numbered lists.",
  "- No em dashes ever (the \\u2014 character). Use commas, periods, or new sentences.",
  "- No emojis.",
  "- Keep replies short. 1 to 3 sentences for iMessage, match the energy of who you're talking to.",
  "- Warm, direct, a little playful. Christian-faith aware when it fits, never preachy.",
  "- Never say 'I searched' or 'based on my research'. You're not a search tool right now.",
  "- If unsure of a fact, say so in one sentence and offer the next step.",
  "",
  "Follow every instruction that follows from the system prompt below. This preamble overrides only tone and format, not identity, memory, or task logic.",
].join("\n");

function injectAmberVoice(messages) {
  const firstSystem = messages.find((m) => m.role === "system");
  if (firstSystem) {
    firstSystem.content = `${AMBER_VOICE_PREAMBLE}\n\n---\n\n${firstSystem.content}`;
  } else {
    messages.unshift({ role: "system", content: AMBER_VOICE_PREAMBLE });
  }
  return messages;
}

// Route tool-using turns through Perplexity's Agent API (`/v1/agent`).
// Uses Claude Sonnet 4.6 via Perplexity's multi-model router for genius-
// tier tool calling with zero hallucination. The Agent API uses a
// different format from chat/completions:
//   - `input` (array of conversation items) instead of `messages`
//   - `instructions` instead of `system`
//   - `function_call` / `function_call_output` items for tool flow
//
// Returns an Anthropic-shaped response so agent.js's existing tool loop
// works without changes.
const AGENT_MODEL =
  process.env.PPLX_AGENT_MODEL || "anthropic/claude-sonnet-4-6";
const AGENT_API_URL = "https://api.perplexity.ai/v1/agent";

function anthropicMessagesToAgentInput(messages) {
  const input = [];
  for (const msg of messages || []) {
    if (msg.role === "user" && Array.isArray(msg.content)) {
      const toolResults = msg.content.filter((b) => b.type === "tool_result");
      const textBlocks = msg.content.filter((b) => b.type === "text");
      for (const tr of toolResults) {
        input.push({
          type: "function_call_output",
          call_id: tr.tool_use_id,
          output:
            typeof tr.content === "string"
              ? tr.content
              : JSON.stringify(tr.content),
        });
      }
      if (textBlocks.length > 0) {
        input.push({
          role: "user",
          content: textBlocks.map((b) => b.text).join("\n"),
        });
      }
      continue;
    }
    if (msg.role === "assistant" && Array.isArray(msg.content)) {
      const text = msg.content
        .filter((b) => b.type === "text")
        .map((b) => b.text)
        .join("\n");
      const toolUses = msg.content.filter((b) => b.type === "tool_use");
      if (text) {
        input.push({ role: "assistant", content: text });
      }
      for (const tu of toolUses) {
        input.push({
          type: "function_call",
          name: tu.name,
          call_id: tu.id,
          arguments: JSON.stringify(tu.input || {}),
        });
      }
      continue;
    }
    const content = Array.isArray(msg.content)
      ? msg.content
          .filter((b) => b.type === "text")
          .map((b) => b.text)
          .join("\n")
      : msg.content;
    if (msg.role === "user" || msg.role === "assistant") {
      // Perplexity Agent API rejects entries with empty content
      // (400: "validation failed: input[N]: content cannot be empty").
      // Skip empties rather than erroring the whole turn. This can happen
      // if an older assistant record was persisted with empty content
      // (e.g. a pre-fix tapback-only turn).
      if (typeof content === "string" && content.trim().length > 0) {
        input.push({ role: msg.role, content });
      }
    }
  }
  return input;
}

function agentToolsFromAnthropic(tools) {
  if (!Array.isArray(tools)) return [];
  return tools
    .filter((t) => t && typeof t.name === "string")
    .map((t) => ({
      type: "function",
      name: t.name,
      description: (t.description || "").slice(0, 1024),
      parameters: sanitizeSchema(t.input_schema),
    }));
}

function agentOutputToAnthropic(output) {
  const content = [];
  for (const item of output || []) {
    if (item.type === "function_call") {
      let input = {};
      try {
        input = item.arguments ? JSON.parse(item.arguments) : {};
      } catch {
        input = { _raw: item.arguments };
      }
      content.push({
        type: "tool_use",
        id: item.call_id,
        name: item.name,
        input,
      });
    } else if (item.type === "message") {
      for (const c of item.content || []) {
        if (c.type === "output_text" && c.text) {
          content.push({ type: "text", text: stripSonarArtifacts(c.text) });
        }
      }
    }
  }
  const hasToolUse = content.some((b) => b.type === "tool_use");
  return {
    content,
    stopReason: hasToolUse ? "tool_use" : "end_turn",
    usage: {},
  };
}

async function callPerplexityAgent(requestBody) {
  if (!PERPLEXITY_API_KEY) throw new Error("PERPLEXITY_API_KEY not set");

  const instructions =
    typeof requestBody.system === "string"
      ? requestBody.system
      : Array.isArray(requestBody.system)
        ? requestBody.system.map((b) => b.text).join("\n")
        : "";

  const input = anthropicMessagesToAgentInput(requestBody.messages || []);
  const tools = agentToolsFromAnthropic(requestBody.tools || []);

  const body = {
    model: AGENT_MODEL,
    input,
    tools: tools.length > 0 ? tools : undefined,
    max_output_tokens: requestBody.max_tokens || 1024,
  };
  if (instructions) body.instructions = instructions;

  const res = await fetch(AGENT_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${PERPLEXITY_API_KEY}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    throw new Error(`pplx-agent ${res.status}: ${errBody.slice(0, 300)}`);
  }

  const data = await res.json();
  const result = agentOutputToAnthropic(data.output || []);
  console.log(
    "[ai] pplx-agent:",
    AGENT_MODEL,
    "stop:",
    result.stopReason,
    "calls:",
    result.content.filter((b) => b.type === "tool_use").length,
  );
  return result;
}

// Main AI call chain, Perplexity-only:
//   Tools present → Perplexity Agent API (Claude Sonnet 4.6)
//   Plain chat    → Perplexity Sonar (/chat/completions)
//   Last resort   → Ollama if OLLAMA_BASE_URL is set (dev-only)
//
// If Perplexity is out and Ollama isn't configured, callClaudeRaw throws
// and agent.js surfaces the "trouble connecting" fallback to the user —
// intentional. Groq was removed: single paid provider, simpler chain, and
// Amber no longer silently loses tool access when the fallback fires.
//
// Caller still sends an Anthropic-shaped requestBody for backward compat.
export async function callClaudeRaw(requestBody) {
  // Tools present, OR caller has requested Agent routing explicitly
  // (e.g. Medha expert mode wants Claude, not Sonar's web-grounded chat):
  // route to Perplexity Agent API (Claude Sonnet 4.6).
  const hasTools =
    Array.isArray(requestBody.tools) && requestBody.tools.length > 0;
  if ((hasTools || requestBody.routeToAgent) && PERPLEXITY_API_KEY) {
    return await callPerplexityAgent(requestBody);
  }

  // Plain chat: Perplexity Sonar.
  if (PERPLEXITY_API_KEY) {
    const rawMessages = anthropicToOpenAIMessages(requestBody, 20000);
    const messages = injectAmberVoice(
      enforcePerplexityAlternation(rawMessages),
    );
    const pplxRes = await fetch("https://api.perplexity.ai/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${PERPLEXITY_API_KEY}`,
      },
      body: JSON.stringify({
        model: PERPLEXITY_MODEL,
        messages,
        max_tokens: requestBody.max_tokens || 1024,
        temperature: 0.8,
        return_citations: false,
        return_images: false,
      }),
      signal: AbortSignal.timeout(60_000),
    });
    if (pplxRes.ok) {
      const data = await pplxRes.json();
      const rawReply = data.choices?.[0]?.message?.content || "";
      const replyText = stripSonarArtifacts(rawReply);
      console.log("[ai] sonar:", PERPLEXITY_MODEL);
      return {
        content: [{ type: "text", text: replyText }],
        stopReason: "end_turn",
        usage: data.usage || {},
      };
    }
    const pplxErr = await pplxRes.text();
    console.warn("[ai] sonar failed, falling through to Ollama:", pplxErr);
  }

  // Fallback: Anthropic direct (no Perplexity key or Perplexity down)
  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
  const CLAUDE_MODEL = process.env.CLAUDE_MODEL || "claude-haiku-4-5-20251001";
  if (ANTHROPIC_API_KEY) {
    try {
      const anthropicBody = {
        model: CLAUDE_MODEL,
        max_tokens: requestBody.max_tokens || 1024,
        messages: (requestBody.messages || []).map((m) => ({
          role: m.role,
          content: Array.isArray(m.content)
            ? m.content
                .filter((b) => b.type === "text")
                .map((b) => b.text)
                .join("\n")
            : m.content,
        })),
      };
      if (requestBody.system) {
        anthropicBody.system =
          typeof requestBody.system === "string"
            ? requestBody.system
            : requestBody.system.map((b) => b.text).join("\n");
      }
      if (Array.isArray(requestBody.tools) && requestBody.tools.length > 0) {
        anthropicBody.tools = requestBody.tools;
      }
      const anthropicRes = await fetch(
        "https://api.anthropic.com/v1/messages",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": ANTHROPIC_API_KEY,
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify(anthropicBody),
          signal: AbortSignal.timeout(60_000),
        },
      );
      if (anthropicRes.ok) {
        const data = await anthropicRes.json();
        console.log(
          "[ai] claude-fallback:",
          CLAUDE_MODEL,
          "stop:",
          data.stop_reason,
        );
        return {
          content: data.content || [],
          stopReason: data.stop_reason || "end_turn",
          usage: data.usage || {},
        };
      }
      const anthropicErr = await anthropicRes.text().catch(() => "");
      console.warn(
        "[ai] claude-fallback failed:",
        anthropicRes.status,
        anthropicErr.slice(0, 200),
      );
    } catch (anthropicEx) {
      console.warn("[ai] claude-fallback error:", anthropicEx.message);
    }
  }

  // Last resort: Ollama (only if operator wired a local endpoint)
  if (OLLAMA_BASE_URL) {
    const messages = anthropicToOpenAIMessages(requestBody);
    const ollamaRes = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: OLLAMA_MODEL, messages, stream: false }),
      signal: AbortSignal.timeout(30_000),
    });
    if (ollamaRes.ok) {
      const data = await ollamaRes.json();
      const replyText = data.message?.content || data.response || "";
      console.log("[cloud-fallback] Using Ollama at", OLLAMA_BASE_URL);
      return {
        content: [{ type: "text", text: replyText }],
        stopReason: "end_turn",
        usage: {},
      };
    }
    const err = await ollamaRes.text();
    console.warn("[ai] ollama fallback failed:", err.slice(0, 200));
  }

  throw new Error("All AI providers failed");
}
