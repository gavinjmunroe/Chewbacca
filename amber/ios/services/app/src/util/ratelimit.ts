/**
 * Lightweight in-memory token-bucket rate limiter.
 *
 * Intentionally dependency-free so the existing pnpm lockfile keeps working.
 * For a multi-instance Railway deployment, swap this for a Redis-backed
 * limiter (e.g. @fastify/rate-limit + Redis) once the lockfile is regenerated.
 */

import type { FastifyRequest, FastifyReply, FastifyInstance } from 'fastify';

interface Bucket {
  count: number;
  resetAt: number;
}

interface Options {
  windowMs: number;
  max: number;
  keyer?: (req: FastifyRequest) => string;
}

function defaultKey(req: FastifyRequest): string {
  // Prefer authenticated user id if the auth middleware ran ahead of us.
  // Fall back to client IP. Behind a proxy (Railway), `request.ip` already
  // honours `trustProxy` when fastify is configured to trust it.
  const anyReq = req as FastifyRequest & { userId?: number };
  if (anyReq.userId) return `u:${anyReq.userId}`;
  const fwd = req.headers['x-forwarded-for'];
  const ip = Array.isArray(fwd) ? fwd[0] : (fwd?.split(',')[0]?.trim() || req.ip);
  return `ip:${ip || 'unknown'}`;
}

export function createRateLimiter(opts: Options) {
  const buckets = new Map<string, Bucket>();
  const { windowMs, max, keyer = defaultKey } = opts;

  // Periodic GC so the map doesn't grow unboundedly.
  const gc = setInterval(() => {
    const now = Date.now();
    for (const [k, b] of buckets) {
      if (b.resetAt <= now) buckets.delete(k);
    }
  }, Math.max(windowMs, 30_000));
  // Don't keep the event loop alive purely for the GC.
  if (typeof gc.unref === 'function') gc.unref();

  return async function rateLimit(req: FastifyRequest, reply: FastifyReply) {
    const key = keyer(req);
    const now = Date.now();
    const bucket = buckets.get(key);

    if (!bucket || bucket.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + windowMs });
      return;
    }

    bucket.count += 1;
    if (bucket.count > max) {
      const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
      reply.header('Retry-After', String(retryAfter));
      reply.code(429).send({ error: 'rate_limited', message: 'Too many requests', retryAfter });
    }
  };
}

/**
 * Register a global per-IP limit + an opt-in per-user limit for write paths.
 * Read-only health endpoints stay limit-free so platform health checks aren't
 * tripped.
 */
export function registerGlobalRateLimit(app: FastifyInstance) {
  const globalLimiter = createRateLimiter({
    windowMs: 60_000,
    max: Number(process.env.RATE_LIMIT_PER_MINUTE || 120),
  });

  app.addHook('onRequest', async (req, reply) => {
    if (req.url === '/health' || req.url.startsWith('/health/')) return;
    await globalLimiter(req, reply);
  });
}
