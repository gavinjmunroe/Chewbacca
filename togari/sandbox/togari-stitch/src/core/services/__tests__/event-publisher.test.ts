import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock Pub/Sub to prevent real connections
vi.mock('@google-cloud/pubsub', () => ({
  PubSub: vi.fn().mockImplementation(() => ({
    topic: vi.fn().mockReturnValue({
      publishMessage: vi.fn().mockResolvedValue('msg-id'),
    }),
  })),
}));

// Mock tenant middleware
vi.mock('../../middleware/tenant', () => ({
  getCurrentTenant: vi.fn().mockReturnValue({
    tenantId: 'org-test',
    userId: 'usr-test',
    tier: 'pro',
  }),
}));

import {
  publishEntityEvent,
  publishScoringEvent,
  publishEnrichmentEvent,
  type EventType,
} from '../event-publisher';

describe('event-publisher', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // =========================================================================
  // publishEntityEvent()
  // =========================================================================

  describe('publishEntityEvent()', () => {
    it('does not throw (fire-and-forget)', () => {
      expect(() => {
        publishEntityEvent('person_created', 'person', 'p123', { vertical: 'healthcare' });
      }).not.toThrow();
    });

    it('accepts all valid event types', () => {
      const types: EventType[] = [
        'person_created', 'person_updated', 'person_scored',
        'person_enriched', 'company_enriched', 'campaign_created',
        'touchpoint_logged', 'file_uploaded', 'file_processed',
        'scoring_tier_changed', 'rate_limit_hit',
      ];
      for (const type of types) {
        expect(() => publishEntityEvent(type, 'test', 'id', {})).not.toThrow();
      }
    });

    it('accepts empty payload', () => {
      expect(() => publishEntityEvent('person_created', 'person', 'p123')).not.toThrow();
    });
  });

  // =========================================================================
  // publishScoringEvent()
  // =========================================================================

  describe('publishScoringEvent()', () => {
    it('does not throw', () => {
      expect(() => {
        publishScoringEvent(
          'person-123',
          { composite: 85, internal: 40, external: 45 },
          'high_touch',
          { channel: 10, authority: 15 },
        );
      }).not.toThrow();
    });

    it('works with empty factors', () => {
      expect(() => {
        publishScoringEvent('p1', { composite: 50, internal: 25, external: 25 }, 'standard');
      }).not.toThrow();
    });
  });

  // =========================================================================
  // publishEnrichmentEvent()
  // =========================================================================

  describe('publishEnrichmentEvent()', () => {
    it('does not throw for person enrichment', () => {
      expect(() => {
        publishEnrichmentEvent('john@test.com', 'person', 'exa', { fields: 3 });
      }).not.toThrow();
    });

    it('does not throw for company enrichment', () => {
      expect(() => {
        publishEnrichmentEvent('acme.com', 'company', 'clay', {}, 0.05);
      }).not.toThrow();
    });

    it('handles missing cost', () => {
      expect(() => {
        publishEnrichmentEvent('domain.com', 'company', 'exa');
      }).not.toThrow();
    });
  });
});
