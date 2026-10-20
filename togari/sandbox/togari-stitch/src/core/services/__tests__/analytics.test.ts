import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock BigQuery to prevent real connections
const mockQuery = vi.fn().mockResolvedValue([[]]);
vi.mock('@google-cloud/bigquery', () => {
  return {
    BigQuery: class MockBigQuery {
      query = mockQuery;
    },
  };
});

import {
  leadFunnel,
  scoringDistribution,
  enrichmentCoverage,
  touchpointAnalysis,
  verticalBreakdown,
  scoringTrend,
} from '../analytics';

describe('analytics', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQuery.mockResolvedValue([[]]);
  });

  // =========================================================================
  // Query parameterization safety
  // =========================================================================

  describe('parameterized queries', () => {
    it('leadFunnel passes clientId as parameter', async () => {
      await leadFunnel('org-123');
      expect(mockQuery).toHaveBeenCalledWith(
        expect.objectContaining({
          params: expect.objectContaining({ clientId: 'org-123' }),
        })
      );
    });

    it('scoringDistribution passes clientId as parameter', async () => {
      await scoringDistribution('org-456');
      expect(mockQuery).toHaveBeenCalledWith(
        expect.objectContaining({
          params: expect.objectContaining({ clientId: 'org-456' }),
        })
      );
    });

    it('enrichmentCoverage passes clientId as parameter', async () => {
      await enrichmentCoverage('org-789');
      expect(mockQuery).toHaveBeenCalledWith(
        expect.objectContaining({
          params: expect.objectContaining({ clientId: 'org-789' }),
        })
      );
    });

    it('touchpointAnalysis passes clientId as parameter', async () => {
      await touchpointAnalysis('org-abc');
      expect(mockQuery).toHaveBeenCalledWith(
        expect.objectContaining({
          params: expect.objectContaining({ clientId: 'org-abc' }),
        })
      );
    });

    it('verticalBreakdown passes clientId as parameter', async () => {
      await verticalBreakdown('org-def');
      expect(mockQuery).toHaveBeenCalledWith(
        expect.objectContaining({
          params: expect.objectContaining({ clientId: 'org-def' }),
        })
      );
    });

    it('scoringTrend passes clientId and personId as parameters', async () => {
      await scoringTrend('org-ghi', 'person-1', 10);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.objectContaining({
          params: expect.objectContaining({
            clientId: 'org-ghi',
            personId: 'person-1',
            limit: 10,
          }),
        })
      );
    });
  });

  // =========================================================================
  // SQL contains @clientId (not string interpolation)
  // =========================================================================

  describe('SQL safety', () => {
    it('all queries contain @clientId parameter marker', async () => {
      const fns = [
        () => leadFunnel('t'),
        () => scoringDistribution('t'),
        () => enrichmentCoverage('t'),
        () => touchpointAnalysis('t'),
        () => verticalBreakdown('t'),
        () => scoringTrend('t', 'p'),
      ];

      for (const fn of fns) {
        mockQuery.mockResolvedValueOnce([[]]);
        await fn();
        const sql = mockQuery.mock.calls[mockQuery.mock.calls.length - 1][0].query;
        expect(sql).toContain('@clientId');
      }
    });

    it('no query contains string-interpolated clientId', async () => {
      const fns = [
        () => leadFunnel('INJECTED'),
        () => scoringDistribution('INJECTED'),
        () => enrichmentCoverage('INJECTED'),
        () => touchpointAnalysis('INJECTED'),
        () => verticalBreakdown('INJECTED'),
        () => scoringTrend('INJECTED', 'p'),
      ];

      for (const fn of fns) {
        mockQuery.mockResolvedValueOnce([[]]);
        await fn();
        const sql = mockQuery.mock.calls[mockQuery.mock.calls.length - 1][0].query;
        expect(sql).not.toContain('INJECTED');
      }
    });
  });

  // =========================================================================
  // Time range filtering
  // =========================================================================

  describe('time range filtering', () => {
    it('leadFunnel includes time range when provided', async () => {
      await leadFunnel('t', { start: '2026-01-01', end: '2026-03-31' });
      const call = mockQuery.mock.calls[0][0];
      expect(call.query).toContain('@startDate');
      expect(call.query).toContain('@endDate');
      expect(call.params.startDate).toBe('2026-01-01');
      expect(call.params.endDate).toBe('2026-03-31');
    });

    it('leadFunnel omits time range when not provided', async () => {
      await leadFunnel('t');
      const call = mockQuery.mock.calls[0][0];
      expect(call.query).not.toContain('@startDate');
    });
  });

  // =========================================================================
  // Return value handling
  // =========================================================================

  describe('return values', () => {
    it('leadFunnel returns rows from BigQuery', async () => {
      mockQuery.mockResolvedValueOnce([[
        { stage: 'new', count: 50, avg_score: 45.2 },
        { stage: 'engaged', count: 20, avg_score: 72.1 },
      ]]);
      const result = await leadFunnel('t');
      expect(result).toHaveLength(2);
      expect(result[0].stage).toBe('new');
      expect(result[0].count).toBe(50);
    });

    it('touchpointAnalysis transforms sentiment into breakdown object', async () => {
      mockQuery.mockResolvedValueOnce([[
        { type: 'email', count: 100, positive: 60, neutral: 30, negative: 10 },
      ]]);
      const result = await touchpointAnalysis('t');
      expect(result[0].sentiment_breakdown).toEqual({
        positive: 60,
        neutral: 30,
        negative: 10,
      });
    });

    it('scoringTrend defaults limit to 20', async () => {
      await scoringTrend('t', 'p');
      expect(mockQuery.mock.calls[0][0].params.limit).toBe(20);
    });

    it('returns empty array when no data', async () => {
      mockQuery.mockResolvedValueOnce([[]]);
      const result = await verticalBreakdown('t');
      expect(result).toEqual([]);
    });
  });
});
