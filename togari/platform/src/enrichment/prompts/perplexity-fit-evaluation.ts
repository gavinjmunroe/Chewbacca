/**
 * @togari/admin — Perplexity fit-evaluation prompt template.
 *
 * Versioned as code (not config) so prompt changes show up in PR diffs and
 * can be reviewed alongside the reasoner logic. Returns a single string
 * suitable as the `messages[0].content` for a Perplexity online-model call.
 *
 * The prompt asks Perplexity to reason over public-web signals and return
 * STRICT JSON in a known shape — the reasoner extracts that JSON and never
 * lets free-form prose leak downstream.
 */

import type { ThesisCandidateCompany, ThesisCriteria } from "../types";

export interface PerplexityFitPromptInput {
  thesis: { name: string; description?: string; criteria: ThesisCriteria };
  candidate: ThesisCandidateCompany;
}

function formatRevenueRange(criteria: ThesisCriteria): string {
  const r = criteria.revenue_range;
  if (!r || (r.min == null && r.max == null)) return "unspecified";
  const min = r.min != null ? `$${(r.min / 1_000_000).toFixed(1)}M` : "any";
  const max = r.max != null ? `$${(r.max / 1_000_000).toFixed(1)}M` : "any";
  return `${min} – ${max} annual revenue`;
}

function formatHeadcountRange(criteria: ThesisCriteria): string {
  const h = criteria.headcount_range;
  if (!h || (h.min == null && h.max == null)) return "unspecified";
  const min = h.min != null ? `${h.min}` : "any";
  const max = h.max != null ? `${h.max}` : "any";
  return `${min} – ${max} employees`;
}

function bulletList(items?: string[]): string {
  if (!items || items.length === 0) return "(none specified)";
  return items.map((i) => `  - ${i}`).join("\n");
}

export function buildPerplexityFitPrompt(
  input: PerplexityFitPromptInput,
): string {
  const { thesis, candidate } = input;
  const c = thesis.criteria;

  const where =
    [candidate.city, candidate.state, candidate.country]
      .filter(Boolean)
      .join(", ") || "unknown location";

  return `You are evaluating whether a company fits a private-equity sourcing thesis. Use public-web signals only. Be skeptical: do not assume fit; cite the evidence.

INVESTMENT THESIS
Name: ${thesis.name}
${thesis.description ? `Description: ${thesis.description}\n` : ""}Industry codes (NAICS/SIC): ${c.industry_codes?.join(", ") || "unspecified"}
Geo constraints: ${c.geo_constraints?.join(", ") || "unspecified"}
Revenue band: ${formatRevenueRange(c)}
Headcount band: ${formatHeadcountRange(c)}
Must-have signals:
${bulletList(c.must_have_signals)}
Disqualifiers:
${bulletList(c.exclude_signals)}

CANDIDATE COMPANY
Name: ${candidate.name}
Domain: ${candidate.domain || "unknown"}
Location: ${where}
${candidate.hint ? `Discovery hint: ${candidate.hint}\n` : ""}
TASK
1. Determine whether this company fits the thesis.
2. Score the fit from 0 (no fit) to 100 (textbook target).
3. Suggest a sourcing tier:
   - 1 = top priority (clear fit, has decisionmaker reachable, in core geo/revenue band)
   - 2 = worth a call (partial fit or one weak signal)
   - 3 = adjacent / long-shot (related industry or out-of-band size)
   - null = insufficient information to classify
4. Write a 1–2 sentence company description suitable for a sales rep skim.
5. Write a brief rationale anchoring the score in concrete evidence (e.g. recent expansion, owner age, lack of PE backing). If you cannot find evidence, say so plainly.

OUTPUT FORMAT — return ONLY a single JSON object, no prose, no code fences:
{
  "fit_score": <number 0-100>,
  "company_description": "<1-2 sentences>",
  "tier_suggestion": <1 | 2 | 3 | null>,
  "rationale": "<one paragraph anchored in evidence>"
}`;
}
