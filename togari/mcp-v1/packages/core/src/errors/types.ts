/**
 * Base error class for all application errors
 */
export class AppError extends Error {
  public readonly code: string;
  public readonly statusCode: number;
  public readonly isRetryable: boolean;
  public readonly metadata: Record<string, unknown>;

  constructor(
    message: string,
    code: string,
    statusCode: number,
    isRetryable: boolean,
    metadata: Record<string, unknown> = {}
  ) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.statusCode = statusCode;
    this.isRetryable = isRetryable;
    this.metadata = metadata;

    // Maintains proper stack trace for where error was thrown
    Error.captureStackTrace(this, this.constructor);
  }

  /**
   * Convert error to JSON representation
   */
  toJSON(): Record<string, unknown> {
    return {
      error: this.code,
      message: this.message,
      retryable: this.isRetryable,
      ...this.metadata,
    };
  }

  /**
   * Wrap any error in AppError
   */
  static fromError(error: unknown): AppError {
    if (error instanceof AppError) {
      return error;
    }

    if (error instanceof Error) {
      return new AppError(
        error.message,
        'INTERNAL_ERROR',
        500,
        false,
        { originalError: error.name }
      );
    }

    return new AppError(
      String(error),
      'UNKNOWN_ERROR',
      500,
      false,
      {}
    );
  }
}

/**
 * Validation error for invalid input
 */
export class ValidationError extends AppError {
  constructor(message: string, fields?: Record<string, string>) {
    super(
      message,
      'VALIDATION_ERROR',
      400,
      false,
      fields ? { fields } : {}
    );
  }
}

/**
 * Rate limit exceeded error
 */
export class RateLimitError extends AppError {
  constructor(retryAfter: number, limit: string) {
    super(
      `Rate limit exceeded: ${limit}. Retry after ${retryAfter} seconds.`,
      'RATE_LIMIT_EXCEEDED',
      429,
      true,
      { retryAfter, limit }
    );
  }
}

/**
 * Upstream API error
 */
export class UpstreamAPIError extends AppError {
  constructor(
    apiName: string,
    originalError: unknown,
    isRetryable: boolean = true
  ) {
    const errorMessage = originalError instanceof Error
      ? originalError.message
      : String(originalError);

    super(
      `Upstream API error from ${apiName}: ${errorMessage}`,
      'UPSTREAM_API_ERROR',
      502,
      isRetryable,
      { apiName, originalError: errorMessage }
    );
  }
}

/**
 * Resource not found error
 */
export class NotFoundError extends AppError {
  constructor(resource: string, identifier?: string) {
    const message = identifier
      ? `${resource} not found: ${identifier}`
      : `${resource} not found`;

    super(
      message,
      'NOT_FOUND',
      404,
      false,
      identifier ? { resource, identifier } : { resource }
    );
  }
}

/**
 * Partial success error for batch operations
 */
export class PartialSuccessError extends AppError {
  constructor(
    succeeded: number,
    failed: number,
    errors: Array<{ index: number; error: string }>
  ) {
    super(
      `Batch operation partially succeeded: ${succeeded} succeeded, ${failed} failed`,
      'PARTIAL_SUCCESS',
      207,
      false,
      { succeeded, failed, errors }
    );
  }
}

/**
 * File parsing error
 */
export class FileParseError extends AppError {
  constructor(
    message: string,
    rowNumber?: number,
    columnName?: string
  ) {
    const metadata: Record<string, unknown> = {};
    if (rowNumber !== undefined) {
      metadata.rowNumber = rowNumber;
    }
    if (columnName !== undefined) {
      metadata.columnName = columnName;
    }

    super(
      message,
      'FILE_PARSE_ERROR',
      400,
      false,
      metadata
    );
  }
}

/**
 * Configuration error
 */
export class ConfigurationError extends AppError {
  constructor(message: string, configKey?: string) {
    super(
      message,
      'CONFIGURATION_ERROR',
      500,
      false,
      configKey ? { configKey } : {}
    );
  }
}
