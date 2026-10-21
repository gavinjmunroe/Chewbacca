import React, { useState, useMemo, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  FlatList,
  ActivityIndicator,
  RefreshControl,
  Pressable,
} from 'react-native';
import { useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SymbolView } from 'expo-symbols';
import * as Haptics from 'expo-haptics';
import Animated, { FadeInDown, FadeInUp } from 'react-native-reanimated';
import { useSessions } from '../../src/features/coaching/hooks/useSessions';
import { MicroGoal } from '../../src/features/coaching/components/MicroGoal';
import { WeeklyProgress } from '../../src/features/coaching/components/ProgressChart';
import { colors } from '../../src/shared/constants/colors';
import { spacing } from '../../src/shared/constants/spacing';
import { ROUTES, STORAGE_KEYS } from '../../src/shared/constants';
import { useOptimizedList } from '../../src/shared/hooks/useOptimizedList';

/**
 * Coaching Tab Screen
 * Displays list of recent sessions with summaries and quick access to details
 */
export default function CoachingScreen() {
  const router = useRouter();

  const [userId, setUserId] = useState<string>('');
  const [isDemoMode, setIsDemoMode] = useState<boolean>(false);
  const [initialLoadComplete, setInitialLoadComplete] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // Load user data and demo mode status on mount
  useEffect(() => {
    loadUserData();
  }, []);

  const loadUserData = async () => {
    try {
      // Check for demo mode
      const demoMode = await AsyncStorage.getItem(STORAGE_KEYS.DEMO_MODE);
      const isDemo = demoMode === 'true';
      setIsDemoMode(isDemo);

      // Get user ID from stored user object
      if (isDemo) {
        setUserId('demo-user-123');
      } else {
        const userDataString = await AsyncStorage.getItem(STORAGE_KEYS.USER);
        if (userDataString) {
          const userData = JSON.parse(userDataString);
          setUserId(userData.id || '');
        }
      }
    } catch (error) {
      console.error('Failed to load user data:', error);
    } finally {
      setInitialLoadComplete(true);
    }
  };

  // Only call useSessions if not in demo mode and have a valid userId
  const shouldFetchSessions = !isDemoMode && userId && initialLoadComplete;
  const { sessions, isLoading, error, refetch } = useSessions(
    shouldFetchSessions ? userId : '',
    10
  );

  const handleRefresh = async () => {
    setRefreshing(true);
    if (!isDemoMode) {
      await refetch();
    }
    setRefreshing(false);
  };

  const handleSessionPress = (sessionId: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push(`${ROUTES.SESSION_DETAIL}?id=${sessionId}`);
  };

  // For demo mode, use empty sessions array; otherwise use fetched sessions
  const displaySessions = isDemoMode ? [] : sessions;
  const latestSession = displaySessions[0];

  // Prepare flat list structure for optimized rendering
  interface SessionListItem {
    type: 'header' | 'micro-goal' | 'progress' | 'sessions-header' | 'session-card';
    session?: any;
  }

  const flatSessionsList = useMemo<SessionListItem[]>(() => {
    const items: SessionListItem[] = [];

    // Add micro-goal section
    if (latestSession?.insights?.micro_goal) {
      items.push({ type: 'micro-goal' });
    }

    // Add progress section
    if (latestSession?.progress_data) {
      items.push({ type: 'progress' });
    }

    // Add sessions header and cards
    if (displaySessions.length > 0) {
      items.push({ type: 'sessions-header' });
      displaySessions.forEach((session) => {
        items.push({ type: 'session-card', session });
      });
    }

    return items;
  }, [displaySessions, latestSession]);

  // Optimize list rendering with memoization
  const optimizedListProps = useOptimizedList({
    items: flatSessionsList,
    renderItem: ({ item }) => {
      if (item.type === 'micro-goal') {
        return <MicroGoal goal={latestSession.insights.micro_goal} />;
      }
      if (item.type === 'progress') {
        return (
          <WeeklyProgress
            sessionsCompleted={latestSession.progress_data.sessions_completed}
            totalMinutes={latestSession.progress_data.total_practice_minutes}
            trend={latestSession.progress_data.improvement_trend}
          />
        );
      }
      if (item.type === 'sessions-header') {
        return (
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Recent Sessions</Text>
          </View>
        );
      }
      if (item.type === 'session-card' && item.session) {
        return (
          <SessionCard
            session={item.session}
            onPress={() => handleSessionPress(item.session.session_id)}
          />
        );
      }
      return null;
    },
    keyExtractor: (item, index) => {
      if (item.type === 'session-card') {
        return `session-${item.session?.session_id || index}`;
      }
      return `${item.type}-${index}`;
    },
    windowSize: 8,
    initialNumToRender: 5,
  });

  // Show loading only when initial data is being loaded (not in demo mode)
  const showLoading = !initialLoadComplete || (isLoading && displaySessions.length === 0 && !isDemoMode);
  const showError = !isDemoMode && error;
  const showEmpty = displaySessions.length === 0 && !showLoading && !showError;

  return (
    <View style={styles.container}>
      <Animated.View entering={FadeInDown.duration(400)} style={styles.header}>
        <Text style={styles.headerTitle}>Your Progress</Text>
        <Text style={styles.headerSubtitle}>
          Track your journey and celebrate your wins
        </Text>
      </Animated.View>

      {/* Use FlatList for better performance with many sessions */}
      <FlatList
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        data={!showLoading && !showError && displaySessions.length > 0 ? flatSessionsList : []}
        renderItem={
          !showLoading && !showError && displaySessions.length > 0
            ? optimizedListProps.renderItem
            : undefined
        }
        keyExtractor={
          !showLoading && !showError && displaySessions.length > 0
            ? optimizedListProps.keyExtractor
            : (item, index) => String(index)
        }
        windowSize={optimizedListProps.windowSize}
        initialNumToRender={optimizedListProps.initialNumToRender}
        maxToRenderPerBatch={optimizedListProps.maxToRenderPerBatch}
        updateCellsBatchingPeriod={optimizedListProps.updateCellsBatchingPeriod}
        scrollEnabled={!showLoading}
        nestedScrollEnabled={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor={colors.primary.main}
            colors={[colors.primary.main]}
          />
        }
        ListHeaderComponent={
          showLoading ? (
            <View style={styles.centerContainer}>
              <ActivityIndicator size="large" color={colors.primary.main} />
              <Text style={styles.loadingText}>Loading your sessions...</Text>
            </View>
          ) : showError ? (
            <View style={styles.errorContainer}>
              <SymbolView
                name="exclamationmark.triangle.fill"
                size={48}
                tintColor={colors.status.warning}
                style={styles.errorEmoji}
              />
              <Text style={styles.errorText}>{error}</Text>
              <Pressable style={styles.retryButton} onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); refetch(); }}>
                <Text style={styles.retryButtonText}>Try Again</Text>
              </Pressable>
            </View>
          ) : showEmpty ? (
            <View style={styles.emptyContainer}>
              <SymbolView
                name="mic.fill"
                size={64}
                tintColor={colors.primary.main}
                style={styles.emptyEmoji}
              />
              <Text style={styles.emptyTitle}>Start Your First Session</Text>
              <Text style={styles.emptyText}>
                Complete a practice session to get personalized coaching insights and track your progress.
              </Text>
            </View>
          ) : null
        }
      />
    </View>
  );
}

/**
 * Session card component for the list
 */
interface SessionCardProps {
  session: any;
  onPress: () => void;
}

function SessionCard({ session, onPress }: SessionCardProps) {
  const date = new Date(session.date);
  const formattedDate = formatDate(date);
  const timeAgo = getTimeAgo(date);

  return (
    <Pressable style={styles.sessionCard} onPress={onPress} android_ripple={{ color: colors.neutral.gray200 }}>
      <View style={styles.sessionHeader}>
        <View style={styles.sessionDateContainer}>
          <Text style={styles.sessionDate}>{formattedDate}</Text>
          <Text style={styles.sessionTimeAgo}>{timeAgo}</Text>
        </View>
        <View style={styles.sessionDuration}>
          <Text style={styles.durationText}>{session.duration_minutes} min</Text>
        </View>
      </View>

      <Text style={styles.sessionSummary} numberOfLines={2}>
        {session.summary}
      </Text>

      <View style={styles.sessionFooter}>
        <View style={styles.insightBadges}>
          <View style={styles.insightBadge}>
            <SymbolView
              name="sparkles"
              size={12}
              tintColor={colors.text.secondary}
              style={styles.badgeEmoji}
            />
            <Text style={styles.badgeText}>
              {session.insights.what_went_well.length} wins
            </Text>
          </View>
          <View style={styles.insightBadge}>
            <SymbolView
              name="leaf.fill"
              size={12}
              tintColor={colors.text.secondary}
              style={styles.badgeEmoji}
            />
            <Text style={styles.badgeText}>
              {session.insights.areas_for_growth.length} opportunities
            </Text>
          </View>
        </View>
        <View style={styles.viewDetailsContainer}>
          <Text style={styles.viewDetails}>View Details</Text>
          <SymbolView
            name="chevron.right"
            size={14}
            tintColor={colors.primary.main}
            style={styles.viewDetailsIcon}
          />
        </View>
      </View>
    </Pressable>
  );
}

/**
 * Format date for display
 */
function formatDate(date: Date): string {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`;
}

/**
 * Get relative time string
 */
function getTimeAgo(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 60) {
    return `${diffMins}m ago`;
  } else if (diffHours < 24) {
    return `${diffHours}h ago`;
  } else if (diffDays === 1) {
    return 'Yesterday';
  } else if (diffDays < 7) {
    return `${diffDays}d ago`;
  } else {
    return '';
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background.secondary,
  },
  header: {
    backgroundColor: colors.background.primary,
    paddingTop: spacing.xl,
    paddingHorizontal: spacing.screenPadding,
    paddingBottom: spacing.md,
    borderBottomWidth: spacing.borderWidth.thin,
    borderBottomColor: colors.border.light,
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: '700',
    color: colors.text.primary,
    marginBottom: spacing.xs,
  },
  headerSubtitle: {
    fontSize: 15,
    color: colors.text.secondary,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: spacing.screenPadding,
  },
  centerContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xxxl,
  },
  loadingText: {
    marginTop: spacing.md,
    fontSize: 15,
    color: colors.text.secondary,
  },
  errorContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xxxl,
  },
  errorEmoji: {
    marginBottom: spacing.md,
  },
  errorText: {
    fontSize: 15,
    color: colors.text.secondary,
    textAlign: 'center',
    marginBottom: spacing.md,
  },
  retryButton: {
    backgroundColor: colors.primary.main,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
    borderRadius: spacing.radius.sm,
  },
  retryButtonText: {
    color: colors.text.inverse,
    fontSize: 15,
    fontWeight: '600',
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xxxl,
  },
  emptyEmoji: {
    marginBottom: spacing.md,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: colors.text.primary,
    marginBottom: spacing.sm,
  },
  emptyText: {
    fontSize: 15,
    color: colors.text.secondary,
    textAlign: 'center',
    maxWidth: 280,
    lineHeight: 22,
  },
  sectionHeader: {
    marginBottom: spacing.md,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.text.primary,
  },
  sessionCard: {
    backgroundColor: colors.background.primary,
    borderRadius: spacing.radius.md,
    borderWidth: spacing.borderWidth.thin,
    borderColor: colors.border.light,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  sessionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: spacing.sm,
  },
  sessionDateContainer: {
    flex: 1,
  },
  sessionDate: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text.primary,
    marginBottom: 2,
  },
  sessionTimeAgo: {
    fontSize: 13,
    color: colors.text.tertiary,
  },
  sessionDuration: {
    backgroundColor: colors.primary.main,
    paddingVertical: 4,
    paddingHorizontal: spacing.sm,
    borderRadius: spacing.radius.xs,
  },
  durationText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.text.inverse,
  },
  sessionSummary: {
    fontSize: 14,
    lineHeight: 20,
    color: colors.text.secondary,
    marginBottom: spacing.md,
  },
  sessionFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  insightBadges: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  insightBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.background.secondary,
    paddingVertical: 4,
    paddingHorizontal: spacing.sm,
    borderRadius: spacing.radius.xs,
  },
  badgeEmoji: {
    marginRight: 4,
  },
  badgeText: {
    fontSize: 12,
    color: colors.text.secondary,
  },
  viewDetailsContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  viewDetails: {
    fontSize: 14,
    fontWeight: '500',
    color: colors.primary.main,
  },
  viewDetailsIcon: {
    marginTop: 1,
  },
});
