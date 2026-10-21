/**
 * LLM-backed classifier for the six-dimension ontology.
 *
 * Pure scaffolding: this module is callable but no production code path
 * uses it yet. Callers are expected to wire it into fact-extractor.js or
 * similar in a follow-up. The function is async, fail-soft (returns the
 * safe default "social" rather than throwing on LLM errors), and caches
 * by content hash so repeated identical inputs cost one round-trip.
 */

import crypto from "node:crypto";
import { DIMENSIONS, isDimension } from "./dimensions.js";

const DEFAULT_MODEL = "claude-haiku-4-5-20251001";
const SAFE_DEFAULT = "social";
const CACHE_MAX = 200;

const cache = new Map();

function cacheGet(key) {
  if (!cache.has(key)) return undefined;
  const value = cache.get(key);
  // LRU touch.
  cache.delete(key);
  cache.set(key, value);
  return value;
}

function cacheSet(key, value) {
  if (cache.has(key)) cache.delete(key);
  cache.set(key, value);
  if (cache.size > CACHE_MAX) {
    const oldest = cache.keys().next().value;
    cache.delete(oldest);
  }
}

function hashKey(text) {
  return crypto.createHash("sha256").update(text).digest("hex").slice(0, 16);
}

function normalizeDimension(raw) {
  if (!raw) return null;
  const cleaned = String(raw)
    .toLowerCase()
    .replace(/[^a-z]/g, "");
  return isDimension(cleaned) ? cleaned : null;
}

const SYSTEM_PROMPT = [
  "Classify this text into exactly one of six health dimensions.",
  "Return ONLY the dimension name, lowercase, no punctuation, no explanation.",
  "",
  "Dimensions:",
  "- spiritual: prayer, faith, meaning, transcendence",
  "- emotional: feelings, mood, relationships' emotional weight, mental health",
  "- physical: body, exercise, sleep, food, energy, illness",
  "- financial: money, work-as-income, spending, saving, debt, business deals",
  "- intellectual: learning, curiosity, ideas, study, technical work, creative output",
  "- social: friendships, community, communication, time-with-others, networking",
].join("\n");

async function callAnthropic(text, model) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is not set");
  }
  const body = {
    model,
    max_tokens: 32,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: String(text) }],
  };
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`anthropic ${res.status}: ${errText.slice(0, 200)}`);
  }
  const data = await res.json();
  const blocks = Array.isArray(data.content) ? data.content : [];
  const textOut = blocks
    .filter((b) => b && b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
  return textOut;
}

/**
 * Classify a piece of text into one of the six dimensions.
 * Returns one of DIMENSIONS. On any failure, returns SAFE_DEFAULT ("social").
 */
export async function classify(text, { model = DEFAULT_MODEL } = {}) {
  if (!text || typeof text !== "string" || !text.trim()) {
    return SAFE_DEFAULT;
  }
  const key = hashKey(text);
  const cached = cacheGet(key);
  if (cached) return cached;

  try {
    const raw = await callAnthropic(text, model);
    const dim = normalizeDimension(raw) || SAFE_DEFAULT;
    cacheSet(key, dim);
    return dim;
  } catch (err) {
    console.warn(
      "[ontology] classify failed, defaulting to social:",
      err.message,
    );
    return SAFE_DEFAULT;
  }
}

// Exported for tests and observability.
export function _resetCache() {
  cache.clear();
}

export { DIMENSIONS };
