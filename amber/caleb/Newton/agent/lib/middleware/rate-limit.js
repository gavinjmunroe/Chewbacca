/**
 * Tenant-scoped tool-call rate limiter (token bucket).
 *
 * Wraps the inner tool dispatcher so a runaway tool-call loop (an LLM
 * stuck in retry, a summarize-job whose window expanded unintentionally,
 * a misconfigured polling tool) can't fan out 100s of API calls per
 * second against an upstream provider that doesn't have its own
 * throttling on the OAuth refresh path (Twitter, LinkedIn, Railway).
 *
 * Default: 60 tool calls / 60 seconds per tenant. Configurable via:
 *   MEDHA_RATELIMIT_PER_TENANT_PER_MIN   (default 60)
 *   MEDHA_RATELIMIT_DISABLED             (set to '1' to disable)
 *
 * On limit hit: returns a structured `{ error: 'rate_limited', ... }`
 * result so the LLM can surface a real message to the user instead of
 * the next tool call silently crashing. Never throws.
 *
 * Bucket state lives in-memory per process. Multi-replica deploys will
 * each have their own bucket; for the size we run at (single replica
 * per service) this is sufficient. Cross-replica rate limiting would
 * need a Firestore-backed counter — out of scope for this PR.
 */

const DEFAULT_LIMIT_PER_MIN = Number(
  process.env.MEDHA_RATELIMIT_PER_TENANT_PER_MIN || 60,
);
const WINDOW_MS = 60_000;

// tenantDid → { tokens, refilledAt }
const buckets = new Map();

function tenantKeyOf(ctx) {
  const t = ctx?.tenant;
  if (!t) return "_no_tenant_";
  return t.privyDid || t.amberId || t.id || t.phoneNumber || "_anon_";
}

function refillBucket(bucket, now) {
  // Linear refill at LIMIT/WINDOW per ms. Cap at LIMIT.
  const elapsed = now - bucket.refilledAt;
  if (elapsed <= 0) return;
  const refillRate = DEFAULT_LIMIT_PER_MIN / WINDOW_MS;
  bucket.tokens = Math.min(
    DEFAULT_LIMIT_PER_MIN,
    bucket.tokens + elapsed * refillRate,
  );
  bucket.refilledAt = now;
}

function takeToken(tenantKey) {
  const now = Date.now();
  let bucket = buckets.get(tenantKey);
  if (!bucket) {
    bucket = { tokens: DEFAULT_LIMIT_PER_MIN, refilledAt: now };
    buckets.set(tenantKey, bucket);
  }
  refillBucket(bucket, now);
  if (bucket.tokens >= 1) {
    bucket.tokens -= 1;
    return { allowed: true, remaining: Math.floor(bucket.tokens) };
  }
  return { allowed: false, remaining: 0 };
}

/**
 * Wrap a tool handler with per-tenant token-bucket rate limiting.
 *
 * @param {string} toolName
 * @param {(toolUse: any, ctx?: any) => Promise<any>} handlerFn
 * @returns {(toolUse: any, ctx?: any) => Promise<any>}
 */
export function withRateLimit(toolName, handlerFn) {
  if (typeof handlerFn !== "function") {
    throw new TypeError(
      `withRateLimit: handler for "${toolName}" must be a function`,
    );
  }
  return async function rateLimitedHandler(toolUse, ctx) {
    if (process.env.MEDHA_RATELIMIT_DISABLED === "1") {
      return handlerFn(toolUse, ctx);
    }
    const tenantKey = tenantKeyOf(ctx);
    const { allowed, remaining } = takeToken(tenantKey);
    if (!allowed) {
      console.warn(
        `[ratelimit] tenant=${tenantKey} tool=${toolName} dropped (${DEFAULT_LIMIT_PER_MIN}/min cap hit)`,
      );
      return {
        error: "rate_limited",
        message: `Tool calls capped at ${DEFAULT_LIMIT_PER_MIN}/min per tenant. Wait a moment and try again.`,
        tool: toolName,
      };
    }
    if (remaining < 5) {
      console.log(
        `[ratelimit] tenant=${tenantKey} tool=${toolName} ok remaining=${remaining}`,
      );
    }
    return handlerFn(toolUse, ctx);
  };
}

// Test-only helpers. Don't import in production code.
export const __internals = {
  takeToken,
  buckets,
  reset() {
    buckets.clear();
  },
};
