/**
 * Anthropic chat client for the NON-chat surfaces: /ask synthesis and the
 * Amber Q&A threads.
 *
 * WHY THIS EXISTS SEPARATELY FROM routes/chat.js streamChat().
 * chat.js already owns a hardened streaming client (three attempts, a
 * first-token watchdog, per-attempt failure logging) and it is the main
 * user-facing path. Extracting it would have meant refactoring the busiest
 * code in the app to serve two callers that need a fraction of its behavior.
 * This module is the fraction: one call, one retry-free timeout, null on any
 * failure. If a third caller shows up, THEN extract the good one and delete
 * this.
 *
 * WHAT IT REPLACED. Both surfaces called Perplexity sonar-pro
 * ($3/$15 per Mtok) to summarize evidence that Cloud SQL had already
 * retrieved. sonar's product is web search; nothing here searches the web, so
 * the entire premium bought nothing. Haiku 4.5 is $1/$5 for the same job.
 *
 * ON PROMPT CACHING, honestly: `cache_control` is applied to the system block
 * whenever a system prompt is supplied, but Anthropic only caches prefixes
 * above a minimum length (~1024 tokens, higher on Haiku). The system prompts
 * on these two surfaces are a few hundred tokens, so caching is a NO-OP here
 * today and costs nothing to leave in place -- it starts paying the moment a
 * system prompt grows past the floor. The real caching win is in
 * routes/chat.js, where the prefix is large.
 */

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const DEFAULT_MODEL = process.env.ASK_SYNTHESIS_MODEL || "claude-haiku-4-5";
const DEFAULT_MAX_TOKENS = 700;
const DEFAULT_TIMEOUT_MS = 20000;
const STREAM_TIMEOUT_MS = 60000;

/** The model these surfaces will report having used, for the /ask contract. */
export const ASK_MODEL = DEFAULT_MODEL;

/**
 * Split an OpenAI-style messages array into Anthropic's shape.
 *
 * Anthropic takes the system prompt as a TOP-LEVEL parameter, not as a message
 * with role "system" -- passing one inline is a 400. Both call sites here were
 * written against the OpenAI convention, so this accepts that convention and
 * converts, which keeps their call sites unchanged and the conversion in one
 * testable place.
 *
 * Consecutive same-role turns are merged because Anthropic requires strictly
 * alternating user/assistant roles, and a sanitised transcript can legitimately
 * contain two user turns in a row.
 */
export function toAnthropicShape(messages) {
  const list = Array.isArray(messages) ? messages : [];
  const systemParts = [];
  const turns = [];
  for (const m of list) {
    if (!m || typeof m !== "object") continue;
    const content = typeof m.content === "string" ? m.content.trim() : "";
    if (!content) continue;
    if (m.role === "system") {
      systemParts.push(content);
      continue;
    }
    const role = m.role === "assistant" ? "assistant" : "user";
    const prev = turns[turns.length - 1];
    if (prev && prev.role === role) {
      prev.content += `\n\n${content}`;
    } else {
      turns.push({ role, content });
    }
  }
  // Anthropic requires a non-empty messages array and a leading user turn.
  if (turns.length === 0) turns.push({ role: "user", content: "Respond now." });
  if (turns[0].role !== "user") turns.unshift({ role: "user", content: "(continued)" });
  return { system: systemParts.join("\n\n") || null, messages: turns };
}

function systemParam(system) {
  if (!system) return undefined;
  return [{ type: "text", text: system, cache_control: { type: "ephemeral" } }];
}

function requestBody({ system, messages, model, maxTokens, stream }) {
  const body = { model, max_tokens: maxTokens, messages };
  const sys = systemParam(system);
  if (sys) body.system = sys;
  if (stream) body.stream = true;
  return body;
}

function headers(apiKey) {
  return {
    "content-type": "application/json",
    "x-api-key": apiKey,
    "anthropic-version": "2023-06-01",
  };
}

/**
 * One buffered completion. Returns the trimmed text, or null on ANY failure
 * (no key, network, timeout, non-2xx, unexpected shape) so every caller can
 * fall back deterministically. This is the same contract the Perplexity client
 * had, deliberately, so no caller's error handling changes.
 */
export async function callChat({
  messages,
  system = null,
  model = DEFAULT_MODEL,
  maxTokens = DEFAULT_MAX_TOKENS,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  apiKey = process.env.ANTHROPIC_API_KEY,
  fetchImpl = globalThis.fetch,
} = {}) {
  if (!apiKey || typeof fetchImpl !== "function") return null;
  const shaped = toAnthropicShape(messages);
  const effectiveSystem = system || shaped.system;
  try {
    const res = await fetchImpl(ANTHROPIC_URL, {
      method: "POST",
      headers: headers(apiKey),
      body: JSON.stringify(
        requestBody({
          system: effectiveSystem,
          messages: shaped.messages,
          model,
          maxTokens,
          stream: false,
        }),
      ),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.warn(`[anthropic-chat] http_${res.status} (model=${model}): ${body.slice(0, 300)}`);
      return null;
    }
    const data = await res.json().catch(() => null);
    // content is an array of blocks; concatenate every text block rather than
    // reading [0], because a response can lead with a non-text block.
    const blocks = Array.isArray(data?.content) ? data.content : [];
    const text = blocks
      .filter((b) => b?.type === "text" && typeof b.text === "string")
      .map((b) => b.text)
      .join("");
    return text.trim() ? text.trim() : null;
  } catch (err) {
    console.warn(`[anthropic-chat] threw (model=${model}): ${err?.message || err}`);
    return null;
  }
}

/**
 * Streaming completion over Anthropic SSE. Calls onToken(delta) per text
 * fragment and resolves with the full assembled text, or null on transport
 * failure so the caller can fall back.
 *
 * Anthropic's event stream is NOT OpenAI-shaped: tokens arrive as
 * `content_block_delta` with `delta.text`, and each event carries an
 * `event:` line as well as `data:`. A stream can also end with
 * `error` instead of `message_stop`, which is why a failed stream that
 * already emitted text still returns what it got.
 */
export async function streamChat({
  messages,
  system = null,
  onToken,
  model = DEFAULT_MODEL,
  maxTokens = DEFAULT_MAX_TOKENS,
  timeoutMs = STREAM_TIMEOUT_MS,
  apiKey = process.env.ANTHROPIC_API_KEY,
  fetchImpl = globalThis.fetch,
} = {}) {
  if (!apiKey || typeof fetchImpl !== "function") return null;
  if (typeof onToken !== "function") return null;
  const shaped = toAnthropicShape(messages);
  const effectiveSystem = system || shaped.system;

  let res;
  try {
    res = await fetchImpl(ANTHROPIC_URL, {
      method: "POST",
      headers: { ...headers(apiKey), accept: "text/event-stream" },
      body: JSON.stringify(
        requestBody({
          system: effectiveSystem,
          messages: shaped.messages,
          model,
          maxTokens,
          stream: true,
        }),
      ),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    console.warn(`[anthropic-chat] stream threw (model=${model}): ${err?.message || err}`);
    return null;
  }

  if (!res.ok || !res.body) {
    const body = await res.text().catch(() => "");
    console.warn(
      `[anthropic-chat] stream http_${res.status} (model=${model}): ${body.slice(0, 300)}`,
    );
    return null;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let full = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split("\n\n");
    buffer = events.pop() ?? "";
    for (const evt of events) {
      const dataLine = evt
        .split("\n")
        .find((l) => l.startsWith("data:"))
        ?.slice(5)
        .trim();
      if (!dataLine) continue;
      let payload;
      try {
        payload = JSON.parse(dataLine);
      } catch {
        continue; // ping / keep-alive / partial frame
      }
      if (payload?.type === "message_stop") return full.trim();
      if (payload?.type === "error") {
        console.warn(
          `[anthropic-chat] stream error event: ${JSON.stringify(payload.error || {}).slice(0, 300)}`,
        );
        return full.trim() ? full.trim() : null;
      }
      if (payload?.type !== "content_block_delta") continue;
      const delta = payload?.delta?.text;
      if (typeof delta !== "string" || delta.length === 0) continue;
      full += delta;
      try {
        onToken(delta);
      } catch (cbErr) {
        try {
          await reader.cancel();
        } catch {}
        throw cbErr;
      }
    }
  }
  return full.trim();
}
