import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Switch,
  TouchableOpacity,
  Alert,
  Linking,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SymbolView } from 'expo-symbols';
import { Button } from '../src/shared/components';
import { colors } from '../src/shared/constants/colors';
import { spacing } from '../src/shared/constants/spacing';
import { typography } from '../src/shared/constants/typography';

// Storage Keys
const SETTINGS_KEYS = {
  CONSENT_MODE: 'settings_consent_mode',
  RECORDING_PREFERENCES: 'settings_recording_preferences',
  DATA_RETENTION: 'settings_data_retention',
  AUDIO_QUALITY: 'settings_audio_quality',
  MIC_SENSITIVITY: 'settings_mic_sensitivity',
  NOISE_REDUCTION: 'settings_noise_reduction',
  SESSION_REMINDERS: 'settings_session_reminders',
  COACHING_INSIGHTS: 'settings_coaching_insights',
  ACHIEVEMENT_ALERTS: 'settings_achievement_alerts',
  QUIET_HOURS_ENABLED: 'settings_quiet_hours_enabled',
  QUIET_HOURS_START: 'settings_quiet_hours_start',
  QUIET_HOURS_END: 'settings_quiet_hours_end',
  CONNECTION_TIMEOUT: 'settings_connection_timeout',
};

// Types
type ConsentMode = 'self-only' | 'conversation' | 'muted';
type AudioQuality = 'low' | 'medium' | 'high';
type DataRetention = '7' | '30' | '90' | '365';

interface PairedDevice {
  id: string;
  name: string;
  lastConnected: Date;
}

export default function SettingsScreen() {
  const router = useRouter();

  // Privacy & Data settings
  const [consentMode, setConsentMode] = useState<ConsentMode>('self-only');
  const [recordingEnabled, setRecordingEnabled] = useState(true);
  const [dataRetention, setDataRetention] = useState<DataRetention>('30');

  // Audio settings
  const [audioQuality, setAudioQuality] = useState<AudioQuality>('medium');
  const [micSensitivity, setMicSensitivity] = useState(50);
  const [noiseReduction, setNoiseReduction] = useState(true);

  // Notification settings
  const [sessionReminders, setSessionReminders] = useState(true);
  const [coachingInsights, setCoachingInsights] = useState(true);
  const [achievementAlerts, setAchievementAlerts] = useState(true);
  const [quietHoursEnabled, setQuietHoursEnabled] = useState(false);
  const [quietHoursStart, setQuietHoursStart] = useState('22:00');
  const [quietHoursEnd, setQuietHoursEnd] = useState('08:00');

  // Device settings
  const [pairedDevices, setPairedDevices] = useState<PairedDevice[]>([]);
  const [connectionTimeout, setConnectionTimeout] = useState(30);

  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      const [
        savedConsentMode,
        savedRecordingPrefs,
        savedDataRetention,
        savedAudioQuality,
        savedMicSensitivity,
        savedNoiseReduction,
        savedSessionReminders,
        savedCoachingInsights,
        savedAchievementAlerts,
        savedQuietHoursEnabled,
        savedQuietHoursStart,
        savedQuietHoursEnd,
        savedConnectionTimeout,
      ] = await Promise.all([
        AsyncStorage.getItem(SETTINGS_KEYS.CONSENT_MODE),
        AsyncStorage.getItem(SETTINGS_KEYS.RECORDING_PREFERENCES),
        AsyncStorage.getItem(SETTINGS_KEYS.DATA_RETENTION),
        AsyncStorage.getItem(SETTINGS_KEYS.AUDIO_QUALITY),
        AsyncStorage.getItem(SETTINGS_KEYS.MIC_SENSITIVITY),
        AsyncStorage.getItem(SETTINGS_KEYS.NOISE_REDUCTION),
        AsyncStorage.getItem(SETTINGS_KEYS.SESSION_REMINDERS),
        AsyncStorage.getItem(SETTINGS_KEYS.COACHING_INSIGHTS),
        AsyncStorage.getItem(SETTINGS_KEYS.ACHIEVEMENT_ALERTS),
        AsyncStorage.getItem(SETTINGS_KEYS.QUIET_HOURS_ENABLED),
        AsyncStorage.getItem(SETTINGS_KEYS.QUIET_HOURS_START),
        AsyncStorage.getItem(SETTINGS_KEYS.QUIET_HOURS_END),
        AsyncStorage.getItem(SETTINGS_KEYS.CONNECTION_TIMEOUT),
      ]);

      if (savedConsentMode) setConsentMode(savedConsentMode as ConsentMode);
      if (savedRecordingPrefs) setRecordingEnabled(savedRecordingPrefs === 'true');
      if (savedDataRetention) setDataRetention(savedDataRetention as DataRetention);
      if (savedAudioQuality) setAudioQuality(savedAudioQuality as AudioQuality);
      if (savedMicSensitivity) setMicSensitivity(parseInt(savedMicSensitivity));
      if (savedNoiseReduction) setNoiseReduction(savedNoiseReduction === 'true');
      if (savedSessionReminders) setSessionReminders(savedSessionReminders === 'true');
      if (savedCoachingInsights) setCoachingInsights(savedCoachingInsights === 'true');
      if (savedAchievementAlerts) setAchievementAlerts(savedAchievementAlerts === 'true');
      if (savedQuietHoursEnabled) setQuietHoursEnabled(savedQuietHoursEnabled === 'true');
      if (savedQuietHoursStart) setQuietHoursStart(savedQuietHoursStart);
      if (savedQuietHoursEnd) setQuietHoursEnd(savedQuietHoursEnd);
      if (savedConnectionTimeout) setConnectionTimeout(parseInt(savedConnectionTimeout));

      // Load paired devices (mock data for now)
      setPairedDevices([
        { id: '1', name: 'Tizzy Device A', lastConnected: new Date() },
        { id: '2', name: 'Tizzy Device B', lastConnected: new Date(Date.now() - 86400000) },
      ]);
    } catch (error) {
      console.error('Error loading settings:', error);
    } finally {
      setLoading(false);
    }
  };

  const saveSetting = async (key: string, value: string) => {
    try {
      await AsyncStorage.setItem(key, value);
    } catch (error) {
      console.error('Error saving setting:', error);
      Alert.alert('Error', 'Failed to save setting. Please try again.');
    }
  };

  const handleConsentModeChange = (mode: ConsentMode) => {
    setConsentMode(mode);
    saveSetting(SETTINGS_KEYS.CONSENT_MODE, mode);
  };

  const handleRecordingToggle = (value: boolean) => {
    setRecordingEnabled(value);
    saveSetting(SETTINGS_KEYS.RECORDING_PREFERENCES, value.toString());
  };

  const handleDataRetentionChange = (days: DataRetention) => {
    Alert.alert(
      'Change Data Retention',
      `Set data retention period to ${days} days?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Confirm',
          onPress: () => {
            setDataRetention(days);
            saveSetting(SETTINGS_KEYS.DATA_RETENTION, days);
          },
        },
      ]
    );
  };

  const handleDeleteAllData = () => {
    Alert.alert(
      'Delete All Data',
      'This will permanently delete all your sessions, recordings, and coaching insights. This action cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            // TODO: Implement actual data deletion
            Alert.alert('Success', 'All data has been deleted.');
          },
        },
      ]
    );
  };

  const handleAudioQualityChange = (quality: AudioQuality) => {
    setAudioQuality(quality);
    saveSetting(SETTINGS_KEYS.AUDIO_QUALITY, quality);
  };

  const handleMicSensitivityChange = (value: number) => {
    setMicSensitivity(value);
    saveSetting(SETTINGS_KEYS.MIC_SENSITIVITY, value.toString());
  };

  const handleNoiseReductionToggle = (value: boolean) => {
    setNoiseReduction(value);
    saveSetting(SETTINGS_KEYS.NOISE_REDUCTION, value.toString());
  };

  const handleSessionRemindersToggle = (value: boolean) => {
    setSessionReminders(value);
    saveSetting(SETTINGS_KEYS.SESSION_REMINDERS, value.toString());
  };

  const handleCoachingInsightsToggle = (value: boolean) => {
    setCoachingInsights(value);
    saveSetting(SETTINGS_KEYS.COACHING_INSIGHTS, value.toString());
  };

  const handleAchievementAlertsToggle = (value: boolean) => {
    setAchievementAlerts(value);
    saveSetting(SETTINGS_KEYS.ACHIEVEMENT_ALERTS, value.toString());
  };

  const handleQuietHoursToggle = (value: boolean) => {
    setQuietHoursEnabled(value);
    saveSetting(SETTINGS_KEYS.QUIET_HOURS_ENABLED, value.toString());
  };

  const handleUnpairDevice = (deviceId: string) => {
    Alert.alert(
      'Unpair Device',
      'Are you sure you want to unpair this device?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Unpair',
          style: 'destructive',
          onPress: () => {
            setPairedDevices(devices => devices.filter(d => d.id !== deviceId));
            Alert.alert('Success', 'Device unpaired successfully.');
          },
        },
      ]
    );
  };

  const handleUnpairAllDevices = () => {
    Alert.alert(
      'Unpair All Devices',
      'Are you sure you want to unpair all devices?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Unpair All',
          style: 'destructive',
          onPress: () => {
            setPairedDevices([]);
            Alert.alert('Success', 'All devices unpaired successfully.');
          },
        },
      ]
    );
  };

  const handleConnectionTimeoutChange = (timeout: number) => {
    setConnectionTimeout(timeout);
    saveSetting(SETTINGS_KEYS.CONNECTION_TIMEOUT, timeout.toString());
  };

  const openURL = (url: string) => {
    Linking.openURL(url).catch(err => {
      console.error('Failed to open URL:', err);
      Alert.alert('Error', 'Failed to open link.');
    });
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <Text style={styles.loadingText}>Loading settings...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Text style={styles.backButtonText}>Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Settings</Text>
        <View style={styles.backButton} />
      </View>

      <ScrollView style={styles.scrollView} contentContainerStyle={styles.content}>
        {/* Privacy & Data Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Privacy & Data</Text>

          <View style={styles.settingItem}>
            <Text style={styles.settingLabel}>Consent Mode Default</Text>
            <View style={styles.segmentedControl}>
              {(['self-only', 'conversation', 'muted'] as ConsentMode[]).map(mode => (
                <TouchableOpacity
                  key={mode}
                  style={[
                    styles.segment,
                    consentMode === mode && styles.segmentActive,
                  ]}
                  onPress={() => handleConsentModeChange(mode)}
                >
                  <Text
                    style={[
                      styles.segmentText,
                      consentMode === mode && styles.segmentTextActive,
                    ]}
                  >
                    {mode.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          <View style={styles.settingItem}>
            <View style={styles.settingRow}>
              <View style={styles.settingInfo}>
                <Text style={styles.settingLabel}>Recording Enabled</Text>
                <Text style={styles.settingDescription}>Allow audio recording during sessions</Text>
              </View>
              <Switch
                value={recordingEnabled}
                onValueChange={handleRecordingToggle}
                trackColor={{ false: colors.neutral.gray300, true: colors.primary.light }}
                thumbColor={recordingEnabled ? colors.primary.main : colors.neutral.gray100}
              />
            </View>
          </View>

          <View style={styles.settingItem}>
            <Text style={styles.settingLabel}>Data Retention Period</Text>
            <View style={styles.optionList}>
              {(['7', '30', '90', '365'] as DataRetention[]).map(days => (
                <TouchableOpacity
                  key={days}
                  style={styles.option}
                  onPress={() => handleDataRetentionChange(days)}
                >
                  <Text style={styles.optionText}>
                    {days === '365' ? '1 year' : `${days} days`}
                  </Text>
                  <View style={styles.radio}>
                    {dataRetention === days && <View style={styles.radioSelected} />}
                  </View>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          <View style={styles.settingItem}>
            <Button
              title="Delete All Data"
              variant="danger"
              onPress={handleDeleteAllData}
              fullWidth
            />
          </View>
        </View>

        {/* Audio Settings Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Audio Settings</Text>

          <View style={styles.settingItem}>
            <Text style={styles.settingLabel}>Audio Quality</Text>
            <View style={styles.segmentedControl}>
              {(['low', 'medium', 'high'] as AudioQuality[]).map(quality => (
                <TouchableOpacity
                  key={quality}
                  style={[
                    styles.segment,
                    audioQuality === quality && styles.segmentActive,
                  ]}
                  onPress={() => handleAudioQualityChange(quality)}
                >
                  <Text
                    style={[
                      styles.segmentText,
                      audioQuality === quality && styles.segmentTextActive,
                    ]}
                  >
                    {quality.charAt(0).toUpperCase() + quality.slice(1)}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          <View style={styles.settingItem}>
            <Text style={styles.settingLabel}>Microphone Sensitivity</Text>
            <View style={styles.sliderContainer}>
              <Text style={styles.sliderLabel}>Low</Text>
              <View style={styles.sliderWrapper}>
                <View style={styles.sliderTrack}>
                  <View style={[styles.sliderFill, { width: `${micSensitivity}%` }]} />
                </View>
                <Text style={styles.sliderValue}>{micSensitivity}%</Text>
              </View>
              <Text style={styles.sliderLabel}>High</Text>
            </View>
            <View style={styles.sliderButtons}>
              <Button
                title="-"
                variant="outline"
                size="small"
                onPress={() => handleMicSensitivityChange(Math.max(0, micSensitivity - 10))}
              />
              <Button
                title="+"
                variant="outline"
                size="small"
                onPress={() => handleMicSensitivityChange(Math.min(100, micSensitivity + 10))}
              />
            </View>
          </View>

          <View style={styles.settingItem}>
            <View style={styles.settingRow}>
              <View style={styles.settingInfo}>
                <Text style={styles.settingLabel}>Background Noise Reduction</Text>
                <Text style={styles.settingDescription}>Filter out ambient noise</Text>
              </View>
              <Switch
                value={noiseReduction}
                onValueChange={handleNoiseReductionToggle}
                trackColor={{ false: colors.neutral.gray300, true: colors.primary.light }}
                thumbColor={noiseReduction ? colors.primary.main : colors.neutral.gray100}
              />
            </View>
          </View>
        </View>

        {/* Notifications Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Notifications</Text>

          <View style={styles.settingItem}>
            <View style={styles.settingRow}>
              <View style={styles.settingInfo}>
                <Text style={styles.settingLabel}>Session Reminders</Text>
                <Text style={styles.settingDescription}>Get notified about upcoming sessions</Text>
              </View>
              <Switch
                value={sessionReminders}
                onValueChange={handleSessionRemindersToggle}
                trackColor={{ false: colors.neutral.gray300, true: colors.primary.light }}
                thumbColor={sessionReminders ? colors.primary.main : colors.neutral.gray100}
              />
            </View>
          </View>

          <View style={styles.settingItem}>
            <View style={styles.settingRow}>
              <View style={styles.settingInfo}>
                <Text style={styles.settingLabel}>Coaching Insights</Text>
                <Text style={styles.settingDescription}>Receive personalized coaching tips</Text>
              </View>
              <Switch
                value={coachingInsights}
                onValueChange={handleCoachingInsightsToggle}
                trackColor={{ false: colors.neutral.gray300, true: colors.primary.light }}
                thumbColor={coachingInsights ? colors.primary.main : colors.neutral.gray100}
              />
            </View>
          </View>

          <View style={styles.settingItem}>
            <View style={styles.settingRow}>
              <View style={styles.settingInfo}>
                <Text style={styles.settingLabel}>Achievement Alerts</Text>
                <Text style={styles.settingDescription}>Celebrate your milestones</Text>
              </View>
              <Switch
                value={achievementAlerts}
                onValueChange={handleAchievementAlertsToggle}
                trackColor={{ false: colors.neutral.gray300, true: colors.primary.light }}
                thumbColor={achievementAlerts ? colors.primary.main : colors.neutral.gray100}
              />
            </View>
          </View>

          <View style={styles.settingItem}>
            <View style={styles.settingRow}>
              <View style={styles.settingInfo}>
                <Text style={styles.settingLabel}>Quiet Hours</Text>
                <Text style={styles.settingDescription}>
                  {quietHoursEnabled ? `${quietHoursStart} - ${quietHoursEnd}` : 'Disabled'}
                </Text>
              </View>
              <Switch
                value={quietHoursEnabled}
                onValueChange={handleQuietHoursToggle}
                trackColor={{ false: colors.neutral.gray300, true: colors.primary.light }}
                thumbColor={quietHoursEnabled ? colors.primary.main : colors.neutral.gray100}
              />
            </View>
          </View>
        </View>

        {/* Device Settings Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Device Settings</Text>

          <View style={styles.settingItem}>
            <Text style={styles.settingLabel}>Paired Devices</Text>
            {pairedDevices.length === 0 ? (
              <Text style={styles.emptyText}>No paired devices</Text>
            ) : (
              pairedDevices.map(device => (
                <View key={device.id} style={styles.deviceItem}>
                  <View style={styles.deviceInfo}>
                    <Text style={styles.deviceName}>{device.name}</Text>
                    <Text style={styles.deviceLastConnected}>
                      Last connected: {device.lastConnected.toLocaleDateString()}
                    </Text>
                  </View>
                  <TouchableOpacity
                    onPress={() => handleUnpairDevice(device.id)}
                    style={styles.unpairButton}
                  >
                    <Text style={styles.unpairButtonText}>Unpair</Text>
                  </TouchableOpacity>
                </View>
              ))
            )}
          </View>

          {pairedDevices.length > 0 && (
            <View style={styles.settingItem}>
              <Button
                title="Unpair All Devices"
                variant="outline"
                onPress={handleUnpairAllDevices}
                fullWidth
              />
            </View>
          )}

          <View style={styles.settingItem}>
            <Text style={styles.settingLabel}>Connection Timeout</Text>
            <View style={styles.optionList}>
              {[15, 30, 60, 120].map(timeout => (
                <TouchableOpacity
                  key={timeout}
                  style={styles.option}
                  onPress={() => handleConnectionTimeoutChange(timeout)}
                >
                  <Text style={styles.optionText}>
                    {timeout < 60 ? `${timeout} seconds` : `${timeout / 60} minute${timeout > 60 ? 's' : ''}`}
                  </Text>
                  <View style={styles.radio}>
                    {connectionTimeout === timeout && <View style={styles.radioSelected} />}
                  </View>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </View>

        {/* About Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>About</Text>

          <View style={styles.settingItem}>
            <View style={styles.settingRow}>
              <Text style={styles.settingLabel}>App Version</Text>
              <Text style={styles.settingValue}>1.0.0</Text>
            </View>
          </View>

          <View style={styles.settingItem}>
            <TouchableOpacity
              style={styles.linkButton}
              onPress={() => openURL('https://tizzy.app/terms')}
            >
              <Text style={styles.linkButtonText}>Terms of Service</Text>
              <SymbolView
                name="chevron.right"
                size={16}
                tintColor={colors.text.tertiary}
              />
            </TouchableOpacity>
          </View>

          <View style={styles.settingItem}>
            <TouchableOpacity
              style={styles.linkButton}
              onPress={() => openURL('https://tizzy.app/privacy')}
            >
              <Text style={styles.linkButtonText}>Privacy Policy</Text>
              <SymbolView
                name="chevron.right"
                size={16}
                tintColor={colors.text.tertiary}
              />
            </TouchableOpacity>
          </View>

          <View style={styles.settingItem}>
            <TouchableOpacity
              style={styles.linkButton}
              onPress={() => openURL('https://tizzy.app/licenses')}
            >
              <Text style={styles.linkButtonText}>Open Source Licenses</Text>
              <SymbolView
                name="chevron.right"
                size={16}
                tintColor={colors.text.tertiary}
              />
            </TouchableOpacity>
          </View>
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
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    backgroundColor: colors.background.primary,
    borderBottomWidth: 1,
    borderBottomColor: colors.border.light,
  },
  backButton: {
    width: 60,
  },
  backButtonText: {
    color: colors.primary.main,
    fontSize: 16,
    fontWeight: '600',
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.text.primary,
  },
  scrollView: {
    flex: 1,
  },
  content: {
    padding: spacing.md,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    fontSize: 16,
    color: colors.text.secondary,
  },
  section: {
    marginBottom: spacing.lg,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.text.primary,
    marginBottom: spacing.md,
    paddingHorizontal: spacing.xs,
  },
  settingItem: {
    backgroundColor: colors.background.primary,
    borderRadius: spacing.radius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  settingInfo: {
    flex: 1,
    marginRight: spacing.md,
  },
  settingLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text.primary,
    marginBottom: spacing.xs,
  },
  settingDescription: {
    fontSize: 14,
    color: colors.text.secondary,
  },
  settingValue: {
    fontSize: 16,
    color: colors.text.secondary,
  },
  segmentedControl: {
    flexDirection: 'row',
    backgroundColor: colors.neutral.gray100,
    borderRadius: spacing.radius.md,
    padding: spacing.xs,
    marginTop: spacing.sm,
  },
  segment: {
    flex: 1,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xs,
    borderRadius: spacing.radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmentActive: {
    backgroundColor: colors.primary.main,
  },
  segmentText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text.secondary,
  },
  segmentTextActive: {
    color: colors.primary.contrast,
  },
  optionList: {
    marginTop: spacing.sm,
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border.light,
  },
  optionText: {
    fontSize: 16,
    color: colors.text.primary,
  },
  radio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: colors.primary.main,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioSelected: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.primary.main,
  },
  sliderContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.sm,
    gap: spacing.sm,
  },
  sliderWrapper: {
    flex: 1,
    alignItems: 'center',
  },
  sliderTrack: {
    width: '100%',
    height: 8,
    backgroundColor: colors.neutral.gray200,
    borderRadius: 4,
    overflow: 'hidden',
  },
  sliderFill: {
    height: 8,
    backgroundColor: colors.primary.main,
    borderRadius: 4,
  },
  sliderValue: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text.primary,
    marginTop: spacing.xs,
  },
  sliderLabel: {
    fontSize: 12,
    color: colors.text.secondary,
    fontWeight: '600',
  },
  sliderButtons: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: spacing.md,
    marginTop: spacing.sm,
  },
  deviceItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border.light,
  },
  deviceInfo: {
    flex: 1,
  },
  deviceName: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text.primary,
  },
  deviceLastConnected: {
    fontSize: 14,
    color: colors.text.secondary,
    marginTop: spacing.xs / 2,
  },
  unpairButton: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
  },
  unpairButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.danger.main,
  },
  emptyText: {
    fontSize: 14,
    color: colors.text.secondary,
    fontStyle: 'italic',
    marginTop: spacing.sm,
  },
  linkButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
  },
  linkButtonText: {
    fontSize: 16,
    color: colors.primary.main,
    fontWeight: '500',
  },
});
