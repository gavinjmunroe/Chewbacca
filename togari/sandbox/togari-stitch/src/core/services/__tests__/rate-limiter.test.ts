import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RateLimitError } from '../../errors/types';

// Mock ioredis to prevent real Redis connections
vi.mock('ioredis', () => {
  return {
    default: vi.fn().mockImplementation(() => ({
      connect: vi.fn().mockRejectedValue(new Error('mock: no Redis')),
      disconnect: vi.fn(),
    })),
  };
});

import {
  getOperationForTool,
  checkTenantLimit,
  checkConnectorLimit,
  initRedis,
} from '../rate-limiter';

describe('rate-limiter', () => {
  // =========================================================================
  // getOperationForTool()
  // =========================================================================

  describe('getOperationForTool()', () => {
    it('maps enrich_contact → enrichment', () => {
      expect(getOperationForTool('enrich_contact')).toBe('enrichment');
    });

    it('maps enrich_company → enrichment', () => {
      expect(getOperationForTool('enrich_company')).toBe('enrichment');
    });

    it('maps normalize_data → enrichment', () => {
      expect(getOperationForTool('normalize_data')).toBe('enrichment');
    });

    it('maps search_patients → search', () => {
      expect(getOperationForTool('search_patients')).toBe('search');
    });

    it('maps query_data → search', () => {
      expect(getOperationForTool('query_data')).toBe('search');
    });

    it('maps search_web → search', () => {
      expect(getOperationForTool('search_web')).toBe('search');
    });

    it('maps upload_file → upload', () => {
      expect(getOperationForTool('upload_file')).toBe('upload');
    });

    it('maps process_file → upload', () => {
      expect(getOperationForTool('process_file')).toBe('upload');
    });

    it('returns undefined for health_check (no rate limit)', () => {
      expect(getOperationForTool('health_check')).toBeUndefined();
    });

    it('returns undefined for score_lead (no rate limit)', () => {
      expect(getOperationForTool('score_lead')).toBeUndefined();
    });

    it('returns undefined for create_patient (CRUD, not rate limited by operation)', () => {
      expect(getOperationForTool('create_patient')).toBeUndefined();
    });

    it('returns undefined for unknown tool', () => {
      expect(getOperationForTool('nonexistent_tool')).toBeUndefined();
    });
  });

  // =========================================================================
  // checkTenantLimit() — in-memory fallback (no Redis)
  // =========================================================================

  describe('checkTenantLimit() — memory fallback', () => {
    it('allows calls within free tier enrichment limit', async () => {
      // Free tier: 100 enrichments/day — a single call should pass
      await expect(
        checkTenantLimit('tenant-limit-1', 'free', 'enrich_contact')
      ).resolves.toBeUndefined();
    });

    it('skips check for tools without operations', async () => {
      // health_check has no operation mapping — should pass
      await expect(
        checkTenantLimit('tenant-skip', 'free', 'health_check')
      ).resolves.toBeUndefined();
    });

    it('skips check for score_lead', async () => {
      await expect(
        checkTenantLimit('tenant-skip-2', 'free', 'score_lead')
      ).resolves.toBeUndefined();
    });

    it('blocks when free tier upload limit exceeded', async () => {
      const tenantId = `tenant-upload-limit-${Date.now()}`;
      // Free tier: 5 uploads/day
      for (let i = 0; i < 5; i++) {
        await checkTenantLimit(tenantId, 'free', 'upload_file');
      }
      // 6th should throw
      await expect(
        checkTenantLimit(tenantId, 'free', 'upload_file')
      ).rejects.toThrow(RateLimitError);
    });

    it('RateLimitError has 429 status code', async () => {
      const tenantId = `tenant-429-${Date.now()}`;
      for (let i = 0; i < 5; i++) {
        await checkTenantLimit(tenantId, 'free', 'upload_file');
      }
      try {
        await checkTenantLimit(tenantId, 'free', 'upload_file');
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(RateLimitError);
        expect((error as RateLimitError).statusCode).toBe(429);
        expect((error as RateLimitError).isRetryable).toBe(true);
      }
    });

    it('different tenants have independent limits', async () => {
      const tenantA = `tenant-a-${Date.now()}`;
      const tenantB = `tenant-b-${Date.now()}`;
      // Exhaust tenant A's upload limit
      for (let i = 0; i < 5; i++) {
        await checkTenantLimit(tenantA, 'free', 'upload_file');
      }
      // Tenant B should still be able to upload
      await expect(
        checkTenantLimit(tenantB, 'free', 'upload_file')
      ).resolves.toBeUndefined();
    });

    it('pro tier has higher limits than free', async () => {
      const tenantId = `tenant-pro-${Date.now()}`;
      // Pro tier: 50 uploads/day — 6 should pass (would fail on free)
      for (let i = 0; i < 6; i++) {
        await checkTenantLimit(tenantId, 'pro', 'upload_file');
      }
      // Should still pass — well within 50 limit
      await expect(
        checkTenantLimit(tenantId, 'pro', 'upload_file')
      ).resolves.toBeUndefined();
    });
  });

  // =========================================================================
  // checkConnectorLimit()
  // =========================================================================

  describe('checkConnectorLimit()', () => {
    it('allows calls within connector limit', async () => {
      await expect(checkConnectorLimit('search_patients')).resolves.toBeUndefined();
    });

    it('skips check for tools without connector mapping', async () => {
      await expect(checkConnectorLimit('health_check')).resolves.toBeUndefined();
    });

    it('skips check for upload_file (no connector)', async () => {
      await expect(checkConnectorLimit('upload_file')).resolves.toBeUndefined();
    });
  });

  // =========================================================================
  // initRedis()
  // =========================================================================

  describe('initRedis()', () => {
    it('falls back gracefully when Redis is unavailable', async () => {
      // The mock rejects connect() — should not throw
      await expect(initRedis('redis://fake:6379')).resolves.toBeUndefined();
    });
  });
});
