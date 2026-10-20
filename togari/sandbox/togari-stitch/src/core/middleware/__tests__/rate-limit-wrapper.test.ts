import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RateLimitError } from '../../errors/types';

// Mock tenant middleware
vi.mock('../tenant', () => ({
  getCurrentTenant: vi.fn(),
}));

// Mock rate limiter service
vi.mock('../../services/rate-limiter', () => ({
  checkTenantLimit: vi.fn(),
  checkConnectorLimit: vi.fn(),
}));

import { withRateLimit } from '../rate-limit-wrapper';
import { getCurrentTenant } from '../tenant';
import { checkTenantLimit, checkConnectorLimit } from '../../services/rate-limiter';

type ToolResult = {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
};

describe('withRateLimit', () => {
  const successResult: ToolResult = {
    content: [{ type: 'text', text: 'ok' }],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getCurrentTenant).mockReturnValue({
      tenantId: 'org-rl-test',
      userId: 'usr-rl-test',
      tier: 'pro',
    });
    vi.mocked(checkTenantLimit).mockResolvedValue(undefined);
    vi.mocked(checkConnectorLimit).mockResolvedValue(undefined);
  });

  // =========================================================================
  // Normal flow
  // =========================================================================

  describe('normal flow', () => {
    it('calls handler and returns result when limits pass', async () => {
      const handler = vi.fn().mockResolvedValue(successResult);
      const wrapped = withRateLimit('search_patients', handler);
      const result = await wrapped({ query: 'test' });
      expect(handler).toHaveBeenCalledWith({ query: 'test' });
      expect(result).toBe(successResult);
    });

    it('checks tenant limit before connector limit before handler', async () => {
      const callOrder: string[] = [];
      vi.mocked(checkTenantLimit).mockImplementation(async () => { callOrder.push('tenant'); });
      vi.mocked(checkConnectorLimit).mockImplementation(async () => { callOrder.push('connector'); });
      const handler = vi.fn().mockImplementation(async () => { callOrder.push('handler'); return successResult; });

      const wrapped = withRateLimit('search_patients', handler);
      await wrapped({});
      expect(callOrder).toEqual(['tenant', 'connector', 'handler']);
    });

    it('passes correct toolName to checkTenantLimit', async () => {
      const handler = vi.fn().mockResolvedValue(successResult);
      const wrapped = withRateLimit('enrich_contact', handler);
      await wrapped({});
      expect(checkTenantLimit).toHaveBeenCalledWith('org-rl-test', 'pro', 'enrich_contact');
    });

    it('passes correct toolName to checkConnectorLimit', async () => {
      const handler = vi.fn().mockResolvedValue(successResult);
      const wrapped = withRateLimit('search_patients', handler);
      await wrapped({});
      expect(checkConnectorLimit).toHaveBeenCalledWith('search_patients');
    });
  });

  // =========================================================================
  // Rate limit exceeded
  // =========================================================================

  describe('rate limit exceeded', () => {
    it('propagates RateLimitError from tenant check (handler NOT called)', async () => {
      const error = new RateLimitError(60, 'free tier enrichment');
      vi.mocked(checkTenantLimit).mockRejectedValue(error);
      const handler = vi.fn().mockResolvedValue(successResult);

      const wrapped = withRateLimit('enrich_contact', handler);
      await expect(wrapped({})).rejects.toBe(error);
      expect(handler).not.toHaveBeenCalled();
    });

    it('propagates error from connector check (handler NOT called)', async () => {
      const error = new RateLimitError(5, 'exa per-minute limit');
      vi.mocked(checkConnectorLimit).mockRejectedValue(error);
      const handler = vi.fn().mockResolvedValue(successResult);

      const wrapped = withRateLimit('search_web', handler);
      await expect(wrapped({})).rejects.toBe(error);
      expect(handler).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // Tenant context handling
  // =========================================================================

  describe('tenant context', () => {
    it('uses tenant tier from getCurrentTenant', async () => {
      vi.mocked(getCurrentTenant).mockReturnValue({
        tenantId: 'org-enterprise',
        tier: 'enterprise',
      });
      const handler = vi.fn().mockResolvedValue(successResult);
      const wrapped = withRateLimit('enrich_contact', handler);
      await wrapped({});
      expect(checkTenantLimit).toHaveBeenCalledWith('org-enterprise', 'enterprise', 'enrich_contact');
    });

    it('defaults to free tier when tenant has no tier', async () => {
      vi.mocked(getCurrentTenant).mockReturnValue({
        tenantId: 'org-no-tier',
        tier: undefined as any,
      });
      const handler = vi.fn().mockResolvedValue(successResult);
      const wrapped = withRateLimit('enrich_contact', handler);
      await wrapped({});
      expect(checkTenantLimit).toHaveBeenCalledWith('org-no-tier', 'free', 'enrich_contact');
    });

    it('skips tenant limit when getCurrentTenant throws', async () => {
      vi.mocked(getCurrentTenant).mockImplementation(() => {
        throw new Error('no tenant context');
      });
      const handler = vi.fn().mockResolvedValue(successResult);
      const wrapped = withRateLimit('health_check', handler);
      await wrapped({});
      // checkTenantLimit should NOT be called (tenantId is 'unknown')
      expect(checkTenantLimit).not.toHaveBeenCalled();
      // But handler should still execute
      expect(handler).toHaveBeenCalled();
    });

    it('still checks connector limit when tenant context is missing', async () => {
      vi.mocked(getCurrentTenant).mockImplementation(() => {
        throw new Error('no tenant');
      });
      const handler = vi.fn().mockResolvedValue(successResult);
      const wrapped = withRateLimit('search_web', handler);
      await wrapped({});
      expect(checkConnectorLimit).toHaveBeenCalledWith('search_web');
    });
  });
});
