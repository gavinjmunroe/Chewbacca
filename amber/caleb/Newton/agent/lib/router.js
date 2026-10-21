/**
 * Smart model router: classifies message complexity and picks per-turn
 * token budgets. Everything flows through callClaudeRaw (Perplexity-only),
 * so the router just returns the token budget and a display label.
 */

import { OLLAMA_BASE_URL, OLLAMA_MODEL } from "./constants.js";

const SIMPLE_OPENERS = new Set([
  "hey",
  "hi",
  "hello",
  "yo",
  "sup",
  "what's up",
  "whats up",
  "heyy",
  "heyyy",
  "lol",
  "lmao",
  "haha",
  "ok",
  "okay",
  "sure",
  "yep",
  "yup",
  "yeah",
  "nah",
  "nope",
  "thanks",
  "thank you",
  "thx",
  "ty",
  "np",
  "no problem",
  "got it",
  "sounds good",
  "nice",
  "cool",
  "dope",
  "facts",
  "fr",
  "omg",
  "wow",
]);

const EMOTIONAL_SIGNALS =
  /\b(stress|stressed|anxious|anxiety|sad|depressed|lonely|overwhelmed|scared|afraid|worried|upset|angry|frustrated|cry|crying|hopeless|lost|hate|hurt|struggling|exhausted|burnout|burnt out|breaking down)\b/i;
const COMPLEX_SIGNALS =
  /\b(remind|reminder|task|todo|calendar|schedule|meeting|email|research|look up|find out|explain|help me|what should|which|compare|difference|analyze|strategy|plan|think about)\b/i;

export function classifyComplexity(text, contact, detectedIntent) {
  const t = text.trim().toLowerCase();
  const wordCount = t.split(/\s+/).length;

  if (detectedIntent && detectedIntent.type !== "chat") return "medium";
  if (EMOTIONAL_SIGNALS.test(text)) return "complex";
  if (COMPLEX_SIGNALS.test(text)) return "complex";
  if (wordCount > 40 || text.length > 220) return "medium";
  if (wordCount <= 6 || SIMPLE_OPENERS.has(t)) return "simple";
  if ((contact.messageCount || 0) <= 3) return "medium";
  if (text.includes("?")) return "medium";
  if (wordCount <= 15) return "simple";
  return "medium";
}

// Callers use `model` only as a display label in logs — the actual routing
// to Perplexity Agent vs Sonar happens inside callClaudeRaw based on whether
// the turn carries tools. Ollama is a last-resort dev path.
const DISPLAY_MODEL = "pplx-sonar";

export function resolveModel(complexity, isCaleb, isGroup) {
  if (isCaleb) {
    // 4096 fits a 24-step enumerated report with one-line entries plus a
    // wrap-up paragraph. Old 1024 cap silently truncated Caleb's end-to-end
    // self-test at step #17 because the model ran out of output budget
    // before finishing the report. Higher cap is safe — Perplexity Sonar
    // and Claude both support well over 4K output; we just weren't asking
    // for it. Caleb's turns are the only ones routinely structured as
    // long enumerated reports, so the bump is scoped to him.
    return { model: DISPLAY_MODEL, maxTokens: 4096, useOllama: false };
  }

  // Groups: complexity-aware token limits
  if (isGroup) {
    const groupTokens =
      complexity === "complex" ? 800 : complexity === "medium" ? 500 : 250;
    return { model: DISPLAY_MODEL, maxTokens: groupTokens, useOllama: false };
  }

  if (complexity === "simple") {
    return { model: DISPLAY_MODEL, maxTokens: 400, useOllama: false };
  }
  if (complexity === "medium") {
    return { model: DISPLAY_MODEL, maxTokens: 500, useOllama: false };
  }
  // Complex (emotional, tasks, research): higher token budget
  return { model: DISPLAY_MODEL, maxTokens: 600, useOllama: false };
}
