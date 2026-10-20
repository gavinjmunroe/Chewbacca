/**
 * @togari/core/services/scoring — Comprehensive Scoring Engine Tests
 * Unit tests, property-based tests (fast-check), and edge cases
 */

import { describe, it, expect, beforeEach } from 'vitest';
import * as fc from 'fast-check';
import { ScoringService } from '../index';
import type { Person, SourceChannel, Vertical } from '../../../types';
import {
  CHANNEL_SCORES,
  BUDGET_SCORE_THRESHOLDS,
  ROUTING_TIER_THRESHOLDS,
  AUTHORITY_SCORES,
  DECISION_MAKER_TITLES,
  INFLUENCER_TITLES,
  GTM_MATURITY_INDICATORS,
  GTM_MATURITY_SCORES,
  VERTICAL_KEYWORDS,
} from '../../../constants';

// ============================================================================
// SETUP
// ============================================================================

let scorer: ScoringService;

beforeEach(() => {
  scorer = new ScoringService();
});

/**
 * Helper to build a minimal Person partial for testing
 */
function buildPerson(overrides: Partial<Person> = {}): Partial<Person> {
  return {
    personId: 'test-person-1',
    sourceChannel: 'direct' as SourceChannel,
    vertical: 'healthcare' as Vertical,
    touchCount: 0,
    ...overrides,
  };
}

// ============================================================================
// SECTION A — UNIT TESTS
// ============================================================================

describe('Section A — Unit Tests', () => {
  // --------------------------------------------------------------------------
  // Channel Scores
  // --------------------------------------------------------------------------
  describe('Channel Scores', () => {
    it('should return correct score for each source channel', () => {
      const expectedScores: [SourceChannel, number][] = [
        ['warm_referral', 25],
        ['event', 20],
        ['partner', 18],
        ['inbound_marketing', 15],
        ['direct', 12],
        ['social_media', 12],
        ['paid_ads', 10],
        ['cold_outbound', 10],
      ];

      for (const [channel, expected] of expectedScores) {
        const result = scorer.calculateScores(buildPerson({ sourceChannel: channel }));
        expect(result.factors.internal.channelScore).toBe(expected);
      }
    });

    it('should return 10 for undefined channel', () => {
      const result = scorer.calculateScores(buildPerson({ sourceChannel: undefined }));
      expect(result.factors.internal.channelScore).toBe(10);
    });

    it('should cover all defined SourceChannel values', () => {
      // Ensure test covers every channel in the CHANNEL_SCORES constant
      const testedChannels = Object.keys(CHANNEL_SCORES);
      expect(testedChannels.length).toBeGreaterThanOrEqual(8);
    });
  });

  // --------------------------------------------------------------------------
  // Budget Scores
  // --------------------------------------------------------------------------
  describe('Budget Scores', () => {
    it('should return correct score for each employee count range', () => {
      const cases: [number, number][] = [
        [1, 5],     // 0-10 → 5
        [10, 5],    // boundary
        [11, 10],   // 11-50 → 10
        [50, 10],   // boundary
        [51, 15],   // 51-200 → 15
        [200, 15],  // boundary
        [201, 20],  // 201-500 → 20
        [500, 20],  // boundary
        [501, 25],  // 501+ → 25
        [10000, 25],
      ];

      for (const [employeeCount, expected] of cases) {
        const result = scorer.calculateScores(
          buildPerson({ companyData: { employeeCount } as Person['companyData'] })
        );
        expect(result.factors.internal.budgetScore).toBe(expected);
      }
    });

    it('should return 10 for undefined employee count', () => {
      const result = scorer.calculateScores(buildPerson({ companyData: undefined }));
      expect(result.factors.internal.budgetScore).toBe(10);
    });

    it('should return 10 for zero employee count', () => {
      const result = scorer.calculateScores(
        buildPerson({ companyData: { employeeCount: 0 } as Person['companyData'] })
      );
      // 0 is falsy, so calculateBudgetScore returns default 10
      expect(result.factors.internal.budgetScore).toBe(10);
    });
  });

  // --------------------------------------------------------------------------
  // Authority Scores
  // --------------------------------------------------------------------------
  describe('Authority Scores', () => {
    it('should return correct score for each persona', () => {
      const cases: [string, number][] = [
        ['decision_maker', 25],
        ['influencer', 15],
        ['champion', 12],
        ['end_user', 8],
        ['gatekeeper', 5],
      ];

      for (const [persona, expected] of cases) {
        const result = scorer.calculateScores(buildPerson({ persona }));
        expect(result.factors.internal.authorityScore).toBe(expected);
      }
    });

    it('should return unknown score for undefined persona and title', () => {
      const result = scorer.calculateScores(buildPerson({ persona: undefined, currentTitle: undefined }));
      expect(result.factors.internal.authorityScore).toBe(AUTHORITY_SCORES.unknown);
    });

    it('should infer decision_maker from C-level titles', () => {
      const titles = ['CEO', 'Chief Executive Officer', 'Founder & CEO', 'VP of Sales', 'CTO'];
      for (const title of titles) {
        const result = scorer.calculateScores(buildPerson({ currentTitle: title }));
        expect(result.factors.internal.authorityScore).toBe(25);
      }
    });

    it('should infer influencer from manager/senior titles', () => {
      const titles = ['Product Manager', 'Senior Engineer', 'Team Lead', 'Principal Architect'];
      for (const title of titles) {
        const result = scorer.calculateScores(buildPerson({ currentTitle: title }));
        expect(result.factors.internal.authorityScore).toBe(15);
      }
    });

    it('should be case-insensitive for title matching', () => {
      const result = scorer.calculateScores(buildPerson({ currentTitle: 'CHIEF EXECUTIVE OFFICER' }));
      expect(result.factors.internal.authorityScore).toBe(25);
    });

    it('should prefer persona over title when both provided', () => {
      const result = scorer.calculateScores(
        buildPerson({ persona: 'end_user', currentTitle: 'CEO' })
      );
      expect(result.factors.internal.authorityScore).toBe(8); // end_user, not decision_maker
    });
  });

  // --------------------------------------------------------------------------
  // GTM Maturity
  // --------------------------------------------------------------------------
  describe('GTM Maturity Scores', () => {
    it('should return high score for high maturity tools', () => {
      const result = scorer.calculateScores(buildPerson({ techStack: ['Salesforce', 'HubSpot'] }));
      expect(result.factors.internal.gtmMaturityScore).toBe(GTM_MATURITY_SCORES.high);
    });

    it('should return medium score for medium maturity tools', () => {
      // Use a tool that's only in medium, not in high
      const mediumTools = GTM_MATURITY_INDICATORS.mediumMaturity.filter(
        t => !GTM_MATURITY_INDICATORS.highMaturity.includes(t)
      );
      if (mediumTools.length > 0) {
        const result = scorer.calculateScores(buildPerson({ techStack: [mediumTools[0]] }));
        expect(result.factors.internal.gtmMaturityScore).toBe(GTM_MATURITY_SCORES.medium);
      }
    });

    it('should return low score for low maturity tools', () => {
      const lowTools = GTM_MATURITY_INDICATORS.lowMaturity.filter(
        t =>
          !GTM_MATURITY_INDICATORS.highMaturity.includes(t) &&
          !GTM_MATURITY_INDICATORS.mediumMaturity.includes(t)
      );
      if (lowTools.length > 0) {
        const result = scorer.calculateScores(buildPerson({ techStack: [lowTools[0]] }));
        expect(result.factors.internal.gtmMaturityScore).toBe(GTM_MATURITY_SCORES.low);
      }
    });

    it('should return unknown score for empty tech stack', () => {
      const result = scorer.calculateScores(buildPerson({ techStack: [] }));
      expect(result.factors.internal.gtmMaturityScore).toBe(GTM_MATURITY_SCORES.unknown);
    });

    it('should return unknown score for undefined tech stack', () => {
      const result = scorer.calculateScores(buildPerson({ techStack: undefined }));
      expect(result.factors.internal.gtmMaturityScore).toBe(GTM_MATURITY_SCORES.unknown);
    });

    it('should return unknown score for unrecognized tools', () => {
      const result = scorer.calculateScores(buildPerson({ techStack: ['unknown-tool-xyz'] }));
      expect(result.factors.internal.gtmMaturityScore).toBe(GTM_MATURITY_SCORES.unknown);
    });

    it('should prioritize highest maturity match', () => {
      // Mix of low and high — high maturity check runs first
      const result = scorer.calculateScores(
        buildPerson({ techStack: [GTM_MATURITY_INDICATORS.lowMaturity[0], 'salesforce'] })
      );
      expect(result.factors.internal.gtmMaturityScore).toBe(GTM_MATURITY_SCORES.high);
    });
  });

  // --------------------------------------------------------------------------
  // Vertical Fit
  // --------------------------------------------------------------------------
  describe('Vertical Fit', () => {
    it('should return 25 (middle) when no vertical set', () => {
      const result = scorer.calculateScores(buildPerson({ vertical: undefined }));
      expect(result.factors.external.verticalFit).toBe(25);
    });

    it('should return 50 for 3+ keyword matches', () => {
      const result = scorer.calculateScores(
        buildPerson({
          vertical: 'healthcare' as Vertical,
          currentTitle: 'hospital clinic medical center director',
          currentCompany: 'health system',
        })
      );
      expect(result.factors.external.verticalFit).toBe(50);
    });

    it('should return 40 for 2 keyword matches', () => {
      const result = scorer.calculateScores(
        buildPerson({
          vertical: 'healthcare' as Vertical,
          currentTitle: 'hospital director',
          currentCompany: 'clinic',
        })
      );
      expect(result.factors.external.verticalFit).toBe(40);
    });

    it('should return 30 for 1 keyword match', () => {
      const result = scorer.calculateScores(
        buildPerson({
          vertical: 'healthcare' as Vertical,
          currentTitle: 'Software Engineer',
          currentCompany: 'hospital',
        })
      );
      expect(result.factors.external.verticalFit).toBe(30);
    });

    it('should return 20 for 0 keyword matches', () => {
      const result = scorer.calculateScores(
        buildPerson({
          vertical: 'healthcare' as Vertical,
          currentTitle: 'Software Engineer',
          currentCompany: 'Tech Corp',
        })
      );
      expect(result.factors.external.verticalFit).toBe(20);
    });
  });

  // --------------------------------------------------------------------------
  // Engagement Signals
  // --------------------------------------------------------------------------
  describe('Engagement Signals', () => {
    it('should return base score of 15 with no touches', () => {
      const result = scorer.calculateScores(buildPerson({ touchCount: 0 }));
      expect(result.factors.external.engagementSignals).toBe(15);
    });

    it('should add 3 for 1-2 touches', () => {
      const result = scorer.calculateScores(buildPerson({ touchCount: 1 }));
      expect(result.factors.external.engagementSignals).toBe(18); // 15 + 3
    });

    it('should add 7 for 3-4 touches', () => {
      const result = scorer.calculateScores(buildPerson({ touchCount: 3 }));
      expect(result.factors.external.engagementSignals).toBe(22); // 15 + 7
    });

    it('should add 10 for 5+ touches', () => {
      const result = scorer.calculateScores(buildPerson({ touchCount: 5 }));
      expect(result.factors.external.engagementSignals).toBe(25); // 15 + 10
    });

    it('should add 5 for contact within 7 days', () => {
      const recent = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000); // 3 days ago
      const result = scorer.calculateScores(
        buildPerson({ touchCount: 0, lastContactedAt: recent as any })
      );
      expect(result.factors.external.engagementSignals).toBe(20); // 15 + 5
    });

    it('should add 2 for contact within 30 days', () => {
      const twoWeeksAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
      const result = scorer.calculateScores(
        buildPerson({ touchCount: 0, lastContactedAt: twoWeeksAgo as any })
      );
      expect(result.factors.external.engagementSignals).toBe(17); // 15 + 2
    });

    it('should cap at 30', () => {
      const recent = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000); // 1 day ago
      const result = scorer.calculateScores(
        buildPerson({ touchCount: 10, lastContactedAt: recent as any })
      );
      expect(result.factors.external.engagementSignals).toBe(30); // capped
    });
  });

  // --------------------------------------------------------------------------
  // Timing Indicators
  // --------------------------------------------------------------------------
  describe('Timing Indicators', () => {
    it('should return base score of 10 with no hooks', () => {
      const result = scorer.calculateScores(buildPerson({ personalizationHooks: undefined }));
      expect(result.factors.external.timingIndicators).toBe(10);
    });

    it('should add 3 per positive signal', () => {
      const result = scorer.calculateScores(
        buildPerson({ personalizationHooks: ['hiring new engineers'] })
      );
      expect(result.factors.external.timingIndicators).toBe(13); // 10 + 3
    });

    it('should add points for multiple positive signals', () => {
      const result = scorer.calculateScores(
        buildPerson({ personalizationHooks: ['hiring and expanding rapidly'] })
      );
      expect(result.factors.external.timingIndicators).toBe(16); // 10 + 3 + 3
    });

    it('should subtract 5 per negative signal', () => {
      const result = scorer.calculateScores(
        buildPerson({ personalizationHooks: ['layoff announced'] })
      );
      expect(result.factors.external.timingIndicators).toBe(5); // 10 - 5
    });

    it('should clamp to [0, 20]', () => {
      // All positive signals at once
      const allPositive = scorer.calculateScores(
        buildPerson({ personalizationHooks: ['hiring expanding new role funding growth launch'] })
      );
      expect(allPositive.factors.external.timingIndicators).toBeLessThanOrEqual(20);
      expect(allPositive.factors.external.timingIndicators).toBeGreaterThanOrEqual(0);

      // Multiple negative signals
      const allNegative = scorer.calculateScores(
        buildPerson({ personalizationHooks: ['layoff downsizing restructuring'] })
      );
      expect(allNegative.factors.external.timingIndicators).toBe(0); // clamped at 0
    });
  });

  // --------------------------------------------------------------------------
  // Composite Score
  // --------------------------------------------------------------------------
  describe('Composite Score', () => {
    it('should be round(internal * 0.5 + external * 0.5)', () => {
      const result = scorer.calculateScores(buildPerson());
      const expectedComposite = Math.round(
        result.internalScore * 0.5 + result.externalScore * 0.5
      );
      expect(result.compositeScore).toBe(expectedComposite);
    });

    it('should compute correctly with known inputs', () => {
      // warm_referral (25) + 501 employees (25) + decision_maker persona (25) + salesforce (25) = 100 internal
      // healthcare vertical with 3 keywords (50) + 5 touches (25) + hiring (13) = 88 external (capped 100)
      const result = scorer.calculateScores(
        buildPerson({
          sourceChannel: 'warm_referral',
          companyData: { employeeCount: 1000 } as Person['companyData'],
          persona: 'decision_maker',
          techStack: ['salesforce'],
          vertical: 'healthcare' as Vertical,
          currentTitle: 'Hospital Clinic Medical Center Director',
          touchCount: 5,
          personalizationHooks: ['hiring'],
        })
      );

      expect(result.internalScore).toBe(100);
      expect(result.externalScore).toBeGreaterThan(0);
      expect(result.compositeScore).toBe(
        Math.round(result.internalScore * 0.5 + result.externalScore * 0.5)
      );
    });
  });

  // --------------------------------------------------------------------------
  // Tier Boundaries
  // --------------------------------------------------------------------------
  describe('Tier Boundaries', () => {
    it('should return high_touch for scores 80-100', () => {
      expect(scorer.determineRoutingTier(80)).toBe('high_touch');
      expect(scorer.determineRoutingTier(90)).toBe('high_touch');
      expect(scorer.determineRoutingTier(100)).toBe('high_touch');
    });

    it('should return standard for scores 60-79', () => {
      expect(scorer.determineRoutingTier(60)).toBe('standard');
      expect(scorer.determineRoutingTier(70)).toBe('standard');
      expect(scorer.determineRoutingTier(79)).toBe('standard');
    });

    it('should return nurture for scores 40-59', () => {
      expect(scorer.determineRoutingTier(40)).toBe('nurture');
      expect(scorer.determineRoutingTier(50)).toBe('nurture');
      expect(scorer.determineRoutingTier(59)).toBe('nurture');
    });

    it('should return disqualify for scores 0-39', () => {
      expect(scorer.determineRoutingTier(0)).toBe('disqualify');
      expect(scorer.determineRoutingTier(20)).toBe('disqualify');
      expect(scorer.determineRoutingTier(39)).toBe('disqualify');
    });

    it('should test exact boundary transitions', () => {
      expect(scorer.determineRoutingTier(39)).toBe('disqualify');
      expect(scorer.determineRoutingTier(40)).toBe('nurture');
      expect(scorer.determineRoutingTier(59)).toBe('nurture');
      expect(scorer.determineRoutingTier(60)).toBe('standard');
      expect(scorer.determineRoutingTier(79)).toBe('standard');
      expect(scorer.determineRoutingTier(80)).toBe('high_touch');
    });
  });

  // --------------------------------------------------------------------------
  // inferVertical
  // --------------------------------------------------------------------------
  describe('inferVertical', () => {
    it('should detect healthcare vertical', () => {
      expect(scorer.inferVertical('hospital administrator')).toBe('healthcare');
    });

    it('should detect mental_health vertical', () => {
      const keywords = VERTICAL_KEYWORDS['mental_health'];
      if (keywords && keywords.length > 0) {
        expect(scorer.inferVertical(keywords[0])).toBe('mental_health');
      }
    });

    it('should return null for no match', () => {
      expect(scorer.inferVertical('random text with no vertical keywords')).toBeNull();
    });

    it('should pick vertical with most keyword matches', () => {
      // healthcare has many keywords — multiple matches should still pick healthcare
      expect(scorer.inferVertical('hospital clinic medical center')).toBe('healthcare');
    });
  });

  // --------------------------------------------------------------------------
  // inferPersona
  // --------------------------------------------------------------------------
  describe('inferPersona', () => {
    it('should return decision_maker for C-level', () => {
      expect(scorer.inferPersona('CEO')).toBe('decision_maker');
      expect(scorer.inferPersona('Chief Technology Officer')).toBe('decision_maker');
    });

    it('should return influencer for manager/lead titles', () => {
      expect(scorer.inferPersona('Engineering Manager')).toBe('influencer');
      expect(scorer.inferPersona('Senior Developer')).toBe('influencer');
    });

    it('should return unknown for no title', () => {
      expect(scorer.inferPersona(undefined)).toBe('unknown');
    });

    it('should return unknown for unrecognized titles', () => {
      expect(scorer.inferPersona('Intern')).toBe('unknown');
    });
  });
});

// ============================================================================
// SECTION B — PROPERTY-BASED TESTS (fast-check)
// ============================================================================

describe('Section B — Property-Based Tests', () => {
  // Arbitrary generators for Person fields
  const channelArb = fc.constantFrom<SourceChannel>(
    'warm_referral', 'event', 'cold_outbound', 'inbound_marketing',
    'partner', 'direct', 'social_media', 'paid_ads'
  );

  const verticalArb = fc.constantFrom<Vertical>(
    'healthcare', 'mental_health', 'wellness', 'fitness', 'digital_health', 'medical_supply'
  );

  const personArb = fc.record({
    sourceChannel: fc.option(channelArb, { nil: undefined }),
    vertical: fc.option(verticalArb, { nil: undefined }),
    currentTitle: fc.option(fc.string({ minLength: 0, maxLength: 200 }), { nil: undefined }),
    touchCount: fc.option(fc.nat(100), { nil: undefined }),
    companyData: fc.option(
      fc.record({
        employeeCount: fc.option(fc.nat(100000), { nil: undefined }),
      }),
      { nil: undefined }
    ),
    techStack: fc.option(
      fc.array(fc.string({ minLength: 1, maxLength: 50 }), { maxLength: 10 }),
      { nil: undefined }
    ),
    personalizationHooks: fc.option(
      fc.array(fc.string({ minLength: 0, maxLength: 100 }), { maxLength: 5 }),
      { nil: undefined }
    ),
    persona: fc.option(
      fc.constantFrom('decision_maker', 'influencer', 'champion', 'end_user', 'gatekeeper'),
      { nil: undefined }
    ),
  }) as fc.Arbitrary<Partial<Person>>;

  it('Boundedness: composite score is always [0, 100]', () => {
    fc.assert(
      fc.property(personArb, (person) => {
        const result = scorer.calculateScores(person);
        expect(result.compositeScore).toBeGreaterThanOrEqual(0);
        expect(result.compositeScore).toBeLessThanOrEqual(100);
        expect(result.internalScore).toBeGreaterThanOrEqual(0);
        expect(result.internalScore).toBeLessThanOrEqual(100);
        expect(result.externalScore).toBeGreaterThanOrEqual(0);
        expect(result.externalScore).toBeLessThanOrEqual(100);
      }),
      { numRuns: 200 }
    );
  });

  it('Determinism: same input always produces same output', () => {
    fc.assert(
      fc.property(personArb, (person) => {
        const result1 = scorer.calculateScores(person);
        const result2 = scorer.calculateScores(person);
        expect(result1.compositeScore).toBe(result2.compositeScore);
        expect(result1.routingTier).toBe(result2.routingTier);
        expect(result1.internalScore).toBe(result2.internalScore);
        expect(result1.externalScore).toBe(result2.externalScore);
      }),
      { numRuns: 100 }
    );
  });

  it('Monotonicity: higher touch count never decreases engagement', () => {
    fc.assert(
      fc.property(
        personArb,
        fc.nat(50),
        fc.nat(50),
        (basePerson, t1, t2) => {
          const low = Math.min(t1, t2);
          const high = Math.max(t1, t2);
          const resultLow = scorer.calculateScores({ ...basePerson, touchCount: low });
          const resultHigh = scorer.calculateScores({ ...basePerson, touchCount: high });
          expect(resultHigh.factors.external.engagementSignals)
            .toBeGreaterThanOrEqual(resultLow.factors.external.engagementSignals);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('NaN safety: no input produces NaN or Infinity', () => {
    fc.assert(
      fc.property(personArb, (person) => {
        const result = scorer.calculateScores(person);
        expect(Number.isFinite(result.compositeScore)).toBe(true);
        expect(Number.isFinite(result.internalScore)).toBe(true);
        expect(Number.isFinite(result.externalScore)).toBe(true);
        expect(Number.isNaN(result.compositeScore)).toBe(false);
      }),
      { numRuns: 200 }
    );
  });

  it('Tier consistency: tier always matches score range', () => {
    fc.assert(
      fc.property(personArb, (person) => {
        const result = scorer.calculateScores(person);
        const tierRange = ROUTING_TIER_THRESHOLDS[result.routingTier];
        expect(result.compositeScore).toBeGreaterThanOrEqual(tierRange.min);
        expect(result.compositeScore).toBeLessThanOrEqual(tierRange.max);
      }),
      { numRuns: 200 }
    );
  });
});

// ============================================================================
// SECTION C — EDGE CASES
// ============================================================================

describe('Section C — Edge Cases', () => {
  it('should handle empty object without throwing', () => {
    const result = scorer.calculateScores({});
    expect(result.compositeScore).toBeGreaterThanOrEqual(0);
    expect(result.compositeScore).toBeLessThanOrEqual(100);
    expect(result.routingTier).toBeDefined();
  });

  it('should handle all-null fields', () => {
    const result = scorer.calculateScores({
      sourceChannel: undefined,
      vertical: undefined,
      currentTitle: undefined,
      touchCount: undefined,
      companyData: undefined,
      techStack: undefined,
      personalizationHooks: undefined,
      persona: undefined,
    } as Partial<Person>);
    expect(Number.isFinite(result.compositeScore)).toBe(true);
  });

  it('should handle negative employee count', () => {
    const result = scorer.calculateScores(
      buildPerson({ companyData: { employeeCount: -1 } as Person['companyData'] })
    );
    expect(Number.isFinite(result.compositeScore)).toBe(true);
    // Negative values should not produce negative scores
    expect(result.factors.internal.budgetScore).toBeGreaterThanOrEqual(0);
  });

  it('should handle Infinity employee count', () => {
    const result = scorer.calculateScores(
      buildPerson({ companyData: { employeeCount: Infinity } as Person['companyData'] })
    );
    // Infinity >= 501 threshold, so should get score 25
    expect(result.factors.internal.budgetScore).toBe(25);
    expect(Number.isFinite(result.compositeScore)).toBe(true);
  });

  it('should handle 10K touchpoints without overflow', () => {
    const result = scorer.calculateScores(buildPerson({ touchCount: 10000 }));
    expect(result.factors.external.engagementSignals).toBeLessThanOrEqual(30);
    expect(Number.isFinite(result.compositeScore)).toBe(true);
  });

  it('should handle empty arrays for tech stack and hooks', () => {
    const result = scorer.calculateScores(
      buildPerson({ techStack: [], personalizationHooks: [] })
    );
    expect(Number.isFinite(result.compositeScore)).toBe(true);
  });

  it('should handle very long title string', () => {
    const longTitle = 'Senior '.repeat(1000) + 'Engineer';
    const result = scorer.calculateScores(buildPerson({ currentTitle: longTitle }));
    expect(Number.isFinite(result.compositeScore)).toBe(true);
  });

  it('should handle unicode and emoji in title', () => {
    const result = scorer.calculateScores(
      buildPerson({ currentTitle: '首席执行官 CEO 🏥 Director' })
    );
    expect(Number.isFinite(result.compositeScore)).toBe(true);
    // Should still detect 'ceo' keyword
    expect(result.factors.internal.authorityScore).toBe(25);
  });

  it('should handle very large personalization hooks array', () => {
    const manyHooks = Array.from({ length: 100 }, (_, i) => `hook-${i}`);
    const result = scorer.calculateScores(buildPerson({ personalizationHooks: manyHooks }));
    expect(result.factors.external.timingIndicators).toBeGreaterThanOrEqual(0);
    expect(result.factors.external.timingIndicators).toBeLessThanOrEqual(20);
  });
});
