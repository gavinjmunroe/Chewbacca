/**
 * Error Handling Examples
 * Real-world usage patterns for the error handling system
 */

import {
  AuthError,
  BLEError,
  NetworkError,
  PermissionError,
  RateLimitError,
  ValidationError,
  classifyError,
  formatErrorForDisplay,
  getExponentialBackoffDelay,
  getRecoverySuggestion,
  getRetryDelay,
  logError,
  retryWithBackoff,
  shouldRetryError,
} from './errorHandling';

// ============================================================================
// Example 1: API Service with Error Handling
// ============================================================================

class ApiService {
  private baseURL = 'https://api.tizzy.com';

  async fetchUserData(userId: string) {
    try {
      const response = await fetch(`${this.baseURL}/users/${userId}`);

      if (!response.ok) {
        const data = await response.json();

        // Handle specific HTTP status codes
        if (response.status === 401) {
          throw new AuthError('Invalid or expired token', 'expired_token');
        }

        if (response.status === 404) {
          throw new ValidationError('User not found', 'userId', userId);
        }

        if (response.status === 429) {
          const retryAfter = parseInt(response.headers.get('Retry-After') || '60000');
          throw new RateLimitError('Too many requests', retryAfter);
        }

        if (response.status >= 500) {
          throw new Error(`Server error: ${response.status}`);
        }

        throw new Error(`HTTP ${response.status}: ${data.message}`);
      }

      return response.json();
    } catch (error) {
      // Log with context
      logError(error, {
        service: 'ApiService',
        method: 'fetchUserData',
        userId,
      });

      throw error;
    }
  }

  // Retry wrapper for API calls
  async fetchWithRetry<T>(fn: () => Promise<T>, operationName: string): Promise<T> {
    try {
      return await retryWithBackoff(fn, {
        maxAttempts: 3,
        baseDelay: 1000,
        maxDelay: 10000,
        backoffMultiplier: 2,
        shouldRetry: (error) => {
          // Don't retry auth or validation errors
          if (error instanceof AuthError || error instanceof ValidationError) {
            return false;
          }
          return shouldRetryError(error);
        },
      });
    } catch (error) {
      logError(error, {
        service: 'ApiService',
        operation: operationName,
        finalAttempt: true,
      });
      throw error;
    }
  }
}

// ============================================================================
// Example 2: Bluetooth Device Connection with Error Recovery
// ============================================================================

class BLEDeviceManager {
  async connectToDevice(deviceId: string, maxRetries = 3) {
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        // Simulate device connection
        const device = await this.scanForDevice(deviceId);

        if (!device) {
          throw new BLEError('Device not found during scan', 'not_found');
        }

        return device;
      } catch (error) {
        const details = classifyError(error);

        // Log the attempt
        logError(error, {
          component: 'BLEDeviceManager',
          deviceId,
          attempt: attempt + 1,
          maxRetries,
        });

        // Don't retry permission errors
        if (error instanceof BLEError && error.subtype === 'permission_denied') {
          throw error;
        }

        // Don't retry on last attempt
        if (attempt === maxRetries - 1) {
          throw error;
        }

        // Wait with exponential backoff
        const delay = getExponentialBackoffDelay(1000, attempt, 10000);
        console.log(`Retrying in ${delay}ms...`);
        await this.sleep(delay);
      }
    }
  }

  async handleConnectionError(error: unknown) {
    if (error instanceof BLEError) {
      const suggestion = getRecoverySuggestion(error.recoveryStrategy);

      switch (error.subtype) {
        case 'disabled':
          // Prompt user to enable Bluetooth
          return { action: 'ENABLE_BLUETOOTH', message: suggestion };

        case 'not_found':
          // Suggest moving closer to device
          return {
            action: 'RETRY',
            message: 'Device not found. Make sure it is powered on and nearby.',
          };

        case 'disconnected':
          // Attempt automatic reconnection
          return { action: 'AUTO_RETRY', message: suggestion };

        case 'permission_denied':
          // Prompt for permissions
          return { action: 'GRANT_PERMISSION', message: suggestion };
      }
    }

    return { action: 'ERROR', message: 'Unknown BLE error' };
  }

  private async scanForDevice(deviceId: string) {
    // Placeholder for actual BLE scan
    return null;
  }

  private sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// ============================================================================
// Example 3: Form Validation with Error Display
// ============================================================================

class FormValidator {
  validateEmail(email: string): void {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (!email) {
      throw new ValidationError(
        'Email is required',
        'email',
        email,
        'required'
      );
    }

    if (!emailRegex.test(email)) {
      throw new ValidationError(
        'Invalid email format',
        'email',
        email,
        'format'
      );
    }
  }

  validatePassword(password: string): void {
    if (password.length < 8) {
      throw new ValidationError(
        'Password must be at least 8 characters',
        'password',
        password,
        'minLength'
      );
    }

    if (!/[A-Z]/.test(password)) {
      throw new ValidationError(
        'Password must contain uppercase letter',
        'password',
        password,
        'uppercase'
      );
    }

    if (!/[0-9]/.test(password)) {
      throw new ValidationError(
        'Password must contain a number',
        'password',
        password,
        'number'
      );
    }
  }

  validateForm(formData: Record<string, any>) {
    const errors: Record<string, string> = {};

    // Validate each field
    const fields = [
      { field: 'email', validator: () => this.validateEmail(formData.email) },
      { field: 'password', validator: () => this.validatePassword(formData.password) },
    ];

    for (const { field, validator } of fields) {
      try {
        validator();
      } catch (error) {
        if (error instanceof ValidationError) {
          errors[field] = error.userMessage;
        }
      }
    }

    return { isValid: Object.keys(errors).length === 0, errors };
  }
}

// ============================================================================
// Example 4: Error Handling Hook for React Components
// ============================================================================

interface ErrorState {
  error: unknown | null;
  isRetrying: boolean;
  retryCount: number;
}

class ErrorHandler {
  private state: ErrorState = {
    error: null,
    isRetrying: false,
    retryCount: 0,
  };

  handleError(error: unknown, context?: Record<string, any>) {
    // Classify and store error
    const details = classifyError(error);

    this.state.error = error;

    // Log with context
    logError(error, {
      ...context,
      timestamp: new Date().toISOString(),
    });

    return {
      details,
      formatted: formatErrorForDisplay(error),
      shouldRetry: details.canRetry,
    };
  }

  async retryOperation<T>(
    operation: () => Promise<T>,
    onRetry?: (attemptNumber: number) => void
  ): Promise<T | null> {
    this.state.isRetrying = true;
    this.state.retryCount = 0;

    try {
      return await retryWithBackoff(operation, {
        maxAttempts: 3,
        baseDelay: 1000,
        maxDelay: 5000,
        shouldRetry: (error) => shouldRetryError(error),
      });
    } catch (error) {
      this.state.error = error;
      logError(error, { failedAfterRetries: this.state.retryCount });
      return null;
    } finally {
      this.state.isRetrying = false;
    }
  }

  getDisplayMessage(): { title: string; message: string; suggestion: string } {
    if (!this.state.error) {
      return { title: '', message: '', suggestion: '' };
    }

    const formatted = formatErrorForDisplay(this.state.error);
    return {
      title: formatted.title,
      message: formatted.message,
      suggestion: formatted.suggestion,
    };
  }

  clearError() {
    this.state = {
      error: null,
      isRetrying: false,
      retryCount: 0,
    };
  }
}

// ============================================================================
// Example 5: Authentication Service with Token Refresh
// ============================================================================

class AuthService {
  private tokenRefreshInProgress = false;

  async login(username: string, password: string) {
    try {
      const response = await fetch('https://api.tizzy.com/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      });

      if (!response.ok) {
        if (response.status === 401) {
          throw new AuthError(
            'Invalid credentials',
            'invalid_credentials'
          );
        }

        throw new Error(`Login failed: ${response.statusText}`);
      }

      return response.json();
    } catch (error) {
      logError(error, { service: 'AuthService', method: 'login' });
      throw error;
    }
  }

  async refreshToken(refreshToken: string) {
    // Prevent multiple simultaneous token refresh requests
    if (this.tokenRefreshInProgress) {
      return;
    }

    this.tokenRefreshInProgress = true;

    try {
      const response = await fetch('https://api.tizzy.com/auth/refresh', {
        method: 'POST',
        body: JSON.stringify({ refreshToken }),
      });

      if (!response.ok) {
        if (response.status === 401) {
          // Token is invalid or expired, user must login again
          throw new AuthError(
            'Refresh token expired',
            'expired_token'
          );
        }

        throw new Error('Token refresh failed');
      }

      return response.json();
    } catch (error) {
      logError(error, {
        service: 'AuthService',
        method: 'refreshToken',
      });

      // If token refresh fails with 401, force logout
      if (error instanceof AuthError && error.subtype === 'expired_token') {
        // Emit logout event
        return { requiresLogout: true };
      }

      throw error;
    } finally {
      this.tokenRefreshInProgress = false;
    }
  }

  handleAuthError(error: unknown) {
    if (error instanceof AuthError) {
      switch (error.subtype) {
        case 'expired_token':
          return { action: 'REFRESH_TOKEN' };
        case 'invalid_token':
          return { action: 'REFRESH_TOKEN' };
        case 'invalid_credentials':
          return { action: 'LOGOUT' };
        case 'access_denied':
          return { action: 'SHOW_ERROR' };
      }
    }

    return { action: 'UNKNOWN' };
  }
}

// ============================================================================
// Example 6: Custom Error Monitoring
// ============================================================================

interface ErrorMetric {
  type: string;
  count: number;
  lastOccurrence: Date;
  avgRetryAttempts?: number;
}

class ErrorMetricsCollector {
  private metrics: Map<string, ErrorMetric> = new Map();

  recordError(error: unknown, retryAttempt?: number) {
    const details = classifyError(error);
    const key = `${details.type}:${details.code || 'unknown'}`;

    const existing = this.metrics.get(key) || {
      type: details.type,
      count: 0,
      lastOccurrence: new Date(),
      avgRetryAttempts: 0,
    };

    existing.count++;
    existing.lastOccurrence = new Date();

    if (retryAttempt !== undefined) {
      existing.avgRetryAttempts = existing.avgRetryAttempts
        ? (existing.avgRetryAttempts + retryAttempt) / 2
        : retryAttempt;
    }

    this.metrics.set(key, existing);
  }

  getMetrics() {
    return Array.from(this.metrics.values());
  }

  getMostCommonErrors(limit = 5) {
    return Array.from(this.metrics.values())
      .sort((a, b) => b.count - a.count)
      .slice(0, limit);
  }

  exportMetrics() {
    return {
      totalErrors: Array.from(this.metrics.values()).reduce(
        (sum, m) => sum + m.count,
        0
      ),
      uniqueErrorTypes: this.metrics.size,
      errors: this.getMetrics(),
    };
  }
}

// ============================================================================
// Example 7: Exponential Backoff Calculator
// ============================================================================

class BackoffCalculator {
  /**
   * Calculate optimal retry delay based on error and attempt number
   */
  getOptimalDelay(
    error: unknown,
    attemptNumber: number,
    maxDelay = 30000
  ): number {
    const details = classifyError(error);

    // Rate limit errors should use their specified delay
    if (error instanceof RateLimitError) {
      return error.getRetryDelay();
    }

    // Network errors: exponential backoff starting from 1s
    if (error instanceof NetworkError) {
      return getExponentialBackoffDelay(1000, attemptNumber, maxDelay);
    }

    // BLE errors: slower backoff starting from 2s
    if (error instanceof BLEError) {
      const baseDelay = error.getRetryDelay();
      if (baseDelay === 0) return 0; // Don't retry
      return getExponentialBackoffDelay(baseDelay, attemptNumber, maxDelay);
    }

    // Default: exponential backoff from 500ms
    return getExponentialBackoffDelay(500, attemptNumber, maxDelay);
  }

  /**
   * Calculate total time for N retry attempts
   */
  calculateTotalRetryTime(
    error: unknown,
    maxAttempts: number
  ): number {
    let total = 0;
    for (let i = 0; i < maxAttempts - 1; i++) {
      total += this.getOptimalDelay(error, i);
    }
    return total;
  }

  /**
   * Show retry countdown to user
   */
  async retryWithCountdown(
    operation: () => Promise<void>,
    delayMs: number,
    onCountdownUpdate?: (remaining: number) => void
  ): Promise<void> {
    const startTime = Date.now();
    const endTime = startTime + delayMs;

    // Update countdown every 100ms
    const interval = setInterval(() => {
      const remaining = Math.max(0, endTime - Date.now());
      if (onCountdownUpdate) {
        onCountdownUpdate(remaining);
      }

      if (remaining === 0) {
        clearInterval(interval);
      }
    }, 100);

    // Wait for delay
    await new Promise((resolve) => setTimeout(resolve, delayMs));

    // Execute operation
    await operation();
  }
}

// ============================================================================
// Export all examples
// ============================================================================

export {
  ApiService,
  AuthService,
  BackoffCalculator,
  BLEDeviceManager,
  ErrorHandler,
  ErrorMetricsCollector,
  FormValidator,
};
