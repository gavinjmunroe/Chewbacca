/**
 * @togari/core/connectors/resilience
 * Cockatiel-based resilience policies for all external connectors.
 * Composes: bulkhead → circuit breaker → retry → timeout
 *
 * NOTE: Cockatiel v3 uses top-level exports (timeout, retry, etc.)
 * NOT Policy.timeout() — the Policy class only has .wrap() as static.
 */

import {
  timeout as cockatielTimeout,
  retry as cockatielRetry,
  circuitBreaker as cockatielCircuitBreaker,
  bulkhead as cockatielBulkhead,
  wrap,
  handleAll,
  SamplingBreaker,
  ExponentialBackoff,
  TimeoutStrategy,
  BulkheadPolicy,
  CircuitBreakerPolicy,
  RetryPolicy,
  TimeoutPolicy,
  BrokenCircuitError,
  BulkheadRejectedError,
  TaskCancelledError,
} from 'cockatiel';
import type { IPolicy } from 'cockatiel';
import { createLogger } from '../utils/logger';

const logger = createLogger('ConnectorResilience');

// ============================================================================
// TYPES
// ============================================================================

export interface ConnectorPolicyConfig {
  /** Connector name (for logging and registry lookup) */
  name: string;
  /** Request timeout in ms */
  timeoutMs: number;
  /** Max retry attempts (not counting the initial try) */
  retryAttempts: number;
  /** Base delay for exponential backoff */
  retryBaseMs?: number;
  /** Circuit breaker failure threshold (0-1, e.g. 0.5 = 50%) */
  cbThresholdPct: number;
  /** Time in ms before CB transitions from open → half-open */
  cbHalfOpenAfterMs: number;
  /** Minimum requests before CB can trip (avoids tripping on small samples) */
  cbMinRequests?: number;
  /** Max concurrent requests */
  bulkheadConcurrency: number;
  /** Max queued requests when bulkhead is full */
  bulkheadQueue: number;
  /** Custom filter: return false to exclude error from CB failure count */
  shouldCountAsFailure?: (err: unknown) => boolean;
}

export interface ConnectorStatus {
  name: string;
  healthy: boolean;
  circuitState: 'closed' | 'open' | 'half-open';
  bulkheadAvailable: number;
  bulkheadQueued: number;
  lastError?: string;
  lastErrorAt?: string;
}

// ============================================================================
// POLICY BUILDER
// ============================================================================

export interface ConnectorPolicy {
  composed: IPolicy;
  breaker: CircuitBreakerPolicy;
  bulkhead: BulkheadPolicy;
  timeout: TimeoutPolicy;
  retry: RetryPolicy;
}

/**
 * Build a composed Cockatiel policy from config.
 * Execution order (outermost → innermost): bulkhead → circuit breaker → retry → timeout
 */
export function buildConnectorPolicy(config: ConnectorPolicyConfig): ConnectorPolicy {
  // 1. Timeout (innermost) — cancels individual requests
  const timeoutPolicy = cockatielTimeout(config.timeoutMs, TimeoutStrategy.Aggressive);

  // 2. Retry — wraps timeout, retries on transient failures
  const retryPolicy = cockatielRetry(handleAll, {
    maxAttempts: config.retryAttempts,
    backoff: new ExponentialBackoff({
      initialDelay: config.retryBaseMs ?? 1000,
      maxDelay: 30_000,
    }),
  });

  retryPolicy.onRetry(({ attempt, reason }) => {
    logger.warn(`[${config.name}] Retry attempt ${attempt}`, {
      connector: config.name,
      attempt,
      error: reason instanceof Error ? reason.message : String(reason),
    });
  });

  // 3. Circuit breaker — wraps retry, opens on sustained failures
  const breaker = cockatielCircuitBreaker(handleAll, {
    halfOpenAfter: config.cbHalfOpenAfterMs,
    breaker: new SamplingBreaker({
      threshold: config.cbThresholdPct,
      duration: config.cbHalfOpenAfterMs * 2, // sampling window
      minimumRps: 0,
    }),
  });

  // If custom failure filter provided (e.g., exclude 429/529 for Anthropic)
  if (config.shouldCountAsFailure) {
    const originalFilter = config.shouldCountAsFailure;
    breaker.onFailure(({ reason }) => {
      if (!originalFilter(reason)) {
        logger.debug(`[${config.name}] Error excluded from CB failure count`, {
          connector: config.name,
          error: reason instanceof Error ? reason.message : String(reason),
        });
      }
    });
  }

  breaker.onBreak(() => {
    logger.error(`[${config.name}] Circuit breaker OPENED — requests will be rejected`, undefined, {
      connector: config.name,
    });
  });

  breaker.onHalfOpen(() => {
    logger.info(`[${config.name}] Circuit breaker half-open — testing with next request`, {
      connector: config.name,
    });
  });

  breaker.onReset(() => {
    logger.info(`[${config.name}] Circuit breaker CLOSED — normal operation resumed`, {
      connector: config.name,
    });
  });

  // 4. Bulkhead (outermost) — limits concurrency
  const bulkheadPolicy = cockatielBulkhead(config.bulkheadConcurrency, config.bulkheadQueue);

  // Compose: bulkhead → breaker → retry → timeout
  const composed = wrap(bulkheadPolicy, breaker, retryPolicy, timeoutPolicy);

  return { composed, breaker, bulkhead: bulkheadPolicy, timeout: timeoutPolicy, retry: retryPolicy };
}

// ============================================================================
// PRE-CONFIGURED POLICIES
// ============================================================================

/**
 * Anthropic special: 429 (rate limit) and 529 (overloaded) should NOT trip the circuit breaker.
 * These are transient capacity issues, not service failures.
 */
function isAnthropicServiceFailure(err: unknown): boolean {
  if (err && typeof err === 'object' && 'status' in err) {
    const status = (err as { status: number }).status;
    if (status === 429 || status === 529) return false;
  }
  if (err instanceof Error && (err.message.includes('429') || err.message.includes('529'))) {
    return false;
  }
  return true;
}

export const CONNECTOR_CONFIGS: Record<string, ConnectorPolicyConfig> = {
  anthropic: {
    name: 'anthropic',
    timeoutMs: 60_000,
    retryAttempts: 2,
    retryBaseMs: 2000,
    cbThresholdPct: 0.5,
    cbHalfOpenAfterMs: 30_000,
    cbMinRequests: 5,
    bulkheadConcurrency: 5,
    bulkheadQueue: 10,
    shouldCountAsFailure: isAnthropicServiceFailure,
  },
  exa: {
    name: 'exa',
    timeoutMs: 15_000,
    retryAttempts: 3,
    retryBaseMs: 1000,
    cbThresholdPct: 0.5,
    cbHalfOpenAfterMs: 10_000,
    cbMinRequests: 5,
    bulkheadConcurrency: 10,
    bulkheadQueue: 5,
  },
  clay: {
    name: 'clay',
    timeoutMs: 15_000,
    retryAttempts: 3,
    retryBaseMs: 1000,
    cbThresholdPct: 0.5,
    cbHalfOpenAfterMs: 10_000,
    cbMinRequests: 5,
    bulkheadConcurrency: 10,
    bulkheadQueue: 5,
  },
  structify: {
    name: 'structify',
    timeoutMs: 10_000,
    retryAttempts: 3,
    retryBaseMs: 1000,
    cbThresholdPct: 0.5,
    cbHalfOpenAfterMs: 10_000,
    cbMinRequests: 5,
    bulkheadConcurrency: 15,
    bulkheadQueue: 10,
  },
  firestore: {
    name: 'firestore',
    timeoutMs: 10_000,
    retryAttempts: 3,
    retryBaseMs: 500,
    cbThresholdPct: 0.5,
    cbHalfOpenAfterMs: 10_000,
    cbMinRequests: 5,
    bulkheadConcurrency: 20,
    bulkheadQueue: 15,
  },
  gcs: {
    name: 'gcs',
    timeoutMs: 30_000,
    retryAttempts: 2,
    retryBaseMs: 1000,
    cbThresholdPct: 0.3,
    cbHalfOpenAfterMs: 15_000,
    cbMinRequests: 5,
    bulkheadConcurrency: 20,
    bulkheadQueue: 10,
  },
};

// Re-export error types for consumers
export {
  BrokenCircuitError,
  BulkheadRejectedError,
  TaskCancelledError,
};
