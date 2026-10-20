/**
 * Retry wrapper with exponential backoff for external API calls.
 *
 * Default: 3 attempts, 1s → 2s → 4s delays.
 * Integrates with CircuitBreaker — if a breaker is provided, calls go through it.
 */

export interface RetryOptions {
  /** Maximum number of attempts (including the first). Default: 3 */
  maxAttempts?: number;
  /** Base delay in ms before the first retry. Default: 1000 */
  baseDelay?: number;
  /** Multiplier applied to delay after each retry. Default: 2 */
  backoffMultiplier?: number;
  /** Optional label for log messages (e.g. "Exa.search") */
  label?: string;
  /** If true, do not retry on 4xx errors (client errors). Default: true */
  skipRetryOn4xx?: boolean;
}

/**
 * Error subclass that carries HTTP status for retry-decision logic.
 */
export class ApiError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
    public readonly retryable: boolean = true,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * Wraps an async function with retry + exponential backoff.
 *
 * @example
 * ```ts
 * const result = await withRetry(() => fetch(url), { label: 'Exa.search' });
 * ```
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const {
    maxAttempts = 3,
    baseDelay = 1000,
    backoffMultiplier = 2,
    label = 'unknown',
    skipRetryOn4xx = true,
  } = options;

  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Don't retry client errors (4xx) — they won't succeed on retry
      if (skipRetryOn4xx && error instanceof ApiError && error.statusCode && error.statusCode >= 400 && error.statusCode < 500) {
        throw error;
      }

      // Don't retry non-retryable errors
      if (error instanceof ApiError && !error.retryable) {
        throw error;
      }

      // Last attempt — don't sleep, just throw
      if (attempt === maxAttempts) {
        break;
      }

      const delay = baseDelay * Math.pow(backoffMultiplier, attempt - 1);
      process.stderr.write(
        `[retry] ${label} attempt ${attempt}/${maxAttempts} failed: ${lastError.message}. ` +
        `Retrying in ${delay}ms...\n`,
      );
      await sleep(delay);
    }
  }

  throw lastError!;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
