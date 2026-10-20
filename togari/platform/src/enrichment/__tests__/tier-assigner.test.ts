/**
 * Vitest unit tests for the tier assigner.
 *
 * The rule-based path is pure and tested directly by passing scores far
 * from band edges. The Claude-on-borderline path is tested via the
 * dependency-injection seam.
 */

import { describe, it, expect, vi } from "vitest";
import { assignTier } from "../tier-assigner";
import type { EnrichedCompany, ThesisCriteria } from "../types";

const COMPANY: EnrichedCompany = {
  company_id: "co-1",
  company_name: "Springdale Landscaping",
  domain: "springdale.com",
  estimated_revenue: 18_000_000,
  estimated_headcount: 75,
  industry: "Commercial Landscaping",
  city: "Charlotte",
  state: "NC",
  country: "US",
};

const CRITERIA: ThesisCriteria = {
  industry_codes: ["561730"],
  geo_constraints: ["US-NC", "US-VA", "US-TN"],
  revenue_range: { min: 5_000_000, max: 50_000_000 },
  headcount_range: { min: 25, max: 250 },
};

const THESIS = { name: "Commercial Landscaping", criteria: CRITERIA };

describe("assignTier (rule-based path)", () => {
  it("assigns tier 1 for high fit + reachable primary + on-band size", async () => {
    const assigner = vi.fn(); // should NOT be called
    const result = await assignTier(
      {
        company: COMPANY,
        thesis: THESIS,
        fit_score: 90,
        has_primary_contact: true,
      },
      { assigner },
    );
    expect(result.tier).toBe(1);
    expect(assigner).not.toHaveBeenCalled();
    expect(result.rationale).toMatch(/Tier 1/);
  });

  it("assigns tier 2 for mid-band fit score", async () => {
    const assigner = vi.fn();
    const result = await assignTier(
      {
        company: COMPANY,
        thesis: THESIS,
        fit_score: 70,
        has_primary_contact: true,
      },
      { assigner },
    );
    expect(result.tier).toBe(2);
    expect(assigner).not.toHaveBeenCalled();
  });

  it("assigns tier 3 for low fit score", async () => {
    const assigner = vi.fn();
    const result = await assignTier(
      {
        company: COMPANY,
        thesis: THESIS,
        fit_score: 40,
        has_primary_contact: false,
      },
      { assigner },
    );
    expect(result.tier).toBe(3);
    expect(assigner).not.toHaveBeenCalled();
  });

  it("downgrades a high-fit company without a primary contact below tier 1", async () => {
    const assigner = vi.fn();
    const result = await assignTier(
      {
        company: COMPANY,
        thesis: THESIS,
        fit_score: 90,
        has_primary_contact: false,
      },
      { assigner },
    );
    expect(result.tier).toBe(2);
  });
});

describe("assignTier (Claude-on-borderline path)", () => {
  it("escalates to Claude when fit_score is within 5 of tier-1 threshold", async () => {
    const assigner = vi.fn().mockResolvedValue({
      tier: 1,
      rationale: "Owner is 67 with no successor; rare top-of-thesis fit.",
    });
    const result = await assignTier(
      {
        company: COMPANY,
        thesis: THESIS,
        fit_score: 78,
        has_primary_contact: true,
      },
      { assigner },
    );
    expect(assigner).toHaveBeenCalledOnce();
    expect(result.tier).toBe(1);
    expect(result.rationale).toMatch(/successor/);
  });

  it("falls back to rule-based tier when Claude throws", async () => {
    const assigner = vi.fn().mockRejectedValue(new Error("Anthropic 500"));
    const result = await assignTier(
      {
        company: COMPANY,
        thesis: THESIS,
        fit_score: 82,
        has_primary_contact: true,
      },
      { assigner },
    );
    expect(assigner).toHaveBeenCalledOnce();
    expect(result.tier).toBe(1); // rule-based path still gives tier 1
    expect(result.rationale).toMatch(/Claude tiering unavailable/);
  });
});
