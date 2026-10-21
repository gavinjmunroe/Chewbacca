# Tizzy Notification System - Integration Guide

This guide demonstrates how to integrate the notification system into your Tizzy mobile app features.

## Table of Contents

1. [Setup](#setup)
2. [Basic Usage](#basic-usage)
3. [Integration Examples](#integration-examples)
4. [Deep Linking](#deep-linking)
5. [Customization](#customization)
6. [Best Practices](#best-practices)

## Setup

### 1. Install Dependencies

The notification system requires `expo-notifications`, which has already been installed:

```bash
npm install expo-notifications --legacy-peer-deps
```

### 2. Configure app.json

The app.json has been configured with notification settings. No additional configuration needed.

### 3. Request Permissions

Request notification permissions when appropriate (e.g., during onboarding):

```typescript
import { NotificationPermissionScreen } from '../src/shared/components/notifications';

function OnboardingScreen() {
  const handlePermissionComplete = (granted: boolean) => {
    if (granted) {
      console.log('Notifications enabled!');
      // Navigate to next screen
    } else {
      console.log('Notifications denied');
      // Continue without notifications
    }
  };

  return (
    <NotificationPermissionScreen
      onComplete={handlePermissionComplete}
      onSkip={() => console.log('User skipped')}
    />
  );
}
```

## Basic Usage

### Using the Notifications Hook

```typescript
import { useNotifications } from '../src/shared/hooks/useNotifications';

function MyComponent() {
  const {
    permissionStatus,
    pushToken,
    scheduleSessionReminder,
    scheduleInsightNotification,
    scheduleAchievementNotification,
    scheduleMicroGoalReminder,
  } = useNotifications();

  // Check permission status
  useEffect(() => {
    if (permissionStatus?.granted) {
      console.log('Notifications are enabled');
    }
  }, [permissionStatus]);

  return <View>...</View>;
}
```

## Integration Examples

### 1. Schedule Session Reminder After Completion

```typescript
// In session completion handler
import { useNotifications } from '../src/shared/hooks/useNotifications';

function SessionCompletedScreen({ sessionId }: { sessionId: string }) {
  const { scheduleSessionReminder } = useNotifications();

  useEffect(() => {
    const scheduleNextReminder = async () => {
      // Calculate recommended time based on user patterns
      const recommendedTime = new Date();
      recommendedTime.setHours(recommendedTime.getHours() + 24); // Tomorrow, same time

      await scheduleSessionReminder(
        sessionId,
        'Breathing Exercise',
        recommendedTime,
        'User typically practices at this time'
      );
    };

    scheduleNextReminder();
  }, []);

  return <View>...</View>;
}
```

### 2. Trigger Coaching Insight Notification

```typescript
// When coaching insights are ready
import { useNotifications } from '../src/shared/hooks/useNotifications';

function CoachingService() {
  const { scheduleInsightNotification } = useNotifications();

  const onInsightReady = async (insight: Insight) => {
    await scheduleInsightNotification(
      insight.title,
      insight.preview,
      insight.id
    );
  };

  return { onInsightReady };
}
```

### 3. Achievement Unlocked

```typescript
// When user unlocks an achievement
import { useNotifications } from '../src/shared/hooks/useNotifications';

function AchievementSystem() {
  const { scheduleAchievementNotification } = useNotifications();

  const unlockAchievement = async (achievement: Achievement) => {
    await scheduleAchievementNotification(
      achievement.id,
      achievement.title,
      achievement.icon
    );
  };

  return { unlockAchievement };
}
```

### 4. Daily Micro-Goal Reminders

```typescript
// Set up daily goal reminders
import { useNotifications } from '../src/shared/hooks/useNotifications';

function GoalManager() {
  const { scheduleMicroGoalReminder } = useNotifications();

  const setupDailyReminder = async (goal: Goal) => {
    const reminderTime = new Date();
    reminderTime.setHours(9, 0, 0, 0); // 9 AM

    await scheduleMicroGoalReminder(
      goal.id,
      goal.title,
      goal.description,
      reminderTime
    );
  };

  return { setupDailyReminder };
}
```

### 5. Notification Preferences in Settings

```typescript
import { NotificationPreferences } from '../src/shared/components/notifications';

function SettingsScreen() {
  const [showNotificationSettings, setShowNotificationSettings] = useState(false);

  return (
    <View>
      <TouchableOpacity onPress={() => setShowNotificationSettings(true)}>
        <Text>Notification Settings</Text>
      </TouchableOpacity>

      {showNotificationSettings && (
        <NotificationPreferences
          onClose={() => setShowNotificationSettings(false)}
        />
      )}
    </View>
  );
}
```

### 6. Listen for Notification Responses

```typescript
import { useNotificationResponse } from '../src/shared/hooks/useNotifications';

function MyComponent() {
  // Handle when user taps a notification
  useNotificationResponse((response) => {
    console.log('Notification tapped:', response);

    // Access notification data
    const { type, sessionId, goalId } = response.data;

    // Navigate or perform action based on notification type
    switch (type) {
      case 'reminder':
        // Navigate to session
        router.push(`/sessions/${sessionId}`);
        break;
      case 'micro_goal':
        // Navigate to goal
        router.push(`/goals/${goalId}`);
        break;
    }
  });

  return <View>...</View>;
}
```

### 7. Show In-App Notification Banner

```typescript
import { InAppNotificationBanner, useNotificationBanner } from '../src/shared/components/notifications';

function MyApp() {
  const { notification, show, hide } = useNotificationBanner();

  const showCustomNotification = () => {
    show({
      title: 'New Message',
      body: 'You have a new coaching insight available',
      icon: '💡',
      data: { type: 'insight', insightId: '123' },
    });
  };

  const handleBannerPress = (data: any) => {
    console.log('Banner pressed:', data);
    // Navigate based on data
    hide();
  };

  return (
    <>
      <View>
        <Button title="Show Notification" onPress={showCustomNotification} />
      </View>

      <InAppNotificationBanner
        notification={notification}
        onPress={handleBannerPress}
        onDismiss={hide}
      />
    </>
  );
}
```

## Deep Linking

The notification system supports deep linking to navigate users to specific screens.

### Deep Link Format

```
tizzy://path/to/screen?param1=value1
```

### Supported Deep Links

- `tizzy://sessions/{sessionId}` - Navigate to specific session
- `tizzy://coaching/{insightId}` - Navigate to coaching insight
- `tizzy://goals/{goalId}` - Navigate to specific goal
- `tizzy://achievements/{achievementId}` - Navigate to achievement
- `tizzy://devices` - Navigate to devices screen
- `tizzy://profile` - Navigate to profile screen

### Custom Deep Links

To add custom deep links, update the route mapping in `app/_layout.tsx`:

```typescript
const routeMap: Record<string, string> = {
  'sessions': '/(tabs)/sessions',
  'coaching': '/(tabs)/coaching',
  'your-custom-path': '/your/custom/route',
};
```

## Customization

### Notification Categories

You can customize notification behavior per category:

```typescript
import { NotificationCategory } from '../src/services/NotificationService';
import { getNotificationPreferencesManager } from '../src/services/NotificationPreferencesManager';

const prefsManager = getNotificationPreferencesManager();

// Enable/disable specific category
await prefsManager.setCategoryEnabled(NotificationCategory.REMINDER, true);

// Update category preferences
await prefsManager.updateCategoryPreferences(NotificationCategory.INSIGHT, {
  enabled: true,
  sound: true,
  vibrate: false,
  badge: true,
});
```

### Quiet Hours

```typescript
import { getNotificationPreferencesManager } from '../src/services/NotificationPreferencesManager';

const prefsManager = getNotificationPreferencesManager();

await prefsManager.setQuietHours({
  enabled: true,
  startHour: 22,  // 10 PM
  startMinute: 0,
  endHour: 8,     // 8 AM
  endMinute: 0,
});
```

### Custom Notification Sounds (iOS)

1. Add custom sound file to `assets/sounds/`
2. Update `app.json`:

```json
{
  "expo": {
    "plugins": [
      [
        "expo-notifications",
        {
          "sounds": ["./assets/sounds/custom-notification.wav"]
        }
      ]
    ]
  }
}
```

3. Use in notification:

```typescript
const content: Notifications.NotificationContentInput = {
  title: 'Title',
  body: 'Body',
  sound: 'custom-notification.wav',
};
```

## Best Practices

### 1. Check Permissions Before Scheduling

```typescript
const { permissionStatus, scheduleSessionReminder } = useNotifications();

if (permissionStatus?.granted) {
  await scheduleSessionReminder(...);
} else {
  console.log('Notifications not enabled');
}
```

### 2. Respect User Preferences

The notification system automatically checks user preferences before showing notifications:

```typescript
import { getNotificationPreferencesManager } from '../src/services/NotificationPreferencesManager';

const prefsManager = getNotificationPreferencesManager();

if (prefsManager.shouldShowNotification(NotificationCategory.REMINDER)) {
  // Show notification
}
```

### 3. Handle Notification Cleanup

```typescript
import { useNotifications } from '../src/shared/hooks/useNotifications';

function MyComponent() {
  const { cancelNotification, getScheduledNotifications } = useNotifications();

  useEffect(() => {
    return () => {
      // Clean up scheduled notifications when component unmounts
      // if needed for your use case
    };
  }, []);
}
```

### 4. Track Notification Analytics

```typescript
import * as Analytics from '../src/services/Analytics';

// Track when notification is scheduled
Analytics.trackEvent('notification_scheduled', {
  type: 'session_reminder',
  sessionId: '123',
});

// Track when notification is opened (already done in _layout.tsx)
```

### 5. Test on Physical Devices

Push notifications require physical devices and won't work on simulators/emulators.

### 6. Handle Notification Badges

```typescript
const { setBadgeCount, clearBadge } = useNotifications();

// Update badge count
await setBadgeCount(3);

// Clear badge
await clearBadge();
```

### 7. Provide Opt-Out

Always give users the ability to disable notifications:

```typescript
import { NotificationPreferences } from '../src/shared/components/notifications';

// Show notification preferences in settings
<NotificationPreferences onClose={() => {}} />
```

## Testing

### Test Notifications in Development

```typescript
import { getNotificationService } from '../src/services/NotificationService';

const testNotification = async () => {
  const service = getNotificationService();

  await service.scheduleNotification(
    {
      title: 'Test Notification',
      body: 'This is a test',
      data: { type: 'test' },
    },
    {
      seconds: 5, // Show in 5 seconds
    }
  );
};
```

### Test Deep Linking

```bash
# iOS
xcrun simctl openurl booted "tizzy://sessions/123"

# Android
adb shell am start -W -a android.intent.action.VIEW -d "tizzy://sessions/123" com.calebsnewton.tizzy
```

## Troubleshooting

### Notifications Not Appearing

1. Check permissions are granted
2. Verify notification preferences are enabled
3. Check if quiet hours are active
4. Ensure running on physical device (for push notifications)

### Deep Links Not Working

1. Verify URL scheme is configured in app.json
2. Check route mapping in _layout.tsx
3. Test deep link format

### Badge Count Not Updating

```typescript
// Manually update badge count
const { setBadgeCount } = useNotifications();
await setBadgeCount(0);
```

## API Reference

See the following files for complete API documentation:

- `src/services/NotificationService.ts` - Core notification service
- `src/services/NotificationPreferencesManager.ts` - Preferences management
- `src/shared/hooks/useNotifications.ts` - React hooks
- `src/shared/components/notifications/` - UI components

## Support

For issues or questions, refer to:

- [Expo Notifications Documentation](https://docs.expo.dev/versions/latest/sdk/notifications/)
- [React Navigation Deep Linking](https://reactnavigation.org/docs/deep-linking/)
