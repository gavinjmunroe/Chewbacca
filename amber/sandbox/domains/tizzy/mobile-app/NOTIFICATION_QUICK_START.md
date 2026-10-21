# Notification UI Components - Quick Start Guide

## Quick Start (30 seconds)

### 1. Import Components
```typescript
import {
  InAppNotificationBanner,
  useNotificationBanner,
  useNotificationReceived,
  useNotificationResponse,
} from '@/shared/components';
import { useNotifications } from '@/shared/hooks/useNotifications';
```

### 2. Set Up In Your App
```typescript
function MyAppRoot() {
  const { notification, show, hide } = useNotificationBanner();

  // Optional: Listen for foreground notifications
  useNotificationReceived((event) => {
    show({
      title: event.notification.request.content.title || 'Notification',
      body: event.notification.request.content.body || '',
      type: 'info',
    });
  });

  // Optional: Listen for notification taps
  useNotificationResponse((response) => {
    console.log('Notification tapped:', response.data);
  });

  return (
    <>
      <NavigationContainer />

      <InAppNotificationBanner
        notification={notification}
        onPress={(data) => {
          // Handle notification action
          console.log('Action:', data);
          hide();
        }}
        onDismiss={() => {
          // Cleanup
        }}
      />
    </>
  );
}
```

### 3. Show Notifications
```typescript
// Success notification
show({
  title: 'Success!',
  body: 'Action completed successfully.',
  type: 'success',
});

// Error notification
show({
  title: 'Error',
  body: 'Something went wrong.',
  type: 'error',
});

// Warning notification
show({
  title: 'Warning',
  body: 'Please review this.',
  type: 'warning',
});

// Info notification
show({
  title: 'Information',
  body: 'Here is some info.',
  type: 'info',
});

// Custom icon
show({
  title: 'Achievement',
  body: 'You unlocked something!',
  type: 'success',
  icon: '🏆',
});

// With action data
show({
  title: 'Session Ready',
  body: 'Tap to open your session.',
  type: 'info',
  data: {
    sessionId: '123',
    action: 'openSession',
  },
});
```

## User Interactions

- **Tap banner**: Triggers `onPress` callback
- **Swipe up**: Dismisses notification with animation
- **Tap X button**: Immediately dismisses notification
- **Wait 5s**: Auto-dismisses (configurable)

## Key Features

✓ Spring entrance animation
✓ Smooth exit animation
✓ Swipe-to-dismiss gesture
✓ Type-based colors (success/error/warning/info)
✓ Auto-dismiss timer
✓ Custom icons/emojis
✓ Action data passing
✓ Safe area respecting
✓ Accessibility support
✓ Design system integrated

## Notification Types & Colors

| Type | Color | Icon |
|------|-------|------|
| `success` | Emerald | ✓ |
| `error` | Red | ✕ |
| `warning` | Amber | ⚠ |
| `info` | Blue | ℹ |

## Hook: useNotificationBanner

```typescript
const { notification, show, hide } = useNotificationBanner();

// Show a notification
show({
  title: 'Title',
  body: 'Message body',
  type: 'success', // Optional
  icon: '✓', // Optional
  data: { /* any data */ }, // Optional
});

// Hide the notification
hide();
```

## Hook: useNotificationReceived

Listen to notifications received while app is in foreground.

```typescript
useNotificationReceived((event) => {
  const { title, body } = event.notification.request.content;
  const data = event.data;
  // Do something with the notification
});
```

## Hook: useNotificationResponse

Listen to when user interacts with notifications.

```typescript
useNotificationResponse((response) => {
  const { notification, actionIdentifier, data } = response;
  // Handle the notification action
});
```

## Hook: useNotifications

Full notification management (push, scheduling, permissions).

```typescript
const {
  permissionStatus,
  pushToken,
  requestPermissions,
  registerForPushNotifications,
  scheduleSessionReminder,
  // ... many more methods
} = useNotifications();
```

## Common Patterns

### Pattern 1: API Call Success/Error
```typescript
const handleSave = async () => {
  try {
    await api.save(data);
    show({
      title: 'Saved',
      body: 'Your changes have been saved.',
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

### Pattern 2: Notification with Action
```typescript
show({
  title: 'Session Ready',
  body: 'Start your daily coaching session',
  type: 'info',
  data: { sessionId: '123', action: 'openSession' },
});

// Handle in onPress callback
<InAppNotificationBanner
  notification={notification}
  onPress={(data) => {
    if (data?.action === 'openSession') {
      navigation.navigate('SessionDetail', { id: data.sessionId });
    }
  }}
/>
```

### Pattern 3: Foreground Notification Integration
```typescript
useNotificationReceived((event) => {
  show({
    title: event.notification.request.content.title || 'Notification',
    body: event.notification.request.content.body || '',
    type: 'info',
    data: event.data,
  });
});
```

## Props Reference

### InAppNotificationBanner Props
- `notification: NotificationBannerData | null` - The notification to display
- `onPress?: (data: any) => void` - Called when notification is tapped
- `onDismiss?: () => void` - Called when notification is dismissed
- `duration?: number` - Auto-dismiss time in ms (default: 5000)

### NotificationBannerData Props
- `title: string` - Notification title
- `body: string` - Notification body/message
- `icon?: string` - Custom icon (emoji or symbol)
- `type?: 'success' | 'error' | 'warning' | 'info'` - Notification type
- `data?: any` - Custom data passed to callbacks

## File Locations

### Components
- `/src/shared/components/notifications/InAppNotificationBanner.tsx`
- `/src/shared/components/notifications/index.ts`

### Hooks
- `/src/shared/hooks/useNotifications.ts`

### Documentation
- `/src/shared/docs/NOTIFICATION_COMPONENTS.md`

### Examples
- `/src/shared/examples/NotificationBannerExample.tsx`
- `/src/shared/examples/NotificationIntegrationExample.tsx`

## Animations

### Entrance
- Type: Spring
- Duration: ~250ms
- Effect: Slides down from top

### Exit
- Type: Timing
- Duration: 300ms
- Effect: Slides up and fades out

### Swipe Gesture
- Threshold: -50px vertical movement
- Velocity threshold: -0.5
- Spring back if not swiped enough

## Accessibility

- Touch targets: 44px minimum (iOS HIG)
- ARIA labels: "Dismiss notification"
- High contrast: White on colored backgrounds
- Screen reader: Proper roles and labels

## Design System Integration

Colors from: `/src/shared/constants/colors.ts`
Spacing from: `/src/shared/constants/spacing.ts`
Typography from: `/src/shared/constants/typography.ts`

## Troubleshooting

**Notification not showing?**
- Check that `InAppNotificationBanner` is mounted
- Verify notification is not null
- Check that component is at top level

**Animation not smooth?**
- Ensure react-native-reanimated is installed
- Check that you're using Reanimated v4+
- Verify Reanimated babel plugin is configured

**Gesture not working?**
- Check PanResponder is being used correctly
- Verify swipe is vertical (dy < -50)
- Test on actual device (simulator may have issues)

**Colors not right?**
- Check design system colors file
- Verify notification type is one of: success/error/warning/info
- Check if custom colors are set in styles

## Need Help?

See detailed docs: `/src/shared/docs/NOTIFICATION_COMPONENTS.md`
See examples: `/src/shared/examples/NotificationBannerExample.tsx`
See advanced example: `/src/shared/examples/NotificationIntegrationExample.tsx`
