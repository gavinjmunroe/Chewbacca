/**
 * Tiny circuit breaker for outbound calls to amber-id (and any future
 * always-must-be-fast dependency).
 *
 * Why this exists: amber-id resolves every inbound Loop sender → tenant
 * before we can reply. If amber-id is slow or down, the agent stalls
 * because every webhook hangs on a 5s fetch timeout. Multiplied across
 * concurrent inbounds, the worker fills up its queue and no replies go
 * out — a single dependency outage masquerades as a global agent
 * outage.
 *
 * The breaker keeps a per-name failure counter. If we cross the
 * threshold within a rolling window, the breaker opens: subsequent
 * calls fail fast (no network round-trip) for a cool-off period.
 * After the cool-off, the breaker enters HALF_OPEN — a single probe
 * call is allowed; if it succeeds the breaker closes again, otherwise
 * it re-opens.
 *
 * This is intentionally minimal — not a replacement for `opossum` or
 * resilience4j. The goal is to bound the blast radius of a deps
 * outage without adding a new dependency to the agent.
 */

const STATES = { CLOSED: "closed", OPEN: "open", HALF_OPEN: "half_open" };

class Breaker {
  constructor(name, opts = {}) {
    this.name = name;
    this.failureThreshold = opts.failureThreshold ?? 5;
    this.cooldownMs = opts.cooldownMs ?? 15_000;
    this.windowMs = opts.windowMs ?? 30_000;
    this.timeoutMs = opts.timeoutMs ?? 3000;
    this.state = STATES.CLOSED;
    this.failures = []; // timestamps within the rolling window
    this.openedAt = 0;
  }

  _pruneFailures(now) {
    const cutoff = now - this.windowMs;
    while (this.failures.length && this.failures[0] < cutoff) {
      this.failures.shift();
    }
  }

  _onSuccess() {
    this.failures.length = 0;
    if (this.state !== STATES.CLOSED) {
      console.log(`[breaker:${this.name}] closed (success after ${this.state})`);
    }
    this.state = STATES.CLOSED;
  }

  _onFailure() {
    const now = Date.now();
    this.failures.push(now);
    this._pruneFailures(now);
    if (
      this.state === STATES.HALF_OPEN ||
      this.failures.length >= this.failureThreshold
    ) {
      if (this.state !== STATES.OPEN) {
        console.warn(
          `[breaker:${this.name}] OPEN — failing fast for ${this.cooldownMs}ms`,
        );
      }
      this.state = STATES.OPEN;
      this.openedAt = now;
    }
  }

  _maybeHalfOpen() {
    if (
      this.state === STATES.OPEN &&
      Date.now() - this.openedAt >= this.cooldownMs
    ) {
      console.log(`[breaker:${this.name}] half-open — admitting probe`);
      this.state = STATES.HALF_OPEN;
    }
  }

  /**
   * Run an async fn through the breaker. If the breaker is open, the
   * fallback (or null) is returned WITHOUT calling fn. fn is also
   * subject to a hard timeout so an unresponsive dep can't pin the
   * worker indefinitely.
   *
   * @param {() => Promise<any>} fn
   * @param {{fallback?: any}} [opts]
   */
  async run(fn, opts = {}) {
    this._maybeHalfOpen();
    if (this.state === STATES.OPEN) {
      return opts.fallback === undefined ? null : opts.fallback;
    }
    let timeoutHandle;
    try {
      const result = await Promise.race([
        Promise.resolve().then(fn),
        new Promise((_, reject) => {
          timeoutHandle = setTimeout(
            () =>
              reject(new Error(`breaker:${this.name} timeout ${this.timeoutMs}ms`)),
            this.timeoutMs,
          );
        }),
      ]);
      this._onSuccess();
      return result;
    } catch (err) {
      this._onFailure();
      if (opts.fallback !== undefined) return opts.fallback;
      // Don't re-throw the timeout/failure — callers want a graceful
      // null/fallback path so they can drop the message rather than
      // crash the worker.
      return null;
    } finally {
      if (timeoutHandle) clearTimeout(timeoutHandle);
    }
  }

  status() {
    return {
      name: this.name,
      state: this.state,
      failures: this.failures.length,
      threshold: this.failureThreshold,
    };
  }
}

const registry = new Map();

export function getBreaker(name, opts) {
  if (!registry.has(name)) registry.set(name, new Breaker(name, opts));
  return registry.get(name);
}

export function allBreakerStatus() {
  return Array.from(registry.values()).map((b) => b.status());
}
