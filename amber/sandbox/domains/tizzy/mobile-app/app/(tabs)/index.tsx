import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { SymbolView } from 'expo-symbols';
import * as Haptics from 'expo-haptics';
import Animated, { FadeInDown, FadeInUp } from 'react-native-reanimated';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useDeviceStore } from '../../src/store/deviceStore';
import { apiService } from '../../src/api/client';
import { getBLEManager } from '../../src/services/BLEManager';
import { StatusBanner } from '../../src/shared/components/StatusBanner';
import { SessionCard, SessionData } from '../../src/shared/components/SessionCard';
import { QuickActions, QuickAction } from '../../src/shared/components/QuickActions';
import { HomeScreenSkeleton } from '../../src/shared/components/SkeletonLoader';
import { STORAGE_KEYS } from '../../src/shared/constants';
import { colors } from '../../src/shared/constants/colors';

export default function HomeScreen() {
  console.log('[HomeScreen] Component rendering...');

  const [userName, setUserName] = useState<string>('');
  const [userId, setUserId] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [recentSessions, setRecentSessions] = useState<SessionData[]>([]);
  const [currentSession, setCurrentSession] = useState<SessionData | null>(null);
  const [weeklyConversations, setWeeklyConversations] = useState<number>(0);
  const [actionLoading, setActionLoading] = useState<{ [key: string]: boolean }>({});
  const [bleManager, setBleManager] = useState<any>(null);

  // Device store state
  const {
    connectionState,
    batteryLevel,
    muteState,
    currentSessionId,
    setMuteState,
  } = useDeviceStore();

  useEffect(() => {
    console.log('[HomeScreen] Initial useEffect running');

    // Check demo mode first, then initialize BLE manager if needed
    const initialize = async () => {
      const demoMode = await AsyncStorage.getItem(STORAGE_KEYS.DEMO_MODE);
      console.log('[HomeScreen] Demo mode check:', demoMode);

      if (demoMode !== 'true') {
        try {
          console.log('[HomeScreen] Getting BLE manager...');
          const manager = getBLEManager();
          setBleManager(manager);
          console.log('[HomeScreen] BLE manager obtained successfully');
        } catch (error) {
          console.error('[HomeScreen] Failed to get BLE manager:', error);
        }
      } else {
        console.log('[HomeScreen] Demo mode - skipping BLE manager initialization');
      }
    };

    initialize();
    loadUserData();
    loadDashboardData();
  }, []);

  useEffect(() => {
    if (currentSessionId) {
      loadCurrentSession();
    } else {
      setCurrentSession(null);
    }
  }, [currentSessionId]);

  const loadUserData = async () => {
    try {
      const userJson = await AsyncStorage.getItem(STORAGE_KEYS.USER);

      if (userJson) {
        const user = JSON.parse(userJson);
        setUserName(user.name || '');
        setUserId(user.id || '');
      }
    } catch (error) {
      console.error('Failed to load user data:', error);
    }
  };

  const loadDashboardData = async () => {
    try {
      console.log('[HomeScreen] loadDashboardData called');
      setLoading(true);

      // Check for demo mode and skip API calls
      const isDemoMode = await AsyncStorage.getItem(STORAGE_KEYS.DEMO_MODE);
      console.log('[HomeScreen] Demo mode check:', isDemoMode);
      if (isDemoMode === 'true') {
        // Set empty/mock data for demo
        console.log('[HomeScreen] Demo mode detected, using mock data');
        setRecentSessions([]);
        setWeeklyConversations(0);
        setLoading(false);
        return;
      }

      // Load user ID from STORAGE_KEYS.USER
      const userJson = await AsyncStorage.getItem(STORAGE_KEYS.USER);
      if (!userJson) {
        setLoading(false);
        return;
      }

      const user = JSON.parse(userJson);
      const storedUserId = user.id;

      if (!storedUserId) {
        setLoading(false);
        return;
      }

      // Load recent sessions
      const sessions = await apiService.getSessions(storedUserId, { limit: 3 });
      // Map API Session type to SessionData type (filter out active sessions without end_time)
      const completedSessions: SessionData[] = sessions
        .filter(s => s.end_time)
        .map(s => ({
          id: s.id,
          start_time: s.start_time,
          end_time: s.end_time!,
          duration_seconds: s.duration_seconds || 0,
          speaker_count_estimate: s.speaker_count_estimate || 2,
          environment_tag: s.environment_tag,
          conversation_count: s.conversation_count,
          created_at: s.created_at,
        }));
      setRecentSessions(completedSessions);

      // Load weekly progress
      const now = new Date();
      const weekString = `${now.getFullYear()}-W${getWeekNumber(now)}`;
      const progress = await apiService.getWeeklyProgress(storedUserId, weekString);
      setWeeklyConversations(progress?.conversation_count || 0);
    } catch (error) {
      console.error('Failed to load dashboard data:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadCurrentSession = async () => {
    if (!currentSessionId) return;

    try {
      const summary = await apiService.getSessionSummary(currentSessionId);
      // Map SessionSummary to SessionData
      const sessionData: SessionData = {
        id: summary.session_id,
        start_time: summary.date,
        end_time: summary.date, // Summary doesn't have separate end_time
        duration_seconds: summary.duration_minutes * 60,
        speaker_count_estimate: 2, // Default value
        environment_tag: 'unknown', // Not available in summary
        conversation_count: 1,
        created_at: summary.date,
      };
      setCurrentSession(sessionData);
    } catch (error) {
      console.error('Failed to load current session:', error);
    }
  };

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadDashboardData();
    if (currentSessionId) {
      await loadCurrentSession();
    }
    setRefreshing(false);
  }, [currentSessionId]);

  const handleStartSession = async () => {
    try {
      setActionLoading({ ...actionLoading, startSession: true });

      if (connectionState !== 'connected') {
        Alert.alert('Device Not Connected', 'Please connect your Tizzy device first.');
        return;
      }

      const deviceId = useDeviceStore.getState().deviceId;
      if (!deviceId) {
        Alert.alert('Error', 'Device ID not found.');
        return;
      }

      const session = await apiService.createSession({
        device_id: deviceId,
        start_time: new Date().toISOString(),
        environment_tag: 'General',
        consent_mode: 'full',
      });

      useDeviceStore.getState().setCurrentSessionId(session.id);
      Alert.alert('Success', 'Session started successfully!');
      await onRefresh();
    } catch (error) {
      console.error('Failed to start session:', error);
      Alert.alert('Error', 'Failed to start session. Please try again.');
    } finally {
      setActionLoading({ ...actionLoading, startSession: false });
    }
  };

  const handleMuteToggle = async () => {
    try {
      setActionLoading({ ...actionLoading, mute: true });

      if (!bleManager) {
        Alert.alert('Error', 'BLE Manager not available');
        return;
      }

      const nextState = muteState === 'unmuted' ? 'muted' : 'unmuted';
      await bleManager.setMuteState(nextState);
      setMuteState(nextState);

      Alert.alert(
        'Mute State Changed',
        `Device is now ${nextState === 'muted' ? 'muted' : 'unmuted'}.`
      );
    } catch (error) {
      console.error('Failed to toggle mute:', error);
      Alert.alert('Error', 'Failed to change mute state.');
    } finally {
      setActionLoading({ ...actionLoading, mute: false });
    }
  };

  const handleTestHaptics = async () => {
    try {
      setActionLoading({ ...actionLoading, haptics: true });

      if (connectionState !== 'connected') {
        Alert.alert('Device Not Connected', 'Please connect your Tizzy device first.');
        return;
      }

      if (!bleManager) {
        Alert.alert('Error', 'BLE Manager not available');
        return;
      }

      await bleManager.sendHaptic('single_pulse');
      Alert.alert('Success', 'Haptic feedback sent!');
    } catch (error) {
      console.error('Failed to send haptic:', error);
      Alert.alert('Error', 'Failed to send haptic feedback.');
    } finally {
      setActionLoading({ ...actionLoading, haptics: false });
    }
  };

  const quickActions: QuickAction[] = [
    {
      id: 'start-session',
      title: currentSessionId ? 'Session Active' : 'Start Session',
      subtitle: currentSessionId ? 'End to start new' : 'Begin recording',
      icon: 'play.circle.fill',
      color: '#10B981',
      onPress: handleStartSession,
      disabled: !!currentSessionId || connectionState !== 'connected',
      loading: actionLoading.startSession,
    },
    {
      id: 'mute',
      title: muteState === 'muted' ? 'Unmute' : 'Mute Device',
      subtitle: muteState === 'muted' ? 'Turn on mic' : 'Turn off mic',
      icon: muteState === 'muted' ? 'speaker.slash.fill' : 'speaker.wave.2.fill',
      color: '#F59E0B',
      onPress: handleMuteToggle,
      disabled: connectionState !== 'connected',
      loading: actionLoading.mute,
    },
    {
      id: 'haptics',
      title: 'Test Haptics',
      subtitle: 'Send test pulse',
      icon: 'iphone.radiowaves.left.and.right',
      color: '#8B5CF6',
      onPress: handleTestHaptics,
      disabled: connectionState !== 'connected',
      loading: actionLoading.haptics,
    },
  ];

  const getGreeting = (): string => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 18) return 'Good afternoon';
    return 'Good evening';
  };

  const getWeekNumber = (date: Date): number => {
    const firstDayOfYear = new Date(date.getFullYear(), 0, 1);
    const pastDaysOfYear = (date.getTime() - firstDayOfYear.getTime()) / 86400000;
    return Math.ceil((pastDaysOfYear + firstDayOfYear.getDay() + 1) / 7);
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>
          <HomeScreenSkeleton />
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.primary.main}
            colors={[colors.primary.main]}
          />
        }
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <Animated.View entering={FadeInDown.delay(0).duration(400)} style={styles.header}>
          <Text style={styles.greeting}>{getGreeting()},</Text>
          <Text style={styles.userName}>{userName || 'User'}</Text>
        </Animated.View>

        {/* Connection Status Banner */}
        <Animated.View entering={FadeInDown.delay(100).duration(400)}>
          <StatusBanner connectionState={connectionState} />
        </Animated.View>

        {/* Device Info Card */}
        {connectionState === 'connected' && (
          <View style={styles.deviceCard}>
            <View style={styles.deviceInfo}>
              <View style={styles.deviceInfoItem}>
                <Text style={styles.deviceLabel}>Battery Level</Text>
                <View style={styles.batteryContainer}>
                  <Text style={styles.batteryText}>{batteryLevel}%</Text>
                  <SymbolView
                    name={batteryLevel > 80 ? 'battery.100' : batteryLevel > 20 ? 'battery.50' : 'battery.0'}
                    size={20}
                    type="hierarchical"
                    tintColor="#1F2937"
                  />
                </View>
              </View>
              <View style={styles.divider} />
              <View style={styles.deviceInfoItem}>
                <Text style={styles.deviceLabel}>Status</Text>
                <Text style={styles.deviceValue}>
                  {currentSessionId ? 'Recording' : 'Ready'}
                </Text>
              </View>
            </View>
          </View>
        )}

        {/* Current Session Card */}
        {currentSession && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Current Session</Text>
            <SessionCard session={currentSession} isActive={true} />
          </View>
        )}

        {/* Quick Actions */}
        <Animated.View entering={FadeInDown.delay(200).duration(400)} style={styles.section}>
          <Text style={styles.sectionTitle}>Quick Actions</Text>
          <QuickActions actions={quickActions} columns={2} />
        </Animated.View>

        {/* Weekly Progress */}
        <Animated.View entering={FadeInDown.delay(300).duration(400)} style={styles.section}>
          <Text style={styles.sectionTitle}>This Week</Text>
          <View style={styles.progressCard}>
            <Text style={styles.progressValue}>{weeklyConversations}</Text>
            <Text style={styles.progressLabel}>Conversations</Text>
            <Text style={styles.progressSubLabel}>this week</Text>
          </View>
        </Animated.View>

        {/* Recent Sessions */}
        <Animated.View entering={FadeInDown.delay(400).duration(400)}>
          {recentSessions.length > 0 ? (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Recent Sessions</Text>
              {recentSessions.map((session) => (
                <SessionCard
                  key={session.id}
                  session={session}
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  }}
                />
              ))}
            </View>
          ) : (
            <View style={styles.emptyState}>
              <View style={styles.emptyStateIconContainer}>
                <SymbolView
                  name="waveform.path.ecg"
                  size={48}
                  type="hierarchical"
                  tintColor={colors.primary.main}
                />
              </View>
              <Text style={styles.emptyStateTitle}>No sessions yet</Text>
              <Text style={styles.emptyStateText}>
                Connect your Tizzy device and start a session to track your conversations and get coaching insights.
              </Text>
            </View>
          )}
        </Animated.View>
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
    padding: 20,
    paddingBottom: 40,
  },
  header: {
    marginBottom: 24,
  },
  greeting: {
    fontSize: 18,
    color: colors.text.secondary,
    marginBottom: 4,
    fontWeight: '500',
  },
  userName: {
    fontSize: 32,
    fontWeight: '700',
    color: colors.text.primary,
    letterSpacing: -0.5,
  },
  deviceCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    marginBottom: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 3,
    borderWidth: 1,
    borderColor: '#F3F4F6',
  },
  deviceInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
  },
  deviceInfoItem: {
    flex: 1,
    alignItems: 'center',
  },
  deviceLabel: {
    fontSize: 13,
    color: '#6B7280',
    marginBottom: 8,
  },
  deviceValue: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1F2937',
  },
  batteryContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  batteryText: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1F2937',
  },
  divider: {
    width: 1,
    height: 40,
    backgroundColor: '#E5E7EB',
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#1F2937',
    marginBottom: 16,
  },
  progressCard: {
    backgroundColor: colors.background.primary,
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 3,
    borderWidth: 1,
    borderColor: colors.border.light,
  },
  progressValue: {
    fontSize: 56,
    fontWeight: '700',
    color: colors.primary.main,
    marginBottom: 4,
    letterSpacing: -2,
  },
  progressLabel: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.text.primary,
    marginBottom: 2,
  },
  progressSubLabel: {
    fontSize: 13,
    color: colors.text.tertiary,
    fontWeight: '400',
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 48,
    paddingHorizontal: 24,
  },
  emptyStateIconContainer: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: colors.primary.main + '12',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  emptyStateTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.text.primary,
    marginBottom: 10,
    letterSpacing: -0.3,
  },
  emptyStateText: {
    fontSize: 15,
    color: colors.text.secondary,
    textAlign: 'center',
    maxWidth: 280,
    lineHeight: 22,
  },
});
