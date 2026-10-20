import { AppError } from './types';

/**
 * Error response structure
 */
export interface ErrorResponse {
  success: false;
  error: {
    code: string;
    message: string;
    retryable: boolean;
    retryAfter?: number;
    details?: Record<string, unknown>;
  };
  requestId?: string;
}

/**
 * Handle any error and convert to safe serializable response
 * Never exposes stack traces or sensitive information
 */
export function handleError(error: unknown, requestId?: string): ErrorResponse {
  let appError: AppError;

  // Convert to AppError if not already
  if (error instanceof AppError) {
    appError = error;
  } else {
    appError = AppError.fromError(error);
  }

  const response: ErrorResponse = {
    success: false,
    error: {
      code: appError.code,
      message: appError.message,
      retryable: appError.isRetryable,
    },
  };

  // Add retryAfter if present in metadata
  if (appError.metadata.retryAfter !== undefined) {
    response.error.retryAfter = appError.metadata.retryAfter as number;
  }

  // Add other metadata as details (excluding retryAfter to avoid duplication)
  const { retryAfter, ...otherMetadata } = appError.metadata;
  if (Object.keys(otherMetadata).length > 0) {
    response.error.details = otherMetadata;
  }

  // Add requestId if provided
  if (requestId) {
    response.requestId = requestId;
  }

  return response;
}

/**
 * Check if an error is retryable
 * Returns true for network errors, rate limits, 5xx errors
 */
export function isRetryableError(error: unknown): boolean {
  // Handle AppError instances
  if (error instanceof AppError) {
    return error.isRetryable;
  }

  // Handle native Error instances
  if (error instanceof Error) {
    const message = error.message.toLowerCase();

    // Network-related errors
    const networkErrors = [
      'network',
      'timeout',
      'econnrefused',
      'econnreset',
      'etimedout',
      'enotfound',
      'socket hang up',
      'fetch failed',
    ];

    if (networkErrors.some(keyword => message.includes(keyword))) {
      return true;
    }

    // Check for specific error names
    const retryableErrorNames = [
      'TimeoutError',
      'NetworkError',
      'FetchError',
    ];

    if (retryableErrorNames.includes(error.name)) {
      return true;
    }
  }

  // Handle objects with status code (e.g., HTTP errors)
  if (typeof error === 'object' && error !== null) {
    const errorObj = error as any;

    // 5xx server errors are retryable
    if (errorObj.statusCode >= 500 && errorObj.statusCode < 600) {
      return true;
    }

    if (errorObj.status >= 500 && errorObj.status < 600) {
      return true;
    }

    // 429 Too Many Requests is retryable
    if (errorObj.statusCode === 429 || errorObj.status === 429) {
      return true;
    }

    // 408 Request Timeout is retryable
    if (errorObj.statusCode === 408 || errorObj.status === 408) {
      return true;
    }
  }

  // Default to not retryable for unknown errors
  return false;
}
