/**
 * Vitest unit tests for the primary-contact resolver (Â§5.1).
 *
 * The rule-based scoring is pure and deterministic â we test it directly
 * via `scoreCandidate` and end-to-end via `resolvePrimaryContact` with a
 * stubbed Claude tiebreaker so no network is involved.
 */

import { describe, it, expect, vi } from "vitest";
import {
  resolvePrimaryContact,
  scoreCandidate,
  DEFAULT_OWNER_TARGET_TITLES,
} from "../primary-contact-resolver";
import type { CompanyContact } from "../types";

function contact(overrides: Partial<CompanyContact>): CompanyContact {
  return {
    contact_id:
      overrides.contact_id || `c-${Math.random().toString(36).slice(2, 8)}`,
    company_id: "co-1",
    full_name: "Jane Smith",
    title: "CEO",
    email: "jane@example.com",
    email_verified: true,
    mobile_phone: "555-0100",
    linkedin_url: "https://linkedin.com/in/janesmith",
    last_activity_at: new Date().toISOString(),
    tenure_years: 12,
    ...overrides,
  };
}

describe("scoreCandidate (rule-based rubric)", () => {
  it("CEO with phone, verified email, LinkedIn, recent activity, long tenure scores high", () => {
    const c = contact({
      contact_id: "ceo-1",
      title: "CEO",
      email_verified: true,
      mobile_phone: "555-0100",
      linkedin_url: "https://linkedin.com/in/x",
      last_activity_at: new Date().toISOString(),
      tenure_years: 15,
    });
    const result = scoreCandidate(c, DEFAULT_OWNER_TARGET_TITLES);
    // 40 (CEO) + 20 (verified email) + 15 (mobile) + 10 (linkedin) + 10 (active) + 5 (tenure) = 100
    expect(result.score).toBe(100);
  });

  it("Director without phone or verified email scores mid-band", () => {
    const c = contact({
      contact_id: "dir-1",
      title: "Director of Operations",
      email: undefined,
      email_verified: false,
      mobile_phone: undefined,
      linkedin_url: "https://linkedin.com/in/x",
      last_activity_at: undefined,
      tenure_years: 4,
    });
    const result = scoreCandidate(c, DEFAULT_OWNER_TARGET_TITLES);
    // No CEO match, no verified email, no mobile, +10 LinkedIn, no recent activity, no tenure bonus = 10
    expect(result.score).toBe(10);
  });

  it("Former CEO incurs the -20 penalty even with reach signals", () => {
    const c = contact({
      contact_id: "former-1",
      title: "Former CEO",
      email_verified: true,
      mobile_phone: "555-0100",
      linkedin_url: "https://linkedin.com/in/x",
      last_activity_at: new Date().toISOString(),
      tenure_years: 1,
    });
    const result = scoreCandidate(c, DEFAULT_OWNER_TARGET_TITLES);
    // -20 former + 40 CEO match + 20 email + 15 mobile + 10 linkedin + 10 active = 75
    expect(result.score).toBe(75);
    expect(result.reasons.some((r) => r.includes("former"))).toBe(true);
  });

  it("LinkedIn-active person scores higher than the same person dormant", () => {
    const base: CompanyContact = {
      contact_id: "x",
      company_id: "co-1",
      title: "VP Sales",
      email_verified: false,
      linkedin_url: "https://linkedin.com/in/x",
    };
    const active = scoreCandidate(
      { ...base, last_activity_at: new Date().toISOString() },
      DEFAULT_OWNER_TARGET_TITLES,
    );
    const dormant = scoreCandidate(
      { ...base, last_activity_at: "2020-01-01T00:00:00Z" },
      DEFAULT_OWNER_TARGET_TITLES,
    );
    expect(active.score).toBeGreaterThan(dormant.score);
    expect(active.score - dormant.score).toBe(10);
  });

  it("Tenure bonus only fires at 10+ years", () => {
    const nine = scoreCandidate(
      contact({ tenure_years: 9, title: "Manager" }),
      DEFAULT_OWNER_TARGET_TITLES,
    );
    const ten = scoreCandidate(
      contact({ tenure_years: 10, title: "Manager" }),
      DEFAULT_OWNER_TARGET_TITLES,
    );
    expect(ten.score - nine.score).toBe(5);
  });
});

describe("resolvePrimaryContact", () => {
  it("throws on empty candidates array", async () => {
    await expect(
      resolvePrimaryContact({ company_id: "co-empty", candidates: [] }),
    ).rejects.toThrow(/no candidates/i);
  });

  it("picks the rule-based winner when the lead is comfortable", async () => {
    const ceo = contact({ contact_id: "ceo-1", title: "CEO" });
    const ic = contact({
      contact_id: "ic-1",
      title: "Account Manager",
      email_verified: false,
      mobile_phone: undefined,
      tenure_years: 1,
    });
    const result = await resolvePrimaryContact({
      company_id: "co-1",
      candidates: [ic, ceo],
    });
    expect(result.primary_contact_id).toBe("ceo-1");
    expect(result.primary_score).toBeGreaterThan(0);
    expect(result.alternates.map((a) => a.contact_id)).toContain("ic-1");
    expect(result.primary_reason).toMatch(/title matches CEO/);
  });

  it("escalates to Claude tiebreaker when top two are within 5 points", async () => {
    // Two C-suite candidates with similar reach signals â within 5 points.
    const ceo = contact({
      contact_id: "ceo-1",
      title: "CEO",
      email_verified: true,
      mobile_phone: "555-0100",
      linkedin_url: "https://linkedin.com/in/ceo",
      last_activity_at: new Date().toISOString(),
      tenure_years: 12,
    });
    // President: same rule signals as CEO â identical score = 100. Tied.
    const pres = contact({
      contact_id: "pres-1",
      title: "President",
      email_verified: true,
      mobile_phone: "555-0200",
      linkedin_url: "https://linkedin.com/in/pres",
      last_activity_at: new Date().toISOString(),
      tenure_years: 11,
    });

    const tiebreaker = vi.fn().mockResolvedValue({
      primary_contact_id: "pres-1",
      primary_reason: "President is the operating decisionmaker on this deal.",
    });

    const result = await resolvePrimaryContact(
      {
        company_id: "co-1",
        candidates: [ceo, pres],
        company: { name: "Acme Co", description: "test" },
        thesis_name: "Test thesis",
      },
      { tiebreaker },
    );

    expect(tiebreaker).toHaveBeenCalledOnce();
    expect(result.primary_contact_id).toBe("pres-1");
    expect(result.primary_reason).toMatch(/operating decisionmaker/);
    expect(result.alternates.map((a) => a.contact_id)).toContain("ceo-1");
  });

  it("falls back to rule-based winner when tiebreaker throws", async () => {
    const ceo = contact({ contact_id: "ceo-1", title: "CEO" });
    const pres = contact({ contact_id: "pres-1", title: "President" });
    const tiebreaker = vi.fn().mockRejectedValue(new Error("Anthropic 500"));

    const result = await resolvePrimaryContact(
      { company_id: "co-1", candidates: [ceo, pres] },
      { tiebreaker },
    );

    expect(tiebreaker).toHaveBeenCalledOnce();
    // Both score the same, so the first one in sort order wins. Either is acceptable;
    // we're really asserting: no throw, fallback happened, reason explains it.
    expect(["ceo-1", "pres-1"]).toContain(result.primary_contact_id);
    expect(result.primary_reason).toMatch(/tiebreaker failed/i);
  });

  it("falls back to rule-based winner when tiebreaker returns unknown contact_id", async () => {
    const ceo = contact({ contact_id: "ceo-1", title: "CEO" });
    const pres = contact({ contact_id: "pres-1", title: "President" });
    const tiebreaker = vi.fn().mockResolvedValue({
      primary_contact_id: "ghost-99", // not in the candidate set
      primary_reason: "made up",
    });

    const result = await resolvePrimaryContact(
      { company_id: "co-1", candidates: [ceo, pres] },
      { tiebreaker },
    );

    // Should fall back to the rule-based top candidate.
    expect(["ceo-1", "pres-1"]).toContain(result.primary_contact_id);
  });

  it("uses thesis_signal_keywords override when supplied", async () => {
    // With custom keywords, "Head of Plant Operations" should beat "CEO" for
    // a thesis where we explicitly want operations leaders.
    const ceo = contact({
      contact_id: "ceo-1",
      title: "CEO",
      email_verified: false,
      mobile_phone: undefined,
      linkedin_url: undefined,
      last_activity_at: undefined,
      tenure_years: 1,
    });
    const ops = contact({
      contact_id: "ops-1",
      title: "Head of Plant Operations",
      email_verified: false,
      mobile_phone: undefined,
      linkedin_url: undefined,
      last_activity_at: undefined,
      tenure_years: 1,
    });

    const result = await resolvePrimaryContact({
      company_id: "co-1",
      candidates: [ceo, ops],
      thesis_signal_keywords: ["Head of Plant Operations"],
    });
    expect(result.primary_contact_id).toBe("ops-1");
  });

  it("returns alternates in descending score order", async () => {
    const ceo = contact({ contact_id: "a", title: "CEO" });
    const vp = contact({
      contact_id: "b",
      title: "VP Sales",
      email_verified: false,
      mobile_phone: undefined,
      linkedin_url: "https://x",
      last_activity_at: undefined,
      tenure_years: 2,
    });
    const ic = contact({
      contact_id: "c",
      title: "Sales Rep",
      email_verified: false,
      mobile_phone: undefined,
      linkedin_url: undefined,
      last_activity_at: undefined,
      tenure_years: 0,
    });
    const result = await resolvePrimaryContact({
      company_id: "co-1",
      candidates: [ic, vp, ceo],
    });
    expect(result.primary_contact_id).toBe("a");
    const scores = result.alternates.map((a) => a.score);
    for (let i = 1; i < scores.length; i++) {
      expect(scores[i - 1]).toBeGreaterThanOrEqual(scores[i]!);
    }
  });
});
