import { createLogger } from '@togari/core';
import { RETRY } from '../config/constants';

const logger = createLogger('Retry');

/**
 * Type-safe helper to extract error code from unknown error
 */
function getErrorCode(error: unknown): string | number | undefined {
  if (error && typeof error === 'object') {
    const err = error as Record<string, unknown>;
    if ('code' in err && (typeof err.code === 'string' || typeof err.code === 'number')) {
      return err.code;
    }
    if ('status' in err && (typeof err.status === 'string' || typeof err.status === 'number')) {
      return err.status;
    }
  }
  return undefined;
}

export interface RetryOptions {
  maxAttempts?: number;
  delayMs?: number;
  exponentialBackoff?: boolean;
  retryableErrors?: Set<string>;
}

const DEFAULT_OPTIONS: Required<RetryOptions> = {
  maxAttempts: RETRY.MAX_ATTEMPTS,
  delayMs: RETRY.DELAY_MS,
  exponentialBackoff: true,
  retryableErrors: new Set([
    'ECONNRESET',
    'ETIMEDOUT',
    'ENOTFOUND',
    'ECONNREFUSED',
    'RATE_LIMIT',
    'SERVICE_UNAVAILABLE',
  ]),
};

/**
 * Retry a function with exponential backoff
 * Useful for transient failures like network errors, rate limits, or temporary service unavailability
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  let lastError: Error;

  for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Don't retry if it's not a retryable error
      const errorCode = getErrorCode(error);
      if (errorCode && !opts.retryableErrors.has(String(errorCode))) {
        logger.warn('Non-retryable error encountered', {
          error: lastError.message,
          code: errorCode,
        });
        throw lastError;
      }

      // Don't retry on last attempt
      if (attempt === opts.maxAttempts) {
        logger.error('Max retry attempts reached', lastError, {
          attempts: opts.maxAttempts,
        });
        break;
      }

      // Calculate delay with exponential backoff
      const delay = opts.exponentialBackoff
        ? opts.delayMs * Math.pow(2, attempt - 1)
        : opts.delayMs;

      logger.warn('Retrying after error', {
        attempt,
        maxAttempts: opts.maxAttempts,
        delayMs: delay,
        error: lastError.message,
      });

      // Wait before retrying
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError!;
}

/**
 * Check if an error is a transient failure that should be retried
 */
export function isTransientError(error: unknown): boolean {
  const errorCode = getErrorCode(error);
  if (!errorCode) return false;

  return DEFAULT_OPTIONS.retryableErrors.has(String(errorCode));
}
