/**
 * @togari/admin â Tier assigner.
 *
 * Classifies an enriched company into tier 1/2/3 against a thesis.
 *
 * - Clear cases (high fit + on-band signals) take a fast-path rule based
 *   on the reasoner's fit score.
 * - Borderline cases (fit score on a band edge, conflicting size/geo
 *   signals) are escalated to Claude for a final call + rationale that
 *   gets persisted to `thesis_companies.tier_reason`.
 *
 * Thresholds are intentionally conservative â the cost of putting a
 * marginal target in tier 3 is small; the cost of burying a real tier 1
 * is large.
 */

import { createLogger } from "../observability/logger";
import { SONNET } from "../config/models";
import {
  buildTierAssignmentPrompt,
  type TierAssignmentPromptInput,
} from "./prompts/tier-assignment";
import type { EnrichedCompany, ThesisCriteria } from "./types";

const logger = createLogger("enrichment/tier-assigner");

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_MODEL = SONNET;
const ANTHROPIC_VERSION = "2023-06-01";

const TIER_1_THRESHOLD = 80;
const TIER_2_THRESHOLD = 60;
const BORDERLINE_BAND = 5;

export interface TierAssignerInput {
  company: EnrichedCompany;
  thesis: { name: string; criteria: ThesisCriteria };
  fit_score: number;
  /**
   * Whether the company has a primary contact already resolved. Without
   * a reachable primary, even an 80+ fit score is at most tier 2 â you
   * can't call a company you can't reach.
   */
  has_primary_contact: boolean;
}

export interface TierAssignerOutput {
  tier: 1 | 2 | 3;
  rationale: string;
}

function inRange(
  value: number | undefined,
  min?: number,
  max?: number,
): boolean {
  if (value == null) return false;
  if (min != null && value < min) return false;
  if (max != null && value > max) return false;
  return true;
}

function ruleBasedTier(input: TierAssignerInput): 1 | 2 | 3 {
  const { fit_score, company, thesis, has_primary_contact } = input;
  const c = thesis.criteria;

  const revenueOnBand = inRange(
    company.estimated_revenue,
    c.revenue_range?.min,
    c.revenue_range?.max,
  );
  const headcountOnBand = inRange(
    company.estimated_headcount,
    c.headcount_range?.min,
    c.headcount_range?.max,
  );

  if (
    fit_score >= TIER_1_THRESHOLD &&
    has_primary_contact &&
    (revenueOnBand || headcountOnBand)
  ) {
    return 1;
  }
  if (fit_score >= TIER_2_THRESHOLD) return 2;
  return 3;
}

function isBorderline(input: TierAssignerInput): boolean {
  const { fit_score } = input;
  return (
    Math.abs(fit_score - TIER_1_THRESHOLD) <= BORDERLINE_BAND ||
    Math.abs(fit_score - TIER_2_THRESHOLD) <= BORDERLINE_BAND
  );
}

function getApiKey(): string {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("ANTHROPIC_API_KEY not set");
  return key;
}

/**
 * Send the tier-assignment prompt to Claude. Exposed so tests can stub
 * without hitting the network.
 */
export async function callClaudeTierAssignment(
  input: TierAssignmentPromptInput,
): Promise<TierAssignerOutput> {
  const apiKey = getApiKey();
  const userMessage = buildTierAssignmentPrompt(input);

  const res = await fetch(ANTHROPIC_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": ANTHROPIC_VERSION,
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: 256,
      system:
        "You are a sales operations decision engine. Always return the requested JSON, nothing else.",
      messages: [{ role: "user", content: userMessage }],
    }),
  });

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`Anthropic tier-assignment ${res.status}: ${errBody}`);
  }

  const data = (await res.json()) as {
    content?: Array<{ type: string; text?: string }>;
  };
  const raw = (data.content || [])
    .filter((c) => c.type === "text")
    .map((c) => c.text || "")
    .join("")
    .trim();

  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1) {
    throw new Error(`Tier assignment returned no JSON: ${raw.slice(0, 200)}`);
  }
  const parsed = JSON.parse(raw.slice(start, end + 1)) as {
    tier?: number;
    rationale?: string;
  };
  const tier =
    parsed.tier === 1 || parsed.tier === 2 || parsed.tier === 3
      ? parsed.tier
      : null;
  if (tier == null) {
    throw new Error(`Tier assignment returned invalid tier: ${parsed.tier}`);
  }
  return {
    tier,
    rationale:
      typeof parsed.rationale === "string" && parsed.rationale.trim().length > 0
        ? parsed.rationale.trim()
        : "Tiered by Claude (no rationale returned)",
  };
}

type Assigner = typeof callClaudeTierAssignment;

export interface AssignerDeps {
  assigner?: Assigner;
}

export async function assignTier(
  input: TierAssignerInput,
  deps: AssignerDeps = {},
): Promise<TierAssignerOutput> {
  const ruleTier = ruleBasedTier(input);

  if (!isBorderline(input)) {
    const rationale = buildRuleRationale(input, ruleTier);
    logger.info("Tier assigned (rule-based)", {
      company_id: input.company.company_id,
      tier: ruleTier,
      fit_score: input.fit_score,
    });
    return { tier: ruleTier, rationale };
  }

  // Borderline â let Claude confirm or override.
  const assigner = deps.assigner ?? callClaudeTierAssignment;
  try {
    const result = await assigner({
      company: input.company,
      thesis: input.thesis,
      fit_score: input.fit_score,
      rule_based_tier: ruleTier,
    });
    logger.info("Tier assigned (Claude on borderline)", {
      company_id: input.company.company_id,
      rule_tier: ruleTier,
      final_tier: result.tier,
      fit_score: input.fit_score,
    });
    return result;
  } catch (err) {
    logger.error(
      "Tier assignment via Claude failed â falling back to rule-based",
      err instanceof Error ? err : new Error(String(err)),
      { company_id: input.company.company_id },
    );
    return {
      tier: ruleTier,
      rationale: `${buildRuleRationale(input, ruleTier)} (Claude tiering unavailable; used rule-based)`,
    };
  }
}

function buildRuleRationale(input: TierAssignerInput, tier: 1 | 2 | 3): string {
  const { fit_score, has_primary_contact, company, thesis } = input;
  const c = thesis.criteria;

  const fitText = `fit score ${fit_score}/100`;
  const reachText = has_primary_contact
    ? "with a reachable primary"
    : "no primary contact yet";
  const revenueOnBand = inRange(
    company.estimated_revenue,
    c.revenue_range?.min,
    c.revenue_range?.max,
  );
  const headcountOnBand = inRange(
    company.estimated_headcount,
    c.headcount_range?.min,
    c.headcount_range?.max,
  );
  const bandText = revenueOnBand
    ? "revenue on-band"
    : headcountOnBand
      ? "headcount on-band"
      : "size signals off-band";

  if (tier === 1) {
    return `Tier 1: ${fitText}, ${reachText}, ${bandText}.`;
  }
  if (tier === 2) {
    return `Tier 2: ${fitText}, ${reachText}, ${bandText} â partial match worth a call.`;
  }
  return `Tier 3: ${fitText} below threshold or signals off-band â adjacent / nurture.`;
}
