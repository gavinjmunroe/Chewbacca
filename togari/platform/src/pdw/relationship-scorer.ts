/**
 * @togari/admin — Relationship Scorer
 *
 * Computes a 0-100 composite score for relationship strength between two persons
 * using frequency, recency, channel diversity, bi-directionality, and duration.
 */

import { createLogger } from '../observability/logger';
import type { Interaction } from './types';

const logger = createLogger('RelationshipScorer');

/** Half-life for exponential recency decay (in days) */
const RECENCY_HALF_LIFE_DAYS = 30;

/** Weight configuration for composite score */
const WEIGHTS = {
  frequency: 0.30,
  channelDiversity: 0.15,
  bidirectionality: 0.15,
  recency: 0.25,
  duration: 0.15,
};

export interface RelationshipScoreInput {
  interactions: Interaction[];
  /** Current timestamp for recency calculations (defaults to now) */
  now?: Date;
}

export interface RelationshipScoreBreakdown {
  composite: number;       // 0-100 final score
  frequency: number;       // 0-100
  channelDiversity: number;// 0-100
  bidirectionality: number;// 0-100
  recency: number;         // 0-100
  duration: number;        // 0-100
  totalInteractions: number;
  uniqueChannels: string[];
  daysSinceLastInteraction: number;
  monthsSinceFirstInteraction: number;
}

/**
 * Compute the relationship strength score between two persons based on their interactions.
 */
export function scoreRelationship(input: RelationshipScoreInput): RelationshipScoreBreakdown {
  const { interactions } = input;
  const now = input.now ?? new Date();

  if (interactions.length === 0) {
    return {
      composite: 0,
      frequency: 0,
      channelDiversity: 0,
      bidirectionality: 0,
      recency: 0,
      duration: 0,
      totalInteractions: 0,
      uniqueChannels: [],
      daysSinceLastInteraction: Infinity,
      monthsSinceFirstInteraction: 0,
    };
  }

  // Parse timestamps once
  const timestamps = interactions.map((i) => new Date(i.occurred_at).getTime());
  const earliest = Math.min(...timestamps);
  const latest = Math.max(...timestamps);
  const nowMs = now.getTime();

  // -----------------------------------------------------------------------
  // 1. Frequency score: interactions per week, weighted by recency (exponential decay)
  // -----------------------------------------------------------------------
  const halfLifeMs = RECENCY_HALF_LIFE_DAYS * 24 * 60 * 60 * 1000;
  let weightedCount = 0;
  for (const ts of timestamps) {
    const ageMs = nowMs - ts;
    const decay = Math.pow(0.5, ageMs / halfLifeMs);
    weightedCount += decay;
  }
  // Normalize: 10 recent-weighted interactions/month maps to ~100
  const frequencyRaw = (weightedCount / 10) * 100;
  const frequency = Math.min(100, Math.max(0, frequencyRaw));

  // -----------------------------------------------------------------------
  // 2. Channel diversity: bonus for multi-channel communication
  // -----------------------------------------------------------------------
  const channels = new Set(interactions.map((i) => i.channel));
  // 1 channel = 25, 2 = 50, 3 = 75, 4+ = 100
  const channelDiversity = Math.min(100, channels.size * 25);

  // -----------------------------------------------------------------------
  // 3. Bi-directionality: bonus for two-way communication
  // -----------------------------------------------------------------------
  const directions = new Set(interactions.map((i) => i.direction));
  const hasInbound = directions.has('inbound');
  const hasOutbound = directions.has('outbound');
  const hasBilateral = directions.has('bilateral');
  let bidirectionality = 0;
  if (hasBilateral || (hasInbound && hasOutbound)) {
    // Full bi-directional: count ratio balance
    const inboundCount = interactions.filter(
      (i) => i.direction === 'inbound' || i.direction === 'bilateral',
    ).length;
    const outboundCount = interactions.filter(
      (i) => i.direction === 'outbound' || i.direction === 'bilateral',
    ).length;
    const total = inboundCount + outboundCount;
    const ratio = total > 0 ? Math.min(inboundCount, outboundCount) / Math.max(inboundCount, outboundCount) : 0;
    bidirectionality = 50 + ratio * 50; // 50-100 for two-way
  } else if (hasInbound || hasOutbound) {
    bidirectionality = 25; // One-way communication
  }

  // -----------------------------------------------------------------------
  // 4. Recency: days since last interaction (exponential decay)
  // -----------------------------------------------------------------------
  const daysSinceLast = (nowMs - latest) / (24 * 60 * 60 * 1000);
  // 0 days = 100, 30 days = 50, 60 days = 25, etc.
  const recency = Math.pow(0.5, daysSinceLast / RECENCY_HALF_LIFE_DAYS) * 100;

  // -----------------------------------------------------------------------
  // 5. Duration: months since first interaction (logarithmic growth)
  // -----------------------------------------------------------------------
  const monthsSinceFirst = (nowMs - earliest) / (30 * 24 * 60 * 60 * 1000);
  // ln(1 + months) * 25, capped at 100
  // 1 month ~ 17, 3 months ~ 35, 12 months ~ 64, 48 months ~ 97
  const durationRaw = Math.log(1 + monthsSinceFirst) * 25;
  const duration = Math.min(100, Math.max(0, durationRaw));

  // -----------------------------------------------------------------------
  // Composite
  // -----------------------------------------------------------------------
  const composite = Math.round(
    frequency * WEIGHTS.frequency +
      channelDiversity * WEIGHTS.channelDiversity +
      bidirectionality * WEIGHTS.bidirectionality +
      recency * WEIGHTS.recency +
      duration * WEIGHTS.duration,
  );

  return {
    composite: Math.min(100, Math.max(0, composite)),
    frequency: Math.round(frequency),
    channelDiversity: Math.round(channelDiversity),
    bidirectionality: Math.round(bidirectionality),
    recency: Math.round(recency),
    duration: Math.round(duration),
    totalInteractions: interactions.length,
    uniqueChannels: Array.from(channels),
    daysSinceLastInteraction: Math.round(daysSinceLast),
    monthsSinceFirstInteraction: Math.round(monthsSinceFirst),
  };
}
