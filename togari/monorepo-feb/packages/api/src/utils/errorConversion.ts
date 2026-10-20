/**
 * Error Conversion Utility
 * Converts unknown errors to proper Error instances for logging and handling
 */

/**
 * Custom error class that supports additional properties like 'code'
 */
interface ErrorWithCode extends Error {
  code?: string | number;
}

/**
 * Convert any value to an Error instance
 * Safely handles Error objects, strings, objects with message property, and unknown types
 */
export function toError(error: unknown): Error {
  // Already an Error instance
  if (error instanceof Error) {
    return error;
  }

  // String error message
  if (typeof error === 'string') {
    return new Error(error);
  }

  // Object with message property
  if (error && typeof error === 'object' && 'message' in error) {
    const message = String(error.message);
    const err: ErrorWithCode = new Error(message);

    // Preserve stack trace if available
    if ('stack' in error && typeof error.stack === 'string') {
      err.stack = error.stack;
    }

    // Preserve error code if available
    if ('code' in error && (typeof error.code === 'string' || typeof error.code === 'number')) {
      err.code = error.code;
    }

    return err;
  }

  // Fallback for unknown types
  return new Error(`Unknown error: ${String(error)}`);
}

/**
 * Extract error message from any value
 * Returns a user-friendly string message
 */
export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === 'string') {
    return error;
  }

  if (error && typeof error === 'object' && 'message' in error) {
    return String(error.message);
  }

  return 'An unknown error occurred';
}

/**
 * Extract error code from any value
 * Returns the error code if available, undefined otherwise
 */
export function getErrorCode(error: unknown): string | undefined {
  if (error && typeof error === 'object' && 'code' in error) {
    return String(error.code);
  }

  return undefined;
}

/**
 * Check if error is a specific type
 */
export function isErrorWithCode(error: unknown, code: string): boolean {
  return getErrorCode(error) === code;
}

/**
 * Create a standardized API error response
 */
export interface ApiErrorResponse {
  success: false;
  message: string;
  code?: string;
  details?: Record<string, unknown>;
}

export function createApiError(
  error: unknown,
  defaultMessage = 'Internal server error',
  details?: Record<string, unknown>
): ApiErrorResponse {
  const err = toError(error);

  return {
    success: false,
    message: err.message || defaultMessage,
    code: getErrorCode(error),
    details,
  };
}
