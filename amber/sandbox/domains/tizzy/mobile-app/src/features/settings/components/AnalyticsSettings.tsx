/**
 * Analytics Settings Component
 *
 * Allows users to opt-in/opt-out of analytics tracking
 */

import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, Switch, Alert } from 'react-native';
import * as Analytics from '../../../services/Analytics';
import { colors } from '../../../shared/constants/colors';
import { spacing } from '../../../shared/constants/spacing';
import { typography } from '../../../shared/constants/typography';

export function AnalyticsSettings() {
  const [analyticsEnabled, setAnalyticsEnabled] = useState(true);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    checkAnalyticsStatus();
  }, []);

  const checkAnalyticsStatus = async () => {
    try {
      const enabled = Analytics.isAnalyticsEnabled();
      setAnalyticsEnabled(enabled);
    } catch (error) {
      console.error('Failed to check analytics status:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleToggleAnalytics = async (value: boolean) => {
    try {
      if (value) {
        // Enabling analytics - show info
        Alert.alert(
          'Enable Analytics',
          'This helps us improve the app by collecting anonymous usage data. We never collect personal information.',
          [
            {
              text: 'Cancel',
              style: 'cancel',
            },
            {
              text: 'Enable',
              onPress: async () => {
                await Analytics.enableAnalytics();
                setAnalyticsEnabled(true);
              },
            },
          ]
        );
      } else {
        // Disabling analytics - confirm
        Alert.alert(
          'Disable Analytics',
          'Are you sure you want to disable analytics? All stored analytics data will be deleted.',
          [
            {
              text: 'Cancel',
              style: 'cancel',
            },
            {
              text: 'Disable',
              style: 'destructive',
              onPress: async () => {
                await Analytics.disableAnalytics();
                setAnalyticsEnabled(false);
              },
            },
          ]
        );
      }
    } catch (error) {
      console.error('Failed to toggle analytics:', error);
      Alert.alert('Error', 'Failed to update analytics settings. Please try again.');
    }
  };

  if (isLoading) {
    return null;
  }

  return (
    <View style={styles.container}>
      <View style={styles.section}>
        <View style={styles.header}>
          <Text style={styles.title}>Analytics & Data Collection</Text>
        </View>

        <View style={styles.settingRow}>
          <View style={styles.settingInfo}>
            <Text style={styles.settingLabel}>Share Usage Data</Text>
            <Text style={styles.settingDescription}>
              Help us improve Tizzy by sharing anonymous usage data. We never collect personal information.
            </Text>
          </View>
          <Switch
            value={analyticsEnabled}
            onValueChange={handleToggleAnalytics}
            trackColor={{ false: colors.border.light, true: colors.primary.light }}
            thumbColor={analyticsEnabled ? colors.primary.main : colors.text.tertiary}
            ios_backgroundColor={colors.border.light}
          />
        </View>

        <View style={styles.privacyInfo}>
          <Text style={styles.privacyTitle}>What we collect:</Text>
          <Text style={styles.privacyItem}>• Screen views and navigation patterns</Text>
          <Text style={styles.privacyItem}>• Feature usage (BLE connections, haptic feedback, etc.)</Text>
          <Text style={styles.privacyItem}>• App performance metrics</Text>
          <Text style={styles.privacyItem}>• Error and crash reports</Text>

          <Text style={[styles.privacyTitle, { marginTop: spacing.md }]}>
            What we DON'T collect:
          </Text>
          <Text style={styles.privacyItem}>• Personal information (name, email, etc.)</Text>
          <Text style={styles.privacyItem}>• Location data</Text>
          <Text style={styles.privacyItem}>• Audio recordings or content</Text>
          <Text style={styles.privacyItem}>• Health or biometric data</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  section: {
    backgroundColor: colors.background.secondary,
    borderRadius: spacing.radius.lg,
    padding: spacing.lg,
    marginBottom: spacing.lg,
  },
  header: {
    marginBottom: spacing.lg,
  },
  title: {
    ...typography.heading3,
    color: colors.text.primary,
  },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border.light,
  },
  settingInfo: {
    flex: 1,
    marginRight: spacing.md,
  },
  settingLabel: {
    ...typography.subtitle1,
    color: colors.text.primary,
    marginBottom: spacing.xs,
  },
  settingDescription: {
    ...typography.body2,
    color: colors.text.secondary,
  },
  privacyInfo: {
    marginTop: spacing.lg,
    padding: spacing.md,
    backgroundColor: colors.background.primary,
    borderRadius: spacing.radius.md,
  },
  privacyTitle: {
    ...typography.subtitle2,
    color: colors.text.primary,
    marginBottom: spacing.sm,
  },
  privacyItem: {
    ...typography.caption,
    color: colors.text.secondary,
    marginBottom: spacing.xs,
    marginLeft: spacing.sm,
  },
});
