import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNotifications } from '../../hooks/useNotifications';
import { NotificationCategory } from '../../../services/NotificationService';

/**
 * Notification Test Screen
 *
 * Example screen demonstrating all notification features
 * Use this for testing and as a reference implementation
 */
export default function NotificationTestScreen() {
  const {
    permissionStatus,
    pushToken,
    preferences,
    requestPermissions,
    registerForPushNotifications,
    scheduleSessionReminder,
    scheduleInsightNotification,
    scheduleAchievementNotification,
    scheduleMicroGoalReminder,
    getScheduledNotifications,
    cancelAllNotifications,
    setBadgeCount,
    clearBadge,
  } = useNotifications();

  const [scheduledCount, setScheduledCount] = useState(0);

  useEffect(() => {
    loadScheduledCount();
  }, []);

  const loadScheduledCount = async () => {
    const scheduled = await getScheduledNotifications();
    setScheduledCount(scheduled.length);
  };

  const handleRequestPermissions = async () => {
    const granted = await requestPermissions();
    Alert.alert(
      granted ? 'Success' : 'Denied',
      granted
        ? 'Notification permissions granted!'
        : 'Please enable notifications in settings'
    );
  };

  const handleRegisterPush = async () => {
    const result = await registerForPushNotifications();
    if (result) {
      Alert.alert('Success', `Push token: ${result.token.substring(0, 20)}...`);
    } else {
      Alert.alert('Error', 'Failed to register for push notifications');
    }
  };

  const handleScheduleSessionReminder = async () => {
    const time = new Date();
    time.setSeconds(time.getSeconds() + 10); // 10 seconds from now

    const id = await scheduleSessionReminder(
      'test-session-123',
      'Breathing Exercise',
      time,
      'User pattern indicates this is a good time'
    );

    if (id) {
      Alert.alert('Scheduled', 'Session reminder will appear in 10 seconds');
      loadScheduledCount();
    }
  };

  const handleScheduleInsight = async () => {
    const id = await scheduleInsightNotification(
      'New Coaching Insight Available',
      'Based on your recent sessions, we have a new insight for you',
      'insight-123'
    );

    if (id) {
      Alert.alert('Scheduled', 'Insight notification will appear immediately');
      loadScheduledCount();
    }
  };

  const handleScheduleAchievement = async () => {
    const id = await scheduleAchievementNotification(
      'achievement-123',
      '7-Day Streak! Keep up the great work!',
      '🔥'
    );

    if (id) {
      Alert.alert('Scheduled', 'Achievement notification will appear immediately');
      loadScheduledCount();
    }
  };

  const handleScheduleMicroGoal = async () => {
    const time = new Date();
    time.setSeconds(time.getSeconds() + 15); // 15 seconds from now

    const id = await scheduleMicroGoalReminder(
      'goal-123',
      'Practice mindful breathing',
      'Take 5 minutes for a breathing exercise',
      time
    );

    if (id) {
      Alert.alert('Scheduled', 'Goal reminder will appear in 15 seconds');
      loadScheduledCount();
    }
  };

  const handleCancelAll = async () => {
    await cancelAllNotifications();
    Alert.alert('Success', 'All scheduled notifications cancelled');
    loadScheduledCount();
  };

  const handleSetBadge = async () => {
    await setBadgeCount(5);
    Alert.alert('Success', 'Badge count set to 5');
  };

  const handleClearBadge = async () => {
    await clearBadge();
    Alert.alert('Success', 'Badge count cleared');
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView style={styles.scrollView}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.title}>Notification Testing</Text>
          <Text style={styles.subtitle}>
            Test all notification features and integrations
          </Text>
        </View>

        {/* Status Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Status</Text>
          <InfoRow
            label="Permissions"
            value={permissionStatus?.granted ? 'Granted' : 'Not Granted'}
            color={permissionStatus?.granted ? '#10B981' : '#EF4444'}
          />
          <InfoRow
            label="Push Token"
            value={pushToken ? 'Registered' : 'Not Registered'}
            color={pushToken ? '#10B981' : '#6B7280'}
          />
          <InfoRow
            label="Scheduled"
            value={`${scheduledCount} notifications`}
            color="#3B82F6"
          />
          <InfoRow
            label="Global Enabled"
            value={preferences?.enabled ? 'Yes' : 'No'}
            color={preferences?.enabled ? '#10B981' : '#EF4444'}
          />
        </View>

        {/* Permission Actions */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Permissions</Text>
          <ActionButton
            title="Request Permissions"
            onPress={handleRequestPermissions}
            icon="[bell.fill]"
          />
          <ActionButton
            title="Register for Push"
            onPress={handleRegisterPush}
            icon="[iphone]"
            disabled={!permissionStatus?.granted}
          />
        </View>

        {/* Schedule Notifications */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Schedule Notifications</Text>
          <ActionButton
            title="Session Reminder (10s)"
            onPress={handleScheduleSessionReminder}
            icon="[hourglass]"
            description="Test session reminder notification"
            disabled={!permissionStatus?.granted}
          />
          <ActionButton
            title="Coaching Insight (now)"
            onPress={handleScheduleInsight}
            icon="[lightbulb.fill]"
            description="Test coaching insight notification"
            disabled={!permissionStatus?.granted}
          />
          <ActionButton
            title="Achievement (now)"
            onPress={handleScheduleAchievement}
            icon="[trophy.fill]"
            description="Test achievement notification"
            disabled={!permissionStatus?.granted}
          />
          <ActionButton
            title="Micro Goal (15s)"
            onPress={handleScheduleMicroGoal}
            icon="[target]"
            description="Test micro goal reminder"
            disabled={!permissionStatus?.granted}
          />
        </View>

        {/* Badge Management */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Badge Management</Text>
          <ActionButton
            title="Set Badge to 5"
            onPress={handleSetBadge}
            icon="[5.circle]"
          />
          <ActionButton
            title="Clear Badge"
            onPress={handleClearBadge}
            icon="[sparkles]"
          />
        </View>

        {/* Cleanup */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Cleanup</Text>
          <ActionButton
            title="Cancel All Notifications"
            onPress={handleCancelAll}
            icon="[trash.fill]"
            color="#EF4444"
          />
        </View>

        {/* Category Preferences */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Category Preferences</Text>
          {preferences && (
            <>
              <InfoRow
                label="Reminders"
                value={preferences.reminders.enabled ? 'Enabled' : 'Disabled'}
                color={preferences.reminders.enabled ? '#10B981' : '#6B7280'}
              />
              <InfoRow
                label="Insights"
                value={preferences.insights.enabled ? 'Enabled' : 'Disabled'}
                color={preferences.insights.enabled ? '#10B981' : '#6B7280'}
              />
              <InfoRow
                label="Achievements"
                value={preferences.achievements.enabled ? 'Enabled' : 'Disabled'}
                color={preferences.achievements.enabled ? '#10B981' : '#6B7280'}
              />
              <InfoRow
                label="Micro Goals"
                value={preferences.microGoals.enabled ? 'Enabled' : 'Disabled'}
                color={preferences.microGoals.enabled ? '#10B981' : '#6B7280'}
              />
            </>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function InfoRow({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color?: string;
}) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={[styles.infoValue, { color: color || '#1F2937' }]}>
        {value}
      </Text>
    </View>
  );
}

function ActionButton({
  title,
  description,
  icon,
  onPress,
  color,
  disabled,
}: {
  title: string;
  description?: string;
  icon?: string;
  onPress: () => void;
  color?: string;
  disabled?: boolean;
}) {
  return (
    <TouchableOpacity
      style={[
        styles.actionButton,
        disabled && styles.actionButtonDisabled,
      ]}
      onPress={onPress}
      disabled={disabled}
    >
      <View style={styles.actionButtonContent}>
        {icon && <Text style={styles.actionIcon}>{icon}</Text>}
        <View style={styles.actionTextContainer}>
          <Text
            style={[
              styles.actionTitle,
              { color: color || '#1F2937' },
              disabled && styles.actionTitleDisabled,
            ]}
          >
            {title}
          </Text>
          {description && (
            <Text style={styles.actionDescription}>{description}</Text>
          )}
        </View>
      </View>
      <Text style={styles.actionArrow}>›</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F9FAFB',
  },
  scrollView: {
    flex: 1,
  },
  header: {
    padding: 24,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#1F2937',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: '#6B7280',
  },
  section: {
    marginTop: 24,
    backgroundColor: '#FFFFFF',
    paddingVertical: 16,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: '#E5E7EB',
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: '#6B7280',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    paddingHorizontal: 20,
    marginBottom: 12,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  infoLabel: {
    fontSize: 16,
    color: '#6B7280',
  },
  infoValue: {
    fontSize: 16,
    fontWeight: '600',
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  actionButtonDisabled: {
    opacity: 0.5,
  },
  actionButtonContent: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  actionIcon: {
    fontSize: 24,
    marginRight: 12,
  },
  actionTextContainer: {
    flex: 1,
  },
  actionTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 2,
  },
  actionTitleDisabled: {
    color: '#9CA3AF',
  },
  actionDescription: {
    fontSize: 14,
    color: '#6B7280',
  },
  actionArrow: {
    fontSize: 24,
    color: '#D1D5DB',
    marginLeft: 12,
  },
});
