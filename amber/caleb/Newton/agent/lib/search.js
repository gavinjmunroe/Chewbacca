/**
 * Web search: tiered search with AI-powered planning and orchestration.
 * Tier 1: Ollama search API (free)
 * Tier 2: DuckDuckGo Instant Answers (free, no key)
 * Tier 3: Perplexity (live research)
 * Tier 4: Anthropic native web search
 *
 * Also includes the AI search brain (Haiku-powered planning).
 */

import { OLLAMA_API_KEY, PERPLEXITY_API_KEY } from "./constants.js";
import { callPerplexityLight } from "./tiwari/context.js";
import { registerCapability } from "./capabilities.js";

registerCapability(
  "Search",
  "Perplexity Search API (fast), Perplexity Agent (deep research), Perplexity Embeddings (semantic)",
);
registerCapability(
  "Search",
  "Anthropic native web search, DuckDuckGo Instant Answers",
);
registerCapability(
  "Search",
  "AI-powered search brain that plans what to search before searching",
);

/**
 * Web search: Ollama search API -> DuckDuckGo Instant Answers fallback.
 */
export async function webSearch(query) {
  // Tier 1: Ollama web search (free, just needs OLLAMA_API_KEY)
  if (OLLAMA_API_KEY) {
    try {
      const res = await fetch("https://ollama.com/api/web_search", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${OLLAMA_API_KEY}`,
        },
        body: JSON.stringify({ query, max_results: 5 }),
        signal: AbortSignal.timeout(10_000),
      });
      if (res.ok) {
        const data = await res.json();
        const results = (data.results || []).slice(0, 5);
        console.log(
          `[web_search] Ollama: ${results.length} results for "${query}"`,
        );
        return results
          .map((r) => `${r.title}\n${r.url}\n${r.content || r.snippet || ""}`)
          .join("\n\n");
      }
      console.warn("[web_search] Ollama failed:", await res.text());
    } catch (e) {
      console.warn("[web_search] Ollama error:", e.message);
    }
  }

  // Tier 2: DuckDuckGo Instant Answers (free, no key)
  try {
    const res = await fetch(
      `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`,
      {
        headers: { "User-Agent": "Amber/1.0" },
        signal: AbortSignal.timeout(8_000),
      },
    );
    if (res.ok) {
      const data = await res.json();
      const parts = [];
      if (data.AbstractText)
        parts.push(
          `${data.Heading}: ${data.AbstractText} (${data.AbstractURL})`,
        );
      (data.RelatedTopics || []).slice(0, 4).forEach((t) => {
        if (t.Text) parts.push(`${t.Text} (${t.FirstURL})`);
      });
      if (parts.length) {
        console.log(
          `[web_search] DuckDuckGo: ${parts.length} results for "${query}"`,
        );
        return parts.join("\n\n");
      }
    }
  } catch (e) {
    console.warn("[web_search] DuckDuckGo error:", e.message);
  }

  return null; // no results
}

/**
 * Perplexity search: uses the new Search API (fast, structured results)
 * with fallback to the chat completions API (sonar).
 */
export async function perplexitySearch(query) {
  if (!PERPLEXITY_API_KEY) return null;

  // Tier 1: Perplexity Search API (fastest, structured results)
  try {
    const searchRes = await fetch("https://api.perplexity.ai/search", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${PERPLEXITY_API_KEY}`,
      },
      body: JSON.stringify({
        query,
        max_results: 5,
        max_tokens_per_page: 256,
      }),
      signal: AbortSignal.timeout(8_000),
    });
    if (searchRes.ok) {
      const data = await searchRes.json();
      const results = data.results || [];
      if (results.length > 0) {
        const formatted = results
          .map(
            (r) =>
              `${r.title || ""}\n${r.url || ""}\n${r.text || r.snippet || r.content || ""}`,
          )
          .join("\n\n");
        console.log(
          `[perplexity] Search API: ${results.length} results for "${query}"`,
        );
        return formatted;
      }
    }
  } catch (e) {
    console.warn("[perplexity] Search API error:", e.message);
  }

  // Tier 2: Perplexity Chat Completions (sonar, AI-synthesized answer)
  try {
    const r = await fetch("https://api.perplexity.ai/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${PERPLEXITY_API_KEY}`,
      },
      body: JSON.stringify({
        model: "sonar",
        messages: [
          {
            role: "system",
            content: "Be precise and concise. Return factual information only.",
          },
          { role: "user", content: query },
        ],
        max_tokens: 400,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!r.ok) {
      console.warn(`[perplexity] HTTP ${r.status}, falling back`);
      return null;
    }
    const data = await r.json();
    return data.choices?.[0]?.message?.content?.trim() || null;
  } catch (e) {
    console.warn("[perplexity] error:", e.message);
    return null;
  }
}

/**
 * Perplexity Agent: deep research using the Responses API.
 * Use for complex questions that need multi-step reasoning.
 */
export async function perplexityAgent(query) {
  if (!PERPLEXITY_API_KEY) return null;
  try {
    const r = await fetch("https://api.perplexity.ai/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${PERPLEXITY_API_KEY}`,
      },
      body: JSON.stringify({
        preset: "fast-search",
        input: query,
      }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!r.ok) {
      console.warn(`[perplexity-agent] HTTP ${r.status}`);
      return null;
    }
    const data = await r.json();
    // Extract text from the response output
    const output = data.output;
    if (Array.isArray(output)) {
      for (const item of output) {
        if (item.type === "message") {
          for (const c of item.content || []) {
            if (c.type === "output_text" && c.text) {
              console.log(
                `[perplexity-agent] Got ${c.text.length} chars for "${query}"`,
              );
              return c.text;
            }
          }
        }
      }
    }
    if (typeof output === "string") return output;
    return null;
  } catch (e) {
    console.warn("[perplexity-agent] error:", e.message);
    return null;
  }
}

/**
 * Perplexity Embeddings: generate vector embeddings for semantic search.
 * Uses pplx-embed-v1-4b model (3416 dimensions).
 */
export async function perplexityEmbed(texts) {
  if (!PERPLEXITY_API_KEY) return null;
  try {
    const r = await fetch("https://api.perplexity.ai/v1/embeddings", {
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
    if (!r.ok) {
      console.warn(`[perplexity-embed] HTTP ${r.status}`);
      return null;
    }
    const data = await r.json();
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

/**
 * Perplexity-powered search: uses callPerplexityLight for quick research.
 * Replaces the old anthropicSearch that called api.anthropic.com directly.
 */
export async function pplxSearch(query) {
  if (!PERPLEXITY_API_KEY) return null;
  try {
    const result = await callPerplexityLight(
      `Search the web and give me a concise factual summary about: ${query}`,
      { maxTokens: 400, timeoutMs: 20_000 },
    );
    if (result && result.length > 20) {
      console.log(
        `[pplx-search] Got ${result.length} chars for "${query.slice(0, 40)}"`,
      );
      return result;
    }
    return null;
  } catch (e) {
    console.warn("[pplx-search] error:", e.message);
    return null;
  }
}

/**
 * Fast regex pre-check: does this message even hint at needing a search?
 */
export function mightNeedSearch(text) {
  const t = text.toLowerCase().trim();
  // Explicit search requests
  if (
    /\b(search|look\s*up|lookup|google|find|research|who is|what is|tell me about|info on|what happened|latest on|news on|where is|how does|when did|why did)\b/i.test(
      t,
    )
  )
    return true;
  // Questions about people, places, things
  if (/^(who|what|where|when|why|how)\b/i.test(t)) return true;
  // Contains a proper noun pattern (capitalized words not at sentence start)
  if (/\s[A-Z][a-z]{2,}/.test(text)) return true;
  return false;
}

/**
 * AI search planner: Haiku decides what to do with this message.
 */
export async function planSearch(text, contextSnippet, conversationHistory) {
  if (!PERPLEXITY_API_KEY) return { action: "skip", queries: [] };

  const recentMsgs = conversationHistory
    .slice(-6)
    .map((m) => `${m.senderLabel || m.from}: ${m.content}`)
    .join("\n");

  try {
    const raw = await callPerplexityLight(
      `KNOWN CONTEXT:\n${contextSnippet.slice(0, 3000)}\n\nRECENT CONVERSATION:\n${recentMsgs || "(none)"}\n\nNEW MESSAGE: "${text}"\n\nReturn JSON:\n{"action": "skip" | "context_only" | "search" | "multi_search", "reason": "one sentence why", "queries": ["search query 1"], "context_summary": "if context_only"}`,
      {
        maxTokens: 300,
        timeoutMs: 8_000,
        system: `You are a search planner. Rules:
- "context_only" if the answer is clearly in context
- "search" if the user asks about something NOT in context
- "multi_search" if multiple queries help
- "skip" for casual chat
Return ONLY valid JSON.`,
      },
    );
    if (!raw) return { action: "skip", queries: [] };
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return { action: "skip", queries: [] };
    const plan = JSON.parse(jsonMatch[0]);
    console.log(
      `[search-brain] action=${plan.action} reason="${plan.reason || ""}" queries=${JSON.stringify(plan.queries || [])}`,
    );
    return plan;
  } catch (e) {
    console.warn("[search-brain] planner error:", e.message);
    return { action: "skip", queries: [] };
  }
}

/**
 * Execute search plan: run queries in parallel, merge results.
 */
export async function executeSearchPlan(plan) {
  if (!plan.queries || plan.queries.length === 0) return null;

  // Run all queries in parallel
  const results = await Promise.all(
    plan.queries.slice(0, 3).map(async (query) => {
      const result =
        (await perplexitySearch(query)) ||
        (await pplxSearch(query)) ||
        (await webSearch(query));
      return result ? { query, result } : null;
    }),
  );

  const found = results.filter(Boolean);
  if (found.length === 0) return null;

  // Merge results with query labels
  if (found.length === 1) return found[0].result;
  return found
    .map((r) => `[Search: "${r.query}"]\n${r.result}`)
    .join("\n\n---\n\n");
}

/**
 * Legacy fallback: simple regex extraction for when Haiku is unavailable.
 */
export function extractSearchQueryFallback(text) {
  const t = text.toLowerCase().trim();
  const searchMatch = t.match(
    /(?:search|look\s*up|lookup|google|find|who is|what is|tell me about|info on|information on|what happened to|latest on|news on|where is|research)\s+(.{3,80})/i,
  );
  if (searchMatch) return searchMatch[1].replace(/[?!.,]+$/, "").trim();
  const whoMatch = text.match(/^who(?:'s| is| are) (.+?)\??$/i);
  if (whoMatch) return whoMatch[1].trim();
  const whatMatch = text.match(/^what(?:'s| is| are) (.+?)\??$/i);
  if (whatMatch) return whatMatch[1].trim();
  return null;
}
