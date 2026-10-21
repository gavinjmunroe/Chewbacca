# Analytics & Error Tracking Setup

This document provides a comprehensive guide to the analytics and error tracking implementation in the Tizzy mobile app.

## Overview

The app includes two primary monitoring services:

1. **Error Tracking (Sentry)**: Captures crashes, exceptions, and performance issues
2. **Analytics**: Tracks user behavior, feature usage, and conversion funnels

Both services are privacy-compliant and allow users to opt-out.

---

## Features

### Error Tracking (Sentry)
- **Crash Reporting**: Automatic crash detection and reporting
- **Error Boundary Integration**: Catches React component errors
- **Performance Monitoring**: Track slow operations and API calls
- **Release Tracking**: Track errors by app version
- **User Context**: Anonymous user tracking (no PII)
- **Breadcrumbs**: Detailed debugging context

### Analytics
- **Screen View Tracking**: Automatic or manual screen tracking
- **Event Tracking**: Track button clicks, feature usage, and custom events
- **Session Tracking**: Monitor user sessions with timeout handling
- **Conversion Funnels**: Track multi-step user flows
- **User Properties**: Opt-in user property tracking
- **Opt-Out Support**: Users can disable analytics completely

---

## Installation

The required packages are already installed:

```bash
npm install @sentry/react-native expo-application expo-device
```

---

## Configuration

### 1. Set Up Sentry

1. Create a Sentry account at https://sentry.io
2. Create a new React Native project in Sentry
3. Copy your DSN from the project settings

### 2. Configure Environment Variables

Create a `.env` file (copy from `.env.example`):

```bash
cp .env.example .env
```

Add your Sentry DSN:

```bash
EXPO_PUBLIC_SENTRY_DSN=https://your-public-key@o0.ingest.sentry.io/0000000
EXPO_PUBLIC_ENVIRONMENT=production
```

### 3. Update app.json (Optional)

Add environment configuration:

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

## Architecture

### File Structure

```
src/
├── services/
│   ├── ErrorTracking.ts        # Sentry error tracking service
│   ├── Analytics.ts             # Analytics service
│   ├── index.ts                 # Service exports
│   └── USAGE_EXAMPLES.md        # Comprehensive usage examples
├── shared/
│   ├── hooks/
│   │   ├── useAnalytics.ts      # Analytics hook
│   │   └── useErrorTracking.ts  # Error tracking hook
│   ├── hoc/
│   │   └── withAnalytics.tsx    # Analytics HOC
│   └── components/
│       └── ErrorBoundary.tsx    # Error boundary with tracking
└── features/
    └── settings/
        └── components/
            └── AnalyticsSettings.tsx  # User opt-out UI
```

### Service Initialization

Services are initialized in `app/_layout.tsx`:

```typescript
// Automatically runs on app startup
ErrorTracking.initializeErrorTracking({
  enableInDev: false,
  tracesSampleRate: 1.0,
  enableAutoSessionTracking: true,
});

await Analytics.initializeAnalytics({
  enableInDev: false,
  autoTrackScreens: true,
});
```

---

## Usage

### Quick Start

#### 1. Track a Screen

```typescript
import { useAnalytics } from '../shared/hooks/useAnalytics';

function MyScreen() {
  const { trackEvent, trackButtonClick } = useAnalytics({
    screenName: 'MyScreen',
    trackOnMount: true,
  });

  const handlePress = () => {
    trackButtonClick('submit_button');
  };

  return <Button onPress={handlePress}>Submit</Button>;
}
```

#### 2. Track an Error

```typescript
import { useErrorTracking } from '../shared/hooks/useErrorTracking';

function MyComponent() {
  const { captureException } = useErrorTracking({
    componentName: 'MyComponent',
  });

  const handleAction = async () => {
    try {
      await performAction();
    } catch (error) {
      captureException(error as Error, { actionType: 'perform' });
    }
  };
}
```

#### 3. Track Feature Usage

```typescript
import { useAnalytics } from '../shared/hooks/useAnalytics';

function BLEControls() {
  const { trackFeatureUsage } = useAnalytics();

  const connectDevice = async () => {
    trackFeatureUsage('ble', 'connect', { deviceId: '123' });
    await bleManager.connect('123');
  };
}
```

For more examples, see [USAGE_EXAMPLES.md](src/services/USAGE_EXAMPLES.md).

---

## Key Events to Track

### App Lifecycle
- `app_opened`: When the app starts
- `session_started`: When a new session begins
- `session_ended`: When a session ends
- `screen_view`: When a screen is viewed

### Feature Usage
- **BLE**: `ble_connect`, `ble_disconnect`, `ble_error`
- **Haptic**: `haptic_test`, `haptic_feedback`
- **Audio**: `audio_play`, `audio_record`, `audio_stop`
- **API**: `api_call`, `api_error`

### User Actions
- `button_click`: Any button press
- `feature_used`: Generic feature usage
- `error_occurred`: Non-crash errors

### Conversion Funnels
- `funnel_step`: Progress through a flow
- `funnel_complete`: Completed a flow
- `funnel_abandoned`: Left a flow early

---

## Privacy Compliance

### What We Track
- Anonymous user IDs (generated locally)
- Screen views and navigation patterns
- Feature usage statistics
- App performance metrics
- Error and crash reports
- Device information (model, OS version)

### What We DON'T Track
- Personal information (name, email, phone)
- Location data
- IP addresses
- Audio recordings or content
- Health or biometric data
- Passwords or authentication tokens

### User Control

Users can opt-out of analytics through the settings screen:

```typescript
import { AnalyticsSettings } from '../features/settings/components/AnalyticsSettings';

function SettingsScreen() {
  return (
    <View>
      <AnalyticsSettings />
    </View>
  );
}
```

Opting out will:
1. Stop all analytics tracking
2. Delete all stored analytics data
3. Clear the anonymous user ID

---

## API Reference

### Analytics Service

#### Initialization
```typescript
Analytics.initializeAnalytics(options?)
```

#### Event Tracking
```typescript
Analytics.trackEvent(eventName, properties?)
Analytics.trackScreenView(screen)
Analytics.trackButtonClick(buttonName, context?)
Analytics.trackFeatureUsage(featureName, action, metadata?)
```

#### User Management
```typescript
Analytics.setUserProperties(properties)
Analytics.clearUserProperties()
```

#### Opt-In/Out
```typescript
Analytics.enableAnalytics()
Analytics.disableAnalytics()
Analytics.isAnalyticsEnabled()
```

### Error Tracking Service

#### Initialization
```typescript
ErrorTracking.initializeErrorTracking(options?)
```

#### Error Reporting
```typescript
ErrorTracking.captureException(error, context?, level?)
ErrorTracking.captureMessage(message, level?, context?)
ErrorTracking.addBreadcrumb(breadcrumb)
```

#### User Context
```typescript
ErrorTracking.setUser(user)
ErrorTracking.clearUser()
```

#### Performance Monitoring
```typescript
ErrorTracking.startTransaction(name, op?)
ErrorTracking.measurePerformance(name, operation, op?)
ErrorTracking.trackAPICall(endpoint, method, statusCode, duration)
```

---

## Hooks

### useAnalytics

```typescript
const {
  trackEvent,
  trackButtonClick,
  trackFeatureUsage,
  trackScreenView,
  trackFunnelStep,
  isEnabled,
} = useAnalytics({
  screenName?: string,
  trackOnMount?: boolean,
  screenProperties?: Record<string, any>,
});
```

### useErrorTracking

```typescript
const {
  captureException,
  captureMessage,
  addBreadcrumb,
  trackBLEError,
  trackAudioError,
  trackAPIError,
} = useErrorTracking({
  componentName?: string,
  context?: Record<string, any>,
});
```

### useAsyncAnalytics

```typescript
const trackAsync = useAsyncAnalytics();

await trackAsync('operationName', async () => {
  // Your async operation
});
```

### useAsyncErrorTracking

```typescript
const trackAsync = useAsyncErrorTracking('ComponentName');

await trackAsync('operationName', async () => {
  // Your async operation
}, (error) => {
  // Optional error handler
});
```

---

## Higher-Order Components

### withAnalytics

Automatically track screen views:

```typescript
import { withAnalytics } from '../shared/hoc/withAnalytics';

const MyScreen = () => <View>...</View>;

export default withAnalytics(MyScreen, {
  screenName: 'MyScreen',
  trackOnMount: true,
});
```

### withAnalyticsAndErrors

Track both screen views and errors:

```typescript
import { withAnalyticsAndErrors } from '../shared/hoc/withAnalytics';

const MyScreen = () => <View>...</View>;

export default withAnalyticsAndErrors(MyScreen, {
  screenName: 'MyScreen',
});
```

---

## Best Practices

### DO:
- ✅ Use hooks for component-level tracking
- ✅ Add breadcrumbs before critical operations
- ✅ Provide context with errors
- ✅ Track meaningful business events
- ✅ Respect user privacy and opt-out preferences
- ✅ Test tracking in development mode

### DON'T:
- ❌ Track PII (personally identifiable information)
- ❌ Track sensitive user data
- ❌ Over-track (too many events)
- ❌ Block the main thread
- ❌ Forget to handle errors
- ❌ Ignore user opt-out preferences

---

## Testing

### Enable in Development

```typescript
// In app/_layout.tsx
ErrorTracking.initializeErrorTracking({
  enableInDev: true, // Enable for testing
});

await Analytics.initializeAnalytics({
  enableInDev: true, // Enable for testing
});
```

### Check Console Logs

When enabled in development, all events and errors are logged to the console:

```
[Analytics] Event tracked: button_click { buttonName: 'submit' }
[ErrorTracking] Exception captured: Error: Test error Event ID: abc123
```

### Test Error Tracking

```typescript
// Trigger a test error
const testError = () => {
  throw new Error('Test error for Sentry');
};

// Capture a test exception
ErrorTracking.captureException(new Error('Test error'), {
  context: 'testing',
});
```

---

## Production Checklist

Before deploying to production:

- [ ] Set `EXPO_PUBLIC_SENTRY_DSN` in environment variables
- [ ] Set `EXPO_PUBLIC_ENVIRONMENT=production`
- [ ] Set `enableInDev: false` for both services
- [ ] Adjust `tracesSampleRate` for Sentry (recommend 0.1 - 0.5 for production)
- [ ] Test analytics opt-out flow
- [ ] Test error boundary error reporting
- [ ] Verify no PII is being tracked
- [ ] Add privacy policy link in app
- [ ] Document what data is collected

---

## Troubleshooting

### Analytics Not Working

1. Check that analytics is enabled:
   ```typescript
   console.log(Analytics.isAnalyticsEnabled());
   ```

2. Check console logs in development mode

3. Verify initialization in `app/_layout.tsx`

### Sentry Not Reporting Errors

1. Verify `EXPO_PUBLIC_SENTRY_DSN` is set correctly

2. Check Sentry dashboard for project status

3. Test with a manual error:
   ```typescript
   ErrorTracking.captureMessage('Test message', 'info');
   ```

4. Check console for initialization errors

### Events Not Being Tracked

1. Ensure service is initialized before tracking

2. Check that component is mounted

3. Verify event name and properties are valid

4. Check for console errors

---

## Resources

- [Sentry React Native Documentation](https://docs.sentry.io/platforms/react-native/)
- [Expo Application API](https://docs.expo.dev/versions/latest/sdk/application/)
- [Expo Device API](https://docs.expo.dev/versions/latest/sdk/device/)
- [Usage Examples](src/services/USAGE_EXAMPLES.md)

---

## Support

For questions or issues:

1. Check [USAGE_EXAMPLES.md](src/services/USAGE_EXAMPLES.md)
2. Review this document
3. Check console logs for errors
4. Contact the development team

---

## License

This implementation is part of the Tizzy mobile app and is subject to the app's license terms.
