import AsyncStorage from '@react-native-async-storage/async-storage';
import { NotificationCategory } from './NotificationService';

/**
 * Quiet Hours Configuration
 */
export interface QuietHours {
  enabled: boolean;
  startHour: number; // 0-23
  startMinute: number; // 0-59
  endHour: number; // 0-23
  endMinute: number; // 0-59
}

/**
 * Notification Type Preferences
 */
export interface NotificationTypePreferences {
  enabled: boolean;
  sound: boolean;
  vibrate: boolean;
  badge: boolean;
}

/**
 * Daily Reminder Configuration
 */
export interface DailyReminderConfig {
  enabled: boolean;
  hour: number; // 0-23
  minute: number; // 0-59
}

/**
 * Complete Notification Preferences
 */
export interface NotificationPreferences {
  // Global settings
  enabled: boolean;
  quietHours: QuietHours;

  // Category-specific settings
  reminders: NotificationTypePreferences;
  insights: NotificationTypePreferences;
  achievements: NotificationTypePreferences;
  microGoals: NotificationTypePreferences;

  // Daily reminder time
  dailyReminder: DailyReminderConfig;

  // Advanced settings
  showInApp: boolean;
  groupNotifications: boolean;
  previewInLockScreen: boolean;
}

/**
 * Default notification preferences
 */
const DEFAULT_PREFERENCES: NotificationPreferences = {
  enabled: true,
  quietHours: {
    enabled: false,
    startHour: 22, // 10 PM
    startMinute: 0,
    endHour: 8, // 8 AM
    endMinute: 0,
  },
  reminders: {
    enabled: true,
    sound: true,
    vibrate: true,
    badge: true,
  },
  insights: {
    enabled: true,
    sound: true,
    vibrate: true,
    badge: true,
  },
  achievements: {
    enabled: true,
    sound: true,
    vibrate: true,
    badge: true,
  },
  microGoals: {
    enabled: true,
    sound: false,
    vibrate: true,
    badge: true,
  },
  dailyReminder: {
    enabled: true,
    hour: 9, // 9 AM
    minute: 0,
  },
  showInApp: true,
  groupNotifications: true,
  previewInLockScreen: true,
};

/**
 * Storage keys
 */
const STORAGE_KEYS = {
  PREFERENCES: '@tizzy_notification_preferences',
  PUSH_TOKEN: '@tizzy_push_token',
  LAST_SYNC: '@tizzy_notification_last_sync',
};

/**
 * Notification Preferences Manager
 *
 * Manages notification settings with AsyncStorage persistence
 * Provides granular control per notification type and quiet hours support
 */
export class NotificationPreferencesManager {
  private preferences: NotificationPreferences = DEFAULT_PREFERENCES;
  private listeners: Set<(preferences: NotificationPreferences) => void> = new Set();
  private loaded = false;

  constructor() {
    this.loadPreferences();
  }

  /**
   * Load preferences from AsyncStorage
   */
  async loadPreferences(): Promise<NotificationPreferences> {
    try {
      const stored = await AsyncStorage.getItem(STORAGE_KEYS.PREFERENCES);

      if (stored) {
        this.preferences = {
          ...DEFAULT_PREFERENCES,
          ...JSON.parse(stored),
        };
        console.log('[NotificationPrefs] Loaded preferences:', this.preferences);
      } else {
        this.preferences = DEFAULT_PREFERENCES;
        await this.savePreferences();
        console.log('[NotificationPrefs] Initialized with default preferences');
      }

      this.loaded = true;
      return this.preferences;
    } catch (error) {
      console.error('[NotificationPrefs] Failed to load preferences:', error);
      this.preferences = DEFAULT_PREFERENCES;
      this.loaded = true;
      return this.preferences;
    }
  }

  /**
   * Save preferences to AsyncStorage
   */
  async savePreferences(): Promise<void> {
    try {
      await AsyncStorage.setItem(
        STORAGE_KEYS.PREFERENCES,
        JSON.stringify(this.preferences)
      );
      console.log('[NotificationPrefs] Saved preferences');

      // Notify listeners
      this.notifyListeners();
    } catch (error) {
      console.error('[NotificationPrefs] Failed to save preferences:', error);
      throw error;
    }
  }

  /**
   * Get current preferences
   */
  getPreferences(): NotificationPreferences {
    if (!this.loaded) {
      console.warn('[NotificationPrefs] Preferences not loaded yet');
    }
    return { ...this.preferences };
  }

  /**
   * Update preferences
   */
  async updatePreferences(
    updates: Partial<NotificationPreferences>
  ): Promise<void> {
    this.preferences = {
      ...this.preferences,
      ...updates,
    };
    await this.savePreferences();
  }

  /**
   * Enable/disable all notifications
   */
  async setNotificationsEnabled(enabled: boolean): Promise<void> {
    await this.updatePreferences({ enabled });
  }

  /**
   * Check if notifications are enabled globally
   */
  areNotificationsEnabled(): boolean {
    return this.preferences.enabled;
  }

  /**
   * Enable/disable specific notification category
   */
  async setCategoryEnabled(
    category: NotificationCategory,
    enabled: boolean
  ): Promise<void> {
    const categoryKey = this.getCategoryKey(category);
    await this.updatePreferences({
      [categoryKey]: {
        ...this.preferences[categoryKey],
        enabled,
      },
    });
  }

  /**
   * Check if specific category is enabled
   */
  isCategoryEnabled(category: NotificationCategory): boolean {
    if (!this.preferences.enabled) return false;

    const categoryKey = this.getCategoryKey(category);
    return this.preferences[categoryKey]?.enabled ?? true;
  }

  /**
   * Update category preferences
   */
  async updateCategoryPreferences(
    category: NotificationCategory,
    preferences: Partial<NotificationTypePreferences>
  ): Promise<void> {
    const categoryKey = this.getCategoryKey(category);
    await this.updatePreferences({
      [categoryKey]: {
        ...this.preferences[categoryKey],
        ...preferences,
      },
    });
  }

  /**
   * Get category preferences
   */
  getCategoryPreferences(category: NotificationCategory): NotificationTypePreferences {
    const categoryKey = this.getCategoryKey(category);
    return { ...this.preferences[categoryKey] };
  }

  /**
   * Set quiet hours
   */
  async setQuietHours(quietHours: QuietHours): Promise<void> {
    await this.updatePreferences({ quietHours });
  }

  /**
   * Get quiet hours
   */
  getQuietHours(): QuietHours {
    return { ...this.preferences.quietHours };
  }

  /**
   * Check if current time is within quiet hours
   */
  isQuietHoursActive(): boolean {
    if (!this.preferences.quietHours.enabled) return false;

    const now = new Date();
    const currentHour = now.getHours();
    const currentMinute = now.getMinutes();
    const currentTime = currentHour * 60 + currentMinute;

    const { startHour, startMinute, endHour, endMinute } = this.preferences.quietHours;
    const startTime = startHour * 60 + startMinute;
    const endTime = endHour * 60 + endMinute;

    // Handle cases where quiet hours span midnight
    if (startTime > endTime) {
      // e.g., 10 PM to 8 AM
      return currentTime >= startTime || currentTime < endTime;
    } else {
      // e.g., 2 AM to 6 AM
      return currentTime >= startTime && currentTime < endTime;
    }
  }

  /**
   * Set daily reminder time
   */
  async setDailyReminder(config: DailyReminderConfig): Promise<void> {
    await this.updatePreferences({ dailyReminder: config });
  }

  /**
   * Get daily reminder configuration
   */
  getDailyReminder(): DailyReminderConfig {
    return { ...this.preferences.dailyReminder };
  }

  /**
   * Check if notification should be shown based on preferences
   */
  shouldShowNotification(category: NotificationCategory): boolean {
    // Check global enabled
    if (!this.preferences.enabled) {
      console.log('[NotificationPrefs] Notifications globally disabled');
      return false;
    }

    // Check category enabled
    if (!this.isCategoryEnabled(category)) {
      console.log('[NotificationPrefs] Category disabled:', category);
      return false;
    }

    // Check quiet hours
    if (this.isQuietHoursActive()) {
      console.log('[NotificationPrefs] Quiet hours active');
      return false;
    }

    return true;
  }

  /**
   * Check if sound should play for notification
   */
  shouldPlaySound(category: NotificationCategory): boolean {
    if (!this.shouldShowNotification(category)) return false;

    const categoryKey = this.getCategoryKey(category);
    return this.preferences[categoryKey]?.sound ?? true;
  }

  /**
   * Check if should vibrate for notification
   */
  shouldVibrate(category: NotificationCategory): boolean {
    if (!this.shouldShowNotification(category)) return false;

    const categoryKey = this.getCategoryKey(category);
    return this.preferences[categoryKey]?.vibrate ?? true;
  }

  /**
   * Check if should update badge for notification
   */
  shouldUpdateBadge(category: NotificationCategory): boolean {
    if (!this.shouldShowNotification(category)) return false;

    const categoryKey = this.getCategoryKey(category);
    return this.preferences[categoryKey]?.badge ?? true;
  }

  /**
   * Store push token
   */
  async storePushToken(token: string): Promise<void> {
    try {
      await AsyncStorage.setItem(STORAGE_KEYS.PUSH_TOKEN, token);
      console.log('[NotificationPrefs] Stored push token');
    } catch (error) {
      console.error('[NotificationPrefs] Failed to store push token:', error);
      throw error;
    }
  }

  /**
   * Get stored push token
   */
  async getPushToken(): Promise<string | null> {
    try {
      return await AsyncStorage.getItem(STORAGE_KEYS.PUSH_TOKEN);
    } catch (error) {
      console.error('[NotificationPrefs] Failed to get push token:', error);
      return null;
    }
  }

  /**
   * Update last sync timestamp
   */
  async updateLastSync(): Promise<void> {
    try {
      await AsyncStorage.setItem(
        STORAGE_KEYS.LAST_SYNC,
        new Date().toISOString()
      );
    } catch (error) {
      console.error('[NotificationPrefs] Failed to update last sync:', error);
    }
  }

  /**
   * Get last sync timestamp
   */
  async getLastSync(): Promise<Date | null> {
    try {
      const timestamp = await AsyncStorage.getItem(STORAGE_KEYS.LAST_SYNC);
      return timestamp ? new Date(timestamp) : null;
    } catch (error) {
      console.error('[NotificationPrefs] Failed to get last sync:', error);
      return null;
    }
  }

  /**
   * Reset preferences to defaults
   */
  async resetToDefaults(): Promise<void> {
    this.preferences = { ...DEFAULT_PREFERENCES };
    await this.savePreferences();
    console.log('[NotificationPrefs] Reset to defaults');
  }

  /**
   * Export preferences for backup
   */
  async exportPreferences(): Promise<string> {
    return JSON.stringify(this.preferences, null, 2);
  }

  /**
   * Import preferences from backup
   */
  async importPreferences(json: string): Promise<void> {
    try {
      const imported = JSON.parse(json);
      this.preferences = {
        ...DEFAULT_PREFERENCES,
        ...imported,
      };
      await this.savePreferences();
      console.log('[NotificationPrefs] Imported preferences');
    } catch (error) {
      console.error('[NotificationPrefs] Failed to import preferences:', error);
      throw new Error('Invalid preferences format');
    }
  }

  /**
   * Add listener for preference changes
   */
  addListener(listener: (preferences: NotificationPreferences) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Notify all listeners of preference changes
   */
  private notifyListeners(): void {
    this.listeners.forEach((listener) => {
      try {
        listener(this.getPreferences());
      } catch (error) {
        console.error('[NotificationPrefs] Listener error:', error);
      }
    });
  }

  /**
   * Get category key from enum
   */
  private getCategoryKey(
    category: NotificationCategory
  ): keyof Pick<NotificationPreferences, 'reminders' | 'insights' | 'achievements' | 'microGoals'> {
    const mapping = {
      [NotificationCategory.REMINDER]: 'reminders' as const,
      [NotificationCategory.INSIGHT]: 'insights' as const,
      [NotificationCategory.ACHIEVEMENT]: 'achievements' as const,
      [NotificationCategory.MICRO_GOAL]: 'microGoals' as const,
    };

    return mapping[category];
  }

  /**
   * Cleanup
   */
  cleanup(): void {
    this.listeners.clear();
    console.log('[NotificationPrefs] Cleaned up');
  }
}

// Singleton instance
let preferencesManagerInstance: NotificationPreferencesManager | null = null;

export function getNotificationPreferencesManager(): NotificationPreferencesManager {
  if (!preferencesManagerInstance) {
    preferencesManagerInstance = new NotificationPreferencesManager();
  }
  return preferencesManagerInstance;
}

/**
 * Utility functions for time formatting
 */
export const TimeUtils = {
  /**
   * Format hour and minute to display string (12-hour format)
   */
  formatTime(hour: number, minute: number): string {
    const period = hour >= 12 ? 'PM' : 'AM';
    const displayHour = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
    const displayMinute = minute.toString().padStart(2, '0');
    return `${displayHour}:${displayMinute} ${period}`;
  },

  /**
   * Format hour and minute to 24-hour format
   */
  format24Hour(hour: number, minute: number): string {
    return `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
  },

  /**
   * Parse time string to hour and minute
   */
  parseTime(timeStr: string): { hour: number; minute: number } | null {
    const match = timeStr.match(/(\d+):(\d+)\s*(AM|PM)?/i);
    if (!match) return null;

    let hour = parseInt(match[1], 10);
    const minute = parseInt(match[2], 10);
    const period = match[3]?.toUpperCase();

    if (period === 'PM' && hour < 12) {
      hour += 12;
    } else if (period === 'AM' && hour === 12) {
      hour = 0;
    }

    if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
      return null;
    }

    return { hour, minute };
  },

  /**
   * Get current time as hour and minute
   */
  getCurrentTime(): { hour: number; minute: number } {
    const now = new Date();
    return {
      hour: now.getHours(),
      minute: now.getMinutes(),
    };
  },
};
