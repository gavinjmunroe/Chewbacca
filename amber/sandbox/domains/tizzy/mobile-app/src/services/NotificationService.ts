import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { Platform } from 'react-native';
import Constants from 'expo-constants';

/**
 * Notification Categories
 */
export enum NotificationCategory {
  REMINDER = 'reminder',
  INSIGHT = 'insight',
  ACHIEVEMENT = 'achievement',
  MICRO_GOAL = 'micro_goal',
}

/**
 * Notification Types
 */
export interface NotificationData {
  type: NotificationCategory;
  sessionId?: string;
  achievementId?: string;
  goalId?: string;
  deepLink?: string;
  [key: string]: unknown;
}

/**
 * Session Reminder Notification
 */
export interface SessionReminderData extends NotificationData {
  type: NotificationCategory.REMINDER;
  sessionId: string;
  sessionType: string;
  recommendedTime: string;
  [key: string]: unknown;
}

/**
 * Coaching Insight Notification
 */
export interface CoachingInsightData extends NotificationData {
  type: NotificationCategory.INSIGHT;
  insightTitle: string;
  insightPreview: string;
  [key: string]: unknown;
}

/**
 * Achievement Notification
 */
export interface AchievementNotificationData extends NotificationData {
  type: NotificationCategory.ACHIEVEMENT;
  achievementId: string;
  achievementTitle: string;
  achievementIcon: string;
  [key: string]: unknown;
}

/**
 * Micro Goal Reminder Notification
 */
export interface MicroGoalReminderData extends NotificationData {
  type: NotificationCategory.MICRO_GOAL;
  goalId: string;
  goalTitle: string;
  goalDescription: string;
  [key: string]: unknown;
}

/**
 * Scheduled Notification Request
 */
export interface ScheduledNotificationRequest {
  identifier: string;
  content: Notifications.NotificationContentInput;
  trigger: Notifications.NotificationTriggerInput;
}

/**
 * Push Token Registration Result
 */
export interface PushTokenResult {
  token: string;
  platform: 'ios' | 'android' | 'web';
}

/**
 * Notification Permission Status
 */
export interface NotificationPermissionStatus {
  granted: boolean;
  canAskAgain: boolean;
  ios?: {
    allowsAlert: boolean;
    allowsBadge: boolean;
    allowsSound: boolean;
  };
  android?: {
    importance: Notifications.AndroidImportance;
  };
}

/**
 * Tizzy Notification Service
 *
 * Handles all notification functionality including:
 * - Permission requests
 * - Local notifications
 * - Push notification handling
 * - Notification categories
 * - Deep linking support
 */
export class TizzyNotificationService {
  private notificationListener?: Notifications.Subscription;
  private responseListener?: Notifications.Subscription;
  private pushToken?: string;
  private handlers: Map<NotificationCategory, Set<(data: any) => void>> = new Map();

  constructor() {
    this.setupNotificationHandler();
    this.setupCategories();
  }

  /**
   * Setup default notification handler
   * Controls how notifications are displayed when app is in foreground
   */
  private setupNotificationHandler(): void {
    Notifications.setNotificationHandler({
      handleNotification: async (notification): Promise<Notifications.NotificationBehavior> => {
        const category = notification.request.content.data?.type as NotificationCategory;

        // Different behavior based on category
        switch (category) {
          case NotificationCategory.ACHIEVEMENT:
            // Always show achievements
            return {
              shouldShowAlert: true,
              shouldPlaySound: true,
              shouldSetBadge: true,
              shouldShowBanner: true,
              shouldShowList: true,
            };

          case NotificationCategory.INSIGHT:
            // Show insights with sound
            return {
              shouldShowAlert: true,
              shouldPlaySound: true,
              shouldSetBadge: true,
              shouldShowBanner: true,
              shouldShowList: true,
            };

          case NotificationCategory.REMINDER:
          case NotificationCategory.MICRO_GOAL:
            // Show reminders but less intrusive
            return {
              shouldShowAlert: true,
              shouldPlaySound: false,
              shouldSetBadge: true,
              shouldShowBanner: true,
              shouldShowList: true,
            };

          default:
            return {
              shouldShowAlert: true,
              shouldPlaySound: true,
              shouldSetBadge: false,
              shouldShowBanner: true,
              shouldShowList: true,
            };
        }
      },
    });
  }

  /**
   * Setup notification categories for iOS
   */
  private async setupCategories(): Promise<void> {
    if (Platform.OS !== 'ios') return;

    try {
      await Notifications.setNotificationCategoryAsync(
        NotificationCategory.REMINDER,
        [
          {
            identifier: 'start_session',
            buttonTitle: 'Start Now',
            options: {
              opensAppToForeground: true,
            },
          },
          {
            identifier: 'snooze',
            buttonTitle: 'Remind Later',
            options: {
              opensAppToForeground: false,
            },
          },
        ],
        {
          previewPlaceholder: 'Session Reminder',
          categorySummaryFormat: '%u% session reminders',
        }
      );

      await Notifications.setNotificationCategoryAsync(
        NotificationCategory.INSIGHT,
        [
          {
            identifier: 'view_insight',
            buttonTitle: 'View',
            options: {
              opensAppToForeground: true,
            },
          },
        ],
        {
          previewPlaceholder: 'New Coaching Insight',
        }
      );

      await Notifications.setNotificationCategoryAsync(
        NotificationCategory.ACHIEVEMENT,
        [
          {
            identifier: 'celebrate',
            buttonTitle: 'View Achievement',
            options: {
              opensAppToForeground: true,
            },
          },
        ],
        {
          previewPlaceholder: 'Achievement Unlocked',
        }
      );

      await Notifications.setNotificationCategoryAsync(
        NotificationCategory.MICRO_GOAL,
        [
          {
            identifier: 'mark_complete',
            buttonTitle: 'Complete',
            options: {
              opensAppToForeground: false,
            },
          },
          {
            identifier: 'view_goal',
            buttonTitle: 'View',
            options: {
              opensAppToForeground: true,
            },
          },
        ],
        {
          previewPlaceholder: 'Daily Goal Reminder',
        }
      );

      console.log('[Notifications] Categories configured for iOS');
    } catch (error) {
      console.error('[Notifications] Failed to setup categories:', error);
    }
  }

  /**
   * Request notification permissions
   */
  async requestPermissions(): Promise<NotificationPermissionStatus> {
    try {
      if (!Device.isDevice) {
        console.warn('[Notifications] Not running on physical device');
        return {
          granted: false,
          canAskAgain: false,
        };
      }

      const { status: existingStatus } = await Notifications.getPermissionsAsync();
      let finalStatus = existingStatus;

      if (existingStatus !== 'granted') {
        const { status } = await Notifications.requestPermissionsAsync({
          ios: {
            allowAlert: true,
            allowBadge: true,
            allowSound: true,
          },
        });
        finalStatus = status;
      }

      if (finalStatus !== 'granted') {
        console.warn('[Notifications] Permission not granted');
        return {
          granted: false,
          canAskAgain: finalStatus === 'undetermined',
        };
      }

      const permissions = await Notifications.getPermissionsAsync();

      console.log('[Notifications] Permissions granted');
      return {
        granted: true,
        canAskAgain: true,
        ios: permissions.ios
          ? {
              allowsAlert: permissions.ios.allowsAlert ?? false,
              allowsBadge: permissions.ios.allowsBadge ?? false,
              allowsSound: permissions.ios.allowsSound ?? false,
            }
          : undefined,
        android: permissions.android
          ? {
              importance: permissions.android.importance,
            }
          : undefined,
      };
    } catch (error) {
      console.error('[Notifications] Failed to request permissions:', error);
      throw error;
    }
  }

  /**
   * Check current notification permissions
   */
  async checkPermissions(): Promise<NotificationPermissionStatus> {
    try {
      const permissions = await Notifications.getPermissionsAsync();

      return {
        granted: permissions.granted,
        canAskAgain: permissions.canAskAgain,
        ios: permissions.ios
          ? {
              allowsAlert: permissions.ios.allowsAlert ?? false,
              allowsBadge: permissions.ios.allowsBadge ?? false,
              allowsSound: permissions.ios.allowsSound ?? false,
            }
          : undefined,
        android: permissions.android
          ? {
              importance: permissions.android.importance,
            }
          : undefined,
      };
    } catch (error) {
      console.error('[Notifications] Failed to check permissions:', error);
      throw error;
    }
  }

  /**
   * Register for push notifications and get token
   */
  async registerForPushNotifications(): Promise<PushTokenResult | null> {
    try {
      if (!Device.isDevice) {
        console.warn('[Notifications] Push notifications require physical device');
        return null;
      }

      // Check permissions first
      const permissionStatus = await this.checkPermissions();
      if (!permissionStatus.granted) {
        const newPermissionStatus = await this.requestPermissions();
        if (!newPermissionStatus.granted) {
          console.warn('[Notifications] Push notification permission denied');
          return null;
        }
      }

      // Configure Android channel
      if (Platform.OS === 'android') {
        await Notifications.setNotificationChannelAsync('default', {
          name: 'Default',
          importance: Notifications.AndroidImportance.MAX,
          vibrationPattern: [0, 250, 250, 250],
          lightColor: '#FF231F7C',
        });

        // Create category-specific channels
        await this.setupAndroidChannels();
      }

      // Get push token
      const projectId = Constants.expoConfig?.extra?.eas?.projectId;

      const tokenData = await Notifications.getExpoPushTokenAsync({
        projectId,
      });

      this.pushToken = tokenData.data;

      console.log('[Notifications] Push token registered:', this.pushToken);

      return {
        token: this.pushToken,
        platform: Platform.OS as 'ios' | 'android',
      };
    } catch (error) {
      console.error('[Notifications] Failed to register for push notifications:', error);
      throw error;
    }
  }

  /**
   * Setup Android notification channels
   */
  private async setupAndroidChannels(): Promise<void> {
    if (Platform.OS !== 'android') return;

    try {
      // Reminders channel
      await Notifications.setNotificationChannelAsync('reminders', {
        name: 'Session Reminders',
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 250, 250, 250],
        sound: 'default',
        description: 'Reminders for therapy sessions',
      });

      // Insights channel
      await Notifications.setNotificationChannelAsync('insights', {
        name: 'Coaching Insights',
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 500],
        sound: 'default',
        description: 'New coaching insights available',
      });

      // Achievements channel
      await Notifications.setNotificationChannelAsync('achievements', {
        name: 'Achievements',
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 500, 250],
        sound: 'default',
        description: 'Achievement notifications',
      });

      // Micro goals channel
      await Notifications.setNotificationChannelAsync('micro_goals', {
        name: 'Daily Goals',
        importance: Notifications.AndroidImportance.DEFAULT,
        vibrationPattern: [0, 250],
        sound: 'default',
        description: 'Daily micro-goal reminders',
      });

      console.log('[Notifications] Android channels configured');
    } catch (error) {
      console.error('[Notifications] Failed to setup Android channels:', error);
    }
  }

  /**
   * Get current push token
   */
  getPushToken(): string | undefined {
    return this.pushToken;
  }

  /**
   * Schedule a local notification
   */
  async scheduleNotification(
    content: Notifications.NotificationContentInput,
    trigger: Notifications.NotificationTriggerInput,
    identifier?: string
  ): Promise<string> {
    try {
      const notificationId = await Notifications.scheduleNotificationAsync({
        content,
        trigger,
        identifier,
      });

      console.log('[Notifications] Scheduled notification:', notificationId);
      return notificationId;
    } catch (error) {
      console.error('[Notifications] Failed to schedule notification:', error);
      throw error;
    }
  }

  /**
   * Schedule session reminder notification
   */
  async scheduleSessionReminder(
    sessionId: string,
    sessionType: string,
    recommendedTime: Date,
    userPattern?: string
  ): Promise<string> {
    const data: Record<string, unknown> = {
      type: NotificationCategory.REMINDER,
      sessionId,
      sessionType,
      recommendedTime: recommendedTime.toISOString(),
      deepLink: `tizzy://sessions/${sessionId}`,
    };

    const content: Notifications.NotificationContentInput = {
      title: 'Time for Your Session',
      body: `Based on your patterns, this is a great time for a ${sessionType} session.`,
      data,
      categoryIdentifier: NotificationCategory.REMINDER,
      sound: true,
      badge: 1,
      ...(Platform.OS === 'android' && { channelId: 'reminders' }),
    };

    const trigger: Notifications.DateTriggerInput = {
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      date: recommendedTime,
    };

    return this.scheduleNotification(content, trigger, `session_reminder_${sessionId}`);
  }

  /**
   * Schedule coaching insight notification
   */
  async scheduleInsightNotification(
    insightTitle: string,
    insightPreview: string,
    insightId?: string
  ): Promise<string> {
    const data: CoachingInsightData = {
      type: NotificationCategory.INSIGHT,
      insightTitle,
      insightPreview,
      deepLink: insightId ? `tizzy://coaching/${insightId}` : 'tizzy://coaching',
    };

    const content: Notifications.NotificationContentInput = {
      title: 'New Coaching Insight',
      body: insightTitle,
      data,
      categoryIdentifier: NotificationCategory.INSIGHT,
      sound: true,
      badge: 1,
      ...(Platform.OS === 'android' && { channelId: 'insights' }),
    };

    // Trigger immediately
    const trigger: null = null;

    return this.scheduleNotification(content, trigger);
  }

  /**
   * Schedule achievement notification
   */
  async scheduleAchievementNotification(
    achievementId: string,
    achievementTitle: string,
    achievementIcon: string
  ): Promise<string> {
    const data: AchievementNotificationData = {
      type: NotificationCategory.ACHIEVEMENT,
      achievementId,
      achievementTitle,
      achievementIcon,
      deepLink: `tizzy://achievements/${achievementId}`,
    };

    const content: Notifications.NotificationContentInput = {
      title: 'Achievement Unlocked!',
      body: achievementTitle,
      data,
      categoryIdentifier: NotificationCategory.ACHIEVEMENT,
      sound: true,
      badge: 1,
      ...(Platform.OS === 'android' && { channelId: 'achievements' }),
    };

    // Trigger immediately
    const trigger: null = null;

    return this.scheduleNotification(content, trigger);
  }

  /**
   * Schedule daily micro-goal reminder
   */
  async scheduleMicroGoalReminder(
    goalId: string,
    goalTitle: string,
    goalDescription: string,
    reminderTime: Date
  ): Promise<string> {
    const data: MicroGoalReminderData = {
      type: NotificationCategory.MICRO_GOAL,
      goalId,
      goalTitle,
      goalDescription,
      deepLink: `tizzy://goals/${goalId}`,
    };

    const content: Notifications.NotificationContentInput = {
      title: 'Daily Goal Reminder',
      body: goalTitle,
      data,
      categoryIdentifier: NotificationCategory.MICRO_GOAL,
      sound: false,
      badge: 1,
      ...(Platform.OS === 'android' && { channelId: 'micro_goals' }),
    };

    // Use CalendarTriggerInput for repeating daily notifications
    const trigger: Notifications.CalendarTriggerInput = {
      type: Notifications.SchedulableTriggerInputTypes.CALENDAR,
      hour: reminderTime.getHours(),
      minute: reminderTime.getMinutes(),
      repeats: true,
    };

    return this.scheduleNotification(content, trigger, `micro_goal_${goalId}`);
  }

  /**
   * Schedule recurring daily notification
   */
  async scheduleDailyNotification(
    title: string,
    body: string,
    hour: number,
    minute: number,
    data?: NotificationData
  ): Promise<string> {
    // DailyTriggerInput automatically repeats daily, no 'repeats' property needed
    const trigger: Notifications.DailyTriggerInput = {
      type: Notifications.SchedulableTriggerInputTypes.DAILY,
      hour,
      minute,
    };

    const content: Notifications.NotificationContentInput = {
      title,
      body,
      data: data || {},
      sound: true,
    };

    return this.scheduleNotification(content, trigger);
  }

  /**
   * Cancel scheduled notification
   */
  async cancelNotification(notificationId: string): Promise<void> {
    try {
      await Notifications.cancelScheduledNotificationAsync(notificationId);
      console.log('[Notifications] Cancelled notification:', notificationId);
    } catch (error) {
      console.error('[Notifications] Failed to cancel notification:', error);
      throw error;
    }
  }

  /**
   * Cancel all scheduled notifications
   */
  async cancelAllNotifications(): Promise<void> {
    try {
      await Notifications.cancelAllScheduledNotificationsAsync();
      console.log('[Notifications] Cancelled all notifications');
    } catch (error) {
      console.error('[Notifications] Failed to cancel all notifications:', error);
      throw error;
    }
  }

  /**
   * Get all scheduled notifications
   */
  async getScheduledNotifications(): Promise<Notifications.NotificationRequest[]> {
    try {
      return await Notifications.getAllScheduledNotificationsAsync();
    } catch (error) {
      console.error('[Notifications] Failed to get scheduled notifications:', error);
      throw error;
    }
  }

  /**
   * Dismiss notification
   */
  async dismissNotification(notificationId: string): Promise<void> {
    try {
      await Notifications.dismissNotificationAsync(notificationId);
      console.log('[Notifications] Dismissed notification:', notificationId);
    } catch (error) {
      console.error('[Notifications] Failed to dismiss notification:', error);
      throw error;
    }
  }

  /**
   * Dismiss all notifications
   */
  async dismissAllNotifications(): Promise<void> {
    try {
      await Notifications.dismissAllNotificationsAsync();
      console.log('[Notifications] Dismissed all notifications');
    } catch (error) {
      console.error('[Notifications] Failed to dismiss all notifications:', error);
      throw error;
    }
  }

  /**
   * Set badge count
   */
  async setBadgeCount(count: number): Promise<void> {
    try {
      await Notifications.setBadgeCountAsync(count);
      console.log('[Notifications] Badge count set to:', count);
    } catch (error) {
      console.error('[Notifications] Failed to set badge count:', error);
      throw error;
    }
  }

  /**
   * Get badge count
   */
  async getBadgeCount(): Promise<number> {
    try {
      return await Notifications.getBadgeCountAsync();
    } catch (error) {
      console.error('[Notifications] Failed to get badge count:', error);
      throw error;
    }
  }

  /**
   * Register notification handler for specific category
   */
  onNotification(
    category: NotificationCategory,
    handler: (data: any) => void
  ): () => void {
    if (!this.handlers.has(category)) {
      this.handlers.set(category, new Set());
    }

    this.handlers.get(category)!.add(handler);

    return () => {
      this.handlers.get(category)?.delete(handler);
    };
  }

  /**
   * Start listening for notifications
   */
  startListening(): void {
    // Listen for notifications received while app is running
    this.notificationListener = Notifications.addNotificationReceivedListener(
      (notification) => {
        console.log('[Notifications] Notification received:', notification);

        const category = notification.request.content.data?.type as NotificationCategory;
        const handlers = this.handlers.get(category);

        if (handlers) {
          handlers.forEach((handler) => {
            handler(notification.request.content.data);
          });
        }
      }
    );

    // Listen for notification interactions (user taps notification)
    this.responseListener = Notifications.addNotificationResponseReceivedListener(
      (response) => {
        console.log('[Notifications] Notification response:', response);

        const data = response.notification.request.content.data;
        const category = data?.type as NotificationCategory;
        const actionIdentifier = response.actionIdentifier;

        // Handle action-specific logic
        if (actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) {
          this.handleNotificationAction(actionIdentifier, data);
        }

        // Call category handlers
        const handlers = this.handlers.get(category);
        if (handlers) {
          handlers.forEach((handler) => {
            handler(data);
          });
        }
      }
    );

    console.log('[Notifications] Started listening for notifications');
  }

  /**
   * Handle notification action buttons
   */
  private handleNotificationAction(actionIdentifier: string, data: any): void {
    console.log('[Notifications] Action triggered:', actionIdentifier, data);

    switch (actionIdentifier) {
      case 'start_session':
        // Handle start session action
        console.log('[Notifications] Start session action');
        break;

      case 'snooze':
        // Handle snooze action - reschedule notification
        console.log('[Notifications] Snooze action');
        break;

      case 'view_insight':
        // Handle view insight action
        console.log('[Notifications] View insight action');
        break;

      case 'celebrate':
        // Handle celebrate achievement action
        console.log('[Notifications] Celebrate action');
        break;

      case 'mark_complete':
        // Handle mark goal complete action
        console.log('[Notifications] Mark complete action');
        break;

      case 'view_goal':
        // Handle view goal action
        console.log('[Notifications] View goal action');
        break;

      default:
        console.log('[Notifications] Unknown action:', actionIdentifier);
    }
  }

  /**
   * Stop listening for notifications
   */
  stopListening(): void {
    if (this.notificationListener) {
      this.notificationListener.remove();
      this.notificationListener = undefined;
    }

    if (this.responseListener) {
      this.responseListener.remove();
      this.responseListener = undefined;
    }

    console.log('[Notifications] Stopped listening for notifications');
  }

  /**
   * Cleanup notification service
   */
  cleanup(): void {
    this.stopListening();
    this.handlers.clear();
    console.log('[Notifications] Notification service cleaned up');
  }
}

// Singleton instance
let notificationServiceInstance: TizzyNotificationService | null = null;

export function getNotificationService(): TizzyNotificationService {
  if (!notificationServiceInstance) {
    notificationServiceInstance = new TizzyNotificationService();
  }
  return notificationServiceInstance;
}
