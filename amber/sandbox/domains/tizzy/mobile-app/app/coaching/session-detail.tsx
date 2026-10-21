import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useSessionDetail } from '../../src/features/coaching/hooks/useSessions';
import { InsightCard } from '../../src/features/coaching/components/InsightCard';
import { ProgressChart, MetricData } from '../../src/features/coaching/components/ProgressChart';
import { MicroGoal } from '../../src/features/coaching/components/MicroGoal';
import { colors } from '../../src/shared/constants/colors';
import { spacing } from '../../src/shared/constants/spacing';

/**
 * Session Detail Screen
 * Displays comprehensive coaching insights for a specific session
 */
export default function SessionDetailScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string }>();
  const sessionId = params.id;

  const { session, isLoading, error } = useSessionDetail(sessionId || '');

  const handleBack = () => {
    router.back();
  };

  if (!sessionId) {
    return (
      <View style={styles.container}>
        <View style={styles.errorContainer}>
          <Text style={styles.errorEmoji}>[exclamationmark.triangle]</Text>
          <Text style={styles.errorText}>Session not found</Text>
          <TouchableOpacity style={styles.backButton} onPress={handleBack}>
            <Text style={styles.backButtonText}>Go Back</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Header with back button */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButtonSmall} onPress={handleBack}>
          <Text style={styles.backArrow}>←</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Session Details</Text>
        <View style={styles.headerSpacer} />
      </View>

      {/* Loading State */}
      {isLoading && (
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color={colors.primary.main} />
          <Text style={styles.loadingText}>Loading session details...</Text>
        </View>
      )}

      {/* Error State */}
      {error && (
        <View style={styles.centerContainer}>
          <Text style={styles.errorEmoji}>[exclamationmark.triangle]</Text>
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity style={styles.retryButton} onPress={handleBack}>
            <Text style={styles.retryButtonText}>Go Back</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Session Content */}
      {session && !isLoading && !error && (
        <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>
          {/* Session Header Info */}
          <View style={styles.sessionHeader}>
            <Text style={styles.sessionDate}>{formatDate(new Date(session.date))}</Text>
            <View style={styles.sessionMeta}>
              <View style={styles.metaItem}>
                <Text style={styles.metaEmoji}>[timer]</Text>
                <Text style={styles.metaText}>{session.duration_minutes} minutes</Text>
              </View>
            </View>
          </View>

          {/* Session Summary */}
          <View style={styles.summaryCard}>
            <Text style={styles.summaryTitle}>Session Summary</Text>
            <Text style={styles.summaryText}>{session.summary}</Text>
          </View>

          {/* What Went Well */}
          <InsightCard type="positive" insights={session.insights.what_went_well} />

          {/* Areas for Growth */}
          <InsightCard type="growth" insights={session.insights.areas_for_growth} />

          {/* Performance Metrics */}
          {hasMetrics(session.metrics) && (
            <ProgressChart
              title="Performance Metrics"
              metrics={convertMetricsToChartData(session.metrics)}
              showPercentages={true}
            />
          )}

          {/* Next Micro-Goal */}
          {session.insights.micro_goal && (
            <View style={styles.goalSection}>
              <Text style={styles.sectionTitle}>Your Next Goal</Text>
              <MicroGoal goal={session.insights.micro_goal} />
            </View>
          )}

          {/* Encouragement Section */}
          <View style={styles.encouragementCard}>
            <Text style={styles.encouragementEmoji}>💫</Text>
            <Text style={styles.encouragementTitle}>Keep Up the Great Work!</Text>
            <Text style={styles.encouragementText}>
              Every session brings you closer to your communication goals. Remember, progress isn't
              always linear, and small improvements add up to big changes over time.
            </Text>
          </View>
        </ScrollView>
      )}
    </View>
  );
}

/**
 * Format date for display
 */
function formatDate(date: Date): string {
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

  return `${days[date.getDay()]}, ${months[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`;
}

/**
 * Check if metrics exist and have values
 */
function hasMetrics(metrics: any): boolean {
  return Object.values(metrics).some((value) => typeof value === 'number' && value > 0);
}

/**
 * Convert metrics object to chart data format
 */
function convertMetricsToChartData(metrics: any): MetricData[] {
  const metricConfigs = [
    { key: 'speech_clarity', label: 'Speech Clarity', color: colors.primary.main },
    { key: 'pace_consistency', label: 'Pace Consistency', color: colors.secondary.main },
    { key: 'vocal_variety', label: 'Vocal Variety', color: colors.accent.main },
    { key: 'pause_effectiveness', label: 'Pause Effectiveness', color: colors.info.main },
  ];

  return metricConfigs
    .filter((config) => metrics[config.key] > 0)
    .map((config) => ({
      label: config.label,
      value: metrics[config.key],
      color: config.color,
    }));
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
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  backButtonSmall: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backArrow: {
    fontSize: 24,
    color: colors.primary.main,
    fontWeight: '600',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.text.primary,
    flex: 1,
    textAlign: 'center',
  },
  headerSpacer: {
    width: 40,
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
    paddingHorizontal: spacing.screenPadding,
  },
  loadingText: {
    marginTop: spacing.md,
    fontSize: 15,
    color: colors.text.secondary,
  },
  errorContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.screenPadding,
  },
  errorEmoji: {
    fontSize: 48,
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
  backButton: {
    backgroundColor: colors.primary.main,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
    borderRadius: spacing.radius.sm,
  },
  backButtonText: {
    color: colors.text.inverse,
    fontSize: 15,
    fontWeight: '600',
  },
  sessionHeader: {
    marginBottom: spacing.lg,
  },
  sessionDate: {
    fontSize: 24,
    fontWeight: '700',
    color: colors.text.primary,
    marginBottom: spacing.sm,
  },
  sessionMeta: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  metaItem: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  metaEmoji: {
    fontSize: 16,
    marginRight: spacing.xs,
  },
  metaText: {
    fontSize: 14,
    color: colors.text.secondary,
  },
  summaryCard: {
    backgroundColor: colors.background.primary,
    borderRadius: spacing.radius.md,
    borderWidth: spacing.borderWidth.thin,
    borderColor: colors.border.light,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  summaryTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text.primary,
    marginBottom: spacing.sm,
  },
  summaryText: {
    fontSize: 15,
    lineHeight: 22,
    color: colors.text.secondary,
  },
  goalSection: {
    marginTop: spacing.sm,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.text.primary,
    marginBottom: spacing.md,
  },
  encouragementCard: {
    backgroundColor: colors.primary.light,
    borderRadius: spacing.radius.md,
    borderWidth: spacing.borderWidth.medium,
    borderColor: colors.primary.main,
    padding: spacing.lg,
    alignItems: 'center',
    marginTop: spacing.md,
    marginBottom: spacing.xl,
  },
  encouragementEmoji: {
    fontSize: 32,
    marginBottom: spacing.sm,
  },
  encouragementTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.text.primary,
    marginBottom: spacing.sm,
    textAlign: 'center',
  },
  encouragementText: {
    fontSize: 14,
    lineHeight: 20,
    color: colors.text.primary,
    textAlign: 'center',
  },
});
