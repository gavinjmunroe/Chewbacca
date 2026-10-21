# Notification UI Components

This document describes the in-app notification UI components and hooks for the Tizzy mobile app.

## Overview

The notification system provides a cohesive experience for displaying alerts, messages, and notifications to users while the app is in the foreground. The components are built with:

- **React Native Reanimated** for smooth, performant animations
- **Design System Integration** for consistent styling
- **Accessibility Support** for screen readers
- **Gesture Support** for swipe-to-dismiss functionality

## Components

### InAppNotificationBanner

The main notification banner component that displays at the top of the screen with animated entrance and exit.

**Location:** `/src/shared/components/notifications/InAppNotificationBanner.tsx`

#### Props

```typescript
interface InAppNotificationBannerProps {
  notification: NotificationBannerData | null;
  onPress?: (data: any) => void;
  onDismiss?: () => void;
  duration?: number; // Auto-dismiss duration in ms, default 5000
}

interface NotificationBannerData {
  title: string;
  body: string;
  icon?: string; // Custom icon/emoji
  type?: 'success' | 'error' | 'warning' | 'info'; // default: 'info'
  data?: any; // Custom data passed to onPress handler
}
```

#### Features

- **Animated Entrance**: Spring animation slides down from top
- **Auto-Dismiss**: Automatically closes after configurable duration
- **Swipe-to-Dismiss**: Swipe up to dismiss with spring-back animation if not fully swiped
- **Tap Action**: Tap banner to trigger onPress callback
- **Manual Dismiss Button**: X button to close immediately
- **Type Styling**: Automatic colors based on notification type:
  - `success` → Emerald green
  - `error` → Red
  - `warning` → Amber
  - `info` → Blue
- **Safe Area Integration**: Respects notch/safe area insets
- **Accessibility**: Proper ARIA labels and roles

#### Example Usage

```typescript
import { InAppNotificationBanner, useNotificationBanner } from '@/shared/components';

function MyScreen() {
  const { notification, show, hide } = useNotificationBanner();

  const handleSuccess = () => {
    show({
      title: 'Success!',
      body: 'Your changes have been saved.',
      type: 'success',
    });
  };

  const handleError = () => {
    show({
      title: 'Error',
      body: 'Failed to save changes. Please try again.',
      type: 'error',
    });
  };

  return (
    <>
      <InAppNotificationBanner
        notification={notification}
        onPress={(data) => {
          console.log('Notification tapped with data:', data);
          hide();
        }}
        onDismiss={() => {
          console.log('Notification dismissed');
        }}
        duration={5000}
      />

      <Button title="Show Success" onPress={handleSuccess} />
      <Button title="Show Error" onPress={handleError} />
    </>
  );
}
```

### useNotificationBanner Hook

Hook for managing the notification banner state.

**Returns:**
```typescript
{
  notification: NotificationBannerData | null;
  show: (data: NotificationBannerData) => void;
  hide: () => void;
}
```

#### Example

```typescript
const { notification, show, hide } = useNotificationBanner();

// Show a notification
show({
  title: 'Reminder',
  body: 'Time for your coaching session!',
  type: 'info',
  data: { sessionId: '123' },
});

// Hide the notification
hide();
```

## Notification Hooks

The notification system includes several hooks for managing push notifications and listening to notification events.

### useNotifications

Main hook for notification management (in `/src/shared/hooks/useNotifications.ts`).

**Features:**
- Permission management
- Push notification registration
- Scheduling reminders and achievements
- Badge management
- Notification dismissal
- Preference management

```typescript
const {
  // Status
  permissionStatus,
  pushToken,
  lastNotification,
  preferences,

  // Methods
  requestPermissions,
  registerForPushNotifications,
  scheduleSessionReminder,
  scheduleInsightNotification,
  scheduleAchievementNotification,
  scheduleMicroGoalReminder,
  cancelNotification,
  cancelAllNotifications,
  getScheduledNotifications,
  setBadgeCount,
  clearBadge,
  dismissNotification,
  dismissAllNotifications,
  updatePreferences,
  onNotification,
} = useNotifications();
```

### useNotificationReceived

Hook for listening to notifications received while the app is in foreground.

```typescript
import { useNotificationReceived } from '@/shared/hooks/useNotifications';

function MyComponent() {
  const { notification, show } = useNotificationBanner();

  useNotificationReceived((event) => {
    // Show the notification in a banner
    show({
      title: event.notification.request.content.title || 'Notification',
      body: event.notification.request.content.body || '',
      data: event.data,
    });
  });

  return <InAppNotificationBanner notification={notification} />;
}
```

### useNotificationResponse

Hook for listening to notification responses (user interactions).

```typescript
import { useNotificationResponse } from '@/shared/hooks/useNotifications';

function MyComponent() {
  useNotificationResponse((response) => {
    console.log('User tapped notification:', response.data);

    // Handle the action based on the notification type
    if (response.data.action === 'openSession') {
      navigation.navigate('SessionDetail', { id: response.data.sessionId });
    }
  });

  return <View />;
}
```

### useNotificationPermissionStatus

Hook for checking and refreshing notification permissions.

```typescript
const { status, loading, refresh } = useNotificationPermissionStatus();

if (status?.granted) {
  // Notifications are enabled
} else {
  // Show permission request
}
```

### useQuietHours

Hook for checking if quiet hours are active.

```typescript
const isQuietHours = useQuietHours();

if (!isQuietHours) {
  // Show notifications
}
```

## Design System Integration

The notification components integrate with the Tizzy design system:

### Colors

Notification types use colors from the design system:
- **Success**: `colors.success.main` (Emerald)
- **Error**: `colors.danger.main` (Red)
- **Warning**: `colors.warning.main` (Amber)
- **Info**: `colors.info.main` (Blue)

### Spacing

Uses consistent spacing from the design system:
- Padding: `spacing.md` (16px)
- Margins: `spacing.sm`, `spacing.md`
- Border radius: `spacing.radius.lg` (16px)

### Typography

Uses typography system for consistent text styling:
- Title: `typography.subtitle2` (14px, semibold)
- Body: `typography.body2` (14px, regular)

## Animation Details

The component uses react-native-reanimated for smooth 60fps animations:

### Entrance Animation
- Type: Spring animation
- Damping: 10
- Mass: 1
- Effect: Slide down from top

### Exit Animation
- Type: Timing animation
- Duration: 300ms
- Easing: out(ease)
- Effect: Slide up and fade out

### Swipe Animation
- PanResponder tracks vertical movement
- Swipe up (dy < -50) or high velocity (vy < -0.5) triggers dismiss
- Otherwise springs back to original position

## Accessibility

The component includes accessibility features:

- Proper touch target sizing (44px minimum)
- `accessibilityLabel` on dismiss button
- `accessibilityRole` set to "button"
- High contrast colors (white text on colored backgrounds)
- Hit slop for easier touch interaction

## Usage Patterns

### Pattern 1: Simple Status Messages

```typescript
const { notification, show } = useNotificationBanner();

const saveData = async () => {
  try {
    await api.save(data);
    show({
      title: 'Saved',
      body: 'Your data has been saved.',
      type: 'success',
    });
  } catch (error) {
    show({
      title: 'Error',
      body: 'Failed to save. Please try again.',
      type: 'error',
    });
  }
};
```

### Pattern 2: Notifications with Actions

```typescript
const { notification, show } = useNotificationBanner();
const navigation = useNavigation();

show({
  title: 'Session Reminder',
  body: 'Start your daily coaching session',
  type: 'info',
  data: { sessionId: '123', action: 'openSession' },
});

// Handle the action when tapped
<InAppNotificationBanner
  notification={notification}
  onPress={(data) => {
    if (data?.action === 'openSession') {
      navigation.navigate('SessionDetail', { id: data.sessionId });
    }
  }}
/>
```

### Pattern 3: Integration with Foreground Notifications

```typescript
function AppRoot() {
  const { notification, show } = useNotificationBanner();

  // Listen for notifications received while app is in foreground
  useNotificationReceived((event) => {
    show({
      title: event.notification.request.content.title || 'Notification',
      body: event.notification.request.content.body || '',
      type: 'info',
      data: event.data,
    });
  });

  // Listen for notification responses (taps)
  useNotificationResponse((response) => {
    // Handle the notification action
    console.log('Notification action:', response.data);
  });

  return (
    <>
      <Navigation />
      <InAppNotificationBanner notification={notification} />
    </>
  );
}
```

## Best Practices

1. **Place at Root Level**: Put `InAppNotificationBanner` at the top-level of your app for maximum reach
2. **Use the Hook**: Always use `useNotificationBanner` to manage state
3. **Meaningful Messages**: Keep titles short and bodies concise
4. **Type Appropriately**: Use the correct type for the notification
5. **Duration**: Use default 5 seconds for most notifications, shorter for errors
6. **Clear Actions**: Make it clear what happens when tapping the notification
7. **Test Accessibility**: Test with screen readers and keyboard navigation
8. **Combine with Listeners**: Use `useNotificationReceived` to show foreground notifications

## Files Modified/Created

1. **`/src/shared/components/notifications/InAppNotificationBanner.tsx`**
   - Enhanced with react-native-reanimated animations
   - Added swipe-to-dismiss gesture support
   - Integrated design system colors and typography
   - Added type-based styling

2. **`/src/shared/components/notifications/index.ts`**
   - Exports InAppNotificationBanner and useNotificationBanner
   - Exports NotificationBannerData type

3. **`/src/shared/components/index.ts`**
   - Added notification component exports

4. **`/src/shared/hooks/useNotifications.ts`**
   - Already includes useNotificationResponse and useNotificationReceived
   - Already includes useNotificationPermissionStatus and useQuietHours

## Dependencies

- **react-native-reanimated**: ^4.2.1 (for animations)
- **expo-notifications**: ^0.32.16 (for push notifications)
- **react-native-safe-area-context**: ^5.6.2 (for safe area insets)

All dependencies are already installed in the project.
