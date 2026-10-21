# Error Handling and Recovery System

## Overview

The Tizzy mobile app includes a comprehensive error handling and recovery system that provides:

- **Automatic error classification** - Categorizes errors by type (network, auth, BLE, etc.)
- **User-friendly messages** - Converts technical errors into actionable user messages
- **Retry mechanisms** - Intelligent retry with exponential backoff
- **Error tracking** - Integration with Sentry for production monitoring
- **Offline support** - Graceful degradation when network is unavailable
- **Recovery strategies** - Provides users with clear steps to resolve issues

## Components

### 1. Error Utilities (`src/shared/utils/errorHandling.ts`)

The core error handling logic that classifies errors and provides recovery strategies.

#### Error Types

```typescript
enum ErrorType {
  NETWORK = 'network',
  AUTH = 'auth',
  VALIDATION = 'validation',
  SYSTEM = 'system',
  BLE = 'ble',
  PERMISSION = 'permission',
  TIMEOUT = 'timeout',
  RATE_LIMIT = 'rate_limit',
  SERVER = 'server',
  UNKNOWN = 'unknown',
}
```

#### Usage

```typescript
import { classifyError, formatErrorForDisplay, retryWithBackoff } from '@/shared/utils/errorHandling';

// Classify an error
const errorDetails = classifyError(error);
console.log(errorDetails.type); // 'network'
console.log(errorDetails.userMessage); // User-friendly message
console.log(errorDetails.canRetry); // true

// Get display-friendly error
const display = formatErrorForDisplay(error);
// { title: 'Connection Error', message: '...', suggestion: '...', canRetry: true }

// Retry with exponential backoff
await retryWithBackoff(
  async () => await fetchData(),
  { maxAttempts: 3, baseDelay: 1000 }
);
```

### 2. Enhanced ErrorBoundary Component

Catches React errors with retry mechanism and user-friendly fallback UI.

#### Features

- Automatic retry for network errors
- Retry counter with max attempts
- User-friendly error messages
- Different fallback UIs for different error types
- Integration with error tracking service

#### Usage

```tsx
import { ErrorBoundary } from '@/shared/components';

function App() {
  return (
    <ErrorBoundary
      name="AppRoot"
      maxRetries={3}
      enableAutoRetry={true}
      autoRetryDelay={2000}
      onError={(error, errorInfo) => {
        console.log('Error caught:', error);
      }}
    >
      <YourApp />
    </ErrorBoundary>
  );
}
```

### 3. Error View Component

Reusable component for displaying errors with retry functionality.

```tsx
import { ErrorView } from '@/shared/components';

function MyScreen() {
  const [error, setError] = useState(null);

  return (
    <ErrorView
      error={error}
      onRetry={handleRetry}
      isRetrying={isRetrying}
      variant="card"
      actionButton={{
        text: 'Go Back',
        onPress: () => navigation.goBack(),
      }}
    />
  );
}
```

### 4. BLE Error View Component

Specialized component for Bluetooth errors with troubleshooting tips.

```tsx
import { BLEErrorView } from '@/shared/components';

function DeviceScreen() {
  return (
    <BLEErrorView
      errorType="bluetooth_off"
      onRetry={handleRetry}
      showSettingsButton
    />
  );
}
```

### 5. Offline Banner Component

Displays a banner when device is offline with retry functionality.

```tsx
import { OfflineBanner } from '@/shared/components';

function App() {
  return (
    <>
      <OfflineBanner onRetry={refetchData} showQualityWarning />
      <YourApp />
    </>
  );
}
```

### 6. Network Status Indicator

Shows current network connection status and quality.

```tsx
import { NetworkStatusIndicator } from '@/shared/components';

function Header() {
  return (
    <View>
      <NetworkStatusIndicator showDetails />
    </View>
  );
}
```

### 7. useErrorHandler Hook

React hook for comprehensive error handling in components.

```tsx
import { useErrorHandler } from '@/shared/hooks/useErrorHandler';

function MyScreen() {
  const { error, handleError, retry, clearError, isRetrying } = useErrorHandler({
    context: 'MyScreen',
    maxRetries: 3,
    onRetrySuccess: () => console.log('Retry successful!'),
  });

  const loadData = async () => {
    try {
      const data = await fetchData();
    } catch (err) {
      handleError(err);
    }
  };

  if (error) {
    return (
      <ErrorView
        error={error}
        onRetry={() => retry(loadData)}
        isRetrying={isRetrying}
      />
    );
  }

  return <YourContent />;
}
```

### 8. useAsyncError Hook

Simplified hook for async operations with automatic error handling.

```tsx
import { useAsyncError } from '@/shared/hooks/useErrorHandler';

function MyScreen() {
  const { execute, loading, data, error, retry } = useAsyncError(
    fetchSessionData,
    { context: 'SessionScreen' }
  );

  useEffect(() => {
    execute();
  }, []);

  if (loading) return <LoadingSpinner />;
  if (error) return <ErrorView error={error} onRetry={retry} />;

  return <DataView data={data} />;
}
```

## API Error Handling

The API client includes comprehensive error handling:

### Features

- **Network detection** - Checks connectivity before making requests
- **Token refresh** - Automatically refreshes expired auth tokens
- **Rate limit handling** - Respects rate limits with automatic retry
- **Timeout detection** - Handles slow network conditions
- **Retry logic** - Exponential backoff for server errors
- **Offline queueing** - Queues mutations when offline for later sync

### Example

```typescript
import { apiService } from '@/api/client';

try {
  const user = await apiService.getUserProfile(userId);
} catch (error) {
  // Error is automatically classified and tracked
  // Network errors trigger offline queue
  // Auth errors trigger token refresh
  // Server errors retry with backoff
}
```

## BLE Error Handling

The BLE Manager includes comprehensive Bluetooth error handling:

### Features

- **Permission handling** - Requests and validates Bluetooth permissions
- **State monitoring** - Tracks Bluetooth on/off state
- **Connection recovery** - Automatic reconnection with backoff
- **Error classification** - Categorizes BLE errors (connection, pairing, etc.)
- **User guidance** - Provides troubleshooting steps

### Example

```typescript
import { getBLEManager } from '@/services/BLEManager';

const bleManager = getBLEManager();

// Listen for errors
bleManager.onError((error) => {
  console.log('BLE Error:', error.type, error.message);
  // Show appropriate error UI based on error.type
});

// Listen for connection state
bleManager.onConnectionStateChange((state) => {
  if (state === 'error') {
    const lastError = bleManager.getLastError();
    // Handle error
  }
});
```

## Error Tracking Integration

All errors are automatically tracked using Sentry:

```typescript
import * as ErrorTracking from '@/services/ErrorTracking';

// Errors are automatically tracked by:
// - ErrorBoundary
// - API client interceptors
// - BLE Manager
// - useErrorHandler hook

// Manual error tracking
ErrorTracking.captureException(error, {
  component: 'MyScreen',
  action: 'loadData',
});

// Add breadcrumbs for debugging
ErrorTracking.addBreadcrumb({
  message: 'User tapped retry button',
  category: 'user_action',
  level: 'info',
});
```

## Best Practices

### 1. Always Use Error Boundaries

Wrap screens and major components with ErrorBoundary:

```tsx
<ErrorBoundary name="SessionScreen" maxRetries={3}>
  <SessionScreen />
</ErrorBoundary>
```

### 2. Handle Errors at the Right Level

- **Component level**: Use `useErrorHandler` hook
- **Screen level**: Use `ErrorView` component
- **App level**: Use `ErrorBoundary` and `OfflineBanner`

### 3. Provide Context

Always provide context when handling errors:

```tsx
const { handleError } = useErrorHandler({
  context: 'SessionScreen:loadSession',
  onError: (error) => {
    // Additional logging or analytics
  },
});
```

### 4. Test Error Scenarios

Test your error handling:

```tsx
// In development
if (__DEV__) {
  // Simulate network error
  throw new Error('Network Error');

  // Simulate auth error
  throw { response: { status: 401 } };
}
```

### 5. User-Friendly Messages

Use the built-in error classification to show user-friendly messages:

```tsx
const display = formatErrorForDisplay(error);
// Shows: "Unable to connect to the server. Please check your internet connection."
// Instead of: "Network Error: ECONNREFUSED"
```

## Error Recovery Strategies

The system provides different recovery strategies based on error type:

| Error Type | Recovery Strategy | User Action |
|------------|------------------|-------------|
| Network | Check internet | "Check your connection and try again" |
| Auth | Refresh token / Logout | "Please log in again" |
| BLE (Bluetooth Off) | Enable Bluetooth | "Turn on Bluetooth in settings" |
| BLE (Permission) | Grant permission | "Grant Bluetooth permissions" |
| BLE (Device Not Found) | Retry scan | "Make sure device is nearby and powered on" |
| Rate Limit | Wait and retry | "Please wait a moment before trying again" |
| Server (5xx) | Retry with backoff | "Our servers are having issues. Please try again" |
| Validation | Fix input | "Please check your input and try again" |

## Testing Error Handling

### Manual Testing

```tsx
// Simulate different error types
function TestErrorButton() {
  const { handleError } = useErrorHandler({ context: 'Test' });

  return (
    <>
      <Button onPress={() => {
        handleError(new Error('Network Error'));
      }}>Test Network Error</Button>

      <Button onPress={() => {
        handleError({ response: { status: 401 } });
      }}>Test Auth Error</Button>

      <Button onPress={() => {
        handleError({ code: 'ETIMEDOUT' });
      }}>Test Timeout Error</Button>
    </>
  );
}
```

### Automated Testing

```typescript
import { classifyError } from '@/shared/utils/errorHandling';

describe('Error Classification', () => {
  it('should classify network errors', () => {
    const error = new Error('Network Error');
    const details = classifyError(error);
    expect(details.type).toBe('network');
    expect(details.canRetry).toBe(true);
  });

  it('should classify auth errors', () => {
    const error = { response: { status: 401 } };
    const details = classifyError(error);
    expect(details.type).toBe('auth');
  });
});
```

## Troubleshooting

### Error not being caught

Make sure you have an ErrorBoundary wrapping your component:

```tsx
<ErrorBoundary>
  <YourComponent />
</ErrorBoundary>
```

### Retry not working

Check that the error is classified as retryable:

```tsx
const details = classifyError(error);
console.log('Can retry:', details.canRetry);
```

### Offline queue not working

Ensure the NetworkService is initialized:

```tsx
import { networkService } from '@/services/NetworkService';
networkService.initialize();
```

### BLE errors not showing

Make sure you're listening for errors:

```tsx
bleManager.onError((error) => {
  // Display error to user
});
```

## Summary

The error handling system provides:

✅ Automatic error classification
✅ User-friendly error messages
✅ Intelligent retry mechanisms
✅ Offline support with queueing
✅ BLE-specific error handling
✅ Error tracking integration
✅ React error boundaries
✅ Reusable error components
✅ Comprehensive hooks
✅ Recovery strategies

For more details, see the implementation files in:
- `src/shared/utils/errorHandling.ts`
- `src/shared/components/ErrorBoundary.tsx`
- `src/shared/components/ErrorView.tsx`
- `src/shared/components/BLEErrorView.tsx`
- `src/shared/hooks/useErrorHandler.ts`
- `src/api/client.ts`
- `src/services/BLEManager.ts`
