/**
 * Simple circuit breaker for upstream API calls.
 * Opens after N failures in a rolling window, stays open for resetTimeout ms.
 * Used to protect against Privy API outages cascading to all callers.
 */

export class CircuitBreaker {
  constructor({
    name = "default",
    threshold = 5,
    resetTimeout = 30_000,
    windowMs = 60_000,
  } = {}) {
    this.name = name;
    this.threshold = threshold;
    this.resetTimeout = resetTimeout;
    this.windowMs = windowMs;
    this.failures = [];
    this.openUntil = 0;
    this.totalTrips = 0;
  }

  isOpen() {
    return Date.now() < this.openUntil;
  }

  state() {
    if (this.isOpen()) return "open";
    if (this.failures.length > 0) return "half-open";
    return "closed";
  }

  recordSuccess() {
    this.failures = [];
  }

  recordFailure() {
    const now = Date.now();
    this.failures = this.failures.filter((t) => now - t < this.windowMs);
    this.failures.push(now);
    if (this.failures.length >= this.threshold) {
      this.openUntil = now + this.resetTimeout;
      this.totalTrips += 1;
      this.failures = [];
      console.warn(
        `[circuit:${this.name}] OPEN for ${this.resetTimeout}ms after ${this.threshold} failures`,
      );
    }
  }

  async execute(fn) {
    if (this.isOpen()) {
      const err = new Error(`Circuit open: ${this.name}`);
      err.code = "circuit_open";
      throw err;
    }
    try {
      const result = await fn();
      this.recordSuccess();
      return result;
    } catch (err) {
      this.recordFailure();
      throw err;
    }
  }

  status() {
    return {
      name: this.name,
      state: this.state(),
      failures: this.failures.length,
      openUntil: this.openUntil,
      totalTrips: this.totalTrips,
    };
  }
}

export const privyBreaker = new CircuitBreaker({
  name: "privy",
  threshold: 5,
  resetTimeout: 30_000,
  windowMs: 60_000,
});
