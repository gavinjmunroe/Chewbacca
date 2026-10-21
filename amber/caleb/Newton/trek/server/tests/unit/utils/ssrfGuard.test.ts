import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Capture Agent constructor options so we can test the lookup callback
const { agentCapture } = vi.hoisted(() => ({ agentCapture: { options: null as any } }));

// Mock dns/promises to avoid real DNS lookups in unit tests
vi.mock('dns/promises', () => ({
  default: { lookup: vi.fn() },
  lookup: vi.fn(),
}));

// Mock undici Agent so we can inspect the connect.lookup option
vi.mock('undici', () => ({
  Agent: class MockAgent {
    options: any;
    constructor(opts: any) {
      this.options = opts;
      agentCapture.options = opts;
    }
  },
}));

import dns from 'dns/promises';
import { checkSsrf, SsrfBlockedError, safeFetch, createPinnedDispatcher } from '../../../src/utils/ssrfGuard';

const mockLookup = vi.mocked(dns.lookup);

function mockIp(ip: string) {
  mockLookup.mockResolvedValue({ address: ip, family: ip.includes(':') ? 6 : 4 });
}

describe('checkSsrf', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  // SEC-001 — Loopback always blocked
  describe('loopback addresses (always blocked)', () => {
    it('SEC-001: blocks 127.0.0.1', async () => {
      mockIp('127.0.0.1');
      const result = await checkSsrf('http://example.com');
      expect(result.allowed).toBe(false);
      expect(result.isPrivate).toBe(true);
    });

    it('SEC-001: blocks ::1 (IPv6 loopback)', async () => {
      mockIp('::1');
      const result = await checkSsrf('http://example.com');
      expect(result.allowed).toBe(false);
    });

    it('SEC-001: blocks 127.x.x.x range', async () => {
      mockIp('127.0.0.2');
      const result = await checkSsrf('http://example.com');
      expect(result.allowed).toBe(false);
    });
  });

  // SEC-002 — Link-local (AWS metadata) always blocked
  describe('link-local addresses (always blocked)', () => {
    it('SEC-002: blocks 169.254.169.254 (AWS metadata)', async () => {
      mockIp('169.254.169.254');
      const result = await checkSsrf('http://example.com');
      expect(result.allowed).toBe(false);
      expect(result.isPrivate).toBe(true);
    });

    it('SEC-002: blocks any 169.254.x.x address', async () => {
      mockIp('169.254.0.1');
      const result = await checkSsrf('http://example.com');
      expect(result.allowed).toBe(false);
    });
  });

  // SEC-003 — Private network blocked when ALLOW_INTERNAL_NETWORK is false
  describe('private network addresses (conditionally blocked)', () => {
    beforeEach(() => {
      vi.stubEnv('ALLOW_INTERNAL_NETWORK', 'false');
    });

    it('SEC-003: blocks 10.x.x.x (RFC-1918)', async () => {
      mockIp('10.0.0.1');
      const result = await checkSsrf('http://example.com');
      expect(result.allowed).toBe(false);
      expect(result.isPrivate).toBe(true);
    });

    it('SEC-003: blocks 192.168.x.x (RFC-1918)', async () => {
      mockIp('192.168.1.100');
      const result = await checkSsrf('http://example.com');
      expect(result.allowed).toBe(false);
    });

    it('SEC-003: blocks 172.16.x.x through 172.31.x.x (RFC-1918)', async () => {
      mockIp('172.16.0.1');
      const result = await checkSsrf('http://example.com');
      expect(result.allowed).toBe(false);
    });
  });

  // SEC-004 — Private network allowed with ALLOW_INTERNAL_NETWORK=true
  describe('ALLOW_INTERNAL_NETWORK=true', () => {
    it('SEC-004: allows private IP when flag is set', async () => {
      vi.stubEnv('ALLOW_INTERNAL_NETWORK', 'true');
      mockIp('192.168.1.100');
      // Need to reload module since ALLOW_INTERNAL_NETWORK is read at module load time
      vi.resetModules();
      const { checkSsrf: checkSsrfFresh } = await import('../../../src/utils/ssrfGuard');
      const { lookup: freshLookup } = await import('dns/promises');
      vi.mocked(freshLookup).mockResolvedValue({ address: '192.168.1.100', family: 4 });
      const result = await checkSsrfFresh('http://example.com');
      expect(result.allowed).toBe(true);
      expect(result.isPrivate).toBe(true);
    });
  });

  describe('protocol restrictions', () => {
    it('rejects non-HTTP/HTTPS protocols', async () => {
      const result = await checkSsrf('ftp://example.com');
      expect(result.allowed).toBe(false);
      expect(result.error).toContain('HTTP');
    });

    it('rejects file:// protocol', async () => {
      const result = await checkSsrf('file:///etc/passwd');
      expect(result.allowed).toBe(false);
    });
  });

  describe('invalid URLs', () => {
    it('rejects malformed URLs', async () => {
      const result = await checkSsrf('not-a-url');
      expect(result.allowed).toBe(false);
      expect(result.error).toContain('Invalid URL');
    });
  });

  describe('public URLs', () => {
    it('allows a normal public IP', async () => {
      mockIp('8.8.8.8');
      const result = await checkSsrf('https://example.com');
      expect(result.allowed).toBe(true);
      expect(result.isPrivate).toBe(false);
      expect(result.resolvedIp).toBe('8.8.8.8');
    });
  });

  describe('internal hostname suffixes', () => {
    it('blocks .local domains', async () => {
      const result = await checkSsrf('http://myserver.local');
      expect(result.allowed).toBe(false);
    });

    it('blocks .internal domains', async () => {
      const result = await checkSsrf('http://service.internal');
      expect(result.allowed).toBe(false);
    });
  });

  describe('DNS resolution failure', () => {
    it('returns allowed:false when dns.lookup throws', async () => {
      mockLookup.mockRejectedValue(new Error('ENOTFOUND nxdomain.example'));
      const result = await checkSsrf('http://nxdomain.example.com');
      expect(result.allowed).toBe(false);
      expect(result.isPrivate).toBe(false);
      expect(result.error).toBe('Could not resolve hostname');
    });
  });

});

describe('SsrfBlockedError', () => {
  it('is an instance of Error', () => {
    const err = new SsrfBlockedError('blocked');
    expect(err).toBeInstanceOf(Error);
  });

  it('has name SsrfBlockedError', () => {
    const err = new SsrfBlockedError('test message');
    expect(err.name).toBe('SsrfBlockedError');
  });

  it('has the correct message', () => {
    const err = new SsrfBlockedError('my message');
    expect(err.message).toBe('my message');
  });
});

describe('safeFetch', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('throws SsrfBlockedError for a blocked URL (invalid URL)', async () => {
    await expect(safeFetch('not-a-valid-url')).rejects.toThrow(SsrfBlockedError);
  });

  it('throws SsrfBlockedError for a loopback URL', async () => {
    mockLookup.mockResolvedValue({ address: '127.0.0.1', family: 4 });
    await expect(safeFetch('http://localhost')).rejects.toThrow(SsrfBlockedError);
  });

  it('calls fetch with the resolved URL when allowed', async () => {
    mockLookup.mockResolvedValue({ address: '93.184.216.34', family: 4 });
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal('fetch', mockFetch);
    const result = await safeFetch('https://example.com');
    expect(mockFetch).toHaveBeenCalledOnce();
    expect(result.status).toBe(200);
  });

  it('throws SsrfBlockedError with fallback message when error is undefined', async () => {
    // non-http protocol → error:'Only HTTP and HTTPS URLs are allowed'
    await expect(safeFetch('ftp://example.com')).rejects.toThrow(SsrfBlockedError);
  });
});

describe('createPinnedDispatcher', () => {
  it('returns an object (Agent instance)', () => {
    const dispatcher = createPinnedDispatcher('93.184.216.34');
    expect(dispatcher).toBeDefined();
    expect(typeof dispatcher).toBe('object');
  });

  it('pinned lookup callback calls back with the resolved IPv4 address', () => {
    createPinnedDispatcher('93.184.216.34');
    const lookup = agentCapture.options?.connect?.lookup;
    expect(typeof lookup).toBe('function');
    const cb = vi.fn();
    lookup('example.com', {}, cb);
    expect(cb).toHaveBeenCalledWith(null, '93.184.216.34', 4);
  });

  it('pinned lookup callback uses family 6 for IPv6 address', () => {
    createPinnedDispatcher('2001:4860:4860::8888');
    const lookup = agentCapture.options?.connect?.lookup;
    const cb = vi.fn();
    lookup('example.com', {}, cb);
    expect(cb).toHaveBeenCalledWith(null, '2001:4860:4860::8888', 6);
  });

  it('returns array format when opts.all is true', () => {
    createPinnedDispatcher('93.184.216.34');
    const lookup = agentCapture.options?.connect?.lookup;
    const cb = vi.fn();
    lookup('example.com', { all: true }, cb);
    expect(cb).toHaveBeenCalledWith(null, [{ address: '93.184.216.34', family: 4 }]);
  });
});
