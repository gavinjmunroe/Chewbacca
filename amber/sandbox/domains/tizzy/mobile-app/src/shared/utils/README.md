# Error Handling System - Implementation Summary

A comprehensive, professional error handling system for the Tizzy mobile application with TypeScript error classes, automatic retry logic, and user-friendly error messages.

## Files Included

### Core Implementation
- **errorHandling.ts** (1,035 lines)
  - 9 custom error classes (NetworkError, AuthError, ValidationError, BLEError, TimeoutError, RateLimitError, PermissionError, ServerError, SystemError)
  - Error classification system
  - User-friendly message mapping
  - Recovery strategy framework
  - Automatic retry logic with exponential backoff
  - Error logging infrastructure

### Documentation
- **ERROR_HANDLING_GUIDE.md**
  - Comprehensive usage guide
  - Feature overview
  - Real-world examples
  - Best practices
  - Integration patterns
  - Recovery strategies reference
  - Error severity levels

- **ERROR_HANDLING_EXAMPLES.ts**
  - 7 practical implementation examples
  - API service with error handling
  - Bluetooth device connection management
  - Form validation with errors
  - React error handling hook
  - Authentication service with token refresh
  - Error metrics collection
  - Exponential backoff calculator

### Testing
- **__tests__/errorHandling.test.ts** (400+ lines)
  - Comprehensive test suite
  - All error classes tested
  - Classification logic verified
  - Retry mechanisms validated
  - Integration tests included

## Key Features

### Error Classes
```typescript
new NetworkError(message, code)
new TimeoutError(message)
new AuthError(message, subtype)
new ValidationError(message, field, value, constraint)
new BLEError(message, subtype)
new PermissionError(permissionName)
new RateLimitError(message, retryAfter)
new ServerError(statusCode, message)
new SystemError(message, code)
```

### Core Functions
```typescript
classifyError(error)                  // Classify any error
formatErrorForDisplay(error)          // Get display object
getRecoverySuggestion(strategy)       // User suggestion text
shouldRetryError(error)               // Check if retryable
getRetryDelay(error, attemptNumber?)  // Get delay with backoff
getExponentialBackoffDelay(...)       // Calculate backoff
retryWithBackoff(fn, options)         // Retry with strategy
logError(error, context)              // Log for debugging
```

## Quick Start

### Installation
No external dependencies beyond Axios (already in project)

```typescript
import {
  NetworkError,
  ValidationError,
  classifyError,
  formatErrorForDisplay,
  retryWithBackoff,
} from '@/shared/utils/errorHandling';
```

### Basic Usage
```typescript
// Throw errors
throw new NetworkError('Failed to fetch', 'ECONNREFUSED');

// Handle errors
try {
  await operation();
} catch (error) {
  const details = classifyError(error);
  const formatted = formatErrorForDisplay(error);

  showErrorModal({
    title: formatted.title,
    message: formatted.message,
    suggestion: formatted.suggestion,
  });
}

// Retry with backoff
await retryWithBackoff(
  () => api.fetchData(),
  { maxAttempts: 3, baseDelay: 1000 }
);
```

## Error Classification

| Type | Cause | Recovery | Retryable |
|------|-------|----------|-----------|
| **NETWORK** | Connection issues | Check internet | ✓ Yes |
| **TIMEOUT** | Request too long | Retry | ✓ Yes |
| **AUTH** | Invalid credentials/token | Refresh/logout | ✗ No |
| **VALIDATION** | Invalid input | Fix input | ✗ No |
| **BLE** | Bluetooth issues | Enable/retry | Depends |
| **PERMISSION** | Missing permissions | Grant permission | ✗ No |
| **RATE_LIMIT** | Too many requests | Wait and retry | ✓ Yes |
| **SERVER** | 5xx errors | Retry | ✓ Yes |
| **SYSTEM** | Unexpected errors | Retry | ✓ Yes |

## Exponential Backoff

Automatic exponential backoff with configurable parameters:

```typescript
// Attempt 0: 1000ms * 2^0 = 1000ms
// Attempt 1: 1000ms * 2^1 = 2000ms
// Attempt 2: 1000ms * 2^2 = 4000ms
// Attempt 3: 1000ms * 2^3 = 8000ms
// ...capped at maxDelay

const delay = getRetryDelay(error, attemptNumber);
```

## Recovery Strategies

- **RETRY**: User taps to retry
- **REFRESH_TOKEN**: Auto-refresh authentication
- **LOGOUT**: Require user login
- **ENABLE_BLUETOOTH**: Prompt system settings
- **GRANT_PERMISSION**: Request app permission
- **CHECK_INTERNET**: Show connection error
- **WAIT_AND_RETRY**: Show countdown timer
- **CONTACT_SUPPORT**: Show support info
- **NONE**: Dismiss error

## Error Severity

- **LOW**: Validation errors, minor issues
- **MEDIUM**: Recoverable errors, timeouts
- **HIGH**: Important errors, auth failures
- **CRITICAL**: Fatal errors

## Type Safety

Full TypeScript support with proper type checking:

```typescript
if (error instanceof AuthError) {
  // Handle auth-specific logic
  if (error.subtype === 'expired_token') {
    refreshToken();
  }
}

if (error instanceof BLEError) {
  // Handle Bluetooth-specific logic
  const delay = error.getRetryDelay();
}
```

## Logging

Structured error logging with context:

```typescript
logError(error, {
  userId: user.id,
  operation: 'fetchUserData',
  deviceId: device.id,
  attemptNumber: 2,
});
```

In development, logs to console. In production, integrate with Sentry or similar service.

## Integration Example

```typescript
class DataService {
  async fetchWithRetry<T>(fn: () => Promise<T>) {
    return retryWithBackoff(fn, {
      maxAttempts: 3,
      baseDelay: 1000,
      maxDelay: 10000,
      shouldRetry: (error) => {
        // Custom retry logic
        if (error instanceof ValidationError) {
          return false; // Don't retry validation errors
        }
        return shouldRetryError(error);
      },
    });
  }

  async getUserData(userId: string) {
    try {
      return await this.fetchWithRetry(
        () => this.api.getUser(userId)
      );
    } catch (error) {
      logError(error, { userId, operation: 'getUserData' });
      throw error;
    }
  }
}
```

## Testing

Run the comprehensive test suite:

```bash
npm test src/shared/utils/__tests__/errorHandling.test.ts
```

Tests cover:
- All error class creation
- Error classification
- Retry logic and backoff
- Recovery suggestions
- Display formatting
- Integration scenarios

## Best Practices

1. **Always type your errors**
   ```typescript
   catch (error: unknown) {
     if (error instanceof NetworkError) { ... }
   }
   ```

2. **Provide context when logging**
   ```typescript
   logError(error, { userId, operation, attempt });
   ```

3. **Use specific error classes**
   ```typescript
   throw new ValidationError('Invalid', 'email');
   ```

4. **Check retryability before retrying**
   ```typescript
   if (shouldRetryError(error)) { retry(); }
   ```

5. **Respect retry delays**
   ```typescript
   const delay = getRetryDelay(error, attemptNumber);
   ```

## File Locations

```
/Users/joelnewton/Desktop/2026-Code/tizzy/mobile-app/src/shared/utils/
├── errorHandling.ts                   # Main implementation (1035 lines)
├── ERROR_HANDLING_GUIDE.md            # Comprehensive guide
├── ERROR_HANDLING_EXAMPLES.ts         # 7 practical examples
├── README.md                          # This file
└── __tests__/
    └── errorHandling.test.ts          # Test suite (400+ lines)
```

## Performance Considerations

- Minimal overhead: Simple instanceof checks and lookups
- Lazy evaluation: Error details only computed when needed
- Configurable backoff: Adjust delays for your use case
- No external dependencies: Only uses Axios (already present)

## Extensibility

Easy to extend with custom error types:

```typescript
export class CustomError extends AppError {
  constructor(message: string) {
    super(
      message,
      ErrorType.CUSTOM,
      ErrorSeverity.MEDIUM,
      'User-friendly message',
      RecoveryStrategy.RETRY,
      'CUSTOM_CODE'
    );
    this.name = 'CustomError';
    Object.setPrototypeOf(this, CustomError.prototype);
  }
}
```

## Monitoring Integration

Easily integrates with error monitoring services:

```typescript
Sentry.captureException(error, {
  level: details.severity,
  tags: { errorType: details.type },
  contexts: { errorDetails: details },
});
```

## Support

For questions or issues with the error handling system, refer to:
- ERROR_HANDLING_GUIDE.md for detailed documentation
- ERROR_HANDLING_EXAMPLES.ts for practical examples
- __tests__/errorHandling.test.ts for test patterns
