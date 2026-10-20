import { describe, it, expect, vi, beforeEach } from 'vitest';
import { withAuditLog } from '../audit-wrapper';
import { AppError, RateLimitError } from '../../errors/types';

// Mock tenant middleware
vi.mock('../tenant', () => ({
  getCurrentTenant: vi.fn(),
}));

// Mock audit logger to capture entries without writing to stdout
vi.mock('../../services/audit-logger', () => ({
  logAudit: vi.fn(),
  createAuditEntry: vi.fn(
    (toolName: string, clientId: string, userId: string, _args: any, durationMs: number, status: string, errorCode?: string) => ({
      audit_id: 'test-uuid',
      audit: 'true',
      client_id: clientId,
      user_id: userId,
      tool_name: toolName,
      duration_ms: durationMs,
      status,
      error_code: errorCode,
      timestamp: new Date().toISOString(),
    })
  ),
}));

import { getCurrentTenant } from '../tenant';
import { logAudit, createAuditEntry } from '../../services/audit-logger';

type ToolResult = {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
};

describe('withAuditLog', () => {
  const successResult: ToolResult = {
    content: [{ type: 'text', text: 'ok' }],
  };

  const errorResult: ToolResult = {
    content: [{ type: 'text', text: 'Error: something failed' }],
    isError: true,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getCurrentTenant).mockReturnValue({
      tenantId: 'org-test',
      userId: 'usr-test',
      userEmail: 'test@example.com',
      tier: 'pro',
    });
  });

  // =========================================================================
  // Successful handler execution
  // =========================================================================

  describe('successful execution', () => {
    it('calls the wrapped handler with original args', async () => {
      const handler = vi.fn().mockResolvedValue(successResult);
      const wrapped = withAuditLog('search_patients', handler);
      const args = { query: 'test', limit: 10 };
      await wrapped(args);
      expect(handler).toHaveBeenCalledWith(args);
    });

    it('returns the handler result unchanged', async () => {
      const handler = vi.fn().mockResolvedValue(successResult);
      const wrapped = withAuditLog('search_patients', handler);
      const result = await wrapped({});
      expect(result).toBe(successResult);
    });

    it('logs audit entry with status success', async () => {
      const handler = vi.fn().mockResolvedValue(successResult);
      const wrapped = withAuditLog('search_patients', handler);
      await wrapped({});
      expect(createAuditEntry).toHaveBeenCalledWith(
        'search_patients',
        'org-test',
        'usr-test',
        {},
        expect.any(Number),
        'success',
      );
      expect(logAudit).toHaveBeenCalledOnce();
    });

    it('measures positive duration', async () => {
      const handler = vi.fn().mockImplementation(async () => {
        // Simulate some work
        await new Promise(r => setTimeout(r, 10));
        return successResult;
      });
      const wrapped = withAuditLog('search_patients', handler);
      await wrapped({});
      const durationArg = vi.mocked(createAuditEntry).mock.calls[0][4];
      expect(durationArg).toBeGreaterThanOrEqual(0);
    });

    it('uses client_id and user_id from tenant context', async () => {
      vi.mocked(getCurrentTenant).mockReturnValue({
        tenantId: 'org-abc',
        userId: 'usr-xyz',
        tier: 'enterprise',
      });
      const handler = vi.fn().mockResolvedValue(successResult);
      const wrapped = withAuditLog('create_patient', handler);
      await wrapped({});
      expect(createAuditEntry).toHaveBeenCalledWith(
        'create_patient',
        'org-abc',
        'usr-xyz',
        expect.anything(),
        expect.any(Number),
        'success',
      );
    });
  });

  // =========================================================================
  // Error handling
  // =========================================================================

  describe('error handling', () => {
    it('logs error status when handler returns isError: true', async () => {
      const handler = vi.fn().mockResolvedValue(errorResult);
      const wrapped = withAuditLog('search_patients', handler);
      const result = await wrapped({});
      expect(result).toBe(errorResult);
      expect(createAuditEntry).toHaveBeenCalledWith(
        'search_patients',
        'org-test',
        'usr-test',
        {},
        expect.any(Number),
        'error',
      );
    });

    it('logs AppError code when handler throws AppError', async () => {
      const error = new RateLimitError(60, 'free tier enrichment');
      const handler = vi.fn().mockRejectedValue(error);
      const wrapped = withAuditLog('enrich_contact', handler);
      await expect(wrapped({})).rejects.toThrow(RateLimitError);
      expect(createAuditEntry).toHaveBeenCalledWith(
        'enrich_contact',
        'org-test',
        'usr-test',
        {},
        expect.any(Number),
        'error',
        'RATE_LIMIT_EXCEEDED',
      );
    });

    it('logs INTERNAL_ERROR when handler throws generic Error', async () => {
      const handler = vi.fn().mockRejectedValue(new Error('kaboom'));
      const wrapped = withAuditLog('search_patients', handler);
      await expect(wrapped({})).rejects.toThrow('kaboom');
      expect(createAuditEntry).toHaveBeenCalledWith(
        'search_patients',
        'org-test',
        'usr-test',
        {},
        expect.any(Number),
        'error',
        'INTERNAL_ERROR',
      );
    });

    it('re-throws the original error', async () => {
      const error = new RateLimitError(30, 'test');
      const handler = vi.fn().mockRejectedValue(error);
      const wrapped = withAuditLog('enrich_contact', handler);
      await expect(wrapped({})).rejects.toBe(error);
    });
  });

  // =========================================================================
  // Tenant context fallback
  // =========================================================================

  describe('tenant context fallback', () => {
    it('uses unknown when getCurrentTenant throws', async () => {
      vi.mocked(getCurrentTenant).mockImplementation(() => {
        throw new Error('no tenant');
      });
      const handler = vi.fn().mockResolvedValue(successResult);
      const wrapped = withAuditLog('health_check', handler);
      await wrapped({});
      expect(createAuditEntry).toHaveBeenCalledWith(
        'health_check',
        'unknown',
        'unknown',
        expect.anything(),
        expect.any(Number),
        'success',
      );
    });

    it('still executes handler when tenant context is missing', async () => {
      vi.mocked(getCurrentTenant).mockImplementation(() => {
        throw new Error('no tenant');
      });
      const handler = vi.fn().mockResolvedValue(successResult);
      const wrapped = withAuditLog('health_check', handler);
      const result = await wrapped({});
      expect(handler).toHaveBeenCalled();
      expect(result).toBe(successResult);
    });
  });
});
