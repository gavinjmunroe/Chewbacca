import { registerNode } from '../engine.js';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

const PRIVATE_V4_RANGES: Array<[number, number]> = [
  // 10.0.0.0/8
  [0x0a000000, 0x0affffff],
  // 172.16.0.0/12
  [0xac100000, 0xac1fffff],
  // 192.168.0.0/16
  [0xc0a80000, 0xc0a8ffff],
  // 127.0.0.0/8 — loopback
  [0x7f000000, 0x7fffffff],
  // 169.254.0.0/16 — link-local (incl. cloud metadata 169.254.169.254)
  [0xa9fe0000, 0xa9feffff],
  // 0.0.0.0/8
  [0x00000000, 0x00ffffff],
  // 100.64.0.0/10 — CGNAT
  [0x64400000, 0x647fffff],
];

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    const o = Number(p);
    if (!Number.isInteger(o) || o < 0 || o > 255) return null;
    n = (n << 8) + o;
  }
  return n >>> 0;
}

function isBlockedIPv4(ip: string): boolean {
  const n = ipv4ToInt(ip);
  if (n === null) return true;
  return PRIVATE_V4_RANGES.some(([lo, hi]) => n >= lo && n <= hi);
}

function isBlockedIPv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower === '::1' || lower === '::') return true;
  // Unique local addresses fc00::/7 and link-local fe80::/10
  if (/^f[cd][0-9a-f]{2}:/.test(lower)) return true;
  if (/^fe[89ab][0-9a-f]:/.test(lower)) return true;
  // IPv4-mapped (::ffff:a.b.c.d) — extract and re-check
  const mapped = lower.match(/^::ffff:([0-9.]+)$/);
  if (mapped) return isBlockedIPv4(mapped[1]);
  return false;
}

async function assertSafeURL(raw: string): Promise<URL> {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`http.fetch: invalid URL`);
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error(`http.fetch: only http(s) URLs are allowed`);
  }
  const host = parsed.hostname;
  if (!host) throw new Error('http.fetch: missing host');

  // Reject obvious meta hostnames
  const lowerHost = host.toLowerCase();
  if (
    lowerHost === 'localhost' ||
    lowerHost.endsWith('.localhost') ||
    lowerHost === 'metadata.google.internal' ||
    lowerHost.endsWith('.internal')
  ) {
    throw new Error(`http.fetch: blocked host ${host}`);
  }

  // If the host is a literal IP, validate directly. Otherwise, resolve and
  // validate every address — guards against DNS pinning of public names to
  // private IPs.
  const literalFamily = isIP(host);
  if (literalFamily === 4) {
    if (isBlockedIPv4(host)) throw new Error(`http.fetch: blocked private IP ${host}`);
  } else if (literalFamily === 6) {
    if (isBlockedIPv6(host)) throw new Error(`http.fetch: blocked private IPv6 ${host}`);
  } else {
    let addrs: Array<{ address: string; family: number }> = [];
    try {
      addrs = await lookup(host, { all: true });
    } catch {
      throw new Error(`http.fetch: DNS lookup failed for ${host}`);
    }
    for (const a of addrs) {
      if (a.family === 4 && isBlockedIPv4(a.address)) {
        throw new Error(`http.fetch: ${host} resolves to blocked address ${a.address}`);
      }
      if (a.family === 6 && isBlockedIPv6(a.address)) {
        throw new Error(`http.fetch: ${host} resolves to blocked address ${a.address}`);
      }
    }
  }

  return parsed;
}

registerNode('http.fetch', async (_input, cfg) => {
  const url = String(cfg.url ?? '');
  const method = String(cfg.method || 'GET').toUpperCase();
  const headers = (cfg.headers || {}) as Record<string, string>;
  const body = cfg.body;

  await assertSafeURL(url);

  const controller = new AbortController();
  const timeoutMs = Number(cfg.timeoutMs) > 0 ? Number(cfg.timeoutMs) : 10_000;
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      redirect: 'manual',
      signal: controller.signal,
    });

    // If the server tried to redirect, validate the new target before following.
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location');
      if (!loc) {
        return { status: res.status, headers: Object.fromEntries(res.headers.entries()), body: '' };
      }
      const next = new URL(loc, url).toString();
      await assertSafeURL(next);
      const followed = await fetch(next, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        redirect: 'manual',
        signal: controller.signal,
      });
      const text = await followed.text();
      return {
        status: followed.status,
        headers: Object.fromEntries(followed.headers.entries()),
        body: text,
      };
    }

    const text = await res.text();
    return { status: res.status, headers: Object.fromEntries(res.headers.entries()), body: text };
  } finally {
    clearTimeout(timer);
  }
});
