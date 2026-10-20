/**
 * Circuit Breaker for external API calls.
 *
 * States:
 *   CLOSED  — normal operation, requests pass through
 *   OPEN    — too many failures, requests are immediately rejected with fallback
 *   HALF_OPEN — cooldown expired, next request is a probe; success → CLOSED, failure → OPEN
 *
 * Default thresholds: 5 failures in 60s → open for 5 minutes.
 */

export interface CircuitBreakerOptions {
  /** Number of failures that triggers the circuit to open. Default: 5 */
  failureThreshold?: number;
  /** Time window (ms) in which failures are counted. Default: 60_000 (60s) */
  failureWindow?: number;
  /** How long (ms) the circuit stays open before allowing a probe. Default: 300_000 (5min) */
  resetTimeout?: number;
  /** Label for logs. */
  name: string;
}

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export class CircuitBreaker {
  readonly name: string;
  private state: CircuitState = 'CLOSED';
  private failureTimestamps: number[] = [];
  private openedAt: number | null = null;

  private readonly failureThreshold: number;
  private readonly failureWindow: number;
  private readonly resetTimeout: number;

  constructor(options: CircuitBreakerOptions) {
    this.name = options.name;
    this.failureThreshold = options.failureThreshold ?? 5;
    this.failureWindow = options.failureWindow ?? 60_000;
    this.resetTimeout = options.resetTimeout ?? 300_000;
  }

  /**
   * Execute a function through the circuit breaker.
   * If the circuit is open, calls the fallback immediately.
   */
  async execute<T>(
    fn: () => Promise<T>,
    fallback: () => T,
  ): Promise<T> {
    // ── Check if open ──
    if (this.state === 'OPEN') {
      if (this.shouldProbe()) {
        this.state = 'HALF_OPEN';
        // Fall through to try the probe call
      } else {
        process.stderr.write(
          `[circuit-breaker] ${this.name} is OPEN — returning fallback\n`,
        );
        return fallback();
      }
    }

    // ── CLOSED or HALF_OPEN — execute the real call ──
    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      // If circuit just tripped to OPEN, return fallback instead of throwing
      if (this.isOpen()) {
        process.stderr.write(
          `[circuit-breaker] ${this.name} tripped to OPEN after failure — returning fallback\n`,
        );
        return fallback();
      }
      // Circuit is still closed (under threshold) — propagate the error
      throw error;
    }
  }

  private onSuccess(): void {
    if (this.state === 'HALF_OPEN') {
      process.stderr.write(
        `[circuit-breaker] ${this.name} probe succeeded — CLOSED\n`,
      );
    }
    // Any success resets the circuit
    this.state = 'CLOSED';
    this.failureTimestamps = [];
    this.openedAt = null;
  }

  private onFailure(): void {
    const now = Date.now();

    // If we were probing (HALF_OPEN), go straight back to OPEN
    if (this.state === 'HALF_OPEN') {
      this.state = 'OPEN';
      this.openedAt = now;
      process.stderr.write(
        `[circuit-breaker] ${this.name} probe failed — back to OPEN for ${this.resetTimeout / 1000}s\n`,
      );
      return;
    }

    // CLOSED — record failure, check threshold
    this.failureTimestamps.push(now);

    // Prune failures outside the window
    const windowStart = now - this.failureWindow;
    this.failureTimestamps = this.failureTimestamps.filter(ts => ts >= windowStart);

    if (this.failureTimestamps.length >= this.failureThreshold) {
      this.state = 'OPEN';
      this.openedAt = now;
      process.stderr.write(
        `[circuit-breaker] ${this.name} OPENED — ${this.failureTimestamps.length} failures ` +
        `in ${this.failureWindow / 1000}s (threshold: ${this.failureThreshold}). ` +
        `Will probe after ${this.resetTimeout / 1000}s.\n`,
      );
    }
  }

  /**
   * Check whether enough time has passed for a probe attempt.
   */
  private shouldProbe(): boolean {
    if (!this.openedAt) return true;
    return Date.now() - this.openedAt >= this.resetTimeout;
  }

  private isOpen(): boolean {
    return this.state === 'OPEN';
  }

  // ── Inspection methods ──

  getState(): CircuitState {
    // Update state if probe window has passed (for accurate reads)
    if (this.state === 'OPEN' && this.shouldProbe()) {
      return 'HALF_OPEN';
    }
    return this.state;
  }

  getFailureCount(): number {
    const now = Date.now();
    const windowStart = now - this.failureWindow;
    return this.failureTimestamps.filter(ts => ts >= windowStart).length;
  }

  /**
   * Manually reset the breaker (e.g. after a deploy or config change).
   */
  reset(): void {
    this.state = 'CLOSED';
    this.failureTimestamps = [];
    this.openedAt = null;
  }
}
