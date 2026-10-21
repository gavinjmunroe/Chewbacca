# Analytics & Error Tracking - Setup Summary

## What Was Implemented

A comprehensive analytics and error tracking system for the Tizzy mobile app with the following features:

### 1. Error Tracking (Sentry)
- **Location**: `/src/services/ErrorTracking.ts`
- **Features**:
  - Crash reporting and exception tracking
  - Error boundary integration
  - Performance monitoring
  - Release and version tracking
  - User context (privacy-compliant)
  - Breadcrumb tracking for debugging
  - Feature-specific error tracking (BLE, Audio, API)
  - Automatic session tracking

### 2. Analytics Service
- **Location**: `/src/services/Analytics.ts`
- **Features**:
  - Event tracking (screen views, button clicks, feature usage)
  - Session tracking with timeout handling
  - Conversion funnel tracking
  - User properties (opt-in only)
  - Privacy-compliant (no PII collection)
  - Opt-out support
  - Batch event processing
  - Anonymous user ID generation

### 3. React Hooks
- **useAnalytics** (`/src/shared/hooks/useAnalytics.ts`)
  - Automatic screen view tracking
  - Event tracking helpers
  - Button click tracking
  - Feature usage tracking
  - Funnel tracking

- **useErrorTracking** (`/src/shared/hooks/useErrorTracking.ts`)
  - Exception capturing
  - Breadcrumb tracking
  - Feature-specific error tracking
  - Automatic context addition

- **useAsyncAnalytics** & **useAsyncErrorTracking**
  - Track async operations automatically
  - Measure operation duration
  - Handle errors gracefully

### 4. Higher-Order Components
- **withAnalytics** (`/src/shared/hoc/withAnalytics.tsx`)
  - Automatic screen tracking for any component
  - Screen view duration tracking
  - Lifecycle event tracking

### 5. Utility Functions
- **analyticsHelpers** (`/src/shared/utils/analyticsHelpers.ts`)
  - Timing utilities
  - Page view tracking
  - Form submission tracking
  - Search tracking
  - Navigation tracking
  - Purchase/subscription tracking
  - A/B testing support
  - Permission tracking
  - Retry and timeout tracking

### 6. Privacy Controls
- **AnalyticsSettings** (`/src/features/settings/components/AnalyticsSettings.tsx`)
  - User opt-in/opt-out UI
  - Clear privacy disclosure
  - Data deletion on opt-out
  - Toggle switch for easy control

### 7. Integration
- **App Layout** (`/app/_layout.tsx`)
  - Automatic initialization on app startup
  - Session cleanup on app close
  - Proper error handling

- **Error Boundary** (`/src/shared/components/ErrorBoundary.tsx`)
  - Integrated with Sentry error tracking
  - Automatic error reporting
  - Context preservation

---

## Files Created/Modified

### New Files Created:
1. `/src/services/ErrorTracking.ts` - Sentry integration
2. `/src/services/Analytics.ts` - Analytics service
3. `/src/services/index.ts` - Service exports
4. `/src/services/USAGE_EXAMPLES.md` - Comprehensive usage guide
5. `/src/services/INTEGRATION_EXAMPLE.tsx` - Integration examples
6. `/src/shared/hooks/useAnalytics.ts` - Analytics hook
7. `/src/shared/hooks/useErrorTracking.ts` - Error tracking hook
8. `/src/shared/hoc/withAnalytics.tsx` - Analytics HOC
9. `/src/shared/utils/analyticsHelpers.ts` - Utility functions
10. `/src/features/settings/components/AnalyticsSettings.tsx` - User settings UI
11. `/.env.example` - Environment configuration template
12. `/ANALYTICS_AND_ERROR_TRACKING.md` - Main documentation
13. `/ANALYTICS_SETUP_SUMMARY.md` - This file

### Files Modified:
1. `/app/_layout.tsx` - Added service initialization
2. `/src/shared/components/ErrorBoundary.tsx` - Added Sentry integration

---

## Quick Start

### 1. Install Dependencies (Already Done)
```bash
npm install @sentry/react-native expo-application expo-device
```

### 2. Configure Environment
```bash
# Copy the example env file
cp .env.example .env

# Add your Sentry DSN
EXPO_PUBLIC_SENTRY_DSN=https://your-dsn@sentry.io/project-id
```

### 3. Use in Components

**Simple screen tracking:**
```typescript
import { useAnalytics } from '../shared/hooks/useAnalytics';

function MyScreen() {
  const { trackButtonClick } = useAnalytics({
    screenName: 'MyScreen',
    trackOnMount: true,
  });

  return (
    <Button onPress={() => trackButtonClick('submit')}>
      Submit
    </Button>
  );
}
```

**Error tracking:**
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
      captureException(error as Error);
    }
  };
}
```

---

## Key Events Being Tracked

### Application Lifecycle
- `app_opened` - App startup
- `session_started` - New session
- `session_ended` - Session end
- `screen_view` - Screen navigation

### Feature Usage
- `ble_connect` / `ble_disconnect` - BLE operations
- `haptic_test` - Haptic feedback testing
- `audio_play` / `audio_record` - Audio operations
- `button_click` - Button interactions
- `feature_used` - Generic feature usage

### Errors & Performance
- Exception captures (all errors)
- API response times
- Operation timeouts
- Retry attempts
- Performance transactions

### User Behavior
- Navigation patterns
- Feature discovery
- Form submissions
- Search queries
- Funnel progress

---

## Privacy Compliance

### What We Track (Anonymous Only)
✅ Screen views and navigation
✅ Feature usage statistics
✅ App performance metrics
✅ Error and crash reports
✅ Device information (model, OS)
✅ Anonymous user IDs

### What We DON'T Track
❌ Names, emails, phone numbers
❌ Location data
❌ IP addresses
❌ Audio recordings
❌ Health/biometric data
❌ Passwords or tokens

### User Controls
- Users can opt-out completely via settings
- Opting out deletes all stored data
- Clear disclosure of what's collected
- No tracking without initialization

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
All events are logged to console in development:
```
[Analytics] Event tracked: button_click { buttonName: 'submit' }
[ErrorTracking] Exception captured: Error: Test error
```

---

## Production Deployment

### Pre-Deployment Checklist
- [ ] Set up Sentry project and get DSN
- [ ] Add `EXPO_PUBLIC_SENTRY_DSN` to environment variables
- [ ] Set `EXPO_PUBLIC_ENVIRONMENT=production`
- [ ] Set `enableInDev: false` for both services
- [ ] Adjust Sentry sample rate (recommend 0.1-0.5)
- [ ] Test opt-out flow
- [ ] Verify no PII is tracked
- [ ] Add privacy policy
- [ ] Test error reporting
- [ ] Test analytics events

### Environment Variables
```bash
# Production
EXPO_PUBLIC_SENTRY_DSN=https://your-dsn@sentry.io/project-id
EXPO_PUBLIC_ENVIRONMENT=production
EXPO_PUBLIC_ENABLE_ANALYTICS=true
EXPO_PUBLIC_ENABLE_ERROR_TRACKING=true
```

---

## Documentation

### Main Documentation
- **[ANALYTICS_AND_ERROR_TRACKING.md](ANALYTICS_AND_ERROR_TRACKING.md)** - Complete guide
- **[src/services/USAGE_EXAMPLES.md](src/services/USAGE_EXAMPLES.md)** - Usage examples
- **[src/services/INTEGRATION_EXAMPLE.tsx](src/services/INTEGRATION_EXAMPLE.tsx)** - Code examples

### API Reference
See [ANALYTICS_AND_ERROR_TRACKING.md](ANALYTICS_AND_ERROR_TRACKING.md) for:
- Complete API documentation
- Hook signatures
- Service methods
- Best practices

---

## Next Steps

### 1. Set Up Sentry Account
1. Go to https://sentry.io
2. Create account and project
3. Copy DSN to `.env` file
4. Test error reporting

### 2. Add Analytics to Existing Screens
Use the integration examples to add tracking to:
- BLE connection screens
- Audio recording screens
- Settings screens
- Onboarding flow
- Main navigation

### 3. Customize Events
Review tracked events and customize based on:
- Business requirements
- User behavior insights needed
- Debugging requirements

### 4. Set Up Alerts
Configure Sentry alerts for:
- High error rates
- Performance degradation
- New error types
- Release issues

### 5. Monitor Usage
After deployment, monitor:
- Screen view patterns
- Feature usage rates
- Error frequency
- Performance metrics
- User engagement

---

## Support & Resources

### Documentation
- [Sentry React Native Docs](https://docs.sentry.io/platforms/react-native/)
- [Expo Application API](https://docs.expo.dev/versions/latest/sdk/application/)
- [Usage Examples](src/services/USAGE_EXAMPLES.md)

### Troubleshooting
See [ANALYTICS_AND_ERROR_TRACKING.md](ANALYTICS_AND_ERROR_TRACKING.md) for:
- Common issues
- Debug tips
- FAQ

### Code Examples
- Simple tracking: [USAGE_EXAMPLES.md](src/services/USAGE_EXAMPLES.md)
- Advanced integration: [INTEGRATION_EXAMPLE.tsx](src/services/INTEGRATION_EXAMPLE.tsx)
- Settings UI: [AnalyticsSettings.tsx](src/features/settings/components/AnalyticsSettings.tsx)

---

## Performance Impact

### Minimal Overhead
- Async event batching (10s intervals)
- Events queued locally, sent in background
- No UI blocking operations
- Automatic session timeout handling
- Efficient breadcrumb storage

### Best Practices
- Events are batched automatically
- No need to worry about performance
- Breadcrumbs are limited to 100 max
- Sessions timeout after 30 minutes
- All operations are non-blocking

---

## Summary

You now have a complete, production-ready analytics and error tracking system that:

✅ Tracks user behavior and feature usage
✅ Captures crashes and errors automatically
✅ Monitors app performance
✅ Respects user privacy (no PII)
✅ Allows user opt-out
✅ Integrates seamlessly with existing code
✅ Provides detailed debugging context
✅ Includes comprehensive documentation
✅ Ready for production deployment

**All you need to do is:**
1. Set up a Sentry account
2. Add your DSN to `.env`
3. Start tracking events in your components
4. Deploy and monitor!

For detailed implementation examples and API documentation, see:
- [ANALYTICS_AND_ERROR_TRACKING.md](ANALYTICS_AND_ERROR_TRACKING.md)
- [USAGE_EXAMPLES.md](src/services/USAGE_EXAMPLES.md)
- [INTEGRATION_EXAMPLE.tsx](src/services/INTEGRATION_EXAMPLE.tsx)
