/**
 * Standardized error responses for ML researchers
 * Clear, actionable error messages with context
 */

export class AppError extends Error {
  constructor(
    public code: string,
    message: string,
    public statusCode: number = 400,
    public context?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export function handleError(error: unknown): { code: string; message: string; statusCode: number; context?: Record<string, unknown> } {
  if (error instanceof AppError) {
    return {
      code: error.code,
      message: error.message,
      statusCode: error.statusCode,
      context: error.context,
    };
  }

  if (error instanceof Error) {
    return {
      code: 'internal_error',
      message: error.message,
      statusCode: 500,
    };
  }

  return {
    code: 'unknown_error',
    message: 'An unexpected error occurred',
    statusCode: 500,
  };
}


