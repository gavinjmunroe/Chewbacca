import { useEffect, useState, useCallback, useRef } from 'react';
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import {
  getNotificationService,
  NotificationCategory,
  NotificationData,
  NotificationPermissionStatus,
  PushTokenResult,
} from '../../services/NotificationService';
import {
  getNotificationPreferencesManager,
  NotificationPreferences,
} from '../../services/NotificationPreferencesManager';

/**
 * Notification event types
 */
export interface NotificationEvent {
  notification: Notifications.Notification;
  data: NotificationData;
}

export interface NotificationResponse {
  notification: Notifications.Notification;
  actionIdentifier: string;
  data: NotificationData;
}

/**
 * Hook for managing notifications
 *
 * Provides easy access to notification functionality
 */
export function useNotifications() {
  const [permissionStatus, setPermissionStatus] =
    useState<NotificationPermissionStatus | null>(null);
  const [pushToken, setPushToken] = useState<string | null>(null);
  const [lastNotification, setLastNotification] =
    useState<NotificationEvent | null>(null);
  const [preferences, setPreferences] = useState<NotificationPreferences | null>(
    null
  );
  const notificationService = useRef(getNotificationService());
  const preferencesManager = useRef(getNotificationPreferencesManager());

  // Initialize on mount
  useEffect(() => {
    initialize();

    return () => {
      cleanup();
    };
  }, []);

  const initialize = async () => {
    // Load preferences
    const prefs = await preferencesManager.current.loadPreferences();
    setPreferences(prefs);

    // Check permissions
    const status = await notificationService.current.checkPermissions();
    setPermissionStatus(status);

    // Get push token if already registered
    const token = notificationService.current.getPushToken();
    if (token) {
      setPushToken(token);
    }

    // Start listening for notifications
    notificationService.current.startListening();
  };

  const cleanup = () => {
    notificationService.current.stopListening();
  };

  /**
   * Request notification permissions
   */
  const requestPermissions = useCallback(async (): Promise<boolean> => {
    const status = await notificationService.current.requestPermissions();
    setPermissionStatus(status);
    return status.granted;
  }, []);

  /**
   * Register for push notifications
   */
  const registerForPushNotifications = useCallback(async (): Promise<
    PushTokenResult | null
  > => {
    const result = await notificationService.current.registerForPushNotifications();
    if (result) {
      setPushToken(result.token);
      await preferencesManager.current.storePushToken(result.token);
    }
    return result;
  }, []);

  /**
   * Schedule a session reminder
   */
  const scheduleSessionReminder = useCallback(
    async (
      sessionId: string,
      sessionType: string,
      recommendedTime: Date,
      userPattern?: string
    ): Promise<string | null> => {
      if (!preferencesManager.current.shouldShowNotification(NotificationCategory.REMINDER)) {
        console.log('[Notifications] Session reminders disabled in preferences');
        return null;
      }

      return await notificationService.current.scheduleSessionReminder(
        sessionId,
        sessionType,
        recommendedTime,
        userPattern
      );
    },
    []
  );

  /**
   * Schedule coaching insight notification
   */
  const scheduleInsightNotification = useCallback(
    async (
      insightTitle: string,
      insightPreview: string,
      insightId?: string
    ): Promise<string | null> => {
      if (!preferencesManager.current.shouldShowNotification(NotificationCategory.INSIGHT)) {
        console.log('[Notifications] Insights disabled in preferences');
        return null;
      }

      return await notificationService.current.scheduleInsightNotification(
        insightTitle,
        insightPreview,
        insightId
      );
    },
    []
  );

  /**
   * Schedule achievement notification
   */
  const scheduleAchievementNotification = useCallback(
    async (
      achievementId: string,
      achievementTitle: string,
      achievementIcon: string
    ): Promise<string | null> => {
      if (!preferencesManager.current.shouldShowNotification(NotificationCategory.ACHIEVEMENT)) {
        console.log('[Notifications] Achievements disabled in preferences');
        return null;
      }

      return await notificationService.current.scheduleAchievementNotification(
        achievementId,
        achievementTitle,
        achievementIcon
      );
    },
    []
  );

  /**
   * Schedule micro goal reminder
   */
  const scheduleMicroGoalReminder = useCallback(
    async (
      goalId: string,
      goalTitle: string,
      goalDescription: string,
      reminderTime: Date
    ): Promise<string | null> => {
      if (!preferencesManager.current.shouldShowNotification(NotificationCategory.MICRO_GOAL)) {
        console.log('[Notifications] Micro goals disabled in preferences');
        return null;
      }

      return await notificationService.current.scheduleMicroGoalReminder(
        goalId,
        goalTitle,
        goalDescription,
        reminderTime
      );
    },
    []
  );

  /**
   * Cancel notification
   */
  const cancelNotification = useCallback(
    async (notificationId: string): Promise<void> => {
      await notificationService.current.cancelNotification(notificationId);
    },
    []
  );

  /**
   * Cancel all notifications
   */
  const cancelAllNotifications = useCallback(async (): Promise<void> => {
    await notificationService.current.cancelAllNotifications();
  }, []);

  /**
   * Get scheduled notifications
   */
  const getScheduledNotifications = useCallback(async (): Promise<
    Notifications.NotificationRequest[]
  > => {
    return await notificationService.current.getScheduledNotifications();
  }, []);

  /**
   * Set badge count
   */
  const setBadgeCount = useCallback(async (count: number): Promise<void> => {
    await notificationService.current.setBadgeCount(count);
  }, []);

  /**
   * Clear badge
   */
  const clearBadge = useCallback(async (): Promise<void> => {
    await notificationService.current.setBadgeCount(0);
  }, []);

  /**
   * Dismiss notification
   */
  const dismissNotification = useCallback(
    async (notificationId: string): Promise<void> => {
      await notificationService.current.dismissNotification(notificationId);
    },
    []
  );

  /**
   * Dismiss all notifications
   */
  const dismissAllNotifications = useCallback(async (): Promise<void> => {
    await notificationService.current.dismissAllNotifications();
  }, []);

  /**
   * Update notification preferences
   */
  const updatePreferences = useCallback(
    async (updates: Partial<NotificationPreferences>): Promise<void> => {
      await preferencesManager.current.updatePreferences(updates);
      const newPrefs = preferencesManager.current.getPreferences();
      setPreferences(newPrefs);
    },
    []
  );

  /**
   * Register notification handler for specific category
   */
  const onNotification = useCallback(
    (category: NotificationCategory, handler: (data: any) => void): (() => void) => {
      return notificationService.current.onNotification(category, handler);
    },
    []
  );

  return {
    // Status
    permissionStatus,
    pushToken,
    lastNotification,
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

    // Dismiss
    dismissNotification,
    dismissAllNotifications,

    // Preferences
    updatePreferences,

    // Event handling
    onNotification,
  };
}

/**
 * Hook for listening to notification responses
 *
 * Handles when user interacts with notifications
 */
export function useNotificationResponse(
  handler: (response: NotificationResponse) => void
) {
  useEffect(() => {
    const subscription =
      Notifications.addNotificationResponseReceivedListener((response) => {
        handler({
          notification: response.notification,
          actionIdentifier: response.actionIdentifier,
          data: response.notification.request.content.data as NotificationData,
        });
      });

    return () => {
      subscription.remove();
    };
  }, [handler]);
}

/**
 * Hook for listening to foreground notifications
 *
 * Handles notifications received while app is in foreground
 */
export function useNotificationReceived(
  handler: (event: NotificationEvent) => void
) {
  useEffect(() => {
    const subscription = Notifications.addNotificationReceivedListener(
      (notification) => {
        handler({
          notification,
          data: notification.request.content.data as NotificationData,
        });
      }
    );

    return () => {
      subscription.remove();
    };
  }, [handler]);
}

/**
 * Hook for checking if in quiet hours
 */
export function useQuietHours() {
  const [isQuietHours, setIsQuietHours] = useState(false);
  const preferencesManager = useRef(getNotificationPreferencesManager());

  useEffect(() => {
    const checkQuietHours = () => {
      setIsQuietHours(preferencesManager.current.isQuietHoursActive());
    };

    // Check immediately
    checkQuietHours();

    // Check every minute
    const interval = setInterval(checkQuietHours, 60000);

    return () => clearInterval(interval);
  }, []);

  return isQuietHours;
}

/**
 * Hook for notification permission status
 */
export function useNotificationPermissionStatus() {
  const [status, setStatus] = useState<NotificationPermissionStatus | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    checkPermissions();
  }, []);

  const checkPermissions = async () => {
    const service = getNotificationService();
    const permissionStatus = await service.checkPermissions();
    setStatus(permissionStatus);
    setLoading(false);
  };

  const refresh = useCallback(async () => {
    setLoading(true);
    await checkPermissions();
  }, []);

  return {
    status,
    loading,
    refresh,
  };
}
