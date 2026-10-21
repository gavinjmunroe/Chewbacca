# Tizzy Push Notifications System

A comprehensive push notification system for the Tizzy mobile app with support for local notifications, push notifications, deep linking, and granular user preferences.

## Features

### Core Functionality
- ✅ Permission request flow with user-friendly UI
- ✅ Local notifications scheduling
- ✅ Push notification registration and handling
- ✅ Notification categories (Reminder, Insight, Achievement, Micro Goal)
- ✅ Deep linking support for navigation from notifications
- ✅ In-app notification banners for foreground notifications
- ✅ Notification action buttons (iOS)
- ✅ Badge count management

### User Preferences
- ✅ Granular control per notification type
- ✅ Quiet hours support (silence notifications during specific times)
- ✅ Daily reminder configuration
- ✅ Sound, vibration, and badge settings per category
- ✅ AsyncStorage persistence
- ✅ Import/export preferences

### Developer Experience
- ✅ React hooks for easy integration
- ✅ TypeScript support with full type safety
- ✅ Singleton service pattern
- ✅ Comprehensive test screen
- ✅ Detailed integration guide

## Project Structure

```
tizzy/mobile-app/
├── src/
│   ├── services/
│   │   ├── NotificationService.ts              # Core notification service
│   │   ├── NotificationPreferencesManager.ts   # Preferences management
│   │   └── NotificationIntegrationGuide.md     # Integration documentation
│   └── shared/
│       ├── components/
│       │   └── notifications/
│       │       ├── NotificationPermissionScreen.tsx  # Permission request UI
│       │       ├── NotificationPreferences.tsx       # Settings UI
│       │       ├── InAppNotificationBanner.tsx       # In-app banner
│       │       ├── NotificationTestScreen.tsx        # Test screen
│       │       └── index.ts                          # Exports
│       └── hooks/
│           └── useNotifications.ts              # React hooks
├── app/
│   └── _layout.tsx                              # Deep linking integration
├── app.json                                     # Expo configuration
└── NOTIFICATIONS_README.md                      # This file
```

## Installation

The notification system has already been installed and configured. Dependencies include:

```json
{
  "expo-notifications": "latest",
  "expo-device": "latest",
  "expo-constants": "latest",
  "expo-linking": "latest",
  "@react-native-async-storage/async-storage": "latest"
}
```

## Quick Start

### 1. Request Permissions

Show the permission request screen during onboarding:

```typescript
import { NotificationPermissionScreen } from './src/shared/components/notifications';

function OnboardingFlow() {
  return (
    <NotificationPermissionScreen
      onComplete={(granted) => {
        if (granted) {
          // Navigate to next step
        }
      }}
      onSkip={() => {
        // User skipped, continue without notifications
      }}
    />
  );
}
```

### 2. Use Notifications Hook

```typescript
import { useNotifications } from './src/shared/hooks/useNotifications';

function MyComponent() {
  const {
    scheduleSessionReminder,
    scheduleInsightNotification,
    scheduleAchievementNotification,
  } = useNotifications();

  const handleSessionComplete = async () => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);

    await scheduleSessionReminder(
      'session-123',
      'Breathing Exercise',
      tomorrow
    );
  };

  return <Button onPress={handleSessionComplete} title="Complete Session" />;
}
```

### 3. Add Notification Settings

```typescript
import { NotificationPreferences } from './src/shared/components/notifications';

function SettingsScreen() {
  const [showPrefs, setShowPrefs] = useState(false);

  return (
    <>
      <Button onPress={() => setShowPrefs(true)} title="Notification Settings" />
      {showPrefs && <NotificationPreferences onClose={() => setShowPrefs(false)} />}
    </>
  );
}
```

## Notification Types

### 1. Session Reminders

Scheduled notifications based on user patterns to remind them to practice:

```typescript
const { scheduleSessionReminder } = useNotifications();

await scheduleSessionReminder(
  'session-id',
  'Breathing Exercise',
  reminderTime,
  'User typically practices at this time'
);
```

**Deep Link:** `tizzy://sessions/{sessionId}`

### 2. Coaching Insights

Notifications when new coaching insights are available:

```typescript
const { scheduleInsightNotification } = useNotifications();

await scheduleInsightNotification(
  'New Insight Available',
  'Based on your recent sessions...',
  'insight-id'
);
```

**Deep Link:** `tizzy://coaching/{insightId}`

### 3. Achievements

Celebration notifications when users unlock achievements:

```typescript
const { scheduleAchievementNotification } = useNotifications();

await scheduleAchievementNotification(
  'achievement-id',
  '7-Day Streak! 🔥',
  '🏆'
);
```

**Deep Link:** `tizzy://achievements/{achievementId}`

### 4. Micro Goal Reminders

Daily reminders for micro-goals:

```typescript
const { scheduleMicroGoalReminder } = useNotifications();

const reminderTime = new Date();
reminderTime.setHours(9, 0, 0, 0); // 9 AM

await scheduleMicroGoalReminder(
  'goal-id',
  'Practice mindful breathing',
  'Take 5 minutes for deep breathing',
  reminderTime
);
```

**Deep Link:** `tizzy://goals/{goalId}`

## Deep Linking

The notification system automatically handles deep linking for navigation.

### Supported Deep Links

| Pattern | Example | Destination |
|---------|---------|-------------|
| `tizzy://sessions/{id}` | `tizzy://sessions/123` | Session detail screen |
| `tizzy://coaching/{id}` | `tizzy://coaching/456` | Coaching insight |
| `tizzy://goals/{id}` | `tizzy://goals/789` | Goal detail |
| `tizzy://achievements/{id}` | `tizzy://achievements/abc` | Achievement detail |
| `tizzy://devices` | `tizzy://devices` | Devices screen |
| `tizzy://profile` | `tizzy://profile` | Profile screen |

### Testing Deep Links

**iOS Simulator:**
```bash
xcrun simctl openurl booted "tizzy://sessions/123"
```

**Android Emulator:**
```bash
adb shell am start -W -a android.intent.action.VIEW -d "tizzy://sessions/123" com.calebsnewton.tizzy
```

## User Preferences

Users can control notifications through the preferences UI:

### Global Settings
- Enable/disable all notifications
- Quiet hours (silence notifications during specific times)
- Show in-app banners
- Group notifications
- Preview in lock screen

### Category Settings
Each notification category can be configured independently:
- Enable/disable
- Sound on/off
- Vibration on/off (Android)
- Badge updates on/off

### Programmatic Access

```typescript
import { getNotificationPreferencesManager } from './src/services/NotificationPreferencesManager';

const prefsManager = getNotificationPreferencesManager();

// Check if notifications should be shown
if (prefsManager.shouldShowNotification(NotificationCategory.REMINDER)) {
  // Show notification
}

// Update preferences
await prefsManager.setQuietHours({
  enabled: true,
  startHour: 22,  // 10 PM
  startMinute: 0,
  endHour: 8,     // 8 AM
  endMinute: 0,
});
```

## Testing

### Test Screen

A comprehensive test screen is included:

```typescript
import { NotificationTestScreen } from './src/shared/components/notifications';

// Add to your navigation
<Stack.Screen name="notification-test" component={NotificationTestScreen} />
```

The test screen allows you to:
- Request permissions
- Register for push notifications
- Schedule all notification types
- Test badge management
- View current preferences
- Cancel notifications

### Manual Testing

```typescript
import { getNotificationService } from './src/services/NotificationService';

const service = getNotificationService();

// Schedule a test notification in 5 seconds
await service.scheduleNotification(
  {
    title: 'Test',
    body: 'This is a test notification',
    data: { type: 'test' },
  },
  { seconds: 5 }
);
```

## Integration Points

### After Session Completion

```typescript
// In your session completion handler
const { scheduleSessionReminder } = useNotifications();

const nextSessionTime = calculateOptimalTime(userPatterns);
await scheduleSessionReminder(sessionId, sessionType, nextSessionTime);
```

### On Coaching Insight Ready

```typescript
// When insights are processed
const { scheduleInsightNotification } = useNotifications();

await scheduleInsightNotification(
  insight.title,
  insight.preview,
  insight.id
);
```

### Daily Goal Setup

```typescript
// When user sets up daily goals
const { scheduleMicroGoalReminder } = useNotifications();

const dailyTime = new Date();
dailyTime.setHours(userPreferredHour, 0, 0, 0);

await scheduleMicroGoalReminder(
  goal.id,
  goal.title,
  goal.description,
  dailyTime
);
```

## Hooks API

### useNotifications()

Main hook for notification functionality:

```typescript
const {
  // Status
  permissionStatus,
  pushToken,
  preferences,

  // Permissions
  requestPermissions,
  registerForPushNotifications,

  // Scheduling
  scheduleSessionReminder,
  scheduleInsightNotification,
  scheduleAchievementNotification,
  scheduleMicroGoalReminder,

  // Management
  cancelNotification,
  cancelAllNotifications,
  getScheduledNotifications,

  // Badge
  setBadgeCount,
  clearBadge,

  // Event handling
  onNotification,
} = useNotifications();
```

### useNotificationResponse()

Listen for notification interactions:

```typescript
useNotificationResponse((response) => {
  const { data, actionIdentifier } = response;
  // Handle notification tap
});
```

### useNotificationReceived()

Listen for foreground notifications:

```typescript
useNotificationReceived((event) => {
  const { notification, data } = event;
  // Handle notification received while app is open
});
```

### useNotificationBanner()

Manage in-app notification banners:

```typescript
const { notification, show, hide } = useNotificationBanner();

show({
  title: 'Title',
  body: 'Body',
  icon: '🔔',
  data: { custom: 'data' },
});
```

## Platform Differences

### iOS
- Action buttons supported
- Notification categories with custom actions
- Quiet notification delivery (no sound/banner, badge only)
- Rich notifications with images (future enhancement)

### Android
- Notification channels for categories
- Customizable importance levels
- LED colors and vibration patterns
- Expandable notifications

## Best Practices

1. **Always check permissions before scheduling:**
   ```typescript
   if (permissionStatus?.granted) {
     await scheduleNotification(...);
   }
   ```

2. **Respect user preferences:**
   ```typescript
   const prefsManager = getNotificationPreferencesManager();
   if (prefsManager.shouldShowNotification(category)) {
     // Show notification
   }
   ```

3. **Clean up old notifications:**
   ```typescript
   // Cancel old notifications when rescheduling
   await cancelNotification(oldNotificationId);
   await scheduleNotification(...);
   ```

4. **Test on physical devices:**
   Push notifications don't work on simulators/emulators.

5. **Handle notification failures gracefully:**
   ```typescript
   try {
     await scheduleNotification(...);
   } catch (error) {
     console.error('Failed to schedule notification:', error);
     // Continue without notification
   }
   ```

## Troubleshooting

### Notifications Not Appearing

1. Check permissions are granted
2. Verify preferences are enabled
3. Check quiet hours aren't active
4. Ensure running on physical device (for push)
5. Check notification is scheduled for future time

### Deep Links Not Working

1. Verify URL scheme in app.json
2. Check route mapping in _layout.tsx
3. Test deep link format manually
4. Ensure navigation state is ready

### Badge Count Issues

```typescript
// Force reset badge
const { clearBadge } = useNotifications();
await clearBadge();
```

### Permissions Denied

Guide users to settings:

```typescript
import { Linking, Platform } from 'react-native';

const openSettings = () => {
  if (Platform.OS === 'ios') {
    Linking.openURL('app-settings:');
  } else {
    Linking.openSettings();
  }
};
```

## Future Enhancements

- [ ] Rich notifications with images
- [ ] Notification grouping and stacking
- [ ] Smart notification timing based on ML patterns
- [ ] A/B testing for notification content
- [ ] Notification analytics dashboard
- [ ] Custom notification sounds per category
- [ ] Geofencing-based notifications
- [ ] Silent notifications for data sync

## Support

For detailed integration examples, see:
- `src/services/NotificationIntegrationGuide.md`
- `src/shared/components/notifications/NotificationTestScreen.tsx`

For Expo documentation:
- [Expo Notifications](https://docs.expo.dev/versions/latest/sdk/notifications/)

## License

Part of the Tizzy mobile application.
