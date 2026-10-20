/**
 * Per-tenant rate limiter — token bucket algorithm.
 *
 * Interface design: RateLimiter can be swapped to a Redis-backed implementation
 * later without changing any call sites. The in-memory version is sufficient
 * for a single-instance Cloud Run deployment; move to Redis when running
 * multiple replicas or when tenants need cross-restart fairness.
 *
 * Default: 100 requests/minute per client_id.
 */

// ─── Interface (swap to Redis by implementing this) ───────────────────────────

export interface RateLimiter {
  /**
   * Try to consume one token for the given client.
   * Returns true if the request is allowed, false if rate-limited.
   */
  consume(clientId: string): boolean;

  /** Tokens remaining for the client (approximate — for headers/logging). */
  remaining(clientId: string): number;
}

// ─── In-memory token bucket ───────────────────────────────────────────────────

interface Bucket {
  /** Current token count (fractional during refill). */
  tokens: number;
  /** Timestamp of last refill calculation, in ms. */
  lastMs: number;
}

export class TokenBucketRateLimiter implements RateLimiter {
  private readonly capacity: number;
  private readonly refillPerMs: number;
  private buckets = new Map<string, Bucket>();

  /**
   * @param requestsPerMinute - Max sustained request rate per tenant. Default 100.
   *
   * To swap to Redis later:
   *   1. Implement RateLimiter against your Redis client (INCR + EXPIRE or Lua script)
   *   2. Replace `new TokenBucketRateLimiter()` in index.ts with your Redis impl
   *   3. No other code changes needed — all callers use the RateLimiter interface
   */
  constructor(requestsPerMinute = 100) {
    this.capacity = requestsPerMinute;
    this.refillPerMs = requestsPerMinute / 60_000;
  }

  private getBucket(clientId: string): Bucket {
    const existing = this.buckets.get(clientId);
    if (existing) return existing;
    const fresh: Bucket = { tokens: this.capacity, lastMs: Date.now() };
    this.buckets.set(clientId, fresh);
    return fresh;
  }

  private refillTokens(bucket: Bucket): number {
    const now = Date.now();
    const elapsed = now - bucket.lastMs;
    bucket.tokens = Math.min(this.capacity, bucket.tokens + elapsed * this.refillPerMs);
    bucket.lastMs = now;
    return bucket.tokens;
  }

  consume(clientId: string): boolean {
    const bucket = this.getBucket(clientId);
    const tokens = this.refillTokens(bucket);
    if (tokens < 1) return false;
    bucket.tokens = tokens - 1;
    return true;
  }

  remaining(clientId: string): number {
    const bucket = this.buckets.get(clientId);
    if (!bucket) return this.capacity;
    return Math.floor(this.refillTokens({ ...bucket })); // non-mutating check
  }
}
