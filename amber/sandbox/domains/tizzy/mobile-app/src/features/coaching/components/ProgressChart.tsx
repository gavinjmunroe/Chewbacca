import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { SymbolView } from 'expo-symbols';
import { colors } from '../../../shared/constants/colors';
import { spacing } from '../../../shared/constants/spacing';

export interface MetricData {
  label: string;
  value: number; // 0-100
  color: string;
}

export interface ProgressChartProps {
  title: string;
  metrics: MetricData[];
  showPercentages?: boolean;
}

/**
 * Simple progress chart component using text-based bars
 * Displays metrics as horizontal bars with labels and values
 */
export function ProgressChart({ title, metrics, showPercentages = true }: ProgressChartProps) {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>{title}</Text>

      <View style={styles.metricsContainer}>
        {metrics.map((metric, index) => (
          <MetricBar
            key={index}
            label={metric.label}
            value={metric.value}
            color={metric.color}
            showPercentage={showPercentages}
          />
        ))}
      </View>
    </View>
  );
}

interface MetricBarProps {
  label: string;
  value: number;
  color: string;
  showPercentage: boolean;
}

function MetricBar({ label, value, color, showPercentage }: MetricBarProps) {
  // Clamp value between 0 and 100
  const normalizedValue = Math.max(0, Math.min(100, value));
  const barWidth = normalizedValue;

  return (
    <View style={styles.metricContainer}>
      <View style={styles.metricHeader}>
        <Text style={styles.metricLabel}>{label}</Text>
        {showPercentage && (
          <Text style={styles.metricValue}>{normalizedValue}%</Text>
        )}
      </View>

      <View style={styles.barContainer}>
        <View style={styles.barBackground}>
          <View
            style={[
              styles.barFill,
              {
                width: `${barWidth}%`,
                backgroundColor: color,
              },
            ]}
          />
        </View>
      </View>
    </View>
  );
}

/**
 * Weekly progress summary component
 */
export interface WeeklyProgressProps {
  sessionsCompleted: number;
  totalMinutes: number;
  trend: 'improving' | 'stable' | 'needs_attention';
}

export function WeeklyProgress({ sessionsCompleted, totalMinutes, trend }: WeeklyProgressProps) {
  const trendConfig = {
    improving: {
      symbol: 'chart.line.uptrend.xyaxis',
      text: 'Great progress!',
      color: colors.success.main,
    },
    stable: {
      symbol: 'arrow.right',
      text: 'Staying consistent',
      color: colors.info.main,
    },
    needs_attention: {
      symbol: 'figure.strengthtraining.traditional',
      text: 'Keep going!',
      color: colors.warning.main,
    },
  };

  const config = trendConfig[trend];

  return (
    <View style={styles.weeklyContainer}>
      <Text style={styles.weeklyTitle}>This Week</Text>

      <View style={styles.statsRow}>
        <View style={styles.statCard}>
          <Text style={styles.statValue}>{sessionsCompleted}</Text>
          <Text style={styles.statLabel}>Sessions</Text>
        </View>

        <View style={styles.statCard}>
          <Text style={styles.statValue}>{totalMinutes}</Text>
          <Text style={styles.statLabel}>Minutes</Text>
        </View>
      </View>

      <View style={[styles.trendBadge, { backgroundColor: config.color + '20', borderColor: config.color }]}>
        <SymbolView
          name={config.symbol}
          size={18}
          tintColor={config.color}
          style={styles.trendSymbol}
        />
        <Text style={[styles.trendText, { color: config.color }]}>{config.text}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.background.primary,
    borderRadius: spacing.radius.md,
    borderWidth: spacing.borderWidth.thin,
    borderColor: colors.border.light,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  title: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.text.primary,
    marginBottom: spacing.md,
  },
  metricsContainer: {
    gap: spacing.md,
  },
  metricContainer: {
    marginBottom: spacing.sm,
  },
  metricHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  metricLabel: {
    fontSize: 14,
    fontWeight: '500',
    color: colors.text.primary,
  },
  metricValue: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text.secondary,
  },
  barContainer: {
    width: '100%',
  },
  barBackground: {
    height: 8,
    backgroundColor: colors.neutral.gray200,
    borderRadius: spacing.radius.xs,
    overflow: 'hidden',
  },
  barFill: {
    height: '100%',
    borderRadius: spacing.radius.xs,
  },
  weeklyContainer: {
    backgroundColor: colors.background.secondary,
    borderRadius: spacing.radius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  weeklyTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.text.primary,
    marginBottom: spacing.md,
  },
  statsRow: {
    flexDirection: 'row',
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  statCard: {
    flex: 1,
    backgroundColor: colors.background.primary,
    borderRadius: spacing.radius.sm,
    padding: spacing.md,
    alignItems: 'center',
  },
  statValue: {
    fontSize: 28,
    fontWeight: '700',
    color: colors.primary.main,
    marginBottom: spacing.xs,
  },
  statLabel: {
    fontSize: 12,
    fontWeight: '500',
    color: colors.text.secondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  trendBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: spacing.radius.sm,
    borderWidth: spacing.borderWidth.thin,
  },
  trendSymbol: {
    marginRight: spacing.xs,
  },
  trendText: {
    fontSize: 15,
    fontWeight: '600',
  },
});
