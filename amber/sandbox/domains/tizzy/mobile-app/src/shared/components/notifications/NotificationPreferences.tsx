import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Switch,
  ScrollView,
  TouchableOpacity,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  getNotificationPreferencesManager,
  NotificationPreferences as NotificationPreferencesType,
  QuietHours,
  TimeUtils,
} from '../../../services/NotificationPreferencesManager';
import { NotificationCategory } from '../../../services/NotificationService';

interface NotificationPreferencesProps {
  onClose?: () => void;
}

/**
 * Notification Preferences Component
 *
 * Allows users to configure notification settings with granular control
 */
export default function NotificationPreferences({
  onClose,
}: NotificationPreferencesProps) {
  const [preferences, setPreferences] = useState<NotificationPreferencesType | null>(
    null
  );
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadPreferences();
  }, []);

  const loadPreferences = async () => {
    const manager = getNotificationPreferencesManager();
    const prefs = await manager.loadPreferences();
    setPreferences(prefs);
    setLoading(false);
  };

  const updatePreferences = async (updates: Partial<NotificationPreferencesType>) => {
    const manager = getNotificationPreferencesManager();
    await manager.updatePreferences(updates);
    setPreferences({ ...preferences!, ...updates });
  };

  const toggleGlobalEnabled = async (value: boolean) => {
    await updatePreferences({ enabled: value });
  };

  const toggleCategoryEnabled = async (
    category: NotificationCategory,
    field: 'enabled' | 'sound' | 'vibrate' | 'badge',
    value: boolean
  ) => {
    const categoryMap: Record<NotificationCategory, keyof NotificationPreferencesType> = {
      [NotificationCategory.REMINDER]: 'reminders',
      [NotificationCategory.INSIGHT]: 'insights',
      [NotificationCategory.ACHIEVEMENT]: 'achievements',
      [NotificationCategory.MICRO_GOAL]: 'microGoals',
    };

    const key = categoryMap[category];
    const currentCategory = preferences![key] as { enabled: boolean; sound: boolean; vibrate: boolean; badge: boolean };
    await updatePreferences({
      [key]: {
        ...currentCategory,
        [field]: value,
      },
    });
  };

  const toggleQuietHours = async (value: boolean) => {
    await updatePreferences({
      quietHours: {
        ...preferences!.quietHours,
        enabled: value,
      },
    });
  };

  const toggleDailyReminder = async (value: boolean) => {
    await updatePreferences({
      dailyReminder: {
        ...preferences!.dailyReminder,
        enabled: value,
      },
    });
  };

  if (loading || !preferences) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <Text style={styles.loadingText}>Loading preferences...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView style={styles.scrollView}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Notification Settings</Text>
          {onClose && (
            <TouchableOpacity onPress={onClose} style={styles.closeButton}>
              <Text style={styles.closeButtonText}>Done</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Global Toggle */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Master Control</Text>
          </View>
          <SettingRow
            title="Enable Notifications"
            description="Turn all notifications on or off"
            value={preferences.enabled}
            onValueChange={toggleGlobalEnabled}
          />
        </View>

        {/* Category Settings */}
        {preferences.enabled && (
          <>
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>Notification Types</Text>
              </View>

              <CategorySettings
                icon="[hourglass]"
                title="Session Reminders"
                description="Get notified when it's time for a session"
                preferences={preferences.reminders}
                onToggle={(field, value) =>
                  toggleCategoryEnabled(NotificationCategory.REMINDER, field, value)
                }
              />

              <CategorySettings
                icon="[lightbulb.fill]"
                title="Coaching Insights"
                description="Receive coaching insights when ready"
                preferences={preferences.insights}
                onToggle={(field, value) =>
                  toggleCategoryEnabled(NotificationCategory.INSIGHT, field, value)
                }
              />

              <CategorySettings
                icon="[trophy.fill]"
                title="Achievements"
                description="Celebrate your milestones"
                preferences={preferences.achievements}
                onToggle={(field, value) =>
                  toggleCategoryEnabled(NotificationCategory.ACHIEVEMENT, field, value)
                }
              />

              <CategorySettings
                icon="[target]"
                title="Daily Goals"
                description="Gentle reminders for micro-goals"
                preferences={preferences.microGoals}
                onToggle={(field, value) =>
                  toggleCategoryEnabled(NotificationCategory.MICRO_GOAL, field, value)
                }
              />
            </View>

            {/* Quiet Hours */}
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>Quiet Hours</Text>
              </View>
              <SettingRow
                title="Enable Quiet Hours"
                description="Silence notifications during specific hours"
                value={preferences.quietHours.enabled}
                onValueChange={toggleQuietHours}
              />
              {preferences.quietHours.enabled && (
                <View style={styles.quietHoursInfo}>
                  <Text style={styles.quietHoursText}>
                    {TimeUtils.formatTime(
                      preferences.quietHours.startHour,
                      preferences.quietHours.startMinute
                    )}
                    {' - '}
                    {TimeUtils.formatTime(
                      preferences.quietHours.endHour,
                      preferences.quietHours.endMinute
                    )}
                  </Text>
                  <TouchableOpacity>
                    <Text style={styles.changeTimeText}>Change</Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>

            {/* Daily Reminder */}
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>Daily Reminder</Text>
              </View>
              <SettingRow
                title="Enable Daily Reminder"
                description="Get a daily check-in reminder"
                value={preferences.dailyReminder.enabled}
                onValueChange={toggleDailyReminder}
              />
              {preferences.dailyReminder.enabled && (
                <View style={styles.quietHoursInfo}>
                  <Text style={styles.quietHoursText}>
                    {TimeUtils.formatTime(
                      preferences.dailyReminder.hour,
                      preferences.dailyReminder.minute
                    )}
                  </Text>
                  <TouchableOpacity>
                    <Text style={styles.changeTimeText}>Change</Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>

            {/* Advanced Settings */}
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>Advanced</Text>
              </View>
              <SettingRow
                title="Show In-App Notifications"
                description="Display notifications while using the app"
                value={preferences.showInApp}
                onValueChange={(value) => updatePreferences({ showInApp: value })}
              />
              <SettingRow
                title="Group Notifications"
                description="Group similar notifications together"
                value={preferences.groupNotifications}
                onValueChange={(value) =>
                  updatePreferences({ groupNotifications: value })
                }
              />
              <SettingRow
                title="Preview in Lock Screen"
                description="Show notification content on lock screen"
                value={preferences.previewInLockScreen}
                onValueChange={(value) =>
                  updatePreferences({ previewInLockScreen: value })
                }
              />
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function SettingRow({
  title,
  description,
  value,
  onValueChange,
}: {
  title: string;
  description?: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
}) {
  return (
    <View style={styles.settingRow}>
      <View style={styles.settingContent}>
        <Text style={styles.settingTitle}>{title}</Text>
        {description && (
          <Text style={styles.settingDescription}>{description}</Text>
        )}
      </View>
      <Switch
        value={value}
        onValueChange={onValueChange}
        trackColor={{ false: '#E5E7EB', true: '#60A5FA' }}
        thumbColor={value ? '#3B82F6' : '#F3F4F6'}
        ios_backgroundColor="#E5E7EB"
      />
    </View>
  );
}

function CategorySettings({
  icon,
  title,
  description,
  preferences,
  onToggle,
}: {
  icon: string;
  title: string;
  description: string;
  preferences: { enabled: boolean; sound: boolean; vibrate: boolean; badge: boolean };
  onToggle: (field: 'enabled' | 'sound' | 'vibrate' | 'badge', value: boolean) => void;
}) {
  return (
    <View style={styles.categoryContainer}>
      <View style={styles.categoryHeader}>
        <Text style={styles.categoryIcon}>{icon}</Text>
        <View style={styles.categoryInfo}>
          <Text style={styles.categoryTitle}>{title}</Text>
          <Text style={styles.categoryDescription}>{description}</Text>
        </View>
        <Switch
          value={preferences.enabled}
          onValueChange={(value) => onToggle('enabled', value)}
          trackColor={{ false: '#E5E7EB', true: '#60A5FA' }}
          thumbColor={preferences.enabled ? '#3B82F6' : '#F3F4F6'}
          ios_backgroundColor="#E5E7EB"
        />
      </View>

      {preferences.enabled && (
        <View style={styles.categoryOptions}>
          <OptionRow
            label="Sound"
            value={preferences.sound}
            onValueChange={(value) => onToggle('sound', value)}
          />
          {Platform.OS === 'android' && (
            <OptionRow
              label="Vibrate"
              value={preferences.vibrate}
              onValueChange={(value) => onToggle('vibrate', value)}
            />
          )}
          <OptionRow
            label="Badge"
            value={preferences.badge}
            onValueChange={(value) => onToggle('badge', value)}
          />
        </View>
      )}
    </View>
  );
}

function OptionRow({
  label,
  value,
  onValueChange,
}: {
  label: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
}) {
  return (
    <View style={styles.optionRow}>
      <Text style={styles.optionLabel}>{label}</Text>
      <Switch
        value={value}
        onValueChange={onValueChange}
        trackColor={{ false: '#E5E7EB', true: '#60A5FA' }}
        thumbColor={value ? '#3B82F6' : '#F3F4F6'}
        ios_backgroundColor="#E5E7EB"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F9FAFB',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    fontSize: 16,
    color: '#6B7280',
  },
  scrollView: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#1F2937',
  },
  closeButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  closeButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#3B82F6',
  },
  section: {
    marginTop: 24,
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: '#E5E7EB',
  },
  sectionHeader: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 8,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: '#6B7280',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  settingContent: {
    flex: 1,
    marginRight: 12,
  },
  settingTitle: {
    fontSize: 16,
    fontWeight: '500',
    color: '#1F2937',
    marginBottom: 2,
  },
  settingDescription: {
    fontSize: 14,
    color: '#6B7280',
    lineHeight: 18,
  },
  categoryContainer: {
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  categoryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  categoryIcon: {
    fontSize: 28,
    marginRight: 12,
  },
  categoryInfo: {
    flex: 1,
    marginRight: 12,
  },
  categoryTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1F2937',
    marginBottom: 2,
  },
  categoryDescription: {
    fontSize: 14,
    color: '#6B7280',
  },
  categoryOptions: {
    paddingLeft: 60,
    paddingRight: 20,
    paddingBottom: 12,
  },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
  },
  optionLabel: {
    fontSize: 14,
    color: '#6B7280',
  },
  quietHoursInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 12,
    backgroundColor: '#F9FAFB',
  },
  quietHoursText: {
    fontSize: 16,
    color: '#1F2937',
  },
  changeTimeText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#3B82F6',
  },
});
