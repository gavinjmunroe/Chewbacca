/**
 * Error Handling Utilities - Test Suite
 * Demonstrates usage of all error handling features
 */

import {
  // Error Classes
  AppError,
  AuthError,
  NetworkError,
  TimeoutError,
  ValidationError,
  BLEError,
  PermissionError,
  RateLimitError,
  ServerError,
  SystemError,
  // Functions
  classifyError,
  formatErrorForDisplay,
  getRecoverySuggestion,
  getRetryDelay,
  getExponentialBackoffDelay,
  shouldRetryError,
  retryWithBackoff,
  logError,
  // Types and Enums
  ErrorType,
  ErrorSeverity,
  RecoveryStrategy,
} from '../errorHandling';

describe('Error Classes', () => {
  describe('NetworkError', () => {
    it('should create a network error with proper details', () => {
      const error = new NetworkError('Connection refused', 'ECONNREFUSED');

      expect(error.type).toBe(ErrorType.NETWORK);
      expect(error.severity).toBe(ErrorSeverity.HIGH);
      expect(error.code).toBe('ECONNREFUSED');
      expect(error.userMessage).toContain('Unable to connect');
      expect(error.recoveryStrategy).toBe(RecoveryStrategy.CHECK_INTERNET);
    });
  });

  describe('TimeoutError', () => {
    it('should create a timeout error with retry delay', () => {
      const error = new TimeoutError('Request timeout');

      expect(error.type).toBe(ErrorType.TIMEOUT);
      expect(error.getRetryDelay()).toBe(2000);
      expect(error.userMessage).toContain('too long');
    });
  });

  describe('AuthError', () => {
    it('should handle expired token subtype', () => {
      const error = new AuthError('Token expired', 'expired_token');

      expect(error.type).toBe(ErrorType.AUTH);
      expect(error.subtype).toBe('expired_token');
      expect(error.recoveryStrategy).toBe(RecoveryStrategy.REFRESH_TOKEN);
    });

    it('should handle invalid credentials subtype', () => {
      const error = new AuthError('Invalid creds', 'invalid_credentials');

      expect(error.subtype).toBe('invalid_credentials');
      expect(error.recoveryStrategy).toBe(RecoveryStrategy.LOGOUT);
    });

    it('should not be retryable', () => {
      const error = new AuthError('Auth failed', 'invalid_token');

      expect(AuthError.isRetryable()).toBe(false);
    });
  });

  describe('ValidationError', () => {
    it('should create a validation error with field info', () => {
      const error = new ValidationError(
        'Invalid input',
        'email',
        'not-an-email',
        'email_format'
      );

      expect(error.type).toBe(ErrorType.VALIDATION);
      expect(error.field).toBe('email');
      expect(error.value).toBe('not-an-email');
      expect(error.constraint).toBe('email_format');
      expect(error.userMessage).toContain('Invalid email');
    });

    it('should not be retryable', () => {
      const error = new ValidationError('Bad input');

      expect(ValidationError.isRetryable()).toBe(false);
    });
  });

  describe('BLEError', () => {
    it('should handle disabled bluetooth', () => {
      const error = new BLEError('Bluetooth off', 'disabled');

      expect(error.subtype).toBe('disabled');
      expect(error.recoveryStrategy).toBe(RecoveryStrategy.ENABLE_BLUETOOTH);
      expect(error.getRetryDelay()).toBe(0);
    });

    it('should handle device not found', () => {
      const error = new BLEError('Device not found', 'not_found');

      expect(error.subtype).toBe('not_found');
      expect(error.recoveryStrategy).toBe(RecoveryStrategy.RETRY);
      expect(error.getRetryDelay()).toBe(3000);
    });

    it('should handle disconnection', () => {
      const error = new BLEError('Disconnected', 'disconnected');

      expect(error.subtype).toBe('disconnected');
      expect(error.getRetryDelay()).toBe(2000);
    });

    it('should handle permission denied', () => {
      const error = new BLEError('No permission', 'permission_denied');

      expect(error.subtype).toBe('permission_denied');
      expect(error.recoveryStrategy).toBe(RecoveryStrategy.GRANT_PERMISSION);
      expect(error.getRetryDelay()).toBe(0);
    });
  });

  describe('PermissionError', () => {
    it('should create a permission error for a specific permission', () => {
      const error = new PermissionError('LOCATION');

      expect(error.type).toBe(ErrorType.PERMISSION);
      expect(error.permission).toBe('LOCATION');
      expect(error.recoveryStrategy).toBe(RecoveryStrategy.GRANT_PERMISSION);
    });
  });

  describe('RateLimitError', () => {
    it('should create a rate limit error with retry-after', () => {
      const error = new RateLimitError('Too many requests', 30000);

      expect(error.type).toBe(ErrorType.RATE_LIMIT);
      expect(error.retryAfter).toBe(30000);
      expect(error.getRetryDelay()).toBe(30000);
    });
  });

  describe('ServerError', () => {
    it('should handle 503 service unavailable', () => {
      const error = new ServerError(503);

      expect(error.type).toBe(ErrorType.SERVER);
      expect(error.statusCode).toBe(503);
      expect(error.message).toContain('Service Unavailable');
      expect(error.getRetryDelay()).toBe(5000);
    });

    it('should handle 500 internal server error', () => {
      const error = new ServerError(500, 'Database connection failed');

      expect(error.statusCode).toBe(500);
      expect(error.message).toBe('Database connection failed');
    });
  });

  describe('AppError base class', () => {
    it('should convert to ErrorDetails', () => {
      const error = new NetworkError('Test error');
      const details = error.toErrorDetails();

      expect(details.type).toBe(ErrorType.NETWORK);
      expect(details.severity).toBe(ErrorSeverity.HIGH);
      expect(details.canRetry).toBe(true);
    });

    it('should have proper prototype chain', () => {
      const error = new NetworkError('Test');

      expect(error instanceof NetworkError).toBe(true);
      expect(error instanceof AppError).toBe(true);
      expect(error instanceof Error).toBe(true);
    });
  });
});

describe('Error Classification', () => {
  it('should classify AppError instances', () => {
    const error = new ValidationError('Bad email', 'email');
    const details = classifyError(error);

    expect(details.type).toBe(ErrorType.VALIDATION);
    expect(details.canRetry).toBe(false);
  });

  it('should classify unknown errors', () => {
    const error = new Error('Some random error');
    const details = classifyError(error);

    expect(details.type).toBe(ErrorType.SYSTEM);
    expect(details.userMessage).toBe('An unexpected error occurred. Please try again.');
  });

  it('should handle null/undefined errors gracefully', () => {
    const details = classifyError('string error');

    expect(details.type).toBe(ErrorType.UNKNOWN);
    expect(details.message).toBeDefined();
  });
});

describe('Error Display Formatting', () => {
  it('should format error for UI display', () => {
    const error = new NetworkError('Connection failed');
    const formatted = formatErrorForDisplay(error);

    expect(formatted.title).toBe('Connection Error');
    expect(formatted.message).toContain('Unable to connect');
    expect(formatted.suggestion).toContain('internet');
    expect(formatted.canRetry).toBe(true);
  });

  it('should format different error types with appropriate titles', () => {
    const errors = [
      { error: new AuthError('Auth failed', 'invalid_credentials'), title: 'Authentication Error' },
      { error: new ValidationError('Invalid'), title: 'Invalid Input' },
      { error: new BLEError('BLE error', 'not_found'), title: 'Bluetooth Error' },
      { error: new PermissionError('CAMERA'), title: 'Permission Required' },
      { error: new TimeoutError('Timeout'), title: 'Request Timeout' },
    ];

    errors.forEach(({ error, title }) => {
      const formatted = formatErrorForDisplay(error);
      expect(formatted.title).toBe(title);
    });
  });
});

describe('Recovery Suggestions', () => {
  it('should provide appropriate recovery suggestion for retry strategy', () => {
    const suggestion = getRecoverySuggestion(RecoveryStrategy.RETRY);
    expect(suggestion).toContain('retry');
  });

  it('should provide appropriate recovery suggestion for auth strategy', () => {
    const suggestion = getRecoverySuggestion(RecoveryStrategy.REFRESH_TOKEN);
    expect(suggestion).toContain('log in');
  });

  it('should provide appropriate recovery suggestion for permission strategy', () => {
    const suggestion = getRecoverySuggestion(RecoveryStrategy.GRANT_PERMISSION);
    expect(suggestion).toContain('permissions');
  });

  it('should provide empty suggestion for NONE strategy', () => {
    const suggestion = getRecoverySuggestion(RecoveryStrategy.NONE);
    expect(suggestion).toBe('');
  });
});

describe('Retry Logic', () => {
  it('should determine if error should be retried', () => {
    const networkError = new NetworkError('Failed');
    const validationError = new ValidationError('Invalid');

    expect(shouldRetryError(networkError)).toBe(true);
    expect(shouldRetryError(validationError)).toBe(false);
  });

  it('should get retry delay without attempt number', () => {
    const error = new TimeoutError('Timeout');
    const delay = getRetryDelay(error);

    expect(delay).toBe(2000);
  });

  it('should apply exponential backoff with attempt number', () => {
    const error = new NetworkError('Failed');

    const delay0 = getRetryDelay(error, 0);
    const delay1 = getRetryDelay(error, 1);
    const delay2 = getRetryDelay(error, 2);

    expect(delay0).toBeLessThanOrEqual(3000);
    expect(delay1).toBeGreaterThanOrEqual(delay0);
    expect(delay2).toBeGreaterThanOrEqual(delay1);
  });

  it('should calculate exponential backoff with custom parameters', () => {
    const delay0 = getExponentialBackoffDelay(1000, 0);
    const delay1 = getExponentialBackoffDelay(1000, 1);
    const delay2 = getExponentialBackoffDelay(1000, 2);
    const delay3 = getExponentialBackoffDelay(1000, 3);

    expect(delay0).toBe(1000);
    expect(delay1).toBe(2000);
    expect(delay2).toBe(4000);
    expect(delay3).toBe(8000);
  });

  it('should cap exponential backoff at max delay', () => {
    const delay = getExponentialBackoffDelay(1000, 10, 30000);

    expect(delay).toBeLessThanOrEqual(30000);
  });

  it('should retry function with backoff', async () => {
    let attempts = 0;

    const fn = async () => {
      attempts++;
      if (attempts < 3) {
        throw new NetworkError('Failed');
      }
      return 'success';
    };

    const result = await retryWithBackoff(fn, {
      maxAttempts: 5,
      baseDelay: 10,
      maxDelay: 100,
    });

    expect(result).toBe('success');
    expect(attempts).toBe(3);
  });

  it('should throw after max attempts', async () => {
    const fn = async () => {
      throw new NetworkError('Always fails');
    };

    await expect(
      retryWithBackoff(fn, { maxAttempts: 2, baseDelay: 10 })
    ).rejects.toThrow();
  });

  it('should respect custom shouldRetry callback', async () => {
    let attempts = 0;

    const fn = async () => {
      attempts++;
      throw new ValidationError('Invalid');
    };

    await expect(
      retryWithBackoff(fn, {
        maxAttempts: 5,
        baseDelay: 10,
        shouldRetry: () => false,
      })
    ).rejects.toThrow();

    expect(attempts).toBe(1);
  });
});

describe('Error Logging', () => {
  const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

  afterEach(() => {
    consoleErrorSpy.mockClear();
  });

  it('should log error with context in development', () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';

    const error = new NetworkError('Network failed');
    logError(error, { userId: '123', operation: 'fetchUser' });

    expect(consoleErrorSpy).toHaveBeenCalled();

    process.env.NODE_ENV = originalEnv;
  });

  it('should not log in production', () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';

    consoleErrorSpy.mockClear();
    const error = new NetworkError('Network failed');
    logError(error);

    expect(consoleErrorSpy).not.toHaveBeenCalled();

    process.env.NODE_ENV = originalEnv;
  });
});

describe('Integration Tests', () => {
  it('should handle complete error flow with formatting and recovery', () => {
    const error = new BLEError('Device timeout', 'not_found');

    // Classify
    const details = classifyError(error);
    expect(details.type).toBe(ErrorType.BLE);

    // Format for display
    const formatted = formatErrorForDisplay(error);
    expect(formatted.title).toBe('Bluetooth Error');
    expect(formatted.canRetry).toBe(true);

    // Get recovery suggestion
    const suggestion = getRecoverySuggestion(details.recoveryStrategy);
    expect(suggestion).toContain('retry');

    // Get retry delay
    const delay = getRetryDelay(error, 0);
    expect(delay).toBeGreaterThan(0);
  });

  it('should handle error in async operation with retry', async () => {
    let attempts = 0;

    const connectToDevice = async () => {
      attempts++;
      if (attempts < 2) {
        throw new BLEError('Connection timeout', 'disconnected');
      }
      return { deviceId: '12345' };
    };

    const result = await retryWithBackoff(connectToDevice, {
      maxAttempts: 3,
      baseDelay: 10,
      shouldRetry: (error) => error instanceof BLEError && error.subtype === 'disconnected',
    });

    expect(result.deviceId).toBe('12345');
    expect(attempts).toBe(2);
  });
});
