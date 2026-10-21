# Analytics & Error Tracking - Usage Examples

This document provides comprehensive examples of how to use the analytics and error tracking services in the Tizzy mobile app.

## Table of Contents

1. [Basic Setup](#basic-setup)
2. [Screen Tracking](#screen-tracking)
3. [Event Tracking](#event-tracking)
4. [Error Tracking](#error-tracking)
5. [Feature-Specific Tracking](#feature-specific-tracking)
6. [Conversion Funnels](#conversion-funnels)
7. [Performance Monitoring](#performance-monitoring)

---

## Basic Setup

The services are automatically initialized in `app/_layout.tsx`. To configure them, modify the initialization options:

```typescript
// app/_layout.tsx
import * as ErrorTracking from '../src/services/ErrorTracking';
import * as Analytics from '../src/services/Analytics';

ErrorTracking.initializeErrorTracking({
  enableInDev: false, // Enable in dev for testing
  tracesSampleRate: 1.0, // 100% sampling (reduce in production)
  enableAutoSessionTracking: true,
});

await Analytics.initializeAnalytics({
  enableInDev: false, // Enable in dev for testing
  autoTrackScreens: true,
});
```

---

## Screen Tracking

### Option 1: Using the `useAnalytics` Hook (Recommended)

```typescript
import { useAnalytics } from '../../shared/hooks/useAnalytics';

function MyScreen() {
  const { trackEvent, trackButtonClick } = useAnalytics({
    screenName: 'MyScreen',
    trackOnMount: true, // Automatically track screen view on mount
    screenProperties: { category: 'main' },
  });

  const handlePress = () => {
    trackButtonClick('submit_button', { formType: 'contact' });
  };

  return <Button onPress={handlePress}>Submit</Button>;
}
```

### Option 2: Using the `withAnalytics` HOC

```typescript
import { withAnalytics } from '../../shared/hoc/withAnalytics';

const MyScreen = () => {
  return <View>...</View>;
};

export default withAnalytics(MyScreen, {
  screenName: 'MyScreen',
  screenProperties: { category: 'main' },
  trackOnMount: true,
  trackOnUnmount: false,
});
```

### Option 3: Manual Screen Tracking

```typescript
import * as Analytics from '../../services/Analytics';

function MyScreen() {
  useEffect(() => {
    Analytics.trackScreenView({
      screenName: 'MyScreen',
      params: { category: 'main' },
    });
  }, []);

  return <View>...</View>;
}
```

---

## Event Tracking

### Track Custom Events

```typescript
import { useAnalytics } from '../../shared/hooks/useAnalytics';

function MyComponent() {
  const { trackEvent } = useAnalytics();

  const handleAction = () => {
    trackEvent('custom_action', {
      action_type: 'purchase',
      item_id: '123',
      amount: 29.99,
    });
  };

  return <Button onPress={handleAction}>Buy Now</Button>;
}
```

### Track Button Clicks

```typescript
import { useAnalytics } from '../../shared/hooks/useAnalytics';

function MyComponent() {
  const { trackButtonClick } = useAnalytics({
    screenName: 'ProductPage',
  });

  const handlePress = () => {
    trackButtonClick('buy_button', {
      product_id: '123',
      price: 29.99,
    });
  };

  return <Button onPress={handlePress}>Buy Now</Button>;
}
```

### Track Feature Usage

```typescript
import { useAnalytics } from '../../shared/hooks/useAnalytics';

function HapticControls() {
  const { trackFeatureUsage } = useAnalytics();

  const testHaptic = () => {
    trackFeatureUsage('haptic', 'test_feedback', {
      feedback_type: 'impact',
      intensity: 'medium',
    });

    // Perform haptic feedback
  };

  return <Button onPress={testHaptic}>Test Haptic</Button>;
}
```

---

## Error Tracking

### Option 1: Using the `useErrorTracking` Hook

```typescript
import { useErrorTracking } from '../../shared/hooks/useErrorTracking';

function MyComponent() {
  const { captureException, addBreadcrumb } = useErrorTracking({
    componentName: 'MyComponent',
  });

  const handleAction = async () => {
    try {
      addBreadcrumb('Starting data fetch');
      const data = await fetchData();
      addBreadcrumb('Data fetch successful');
    } catch (error) {
      captureException(error as Error, {
        actionType: 'fetch_data',
        userId: 'anon_123',
      });
    }
  };

  return <Button onPress={handleAction}>Fetch Data</Button>;
}
```

### Option 2: Direct Service Usage

```typescript
import * as ErrorTracking from '../../services/ErrorTracking';

try {
  await performOperation();
} catch (error) {
  ErrorTracking.captureException(error as Error, {
    context: 'data_sync',
    operation: 'sync_user_data',
  });
}
```

### Track Async Operations with Error Handling

```typescript
import { useAsyncErrorTracking } from '../../shared/hooks/useErrorTracking';

function MyComponent() {
  const trackAsync = useAsyncErrorTracking('MyComponent');

  const fetchData = async () => {
    await trackAsync(
      'fetchData',
      async () => {
        const response = await api.getData();
        return response.data;
      },
      (error) => {
        // Optional error handler
        Alert.alert('Error', 'Failed to fetch data');
      }
    );
  };

  return <Button onPress={fetchData}>Fetch Data</Button>;
}
```

---

## Feature-Specific Tracking

### BLE Connection Tracking

```typescript
import * as Analytics from '../../services/Analytics';
import * as ErrorTracking from '../../services/ErrorTracking';

// Success
Analytics.trackBLEConnection('connect', {
  device_id: 'device_123',
  device_name: 'Tizzy Device',
  connection_time: 1500, // ms
});

// Error
try {
  await bleManager.connect(deviceId);
} catch (error) {
  ErrorTracking.trackBLEError(error as Error, {
    device_id: deviceId,
    device_name: 'Unknown',
    error_code: 'CONNECTION_FAILED',
  });

  Analytics.trackBLEConnection('error', {
    device_id: deviceId,
    error_type: 'connection_failed',
  });
}
```

### Audio Event Tracking

```typescript
import * as Analytics from '../../services/Analytics';

// Track audio playback
Analytics.trackAudioEvent('play', {
  track_id: 'track_123',
  duration: 180000, // 3 minutes
  source: 'coaching_session',
});

// Track recording
Analytics.trackAudioEvent('record', {
  duration: 5000, // 5 seconds
  format: 'wav',
  sample_rate: 44100,
});
```

### API Call Tracking

```typescript
import * as Analytics from '../../services/Analytics';
import * as ErrorTracking from '../../services/ErrorTracking';

const apiClient = axios.create({
  baseURL: API_BASE_URL,
});

// Add request interceptor to track timing
apiClient.interceptors.request.use((config) => {
  config.metadata = { startTime: Date.now() };
  return config;
});

// Add response interceptor to track results
apiClient.interceptors.response.use(
  (response) => {
    const duration = Date.now() - response.config.metadata.startTime;

    Analytics.trackAPICall(
      response.config.url || 'unknown',
      response.config.method || 'GET',
      duration,
      true
    );

    ErrorTracking.trackAPICall(
      response.config.url || 'unknown',
      response.config.method || 'GET',
      response.status,
      duration
    );

    return response;
  },
  (error) => {
    const duration = Date.now() - error.config.metadata.startTime;

    Analytics.trackAPICall(
      error.config.url || 'unknown',
      error.config.method || 'GET',
      duration,
      false
    );

    ErrorTracking.trackAPIError(
      error,
      error.config.url || 'unknown',
      error.config.method || 'GET',
      error.response?.status
    );

    throw error;
  }
);
```

---

## Conversion Funnels

Track multi-step user flows:

```typescript
import { useAnalytics } from '../../shared/hooks/useAnalytics';

function OnboardingFlow() {
  const { trackFunnelStep } = useAnalytics();

  const handleStepComplete = (stepNumber: number, stepName: string) => {
    trackFunnelStep('onboarding', stepName, stepNumber, {
      time_spent: Date.now() - stepStartTime,
    });
  };

  return (
    <View>
      <Step1
        onComplete={() => handleStepComplete(1, 'welcome')}
      />
      <Step2
        onComplete={() => handleStepComplete(2, 'permissions')}
      />
      <Step3
        onComplete={() => handleStepComplete(3, 'profile_setup')}
      />
    </View>
  );
}

// Track completion
Analytics.trackFunnelComplete('onboarding', 3, {
  total_time: Date.now() - funnelStartTime,
});

// Track abandonment
Analytics.trackFunnelAbandoned('onboarding', 'permissions', 2, {
  reason: 'permission_denied',
});
```

---

## Performance Monitoring

### Measure Async Operations

```typescript
import * as ErrorTracking from '../../services/ErrorTracking';

const result = await ErrorTracking.measurePerformance(
  'load_user_data',
  async () => {
    const user = await api.getUser();
    const preferences = await api.getUserPreferences();
    return { user, preferences };
  },
  'data.load'
);
```

### Manual Transaction Tracking

```typescript
import * as ErrorTracking from '../../services/ErrorTracking';

const transaction = ErrorTracking.startTransaction('app_startup', 'app.init');

try {
  // Perform initialization
  await initializeServices();
  await loadUserData();
  await setupApp();

  transaction?.setStatus('ok');
} catch (error) {
  transaction?.setStatus('internal_error');
  throw error;
} finally {
  transaction?.finish();
}
```

---

## User Context (Privacy-Compliant)

### Set Anonymous User Context

```typescript
import * as ErrorTracking from '../../services/ErrorTracking';
import * as Analytics from '../../services/Analytics';

// Set anonymous user ID
ErrorTracking.setUser({
  id: 'user_123',
  anonymousId: 'anon_xyz789',
  deviceId: 'device_abc456',
});

// Set user properties (opt-in only)
Analytics.setUserProperties({
  subscription_tier: 'premium',
  onboarding_completed: true,
  preferred_device_type: 'ble',
});

// Clear user context on logout
ErrorTracking.clearUser();
Analytics.clearUserProperties();
```

---

## Advanced: Combining Analytics and Error Tracking

```typescript
import { useAnalytics } from '../../shared/hooks/useAnalytics';
import { useErrorTracking } from '../../shared/hooks/useErrorTracking';

function ComplexFeature() {
  const { trackFeatureUsage } = useAnalytics();
  const { captureException, addBreadcrumb } = useErrorTracking({
    componentName: 'ComplexFeature',
  });

  const performComplexAction = async () => {
    const startTime = Date.now();

    try {
      addBreadcrumb('Starting complex action');

      // Step 1
      await step1();
      addBreadcrumb('Step 1 completed');

      // Step 2
      await step2();
      addBreadcrumb('Step 2 completed');

      // Success
      const duration = Date.now() - startTime;
      trackFeatureUsage('complex_feature', 'completed', { duration });
    } catch (error) {
      const duration = Date.now() - startTime;

      captureException(error as Error, {
        duration,
        failedAt: 'step_2',
      });

      trackFeatureUsage('complex_feature', 'failed', {
        duration,
        error: error.message,
      });
    }
  };

  return <Button onPress={performComplexAction}>Start</Button>;
}
```

---

## Best Practices

1. **Always use hooks in components**: Use `useAnalytics` and `useErrorTracking` hooks for component-level tracking.

2. **Track meaningful events**: Focus on user actions that provide business value or help debug issues.

3. **Add context to errors**: Always provide relevant context when capturing exceptions.

4. **Use breadcrumbs**: Add breadcrumbs before critical operations to help debug issues.

5. **Respect privacy**: Never track PII (personally identifiable information).

6. **Batch events**: The analytics service automatically batches events - don't worry about performance.

7. **Test in development**: Enable analytics/error tracking in development to test before production.

8. **Monitor performance**: Use performance monitoring to identify slow operations.

9. **Track funnels**: Use funnel tracking to understand user flows and drop-off points.

10. **Clean up on unmount**: Always clean up timers and listeners in component cleanup.

---

## Environment Configuration

Add these to your `.env` file:

```bash
# Sentry DSN for error tracking
EXPO_PUBLIC_SENTRY_DSN=https://your-sentry-dsn@sentry.io/project-id

# Environment (development, staging, production)
EXPO_PUBLIC_ENVIRONMENT=production
```

And in `app.json`:

```json
{
  "expo": {
    "extra": {
      "sentryDsn": process.env.EXPO_PUBLIC_SENTRY_DSN,
      "environment": process.env.EXPO_PUBLIC_ENVIRONMENT || "development"
    }
  }
}
```

---

## Testing

```typescript
// Enable in development for testing
ErrorTracking.initializeErrorTracking({
  enableInDev: true, // Test error tracking
  tracesSampleRate: 1.0,
});

await Analytics.initializeAnalytics({
  enableInDev: true, // Test analytics
});

// Check console logs to see events being tracked
```
