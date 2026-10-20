/**
 * Retry utility with exponential backoff for handling transient failures.
 * Ported from autotier's apps/worker/src/lib/retry.ts. Generic gateway markers
 * cover BigQuery, Cloudflare-fronted services, and any upstream HTML/52x bodies.
 */

export interface RetryOptions {
  /** Maximum number of retry attempts (default: 3) */
  maxRetries?: number;
  /** Base delay in milliseconds (default: 1000) */
  baseDelayMs?: number;
  /** Maximum delay in milliseconds (default: 10000) */
  maxDelayMs?: number;
  /** Error codes/messages that should trigger a retry */
  retryableErrors?: string[];
  /** Operation name for logging */
  operationName?: string;
  /** Whether to log retry attempts (default: true) */
  logRetries?: boolean;
}

/**
 * Markers indicating a transient gateway/origin outage (Cloudflare 52x, HTML body
 * leaking through a JSON client, etc.). Shared with Sentry classification.
 */
export const GATEWAY_ERROR_MARKERS: readonly string[] = [
  "520",
  "521",
  "522",
  "523",
  "524",
  "Web server is down",
  "cloudflare",
  "cf-error",
  "<!DOCTYPE html",
  "Unexpected token '<'",
];

const DEFAULT_RETRYABLE_ERRORS = [
  "500",
  "502",
  "503",
  "504",
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "ENOTFOUND",
  "NetworkError",
  "fetch failed",
  "socket hang up",
  ...GATEWAY_ERROR_MARKERS,
];

export function isGatewayOverloadError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  return GATEWAY_ERROR_MARKERS.some((marker) => msg.includes(marker));
}

export function truncateErrorSummaryForSentry(
  message: string,
  maxLen = 500,
): string {
  if (message.length <= maxLen) {
    return message;
  }
  return `${message.slice(0, maxLen)}…`;
}

/**
 * Retry tuning for upstream calls that should ride out short edge/origin outages.
 */
export const GATEWAY_OUTAGE_RETRY_OPTIONS: Pick<
  RetryOptions,
  "maxRetries" | "baseDelayMs" | "maxDelayMs"
> = {
  maxRetries: 6,
  baseDelayMs: 1500,
  maxDelayMs: 45_000,
};

function isRetryableError(error: unknown, retryableErrors: string[]): boolean {
  const errorString = String(error);
  const errorMessage = error instanceof Error ? error.message : errorString;
  return retryableErrors.some(
    (retryable) =>
      errorMessage.includes(retryable) || errorString.includes(retryable),
  );
}

function calculateDelay(
  attempt: number,
  baseDelayMs: number,
  maxDelayMs: number,
): number {
  const exponentialDelay = baseDelayMs * 2 ** attempt;
  const jitter = exponentialDelay * Math.random() * 0.25;
  return Math.min(exponentialDelay + jitter, maxDelayMs);
}

/**
 * Execute a function with automatic retry on transient failures.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options?: RetryOptions,
): Promise<T> {
  const {
    maxRetries = 3,
    baseDelayMs = 1000,
    maxDelayMs = 10000,
    retryableErrors = DEFAULT_RETRYABLE_ERRORS,
    operationName = "operation",
    logRetries = true,
  } = options ?? {};

  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      if (attempt >= maxRetries) {
        if (logRetries) {
          console.error(
            `[RETRY] ${operationName} failed after ${maxRetries + 1} attempts:`,
            error instanceof Error ? error.message : String(error),
          );
        }
        throw error;
      }

      if (!isRetryableError(error, retryableErrors)) {
        if (logRetries) {
          console.error(
            `[RETRY] ${operationName} failed with non-retryable error:`,
            error instanceof Error ? error.message : String(error),
          );
        }
        throw error;
      }

      const delay = calculateDelay(attempt, baseDelayMs, maxDelayMs);
      if (logRetries) {
        console.warn(
          `[RETRY] ${operationName} attempt ${attempt + 1}/${maxRetries + 1} failed, retrying in ${Math.round(delay)}ms:`,
          error instanceof Error ? error.message : String(error),
        );
      }
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}

export interface SilentRetryOptions extends RetryOptions {
  /** Called when the operation ultimately fails (non-retryable or retries exhausted). */
  onFailure?: (error: unknown) => void;
}

export async function withRetrySilent<T>(
  fn: () => Promise<T>,
  options?: SilentRetryOptions,
): Promise<T | undefined> {
  try {
    return await withRetry(fn, options);
  } catch (error) {
    options?.onFailure?.(error);
    return undefined;
  }
}

interface CircuitBreakerState {
  consecutiveFailures: number;
  lastFailureTime: number;
  isOpen: boolean;
}

const circuitBreakers = new Map<string, CircuitBreakerState>();

export interface CircuitBreakerOptions extends RetryOptions {
  /** Number of consecutive failures before opening circuit (default: 5) */
  failureThreshold?: number;
  /** Time to wait before trying again when circuit is open (default: 30000ms) */
  cooldownMs?: number;
  /** Circuit breaker name for state tracking */
  circuitName?: string;
}

export async function withRetryAndCircuitBreaker<T>(
  fn: () => Promise<T>,
  options?: CircuitBreakerOptions,
): Promise<T> {
  const {
    failureThreshold = 5,
    cooldownMs = 30000,
    circuitName = "default",
    ...retryOptions
  } = options ?? {};

  let state = circuitBreakers.get(circuitName);
  if (!state) {
    state = { consecutiveFailures: 0, lastFailureTime: 0, isOpen: false };
    circuitBreakers.set(circuitName, state);
  }

  if (state.isOpen) {
    const timeSinceLastFailure = Date.now() - state.lastFailureTime;
    if (timeSinceLastFailure < cooldownMs) {
      const remainingMs = cooldownMs - timeSinceLastFailure;
      console.warn(
        `[CIRCUIT BREAKER] ${circuitName} is open, waiting ${Math.round(remainingMs / 1000)}s before retry`,
      );
      throw new Error(
        `Circuit breaker ${circuitName} is open. Try again in ${Math.round(remainingMs / 1000)}s`,
      );
    }
    console.log(`[CIRCUIT BREAKER] ${circuitName} cooldown complete, retrying`);
    state.isOpen = false;
    state.consecutiveFailures = 0;
  }

  try {
    const result = await withRetry(fn, {
      ...retryOptions,
      operationName: retryOptions.operationName ?? circuitName,
    });
    state.consecutiveFailures = 0;
    return result;
  } catch (error) {
    state.consecutiveFailures++;
    state.lastFailureTime = Date.now();

    if (state.consecutiveFailures >= failureThreshold) {
      state.isOpen = true;
      console.error(
        `[CIRCUIT BREAKER] ${circuitName} opened after ${failureThreshold} consecutive failures`,
      );
    }

    throw error;
  }
}

export function resetCircuitBreaker(circuitName: string): void {
  circuitBreakers.delete(circuitName);
}

export function getCircuitBreakerState(
  circuitName: string,
): CircuitBreakerState | undefined {
  return circuitBreakers.get(circuitName);
}
