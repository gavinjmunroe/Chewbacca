import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock fs before importing config
vi.mock('fs', () => ({
  existsSync: vi.fn(() => false),
  readFileSync: vi.fn(() => ''),
}));

// Mock Secret Manager to prevent real SDK loading
vi.mock('@google-cloud/secret-manager', () => ({
  SecretManagerServiceClient: vi.fn().mockImplementation(() => ({
    accessSecretVersion: vi.fn().mockRejectedValue(new Error('mock: not available')),
  })),
}));

import { existsSync, readFileSync } from 'fs';
import { getSecret, getOptionalSecret, staticConfig } from '../index';

describe('config — Secret Manager 3-tier resolution', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Reset module-level cache between tests by clearing env and mocks
    vi.clearAllMocks();
    // Reset env
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  // =========================================================================
  // Tier 3 — env var fallback
  // =========================================================================

  describe('env var fallback (tier 3)', () => {
    it('resolves kebab-case name to UPPER_SNAKE_CASE env var', async () => {
      process.env.ANTHROPIC_API_KEY = 'sk-test-123';
      const val = await getSecret('anthropic-api-key');
      expect(val).toBe('sk-test-123');
    });

    it('converts multi-segment names correctly', async () => {
      process.env.GCP_STORAGE_BUCKET = 'my-bucket';
      const val = await getSecret('gcp-storage-bucket');
      expect(val).toBe('my-bucket');
    });

    it('converts single-segment names correctly', async () => {
      process.env.SENTRY_DSN = 'https://sentry.io/123';
      const val = await getSecret('sentry-dsn');
      expect(val).toBe('https://sentry.io/123');
    });

    it('throws when env var is not set and no other tier resolves', async () => {
      delete process.env.MISSING_SECRET;
      await expect(getSecret('missing-secret')).rejects.toThrow(
        'Secret "missing-secret" not found'
      );
    });

    it('throws with env var name in error message', async () => {
      await expect(getSecret('my-api-key')).rejects.toThrow('MY_API_KEY');
    });
  });

  // =========================================================================
  // Tier 1 — volume mount
  // =========================================================================

  describe('volume mount (tier 1)', () => {
    it('reads from /secrets/{name} when file exists', async () => {
      vi.mocked(existsSync).mockReturnValueOnce(true);
      vi.mocked(readFileSync).mockReturnValueOnce('  mounted-secret-value  \n');
      const val = await getSecret('my-secret');
      expect(val).toBe('mounted-secret-value');
      expect(existsSync).toHaveBeenCalledWith('/secrets/my-secret');
    });

    it('trims whitespace and newlines from mounted secret', async () => {
      vi.mocked(existsSync).mockReturnValueOnce(true);
      vi.mocked(readFileSync).mockReturnValueOnce('\n  secret  \n');
      const val = await getSecret('trimmed');
      expect(val).toBe('secret');
    });

    it('falls through to env when file does not exist', async () => {
      vi.mocked(existsSync).mockReturnValueOnce(false);
      process.env.FALLBACK_KEY = 'env-value';
      const val = await getSecret('fallback-key');
      expect(val).toBe('env-value');
    });

    it('falls through when readFileSync throws', async () => {
      vi.mocked(existsSync).mockImplementationOnce(() => { throw new Error('permission denied'); });
      process.env.PERM_KEY = 'env-fallback';
      const val = await getSecret('perm-key');
      expect(val).toBe('env-fallback');
    });

    it('volume mount takes precedence over env var', async () => {
      vi.mocked(existsSync).mockReturnValueOnce(true);
      vi.mocked(readFileSync).mockReturnValueOnce('from-mount');
      process.env.PRIORITY_KEY = 'from-env';
      const val = await getSecret('priority-key');
      expect(val).toBe('from-mount');
    });
  });

  // =========================================================================
  // getSecret() caching
  // =========================================================================

  describe('caching', () => {
    it('caches value and returns it on second call without re-reading', async () => {
      process.env.CACHED_KEY = 'cached-value';
      const val1 = await getSecret('cached-key');
      // Clear env — if caching works, second call still returns the value
      delete process.env.CACHED_KEY;
      const val2 = await getSecret('cached-key');
      expect(val1).toBe('cached-value');
      expect(val2).toBe('cached-value');
    });

    it('re-resolves after TTL expires', async () => {
      const now = 1000000;
      const expired = now + 6 * 60 * 1000; // 6 min later — past 5-min TTL
      const dateNowSpy = vi.spyOn(Date, 'now');

      // First call: getSecret → getCached miss → setCache (2 Date.now calls)
      dateNowSpy.mockReturnValue(now);

      process.env.TTL_KEY = 'old-value';
      const val1 = await getSecret('ttl-key');
      expect(val1).toBe('old-value');

      // Second call: getSecret → getCached expired → re-resolve → setCache
      dateNowSpy.mockReturnValue(expired);

      process.env.TTL_KEY = 'new-value';
      const val2 = await getSecret('ttl-key');
      expect(val2).toBe('new-value');

      dateNowSpy.mockRestore();
    });
  });

  // =========================================================================
  // getOptionalSecret()
  // =========================================================================

  describe('getOptionalSecret()', () => {
    it('returns value when secret exists', async () => {
      process.env.OPT_KEY = 'optional-value';
      const val = await getOptionalSecret('opt-key');
      expect(val).toBe('optional-value');
    });

    it('returns undefined when secret is missing (no throw)', async () => {
      delete process.env.MISSING_OPT;
      const val = await getOptionalSecret('missing-opt');
      expect(val).toBeUndefined();
    });
  });

  // =========================================================================
  // staticConfig
  // =========================================================================

  describe('staticConfig', () => {
    it('reads NODE_ENV from environment (vitest sets it to "test")', () => {
      // staticConfig is evaluated at import time; vitest sets NODE_ENV=test
      expect(['development', 'test', 'production']).toContain(staticConfig.env);
    });

    it('has default port 4200', () => {
      expect(staticConfig.port).toBe(4200);
    });

    it('has correct GCP project ID', () => {
      expect(staticConfig.gcpProjectId).toBe('midyear-glazing-485303-u3');
    });
  });
});
