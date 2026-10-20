/**
 * @togari/core/services/scoring
 * Lead scoring service for calculating internal, external, and composite scores
 */

import type {
  Person,
  RoutingTier,
  SourceChannel,
  InternalScoringFactors,
  ExternalScoringFactors,
  Vertical,
} from '../../types';
import {
  CHANNEL_SCORES,
  BUDGET_SCORE_THRESHOLDS,
  ROUTING_TIER_THRESHOLDS,
  COMPOSITE_SCORE_WEIGHTS,
  DECISION_MAKER_TITLES,
  INFLUENCER_TITLES,
  AUTHORITY_SCORES,
  GTM_MATURITY_INDICATORS,
  GTM_MATURITY_SCORES,
  VERTICAL_KEYWORDS,
} from '../../constants';
import { createLogger } from '../../utils/logger';

const logger = createLogger('ScoringService');

// ============================================================================
// SCORING CALCULATOR
// ============================================================================

export class ScoringService {
  /**
   * Calculate the full scoring breakdown for a person
   */
  calculateScores(person: Partial<Person>): {
    internalScore: number;
    externalScore: number;
    compositeScore: number;
    routingTier: RoutingTier;
    factors: {
      internal: InternalScoringFactors;
      external: ExternalScoringFactors;
    };
  } {
    const internalFactors = this.calculateInternalFactors(person);
    const externalFactors = this.calculateExternalFactors(person);

    const internalScore = this.sumInternalFactors(internalFactors);
    const externalScore = this.sumExternalFactors(externalFactors);
    const compositeScore = this.calculateCompositeScore(internalScore, externalScore);
    const routingTier = this.determineRoutingTier(compositeScore);

    logger.debug('Calculated scores', {
      personId: person.personId,
      internalScore,
      externalScore,
      compositeScore,
      routingTier,
    });

    return {
      internalScore,
      externalScore,
      compositeScore,
      routingTier,
      factors: {
        internal: internalFactors,
        external: externalFactors,
      },
    };
  }

  /**
   * Calculate internal scoring factors (0-25 each, 0-100 total)
   */
  calculateInternalFactors(person: Partial<Person>): InternalScoringFactors {
    return {
      channelScore: this.calculateChannelScore(person.sourceChannel),
      budgetScore: this.calculateBudgetScore(person.companyData?.employeeCount),
      authorityScore: this.calculateAuthorityScore(person.currentTitle, person.persona),
      gtmMaturityScore: this.calculateGtmMaturityScore(person.techStack),
    };
  }

  /**
   * Calculate external scoring factors (0-100 total)
   */
  calculateExternalFactors(person: Partial<Person>): ExternalScoringFactors {
    return {
      verticalFit: this.calculateVerticalFit(person),
      engagementSignals: this.calculateEngagementSignals(person),
      timingIndicators: this.calculateTimingIndicators(person),
    };
  }

  /**
   * Calculate channel score based on source channel (0-25)
   */
  private calculateChannelScore(channel?: SourceChannel): number {
    if (!channel) return 10; // Default middle score
    return CHANNEL_SCORES[channel] || 10;
  }

  /**
   * Calculate budget score based on employee count (0-25)
   */
  private calculateBudgetScore(employeeCount?: number): number {
    if (!employeeCount) return 10; // Default middle score

    for (const threshold of BUDGET_SCORE_THRESHOLDS) {
      if (employeeCount >= threshold.minEmployees && employeeCount <= threshold.maxEmployees) {
        return threshold.score;
      }
    }
    return 10;
  }

  /**
   * Calculate authority score based on title and persona (0-25)
   */
  private calculateAuthorityScore(title?: string, persona?: string): number {
    // If persona is directly set, use it
    if (persona && persona in AUTHORITY_SCORES) {
      return AUTHORITY_SCORES[persona as keyof typeof AUTHORITY_SCORES];
    }

    // Otherwise, infer from title
    if (!title) return AUTHORITY_SCORES.unknown;

    const normalizedTitle = title.toLowerCase();

    // Check for decision maker keywords
    for (const keyword of DECISION_MAKER_TITLES) {
      if (normalizedTitle.includes(keyword)) {
        return AUTHORITY_SCORES.decision_maker;
      }
    }

    // Check for influencer keywords
    for (const keyword of INFLUENCER_TITLES) {
      if (normalizedTitle.includes(keyword)) {
        return AUTHORITY_SCORES.influencer;
      }
    }

    return AUTHORITY_SCORES.unknown;
  }

  /**
   * Calculate GTM maturity score based on tech stack (0-25)
   */
  private calculateGtmMaturityScore(techStack?: string[]): number {
    if (!techStack || techStack.length === 0) return GTM_MATURITY_SCORES.unknown;

    const normalizedStack = techStack.map(t => t.toLowerCase());

    // Check for high maturity indicators
    for (const tool of GTM_MATURITY_INDICATORS.highMaturity) {
      if (normalizedStack.some(t => t.includes(tool))) {
        return GTM_MATURITY_SCORES.high;
      }
    }

    // Check for medium maturity indicators
    for (const tool of GTM_MATURITY_INDICATORS.mediumMaturity) {
      if (normalizedStack.some(t => t.includes(tool))) {
        return GTM_MATURITY_SCORES.medium;
      }
    }

    // Check for low maturity indicators
    for (const tool of GTM_MATURITY_INDICATORS.lowMaturity) {
      if (normalizedStack.some(t => t.includes(tool))) {
        return GTM_MATURITY_SCORES.low;
      }
    }

    return GTM_MATURITY_SCORES.unknown;
  }

  /**
   * Calculate vertical fit score (0-50)
   */
  private calculateVerticalFit(person: Partial<Person>): number {
    if (!person.vertical) return 25; // Middle score

    // Check if company/title match the vertical keywords
    const textToCheck = [
      person.currentTitle || '',
      person.currentCompany || '',
      person.linkedinHeadline || '',
      person.companyData?.industry || '',
    ].join(' ').toLowerCase();

    const verticalKeywords = VERTICAL_KEYWORDS[person.vertical];
    if (!verticalKeywords) return 25;

    let matchCount = 0;
    for (const keyword of verticalKeywords) {
      if (textToCheck.includes(keyword)) {
        matchCount++;
      }
    }

    // Score based on keyword matches (0-50)
    if (matchCount >= 3) return 50;
    if (matchCount >= 2) return 40;
    if (matchCount >= 1) return 30;
    return 20;
  }

  /**
   * Calculate engagement signals (0-30)
   */
  private calculateEngagementSignals(person: Partial<Person>): number {
    let score = 15; // Base score

    // Touch count indicates engagement
    if (person.touchCount) {
      if (person.touchCount >= 5) score += 10;
      else if (person.touchCount >= 3) score += 7;
      else if (person.touchCount >= 1) score += 3;
    }

    // Recent contact is positive
    if (person.lastContactedAt) {
      const daysSinceContact = Math.floor(
        (Date.now() - new Date(person.lastContactedAt).getTime()) / (1000 * 60 * 60 * 24)
      );
      if (daysSinceContact <= 7) score += 5;
      else if (daysSinceContact <= 30) score += 2;
    }

    return Math.min(score, 30);
  }

  /**
   * Calculate timing indicators (0-20)
   */
  private calculateTimingIndicators(person: Partial<Person>): number {
    let score = 10; // Base score

    // Check for timing signals in personalization hooks
    if (person.personalizationHooks) {
      const hooks = person.personalizationHooks.join(' ').toLowerCase();

      // Positive timing signals
      const positiveSignals = ['hiring', 'expanding', 'new role', 'funding', 'growth', 'launch'];
      for (const signal of positiveSignals) {
        if (hooks.includes(signal)) {
          score += 3;
        }
      }

      // Negative timing signals
      const negativeSignals = ['layoff', 'downsizing', 'restructuring'];
      for (const signal of negativeSignals) {
        if (hooks.includes(signal)) {
          score -= 5;
        }
      }
    }

    return Math.max(0, Math.min(score, 20));
  }

  /**
   * Sum internal factors to get internal score (0-100)
   */
  private sumInternalFactors(factors: InternalScoringFactors): number {
    return Math.min(
      100,
      factors.channelScore +
        factors.budgetScore +
        factors.authorityScore +
        factors.gtmMaturityScore
    );
  }

  /**
   * Sum external factors to get external score (0-100)
   */
  private sumExternalFactors(factors: ExternalScoringFactors): number {
    return Math.min(
      100,
      factors.verticalFit + factors.engagementSignals + factors.timingIndicators
    );
  }

  /**
   * Calculate composite score from internal and external (0-100)
   */
  private calculateCompositeScore(internalScore: number, externalScore: number): number {
    const weighted =
      internalScore * COMPOSITE_SCORE_WEIGHTS.internalWeight +
      externalScore * COMPOSITE_SCORE_WEIGHTS.externalWeight;
    return Math.round(weighted);
  }

  /**
   * Determine routing tier based on composite score
   */
  determineRoutingTier(compositeScore: number): RoutingTier {
    for (const [tier, range] of Object.entries(ROUTING_TIER_THRESHOLDS)) {
      if (compositeScore >= range.min && compositeScore <= range.max) {
        return tier as RoutingTier;
      }
    }
    return 'nurture'; // Default fallback
  }

  /**
   * Infer vertical from text content
   */
  inferVertical(text: string): Vertical | null {
    const normalizedText = text.toLowerCase();
    let bestMatch: { vertical: Vertical; count: number } | null = null;

    for (const [vertical, keywords] of Object.entries(VERTICAL_KEYWORDS)) {
      let count = 0;
      for (const keyword of keywords) {
        if (normalizedText.includes(keyword)) {
          count++;
        }
      }
      if (count > 0 && (!bestMatch || count > bestMatch.count)) {
        bestMatch = { vertical: vertical as Vertical, count };
      }
    }

    return bestMatch?.vertical || null;
  }

  /**
   * Infer persona from title
   */
  inferPersona(title?: string): 'decision_maker' | 'influencer' | 'unknown' {
    if (!title) return 'unknown';

    const normalizedTitle = title.toLowerCase();

    for (const keyword of DECISION_MAKER_TITLES) {
      if (normalizedTitle.includes(keyword)) {
        return 'decision_maker';
      }
    }

    for (const keyword of INFLUENCER_TITLES) {
      if (normalizedTitle.includes(keyword)) {
        return 'influencer';
      }
    }

    return 'unknown';
  }
}

// Export singleton instance
export const scoringService = new ScoringService();

// Export types
export type { InternalScoringFactors, ExternalScoringFactors };
