/**
 * Tiwari Search Bucket: Exa API for web search.
 * Handles: general web search, content extraction, finding similar pages.
 *
 * Exa API docs: https://docs.exa.ai
 * Uses native fetch (no npm deps needed).
 */

import { EXA_API_KEY } from "../constants.js";

const EXA_BASE = "https://api.exa.ai";

/**
 * General web search via Exa API.
 *
 * @param {string} query - Search query
 * @param {object} options - { numResults, type, useAutoprompt, category }
 * @returns {Array|null} Array of search results
 */
export async function exaSearch(query, options = {}) {
  if (!EXA_API_KEY) return null;

  const {
    numResults = 5,
    type = "auto",
    useAutoprompt = true,
    category,
  } = options;

  try {
    const body = {
      query,
      num_results: numResults,
      type,
      use_autoprompt: useAutoprompt,
      contents: {
        text: { max_characters: 1000 },
        highlights: { num_sentences: 3 },
      },
    };
    if (category) body.category = category;

    const res = await fetch(`${EXA_BASE}/search`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": EXA_API_KEY,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      console.warn(`[exa-search] HTTP ${res.status}: ${await res.text()}`);
      return null;
    }

    const data = await res.json();
    const results = data.results || [];
    console.log(
      `[exa-search] ${results.length} results for "${query.slice(0, 60)}"`,
    );
    return results;
  } catch (e) {
    console.warn("[exa-search] error:", e.message);
    return null;
  }
}

/**
 * Get full page contents for a list of Exa document IDs.
 *
 * @param {string[]} ids - Array of Exa document IDs
 * @returns {Array|null} Array of content objects
 */
export async function exaGetContents(ids) {
  if (!EXA_API_KEY || !ids?.length) return null;

  try {
    const res = await fetch(`${EXA_BASE}/contents`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": EXA_API_KEY,
      },
      body: JSON.stringify({
        ids,
        text: { max_characters: 3000 },
      }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) {
      console.warn(`[exa-contents] HTTP ${res.status}`);
      return null;
    }

    const data = await res.json();
    return data.results || [];
  } catch (e) {
    console.warn("[exa-contents] error:", e.message);
    return null;
  }
}

/**
 * Find similar pages to a given URL.
 *
 * @param {string} url - URL to find similar pages for
 * @param {object} options - { numResults }
 * @returns {Array|null} Array of similar page results
 */
export async function exaFindSimilar(url, options = {}) {
  if (!EXA_API_KEY) return null;

  const { numResults = 5 } = options;

  try {
    const res = await fetch(`${EXA_BASE}/findSimilar`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": EXA_API_KEY,
      },
      body: JSON.stringify({
        url,
        num_results: numResults,
        contents: {
          text: { max_characters: 1000 },
        },
      }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      console.warn(`[exa-similar] HTTP ${res.status}`);
      return null;
    }

    const data = await res.json();
    return data.results || [];
  } catch (e) {
    console.warn("[exa-similar] error:", e.message);
    return null;
  }
}

/**
 * Fast regex pre-check: does this message even hint at needing a search?
 * Ported from the legacy lib/search.js.
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
