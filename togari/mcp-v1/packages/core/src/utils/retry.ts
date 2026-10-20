/**
 * Options for configuring retry behavior
 */
export interface RetryOptions {
  /** Maximum number of retry attempts (default: 3) */
  maxAttempts: number;
  /** Base delay in milliseconds between retries (default: 1000) */
  baseDelayMs: number;
  /** Maximum delay in milliseconds between retries (default: 30000) */
  maxDelayMs: number;
  /** Custom function to determine if an error should trigger a retry */
  shouldRetry?: (error: unknown) => boolean;
  /** Callback invoked before each retry attempt */
  onRetry?: (error: unknown, attempt: number) => void;
}

/**
 * Default retry options
 */
const DEFAULT_RETRY_OPTIONS: RetryOptions = {
  maxAttempts: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
  shouldRetry: defaultShouldRetry,
};

/**
 * Default shouldRetry implementation that retries on:
 * - Network errors (ECONNREFUSED, ETIMEDOUT)
 * - Rate limit errors (429)
 * - Server errors (5xx)
 */
function defaultShouldRetry(error: unknown): boolean {
  // Check for network errors
  if (error && typeof error === 'object') {
    const err = error as { code?: string; status?: number; statusCode?: number };

    // Network errors
    if (err.code === 'ECONNREFUSED' || err.code === 'ETIMEDOUT') {
      return true;
    }

    // HTTP status codes
    const statusCode = err.status || err.statusCode;
    if (statusCode) {
      // Rate limit (429) or server errors (5xx)
      return statusCode === 429 || (statusCode >= 500 && statusCode < 600);
    }
  }

  return false;
}

/**
 * Calculate delay with exponential backoff and jitter
 */
function calculateDelay(attempt: number, baseDelayMs: number, maxDelayMs: number): number {
  // Exponential backoff: baseDelay * 2^attempt
  const exponentialDelay = baseDelayMs * Math.pow(2, attempt);

  // Add jitter (random value between 0 and 1000ms)
  const jitter = Math.random() * 1000;

  // Apply max delay cap
  return Math.min(exponentialDelay + jitter, maxDelayMs);
}

/**
 * Sleep for the specified duration
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Executes an async function with automatic retries using exponential backoff
 *
 * @param fn - The async function to execute
 * @param options - Retry configuration options
 * @returns Promise that resolves with the function result or rejects after all retries are exhausted
 *
 * @example
 * ```typescript
 * const result = await withRetry(
 *   async () => await fetch('https://api.example.com/data'),
 *   { maxAttempts: 5, baseDelayMs: 2000 }
 * );
 * ```
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options?: Partial<RetryOptions>
): Promise<T> {
  const opts = { ...DEFAULT_RETRY_OPTIONS, ...options };
  let lastError: unknown;

  for (let attempt = 0; attempt < opts.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      // Check if we should retry
      const shouldRetry = opts.shouldRetry!(error);
      const isLastAttempt = attempt === opts.maxAttempts - 1;

      if (!shouldRetry || isLastAttempt) {
        throw error;
      }

      // Call onRetry callback if provided
      if (opts.onRetry) {
        opts.onRetry(error, attempt + 1);
      }

      // Calculate delay and wait before retrying
      const delay = calculateDelay(attempt, opts.baseDelayMs, opts.maxDelayMs);
      await sleep(delay);
    }
  }

  // This should never be reached, but TypeScript needs it
  throw lastError;
}
