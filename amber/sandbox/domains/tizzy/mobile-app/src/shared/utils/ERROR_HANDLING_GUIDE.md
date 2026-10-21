# Comprehensive Error Handling System

A professional error handling utility system for the Tizzy mobile app with built-in error classification, user-friendly messages, recovery strategies, and automatic retry logic.

## Features

- **TypeScript Error Classes**: Strongly-typed custom error classes for different error scenarios
- **Error Classification**: Automatic classification of errors into meaningful categories
- **User-Friendly Messages**: Conversion of technical errors to user-understandable messages
- **Recovery Strategies**: Predefined recovery actions for different error types
- **Automatic Retry Logic**: Built-in exponential backoff retry mechanism
- **Error Logging**: Structured error logging for debugging and monitoring
- **BLE Support**: Special handling for Bluetooth Low Energy errors
- **Network Resilience**: Comprehensive handling of network, timeout, and rate-limit errors

## Error Types

### NetworkError
Network connectivity issues, including connection refused, offline mode, etc.

```typescript
throw new NetworkError('Connection refused', 'ECONNREFUSED');
```

**Recovery Strategy**: `CHECK_INTERNET`
**Retryable**: Yes

### TimeoutError
Request or operation timeouts.

```typescript
throw new TimeoutError('Request took too long');
```

**Recovery Strategy**: `RETRY`
**Retryable**: Yes
**Retry Delay**: 2000ms

### AuthError
Authentication and authorization issues.

```typescript
// Token expired
throw new AuthError('Session expired', 'expired_token');

// Invalid credentials
throw new AuthError('Wrong password', 'invalid_credentials');

// Access denied
throw new AuthError('Insufficient permissions', 'access_denied');
```

**Subtypes**:
- `expired_token`: Recovery with `REFRESH_TOKEN`
- `invalid_token`: Recovery with `REFRESH_TOKEN`
- `invalid_credentials`: Recovery with `LOGOUT`
- `access_denied`: Recovery with `NONE`

**Retryable**: No

### ValidationError
Invalid input data or malformed requests.

```typescript
throw new ValidationError(
  'Invalid email format',
  'email',
  'invalid@.com',
  'email_format'
);
```

**Recovery Strategy**: `NONE`
**Retryable**: No

### BLEError
Bluetooth Low Energy and device connection issues.

```typescript
// Bluetooth disabled
throw new BLEError('Please enable Bluetooth', 'disabled');

// Device not found
throw new BLEError('Device not in range', 'not_found');

// Connection lost
throw new BLEError('Unexpected disconnect', 'disconnected');

// Permission denied
throw new BLEError('BLE permission needed', 'permission_denied');
```

**Subtypes**:
- `disabled`: Recovery with `ENABLE_BLUETOOTH`, Retry delay: 0ms
- `not_found`: Recovery with `RETRY`, Retry delay: 3000ms
- `disconnected`: Recovery with `RETRY`, Retry delay: 2000ms
- `permission_denied`: Recovery with `GRANT_PERMISSION`, Retry delay: 0ms

**Retryable**: Depends on subtype

### PermissionError
Missing app permissions (location, camera, microphone, etc.).

```typescript
throw new PermissionError('LOCATION');
throw new PermissionError('CAMERA');
throw new PermissionError('MICROPHONE');
```

**Recovery Strategy**: `GRANT_PERMISSION`
**Retryable**: No

### RateLimitError
Too many requests in a short period.

```typescript
throw new RateLimitError('Rate limit exceeded', 60000); // 60 second wait
```

**Recovery Strategy**: `WAIT_AND_RETRY`
**Retryable**: Yes (after delay)

### ServerError
Server-side errors (5xx HTTP status codes).

```typescript
throw new ServerError(503, 'Service temporarily unavailable');
throw new ServerError(500);
```

**Recovery Strategy**: `RETRY`
**Retryable**: Yes
**Retry Delay**: 5000ms

### SystemError
Unexpected application errors.

```typescript
throw new SystemError('Something went wrong', 'UNKNOWN_ERR');
```

**Recovery Strategy**: `RETRY`
**Retryable**: Yes

## Usage Guide

### 1. Throwing Errors

```typescript
import { NetworkError, ValidationError, BLEError } from './utils/errorHandling';

// In your API service
async function fetchUserData() {
  try {
    const response = await axios.get('/api/user');
    return response.data;
  } catch (error) {
    throw new NetworkError('Failed to fetch user data', error.code);
  }
}

// In validation logic
function validateEmail(email: string) {
  if (!isValidEmail(email)) {
    throw new ValidationError(
      'Invalid email format',
      'email',
      email,
      'email_format'
    );
  }
}

// In BLE operations
async function connectToDevice(deviceId: string) {
  try {
    const device = await scanForDevice(deviceId);
    if (!device) {
      throw new BLEError('Device not found', 'not_found');
    }
    return device;
  } catch (error) {
    if (error instanceof BLEError) {
      throw error;
    }
    throw new BLEError('Connection failed', 'disconnected');
  }
}
```

### 2. Classifying and Handling Errors

```typescript
import { classifyError, formatErrorForDisplay } from './utils/errorHandling';

try {
  // Some operation
} catch (error) {
  // Classify the error
  const details = classifyError(error);

  console.log(details.type); // ErrorType
  console.log(details.severity); // ErrorSeverity
  console.log(details.userMessage); // User-friendly message
  console.log(details.canRetry); // Whether to retry
  console.log(details.recoveryStrategy); // What user should do

  // Format for UI display
  const formatted = formatErrorForDisplay(error);
  showErrorModal({
    title: formatted.title,
    message: formatted.message,
    suggestion: formatted.suggestion,
    onRetry: formatted.canRetry ? retryOperation : undefined,
  });
}
```

### 3. Displaying Errors to Users

```typescript
import { formatErrorForDisplay } from './utils/errorHandling';

function ErrorModal({ error, onDismiss, onRetry }: Props) {
  const formatted = formatErrorForDisplay(error);

  return (
    <Modal>
      <Text style={styles.title}>{formatted.title}</Text>
      <Text style={styles.message}>{formatted.message}</Text>

      {formatted.suggestion && (
        <Text style={styles.suggestion}>{formatted.suggestion}</Text>
      )}

      <View style={styles.buttons}>
        <Button onPress={onDismiss} title="Dismiss" />
        {formatted.canRetry && (
          <Button onPress={onRetry} title="Retry" color="primary" />
        )}
      </View>
    </Modal>
  );
}
```

### 4. Retry Logic

#### Simple Retry with Backoff

```typescript
import { retryWithBackoff } from './utils/errorHandling';

async function fetchDataWithRetry() {
  return retryWithBackoff(
    () => api.fetchUserData(),
    {
      maxAttempts: 3,
      baseDelay: 1000,
      maxDelay: 10000,
      backoffMultiplier: 2,
    }
  );
}
```

#### Manual Retry with Custom Logic

```typescript
import { shouldRetryError, getRetryDelay } from './utils/errorHandling';

async function connectWithRetry(deviceId: string) {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      return await connectToDevice(deviceId);
    } catch (error) {
      // Check if we should retry this error
      if (!shouldRetryError(error)) {
        throw error; // Don't retry this error type
      }

      // Don't retry on last attempt
      if (attempt === 4) {
        throw error;
      }

      // Wait before retrying with exponential backoff
      const delay = getRetryDelay(error, attempt);
      await sleep(delay);
    }
  }
}
```

#### Custom Retry Callback

```typescript
import { retryWithBackoff, BLEError } from './utils/errorHandling';

async function scanDevices() {
  return retryWithBackoff(() => ble.scan(), {
    maxAttempts: 5,
    baseDelay: 1000,
    shouldRetry: (error, attempt) => {
      // Retry BLE disconnection errors, but not permission errors
      if (error instanceof BLEError) {
        return error.subtype !== 'permission_denied';
      }
      return false;
    },
  });
}
```

### 5. Getting Recovery Suggestions

```typescript
import { getRecoverySuggestion } from './utils/errorHandling';

const suggestion = getRecoverySuggestion(details.recoveryStrategy);
// Example outputs:
// - 'Tap to retry'
// - 'Please log in again'
// - 'Turn on Bluetooth in your device settings'
// - 'Check your internet connection and try again'
```

### 6. Error Logging

```typescript
import { logError } from './utils/errorHandling';

async function fetchUserProfile(userId: string) {
  try {
    return await api.getUserProfile(userId);
  } catch (error) {
    // Log error for debugging
    logError(error, {
      userId,
      operation: 'fetchUserProfile',
      timestamp: new Date().toISOString(),
    });
    throw error;
  }
}
```

### 7. Type-Safe Error Handling

```typescript
import {
  AppError,
  AuthError,
  BLEError,
  ValidationError,
  NetworkError,
} from './utils/errorHandling';

function handleError(error: unknown) {
  if (error instanceof AuthError) {
    // Handle auth-specific error
    if (error.subtype === 'expired_token') {
      refreshToken();
    } else if (error.subtype === 'invalid_credentials') {
      showLoginScreen();
    }
  } else if (error instanceof BLEError) {
    // Handle BLE-specific error
    if (error.subtype === 'disabled') {
      promptEnableBluetooth();
    }
  } else if (error instanceof ValidationError) {
    // Handle validation error
    showFormError(error.field, error.userMessage);
  } else if (error instanceof NetworkError) {
    // Handle network error
    showNetworkError();
  } else if (error instanceof AppError) {
    // Handle other app errors
    logError(error);
  }
}
```

### 8. Exponential Backoff Calculation

```typescript
import { getExponentialBackoffDelay } from './utils/errorHandling';

// Get delay for each retry attempt
const attempt0Delay = getExponentialBackoffDelay(1000, 0); // 1000ms
const attempt1Delay = getExponentialBackoffDelay(1000, 1); // 2000ms
const attempt2Delay = getExponentialBackoffDelay(1000, 2); // 4000ms
const attempt3Delay = getExponentialBackoffDelay(1000, 3); // 8000ms

// With custom parameters
const customDelay = getExponentialBackoffDelay(
  baseDelay = 500,
  attemptNumber = 3,
  maxDelay = 15000,
  multiplier = 3
); // 500 * 3^3 = 13500ms, capped at 15000ms
```

## Recovery Strategies

| Strategy | Description | Action |
|----------|-------------|--------|
| `RETRY` | Retry the operation | Show retry button |
| `REFRESH_TOKEN` | Refresh authentication token | Attempt token refresh silently |
| `LOGOUT` | User must log in again | Show login screen |
| `ENABLE_BLUETOOTH` | Enable Bluetooth in settings | Prompt to enable BLE |
| `GRANT_PERMISSION` | Grant app permission | Prompt to grant permission |
| `CHECK_INTERNET` | Check internet connection | Show connection error message |
| `CONTACT_SUPPORT` | Contact support | Show support contact info |
| `WAIT_AND_RETRY` | Wait before retrying | Show countdown timer |
| `NONE` | No action needed | Dismiss error |

## Error Severity Levels

| Level | Description | Handling |
|-------|-------------|----------|
| `LOW` | Validation or minor errors | Log and show user message |
| `MEDIUM` | Recoverable errors | Log, show message, offer retry |
| `HIGH` | Important errors requiring action | Log, show prominent alert |
| `CRITICAL` | Fatal errors | Log extensively, show modal, may close app |

## Best Practices

### 1. Always Type Your Errors

```typescript
// Good
catch (error: unknown) {
  if (error instanceof NetworkError) {
    // Handle
  }
}

// Avoid
catch (error: any) {
  // Risky
}
```

### 2. Provide Context When Logging

```typescript
// Good
logError(error, {
  userId: currentUser.id,
  operation: 'fetchUserData',
  retryAttempt: 2,
  deviceId: device.id,
});

// Avoid
logError(error); // No context
```

### 3. Use Specific Error Classes

```typescript
// Good
if (statusCode === 401) {
  throw new AuthError('Token expired', 'expired_token');
}

// Avoid
throw new Error('Auth failed'); // Too generic
```

### 4. Handle Errors Based on Type

```typescript
// Good
const details = classifyError(error);
if (details.canRetry) {
  showRetryButton();
}

// Avoid
try {
  // operation
} catch {
  // always retry
}
```

### 5. Respect Retry Delays

```typescript
// Good
const delay = getRetryDelay(error, attemptNumber);
await sleep(delay); // Exponential backoff

// Avoid
for (let i = 0; i < 3; i++) {
  await operation(); // No delay between retries
}
```

## Error Flow Diagram

```
Error Occurs
    ↓
classifyError()
    ↓
    ├─ ErrorType determined
    ├─ Severity assessed
    ├─ User message generated
    └─ Recovery strategy assigned
    ↓
shouldRetryError()?
    ├─ Yes → getRetryDelay() → wait → retry
    └─ No → formatErrorForDisplay() → show to user
    ↓
User takes action based on recovery strategy
    ├─ RETRY → Retry operation
    ├─ REFRESH_TOKEN → Token refresh
    ├─ LOGOUT → Login again
    ├─ ENABLE_BLUETOOTH → System settings
    ├─ GRANT_PERMISSION → App permissions
    └─ NONE → Dismiss
```

## Integration with Monitoring Services

### Sentry Integration Example

```typescript
import * as Sentry from '@sentry/react-native';
import { logError, classifyError } from './utils/errorHandling';

export function setupErrorTracking() {
  Sentry.init({
    dsn: 'YOUR_SENTRY_DSN',
    environment: process.env.NODE_ENV,
  });
}

export function trackError(error: unknown, context?: Record<string, any>) {
  const details = classifyError(error);

  Sentry.captureException(error, {
    level: details.severity as any,
    tags: {
      errorType: details.type,
      retryable: details.canRetry.toString(),
    },
    contexts: {
      errorDetails: {
        userMessage: details.userMessage,
        recoveryStrategy: details.recoveryStrategy,
        technicalDetails: details.technicalDetails,
      },
      custom: context,
    },
  });

  // Also log locally
  logError(error, context);
}
```

## File Location

```
/Users/joelnewton/Desktop/2026-Code/tizzy/mobile-app/src/shared/utils/
├── errorHandling.ts                    # Main implementation
├── ERROR_HANDLING_GUIDE.md             # This documentation
└── __tests__/
    └── errorHandling.test.ts           # Test suite
```

## Quick Reference

### Creating Errors
```typescript
new NetworkError(message, code, technicalDetails)
new TimeoutError(message, technicalDetails)
new AuthError(message, subtype, technicalDetails)
new ValidationError(message, field, value, constraint)
new BLEError(message, subtype, technicalDetails)
new PermissionError(permissionName, technicalDetails)
new RateLimitError(message, retryAfter)
new ServerError(statusCode, message)
new SystemError(message, code, technicalDetails)
```

### Core Functions
```typescript
classifyError(error)                    // Get ErrorDetails
formatErrorForDisplay(error)             // Get display object
getRecoverySuggestion(strategy)         // Get user suggestion text
shouldRetryError(error)                 // Should we retry?
getRetryDelay(error, attemptNumber?)    // Get delay before retry
getExponentialBackoffDelay(...)         // Calculate backoff delay
retryWithBackoff(fn, options)           // Retry with backoff
logError(error, context)                // Log for debugging
```

## Testing

Run the comprehensive test suite:

```bash
npm test src/shared/utils/__tests__/errorHandling.test.ts
```

The test file includes:
- Error class creation and validation
- Error classification for different types
- Recovery suggestion generation
- Retry logic and exponential backoff
- Error display formatting
- Integration tests

## Version History

- **v1.0.0** (Current)
  - Custom TypeScript error classes
  - 9 error types with subtypes
  - Exponential backoff retry mechanism
  - User-friendly message mapping
  - Recovery strategy system
  - Comprehensive logging
  - BLE and network error handling
