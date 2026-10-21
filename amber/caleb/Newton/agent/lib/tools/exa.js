/**
 * Exa search tool module.
 *
 * Exposes three Claude tool schemas:
 *   exa_search          — neural + keyword hybrid web search
 *   exa_find_similar    — find URLs similar to a seed URL
 *   exa_get_contents    — fetch full text for a list of URLs
 *
 * Uses per-tenant EXA_API_KEY via getSecret(tenant, "EXA_API_KEY").
 * Falls back to process.env.EXA_API_KEY during migration.
 *
 * All handlers return { error: "…" } on failure; never throw.
 */

import { getSecret } from "../secrets.js";
import { registerCapability } from "../capabilities.js";

registerCapability("_tools_Exa", [
  "Neural + keyword hybrid web search (exa_search)",
  "Find similar pages by URL (exa_find_similar)",
  "Fetch full page text for URL list (exa_get_contents)",
]);

const EXA_BASE = "https://api.exa.ai";
const DEFAULT_TIMEOUT_MS = 20_000;

// ── helpers ───────────────────────────────────────────────────────────────

async function resolveApiKey(tenant) {
  if (tenant) {
    const key = await getSecret(tenant, "EXA_API_KEY", {
      fallbackEnv: "EXA_API_KEY",
    });
    if (key) return key;
  }
  return process.env.EXA_API_KEY || null;
}

async function exaPost(path, body, apiKey) {
  const res = await fetch(`${EXA_BASE}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    throw new Error(
      `Exa ${path} -> ${res.status}: ${JSON.stringify(data).slice(0, 200)}`,
    );
  }
  return data;
}

// ── tool implementations ──────────────────────────────────────────────────

async function exaSearch(input, tenant) {
  const apiKey = await resolveApiKey(tenant);
  if (!apiKey) return { error: "EXA_API_KEY not configured for this tenant" };

  const {
    query,
    numResults = 10,
    type = "auto",
    includeDomains,
    excludeDomains,
    startPublishedDate,
    endPublishedDate,
    useAutoprompt = true,
    text = false,
  } = input;

  const body = {
    query,
    numResults,
    type,
    useAutoprompt,
    ...(includeDomains?.length && { includeDomains }),
    ...(excludeDomains?.length && { excludeDomains }),
    ...(startPublishedDate && { startPublishedDate }),
    ...(endPublishedDate && { endPublishedDate }),
    ...(text && { contents: { text: { maxCharacters: 2000 } } }),
  };

  try {
    return await exaPost("/search", body, apiKey);
  } catch (err) {
    return { error: err.message };
  }
}

async function exaFindSimilar(input, tenant) {
  const apiKey = await resolveApiKey(tenant);
  if (!apiKey) return { error: "EXA_API_KEY not configured for this tenant" };

  const {
    url,
    numResults = 10,
    excludeSourceDomain = true,
    text = false,
  } = input;

  const body = {
    url,
    numResults,
    excludeSourceDomain,
    ...(text && { contents: { text: { maxCharacters: 2000 } } }),
  };

  try {
    return await exaPost("/findSimilar", body, apiKey);
  } catch (err) {
    return { error: err.message };
  }
}

async function exaGetContents(input, tenant) {
  const apiKey = await resolveApiKey(tenant);
  if (!apiKey) return { error: "EXA_API_KEY not configured for this tenant" };

  const { urls, maxCharacters = 3000, highlights = false } = input;

  if (!Array.isArray(urls) || urls.length === 0) {
    return { error: "urls must be a non-empty array" };
  }

  const body = {
    ids: urls,
    contents: {
      text: { maxCharacters },
      ...(highlights && { highlights: { numSentences: 3, highlightsPerUrl: 3 } }),
    },
  };

  try {
    return await exaPost("/contents", body, apiKey);
  } catch (err) {
    return { error: err.message };
  }
}

// ── tool schemas ──────────────────────────────────────────────────────────

export const EXA_TOOLS = [
  {
    name: "exa_search",
    description:
      "Search the web using Exa's neural + keyword hybrid search. Returns relevant URLs, titles, and optional page text. Best for research, finding people, companies, news, or any factual query.",
    input_schema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "The search query (natural language or keyword)",
        },
        numResults: {
          type: "integer",
          description: "Number of results to return (default 10, max 25)",
        },
        type: {
          type: "string",
          enum: ["auto", "neural", "keyword"],
          description: "Search mode: auto (default), neural (semantic), or keyword",
        },
        includeDomains: {
          type: "array",
          items: { type: "string" },
          description: "Restrict results to these domains (e.g. ['linkedin.com'])",
        },
        excludeDomains: {
          type: "array",
          items: { type: "string" },
          description: "Exclude results from these domains",
        },
        startPublishedDate: {
          type: "string",
          description: "ISO 8601 date — only return pages published after this",
        },
        endPublishedDate: {
          type: "string",
          description: "ISO 8601 date — only return pages published before this",
        },
        useAutoprompt: {
          type: "boolean",
          description: "Let Exa rewrite query for better results (default true)",
        },
        text: {
          type: "boolean",
          description: "Include snippet of page text in results (default false)",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "exa_find_similar",
    description:
      "Find web pages similar to a given URL. Useful for competitor discovery, finding related articles, or expanding a research set from a known good source.",
    input_schema: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "Seed URL to find similar pages for",
        },
        numResults: {
          type: "integer",
          description: "Number of similar pages to return (default 10)",
        },
        excludeSourceDomain: {
          type: "boolean",
          description: "Exclude results from the seed URL's domain (default true)",
        },
        text: {
          type: "boolean",
          description: "Include snippet of page text in results (default false)",
        },
      },
      required: ["url"],
    },
  },
  {
    name: "exa_get_contents",
    description:
      "Fetch full text content for a list of URLs. Use after exa_search to read the actual content of result pages.",
    input_schema: {
      type: "object",
      properties: {
        urls: {
          type: "array",
          items: { type: "string" },
          description: "List of URLs to fetch content for",
        },
        maxCharacters: {
          type: "integer",
          description: "Max characters per page (default 3000)",
        },
        highlights: {
          type: "boolean",
          description: "Include highlighted relevant sentences (default false)",
        },
      },
      required: ["urls"],
    },
  },
];

// ── dispatcher ────────────────────────────────────────────────────────────

export async function executeExaTool(toolName, input, ctx = {}) {
  const { tenant } = ctx;
  switch (toolName) {
    case "exa_search":
      return exaSearch(input, tenant);
    case "exa_find_similar":
      return exaFindSimilar(input, tenant);
    case "exa_get_contents":
      return exaGetContents(input, tenant);
    default:
      return { error: `Unknown Exa tool: ${toolName}` };
  }
}
