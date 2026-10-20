/**
 * @togari/admin — Tier-assignment prompt template.
 *
 * Used when the rule-based tier is borderline (fit score on a band edge,
 * conflicting signals) and we want Claude to make the final call with a
 * human-readable rationale that gets stored on `thesis_companies.tier_reason`.
 */

import type { EnrichedCompany, ThesisCriteria } from "../types";

export interface TierAssignmentPromptInput {
  company: EnrichedCompany;
  thesis: { name: string; criteria: ThesisCriteria };
  fit_score: number;
  /**
   * The tier the rule-based pass tentatively assigned. Provided so Claude
   * either confirms or overrides with a stated reason — never starts blank.
   */
  rule_based_tier: 1 | 2 | 3;
}

function formatRevenueBand(c: ThesisCriteria): string {
  const r = c.revenue_range;
  if (!r) return "unspecified";
  const min = r.min != null ? `$${(r.min / 1_000_000).toFixed(1)}M` : "any";
  const max = r.max != null ? `$${(r.max / 1_000_000).toFixed(1)}M` : "any";
  return `${min}-${max}`;
}

export function buildTierAssignmentPrompt(
  input: TierAssignmentPromptInput,
): string {
  const { company, thesis, fit_score, rule_based_tier } = input;
  const c = thesis.criteria;

  const revenue =
    company.estimated_revenue != null
      ? `$${(company.estimated_revenue / 1_000_000).toFixed(1)}M`
      : "unknown";
  const headcount = company.estimated_headcount ?? "unknown";
  const where =
    [company.city, company.state, company.country].filter(Boolean).join(", ") ||
    "unknown";

  return `You are tiering a sourcing target for the "${thesis.name}" thesis. The rule-based pass put it in tier ${rule_based_tier}; confirm or override.

THESIS BANDS
Industry: ${c.industry_codes?.join(", ") || "unspecified"}
Geo: ${c.geo_constraints?.join(", ") || "unspecified"}
Revenue: ${formatRevenueBand(c)}
Headcount: ${c.headcount_range?.min ?? "any"}-${c.headcount_range?.max ?? "any"}

COMPANY
${company.company_name} (${company.domain || "no domain"})
Location: ${where}
Industry: ${company.industry || "unknown"}${company.naics_code ? ` (NAICS ${company.naics_code})` : ""}
Revenue: ${revenue}
Headcount: ${headcount}
Founded: ${company.founded_year ?? "unknown"}
Description: ${company.description || "(no description available)"}
Fit score from reasoner: ${fit_score}/100

TIER DEFINITIONS
1 = top priority. Clear fit on industry, geo, and revenue band. Call this week.
2 = worth a call. Partial fit (1 signal off-band but otherwise on-thesis).
3 = adjacent / long-shot. Multiple signals off-band but related enough to keep warm.

TASK
Pick the final tier (1, 2, or 3) and write a one-sentence rationale anchored in the most decisive signal — revenue, geo, headcount, industry match, or fit score.

OUTPUT FORMAT — return ONLY a single JSON object:
{ "tier": <1 | 2 | 3>, "rationale": "<one sentence>" }`;
}
