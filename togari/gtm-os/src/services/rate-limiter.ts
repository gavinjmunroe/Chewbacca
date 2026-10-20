/**
 * Per-tenant rate limiting with token bucket algorithm.
 * In-memory implementation — interface designed for Redis swap later.
 */

export interface RateLimiter {
  /** Returns true if the request is allowed, false if rate-limited. */
  tryConsume(tenantId: string): boolean;
}

interface Bucket {
  tokens: number;
  lastRefill: number;
}

export interface RateLimiterConfig {
  /** Maximum tokens per tenant bucket */
  maxTokens: number;
  /** Tokens refilled per second */
  refillRatePerSecond: number;
}

const DEFAULT_CONFIG: RateLimiterConfig = {
  maxTokens: 100,
  refillRatePerSecond: 100 / 60, // 100 per minute
};

export class InMemoryRateLimiter implements RateLimiter {
  private buckets = new Map<string, Bucket>();
  private config: RateLimiterConfig;

  constructor(config?: Partial<RateLimiterConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  tryConsume(tenantId: string): boolean {
    const now = Date.now();
    let bucket = this.buckets.get(tenantId);

    if (!bucket) {
      bucket = { tokens: this.config.maxTokens, lastRefill: now };
      this.buckets.set(tenantId, bucket);
    }

    // Refill tokens based on elapsed time
    const elapsedSeconds = (now - bucket.lastRefill) / 1000;
    bucket.tokens = Math.min(
      this.config.maxTokens,
      bucket.tokens + elapsedSeconds * this.config.refillRatePerSecond
    );
    bucket.lastRefill = now;

    // Try to consume one token
    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      return true;
    }

    return false;
  }
}

export function createRateLimiter(config?: Partial<RateLimiterConfig>): RateLimiter {
  return new InMemoryRateLimiter(config);
}
