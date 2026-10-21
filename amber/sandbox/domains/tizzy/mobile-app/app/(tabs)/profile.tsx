import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  TouchableOpacity,
  Alert,
  Switch,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { SymbolView } from 'expo-symbols';
import * as Haptics from 'expo-haptics';
import Animated, { FadeInDown } from 'react-native-reanimated';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { router } from 'expo-router';
import { apiService } from '../../src/api/client';
import { User } from '../../src/shared/types/api';
import { LoadingSpinner } from '../../src/shared/components';
import { ErrorState } from '../../src/shared/components';
import { Button } from '../../src/shared/components';
import { colors } from '../../src/shared/constants/colors';
import { spacing } from '../../src/shared/constants/spacing';
import { typography } from '../../src/shared/constants/typography';
import { STORAGE_KEYS } from '../../src/shared/constants';

export default function ProfileScreen() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exportLoading, setExportLoading] = useState(false);

  // Local state for preferences toggles
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);
  const [hapticFeedbackEnabled, setHapticFeedbackEnabled] = useState(false);
  const [privacyMode, setPrivacyMode] = useState<'full' | 'minimal'>('full');
  const [dataSharingConsent, setDataSharingConsent] = useState(false);

  useEffect(() => {
    loadUserProfile();
  }, []);

  const loadUserProfile = async () => {
    try {
      setLoading(true);
      setError(null);

      // Check for demo mode
      const isDemoMode = await AsyncStorage.getItem(STORAGE_KEYS.DEMO_MODE);
      if (isDemoMode === 'true') {
        // Set demo user data
        const demoUser: User = {
          id: 'demo-user-123',
          email: 'demo@tizzy.app',
          name: 'Demo User',
          created_at: new Date().toISOString(),
          preferences: {
            notifications_enabled: false,
            haptic_feedback_enabled: true,
            privacy_mode: 'full',
            data_sharing_consent: false,
          },
        };

        setUser(demoUser);
        setNotificationsEnabled(false);
        setHapticFeedbackEnabled(true);
        setPrivacyMode('full');
        setDataSharingConsent(false);
        setLoading(false);
        return;
      }

      // Parse stored user object
      const storedUser = await AsyncStorage.getItem(STORAGE_KEYS.USER);
      if (!storedUser) {
        setError('User data not found');
        setLoading(false);
        return;
      }

      const userObject = JSON.parse(storedUser);
      const userId = userObject.id;

      if (!userId) {
        setError('User ID not found');
        setLoading(false);
        return;
      }

      const userData = await apiService.getUserProfile(userId);
      setUser(userData);

      // Update local state from user preferences
      setNotificationsEnabled(userData.preferences?.notifications_enabled ?? false);
      setHapticFeedbackEnabled(userData.preferences?.haptic_feedback_enabled ?? true);
      setPrivacyMode(userData.preferences?.privacy_mode ?? 'full');
      setDataSharingConsent(userData.preferences?.data_sharing_consent ?? false);
    } catch (err) {
      console.error('Failed to load user profile:', err);
      setError('Failed to load profile. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadUserProfile();
    setRefreshing(false);
  }, []);

  const updatePreferences = async (updates: Partial<User['preferences']>) => {
    if (!user) return;

    try {
      // Skip API call in demo mode
      const isDemoMode = await AsyncStorage.getItem(STORAGE_KEYS.DEMO_MODE);
      if (isDemoMode === 'true') {
        // Just update local state for demo mode
        return;
      }

      await apiService.updateUserProfile(user.id, {
        preferences: updates,
      });
    } catch (err) {
      console.error('Failed to update preferences:', err);
      Alert.alert('Error', 'Failed to update preferences. Please try again.');
    }
  };

  const handleNotificationToggle = async (value: boolean) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setNotificationsEnabled(value);
    await updatePreferences({ notifications_enabled: value });
  };

  const handleHapticToggle = async (value: boolean) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setHapticFeedbackEnabled(value);
    await updatePreferences({ haptic_feedback_enabled: value });
  };

  const handlePrivacyModeToggle = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const newMode = privacyMode === 'full' ? 'minimal' : 'full';
    setPrivacyMode(newMode);
    await updatePreferences({ privacy_mode: newMode });
  };

  const handleDataSharingToggle = async (value: boolean) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setDataSharingConsent(value);
    await updatePreferences({ data_sharing_consent: value });
  };

  const handleDataExport = async () => {
    if (!user) return;

    // Check for demo mode
    const isDemoMode = await AsyncStorage.getItem(STORAGE_KEYS.DEMO_MODE);
    if (isDemoMode === 'true') {
      Alert.alert(
        'Demo Mode',
        'Data export is not available in demo mode. Create a real account to export your data.'
      );
      return;
    }

    Alert.alert(
      'Export Data',
      'Choose your export format:',
      [
        {
          text: 'Cancel',
          style: 'cancel',
        },
        {
          text: 'JSON',
          onPress: async () => {
            try {
              setExportLoading(true);
              const response = await apiService.requestDataExport(user.id, 'json', false);
              Alert.alert(
                'Export Started',
                `Your data export has been initiated. Export ID: ${response.export_id}. You will be notified when it's ready.`
              );
            } catch (err) {
              console.error('Failed to export data:', err);
              Alert.alert('Error', 'Failed to export data. Please try again.');
            } finally {
              setExportLoading(false);
            }
          },
        },
        {
          text: 'CSV',
          onPress: async () => {
            try {
              setExportLoading(true);
              const response = await apiService.requestDataExport(user.id, 'csv', false);
              Alert.alert(
                'Export Started',
                `Your data export has been initiated. Export ID: ${response.export_id}. You will be notified when it's ready.`
              );
            } catch (err) {
              console.error('Failed to export data:', err);
              Alert.alert('Error', 'Failed to export data. Please try again.');
            } finally {
              setExportLoading(false);
            }
          },
        },
      ]
    );
  };

  const handleDeleteAccount = async () => {
    if (!user) return;

    // Check for demo mode
    const isDemoMode = await AsyncStorage.getItem(STORAGE_KEYS.DEMO_MODE);
    if (isDemoMode === 'true') {
      Alert.alert(
        'Demo Mode',
        'Account deletion is not available in demo mode. This is a demo account for testing purposes only.'
      );
      return;
    }

    Alert.alert(
      'Delete Account',
      'Are you absolutely sure you want to delete your account? This action cannot be undone and all your data will be permanently deleted.',
      [
        {
          text: 'Cancel',
          style: 'cancel',
        },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await apiService.deleteAccount(user.id);
              await AsyncStorage.multiRemove(['auth_token', 'user_id', 'user_name']);
              Alert.alert('Account Deleted', 'Your account has been successfully deleted.', [
                {
                  text: 'OK',
                  onPress: () => router.replace('/(auth)/login'),
                },
              ]);
            } catch (err) {
              console.error('Failed to delete account:', err);
              Alert.alert('Error', 'Failed to delete account. Please try again.');
            }
          },
        },
      ]
    );
  };

  const handleLogout = async () => {
    // Check for demo mode
    const isDemoMode = await AsyncStorage.getItem(STORAGE_KEYS.DEMO_MODE);

    Alert.alert(
      'Logout',
      'Are you sure you want to logout?',
      [
        {
          text: 'Cancel',
          style: 'cancel',
        },
        {
          text: 'Logout',
          style: 'destructive',
          onPress: async () => {
            try {
              // Skip API call in demo mode
              if (isDemoMode !== 'true') {
                await apiService.logout();
              }

              // Clear all storage including demo mode
              await AsyncStorage.multiRemove([
                STORAGE_KEYS.AUTH_TOKEN,
                STORAGE_KEYS.USER,
                STORAGE_KEYS.DEMO_MODE,
                'user_id',
                'user_name'
              ]);
              router.replace('/(auth)/login');
            } catch (err) {
              console.error('Failed to logout:', err);
              // Even if API call fails, clear local storage and navigate to login
              await AsyncStorage.multiRemove([
                STORAGE_KEYS.AUTH_TOKEN,
                STORAGE_KEYS.USER,
                STORAGE_KEYS.DEMO_MODE,
                'user_id',
                'user_name'
              ]);
              router.replace('/(auth)/login');
            }
          },
        },
      ]
    );
  };

  const formatDate = (dateString: string): string => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <LoadingSpinner
          size="large"
          color="primary"
          text="Loading profile..."
          style={styles.loadingContainer}
        />
      </SafeAreaView>
    );
  }

  if (error || !user) {
    return (
      <SafeAreaView style={styles.container}>
        <ErrorState
          message={error || 'Failed to load profile'}
          onRetry={loadUserProfile}
          retryText="Try Again"
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.primary.main}
            colors={[colors.primary.main]}
          />
        }
      >
        {/* Profile Header */}
        <Animated.View entering={FadeInDown.duration(400)} style={styles.profileHeader}>
          <View style={styles.avatarContainer}>
            <Text style={styles.avatarText}>
              {user.name ? user.name.charAt(0).toUpperCase() : user.email.charAt(0).toUpperCase()}
            </Text>
          </View>
          <Text style={styles.userName}>{user.name || 'User'}</Text>
          <Text style={styles.userEmail}>{user.email}</Text>
          <View style={styles.memberBadge}>
            <SymbolView name="checkmark.seal.fill" size={14} tintColor={colors.primary.main} />
            <Text style={styles.joinDate}>Member since {formatDate(user.created_at)}</Text>
          </View>
        </Animated.View>

        {/* Privacy Settings */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Privacy Settings</Text>

          <View style={styles.settingCard}>
            <View style={styles.settingItem}>
              <View style={styles.settingInfo}>
                <Text style={styles.settingLabel}>Privacy Mode</Text>
                <Text style={styles.settingDescription}>
                  {privacyMode === 'full' ? 'Full privacy protection' : 'Minimal data collection'}
                </Text>
              </View>
              <TouchableOpacity
                style={[styles.toggleButton, privacyMode === 'minimal' && styles.toggleButtonActive]}
                onPress={handlePrivacyModeToggle}
              >
                <Text style={[styles.toggleButtonText, privacyMode === 'minimal' && styles.toggleButtonTextActive]}>
                  {privacyMode === 'full' ? 'Full' : 'Minimal'}
                </Text>
              </TouchableOpacity>
            </View>

            <View style={styles.divider} />

            <View style={styles.settingItem}>
              <View style={styles.settingInfo}>
                <Text style={styles.settingLabel}>Data Sharing</Text>
                <Text style={styles.settingDescription}>
                  Share anonymized data for research
                </Text>
              </View>
              <Switch
                value={dataSharingConsent}
                onValueChange={handleDataSharingToggle}
                trackColor={{ false: colors.neutral.gray300, true: colors.primary.light }}
                thumbColor={dataSharingConsent ? colors.primary.main : colors.neutral.gray50}
              />
            </View>
          </View>
        </View>

        {/* App Settings */}
        <View style={styles.section}>
          <View style={styles.settingCard}>
            <TouchableOpacity
              style={styles.actionItem}
              onPress={() => router.push('/settings')}
            >
              <View style={styles.actionInfo}>
                <SymbolView
                  name="gearshape.fill"
                  size={spacing.iconSize.lg}
                  tintColor={colors.text.primary}
                  style={styles.actionIconSymbol}
                />
                <View style={styles.actionText}>
                  <Text style={styles.actionLabel}>App Settings</Text>
                  <Text style={styles.actionDescription}>
                    Configure privacy, audio, notifications, and devices
                  </Text>
                </View>
              </View>
              <Text style={styles.chevron}>›</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Notification Preferences */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Notification Preferences</Text>

          <View style={styles.settingCard}>
            <View style={styles.settingItem}>
              <View style={styles.settingInfo}>
                <Text style={styles.settingLabel}>Push Notifications</Text>
                <Text style={styles.settingDescription}>
                  Receive coaching tips and reminders
                </Text>
              </View>
              <Switch
                value={notificationsEnabled}
                onValueChange={handleNotificationToggle}
                trackColor={{ false: colors.neutral.gray300, true: colors.primary.light }}
                thumbColor={notificationsEnabled ? colors.primary.main : colors.neutral.gray50}
              />
            </View>

            <View style={styles.divider} />

            <View style={styles.settingItem}>
              <View style={styles.settingInfo}>
                <Text style={styles.settingLabel}>Haptic Feedback</Text>
                <Text style={styles.settingDescription}>
                  Vibration feedback from device
                </Text>
              </View>
              <Switch
                value={hapticFeedbackEnabled}
                onValueChange={handleHapticToggle}
                trackColor={{ false: colors.neutral.gray300, true: colors.primary.light }}
                thumbColor={hapticFeedbackEnabled ? colors.primary.main : colors.neutral.gray50}
              />
            </View>
          </View>
        </View>

        {/* Data Management */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Data Management</Text>

          <View style={styles.settingCard}>
            <TouchableOpacity
              style={styles.actionItem}
              onPress={handleDataExport}
              disabled={exportLoading}
            >
              <View style={styles.actionInfo}>
                <SymbolView
                  name="arrow.down.doc.fill"
                  size={spacing.iconSize.lg}
                  tintColor={colors.text.primary}
                  style={styles.actionIconSymbol}
                />
                <View style={styles.actionText}>
                  <Text style={styles.actionLabel}>Export Your Data</Text>
                  <Text style={styles.actionDescription}>
                    Download all your data in JSON or CSV format
                  </Text>
                </View>
              </View>
              <Text style={styles.chevron}>›</Text>
            </TouchableOpacity>

            <View style={styles.divider} />

            <TouchableOpacity
              style={styles.actionItem}
              onPress={handleDeleteAccount}
            >
              <View style={styles.actionInfo}>
                <SymbolView
                  name="trash.fill"
                  size={spacing.iconSize.lg}
                  tintColor={colors.danger.main}
                  style={styles.actionIconSymbol}
                />
                <View style={styles.actionText}>
                  <Text style={[styles.actionLabel, styles.dangerText]}>Delete Account</Text>
                  <Text style={styles.actionDescription}>
                    Permanently delete your account and data
                  </Text>
                </View>
              </View>
              <Text style={styles.chevron}>›</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Logout Button */}
        <View style={styles.section}>
          <Button
            title="Logout"
            onPress={handleLogout}
            variant="outline"
            size="large"
            fullWidth
          />
        </View>

        {/* Version Info */}
        <View style={styles.footer}>
          <Text style={styles.versionText}>Tizzy App</Text>
          <Text style={styles.versionText}>Version 1.0.0</Text>
          <Text style={styles.footerLink}>Terms of Service</Text>
          <Text style={styles.footerLink}>Privacy Policy</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background.secondary,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: spacing.screenPadding,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  profileHeader: {
    alignItems: 'center',
    paddingVertical: spacing.xl,
    marginBottom: spacing.md,
  },
  avatarContainer: {
    width: spacing.avatarSize.xl,
    height: spacing.avatarSize.xl,
    borderRadius: spacing.avatarSize.xl / 2,
    backgroundColor: colors.primary.main,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  avatarText: {
    ...typography.heading1,
    color: colors.primary.contrast,
  },
  userName: {
    ...typography.heading2,
    color: colors.text.primary,
    marginBottom: spacing.xs,
  },
  userEmail: {
    ...typography.body1,
    color: colors.text.secondary,
    marginBottom: spacing.xs,
  },
  memberBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 4,
  },
  joinDate: {
    ...typography.caption,
    color: colors.text.tertiary,
  },
  section: {
    marginBottom: spacing.sectionSpacing,
  },
  sectionTitle: {
    ...typography.heading4,
    color: colors.text.primary,
    marginBottom: spacing.md,
  },
  settingCard: {
    backgroundColor: colors.background.primary,
    borderRadius: spacing.radius.lg,
    padding: spacing.cardPadding,
    shadowColor: colors.shadow.main,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 3,
    borderWidth: spacing.borderWidth.thin,
    borderColor: colors.border.light,
  },
  settingItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.md,
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
    ...typography.caption,
    color: colors.text.secondary,
  },
  toggleButton: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: spacing.radius.md,
    backgroundColor: colors.neutral.gray100,
    borderWidth: spacing.borderWidth.thin,
    borderColor: colors.border.light,
  },
  toggleButtonActive: {
    backgroundColor: colors.primary.light,
    borderColor: colors.primary.main,
  },
  toggleButtonText: {
    ...typography.body2,
    color: colors.text.secondary,
    fontWeight: '600',
  },
  toggleButtonTextActive: {
    color: colors.primary.dark,
  },
  divider: {
    height: spacing.borderWidth.thin,
    backgroundColor: colors.border.light,
    marginVertical: spacing.xs,
  },
  actionItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.md,
  },
  actionInfo: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  actionIcon: {
    fontSize: spacing.iconSize.lg,
    marginRight: spacing.md,
  },
  actionIconSymbol: {
    marginRight: spacing.md,
  },
  actionText: {
    flex: 1,
  },
  actionLabel: {
    ...typography.subtitle1,
    color: colors.text.primary,
    marginBottom: spacing.xs,
  },
  actionDescription: {
    ...typography.caption,
    color: colors.text.secondary,
  },
  dangerText: {
    color: colors.danger.main,
  },
  chevron: {
    fontSize: 24,
    color: colors.text.tertiary,
    fontWeight: '300',
  },
  footer: {
    alignItems: 'center',
    paddingVertical: spacing.xl,
    paddingBottom: spacing.xxl,
  },
  versionText: {
    ...typography.caption,
    color: colors.text.tertiary,
    marginBottom: spacing.xs,
  },
  footerLink: {
    ...typography.caption,
    color: colors.primary.main,
    marginTop: spacing.sm,
  },
});
