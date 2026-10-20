/**
 * @togari/admin — Perplexity fit-evaluation reasoner.
 *
 * Per-candidate fit score + AI summary + tier suggestion using Perplexity's
 * online model (citations grounded in live web). Sits between Exa
 * discovery and Clay enrichment in the Â§5.2 orchestrator pipeline.
 *
 * The reasoner deliberately does not depend on the connector registry
 * (Karthik wires that on Day 1). It calls Perplexity directly via fetch,
 * matching the pattern established in `core/tools/meeting-intel.ts`.
 *
 * Cost target: under $0.30 per call (max_tokens 800, sonar online tier).
 */

import { createLogger } from "../observability/logger";
import {
  buildPerplexityFitPrompt,
  type PerplexityFitPromptInput,
} from "./prompts/perplexity-fit-evaluation";
import type { ThesisCandidateCompany, ThesisCriteria } from "./types";

const logger = createLogger("enrichment/perplexity-reasoner");

const PERPLEXITY_URL = "https://api.perplexity.ai/chat/completions";
/**
 * Default Perplexity model. Online variants ground answers in live web
 * results which is what we want for sourcing fit checks. Override via
 * PERPLEXITY_MODEL env when Sagar wants to A/B against a cheaper tier.
 */
const DEFAULT_MODEL = process.env.PERPLEXITY_MODEL || "sonar";

export interface PerplexityReasonerInput {
  thesis: { name: string; description?: string; criteria: ThesisCriteria };
  candidate: ThesisCandidateCompany;
}

export interface PerplexityReasonerOutput {
  fit_score: number;
  company_description: string;
  tier_suggestion: 1 | 2 | 3 | null;
  rationale: string;
  perplexity_citations: string[];
}

function getApiKey(): string {
  const key = process.env.PERPLEXITY_API_KEY;
  if (!key) throw new Error("PERPLEXITY_API_KEY not set");
  return key;
}

function clampScore(n: unknown): number {
  const num = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(num)) return 0;
  return Math.max(0, Math.min(100, Math.round(num)));
}

function coerceTier(t: unknown): 1 | 2 | 3 | null {
  if (t === 1 || t === 2 || t === 3) return t;
  if (t === "1" || t === "2" || t === "3") return Number(t) as 1 | 2 | 3;
  return null;
}

/**
 * Perplexity occasionally wraps JSON in code fences or trailing prose.
 * Pull out the first {...} block; if that fails, throw with the raw body
 * for the caller to log.
 */
function extractJsonObject(raw: string): Record<string, unknown> {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error(
      `No JSON object found in Perplexity response: ${raw.slice(0, 200)}`,
    );
  }
  const slice = raw.slice(start, end + 1);
  try {
    return JSON.parse(slice) as Record<string, unknown>;
  } catch (err) {
    throw new Error(
      `Could not parse JSON from Perplexity response: ${(err as Error).message}. Raw: ${slice.slice(0, 200)}`,
    );
  }
}

export async function evaluateCompanyFit(
  input: PerplexityReasonerInput,
): Promise<PerplexityReasonerOutput> {
  const apiKey = getApiKey();
  const promptInput: PerplexityFitPromptInput = {
    thesis: input.thesis,
    candidate: input.candidate,
  };
  const userPrompt = buildPerplexityFitPrompt(promptInput);

  const body = {
    model: DEFAULT_MODEL,
    messages: [
      {
        role: "system",
        content:
          "You are a private-equity sourcing analyst. Always return strict JSON in the format the user specifies. Never include code fences or commentary.",
      },
      { role: "user", content: userPrompt },
    ],
    max_tokens: 800,
    temperature: 0.2,
  };

  const res = await fetch(PERPLEXITY_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errBody = await res.text();
    logger.error(
      "Perplexity reasoner call failed",
      new Error(`status=${res.status}`),
      {
        status: res.status,
        body: errBody.slice(0, 500),
        candidate: input.candidate.name,
      },
    );
    throw new Error(`Perplexity API ${res.status}: ${errBody}`);
  }

  const json = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    citations?: string[];
  };
  const raw = json.choices?.[0]?.message?.content?.trim() ?? "";
  if (!raw) {
    throw new Error("Perplexity returned empty content");
  }

  const parsed = extractJsonObject(raw);
  const result: PerplexityReasonerOutput = {
    fit_score: clampScore(parsed.fit_score),
    company_description:
      typeof parsed.company_description === "string"
        ? parsed.company_description.trim()
        : "",
    tier_suggestion: coerceTier(parsed.tier_suggestion),
    rationale:
      typeof parsed.rationale === "string" ? parsed.rationale.trim() : "",
    perplexity_citations: Array.isArray(json.citations)
      ? json.citations.filter((c): c is string => typeof c === "string")
      : [],
  };

  logger.info("Perplexity fit evaluation complete", {
    candidate: input.candidate.name,
    fit_score: result.fit_score,
    tier_suggestion: result.tier_suggestion,
    citation_count: result.perplexity_citations.length,
  });

  return result;
}
