import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { SymbolView } from 'expo-symbols';
import { colors } from '../../../shared/constants/colors';
import { spacing } from '../../../shared/constants/spacing';

export interface MicroGoalData {
  title: string;
  description: string;
  target_date: string;
}

export interface MicroGoalProps {
  goal: MicroGoalData;
  compact?: boolean;
}

/**
 * Micro-goal display component
 * Shows actionable, encouraging goal for the user's next session
 */
export function MicroGoal({ goal, compact = false }: MicroGoalProps) {
  const targetDate = new Date(goal.target_date);
  const isToday = isDateToday(targetDate);
  const isTomorrow = isDateTomorrow(targetDate);

  let dateLabel = 'Upcoming';
  if (isToday) {
    dateLabel = 'Today';
  } else if (isTomorrow) {
    dateLabel = 'Tomorrow';
  }

  if (compact) {
    return (
      <View style={styles.compactContainer}>
        <View style={styles.compactHeader}>
          <SymbolView
            name="target"
            size={18}
            tintColor={colors.accent.main}
          />
          <Text style={styles.compactTitle}>{goal.title}</Text>
        </View>
        <Text style={styles.compactDescription} numberOfLines={2}>
          {goal.description}
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.badge}>
          <SymbolView
            name="target"
            size={24}
            tintColor={colors.background.primary}
          />
        </View>
        <View style={styles.headerText}>
          <Text style={styles.label}>Your Next Goal</Text>
          <Text style={styles.dateLabel}>{dateLabel}</Text>
        </View>
      </View>

      <View style={styles.content}>
        <Text style={styles.title}>{goal.title}</Text>
        <Text style={styles.description}>{goal.description}</Text>
      </View>

      <View style={styles.encouragement}>
        <Text style={styles.encouragementText}>
          You've got this! Small steps lead to big improvements.
        </Text>
      </View>
    </View>
  );
}

/**
 * Helper function to check if date is today
 */
function isDateToday(date: Date): boolean {
  const today = new Date();
  return (
    date.getDate() === today.getDate() &&
    date.getMonth() === today.getMonth() &&
    date.getFullYear() === today.getFullYear()
  );
}

/**
 * Helper function to check if date is tomorrow
 */
function isDateTomorrow(date: Date): boolean {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  return (
    date.getDate() === tomorrow.getDate() &&
    date.getMonth() === tomorrow.getMonth() &&
    date.getFullYear() === tomorrow.getFullYear()
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.accent.light,
    borderRadius: spacing.radius.md,
    borderWidth: spacing.borderWidth.medium,
    borderColor: colors.accent.main,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  badge: {
    width: 48,
    height: 48,
    backgroundColor: colors.accent.main,
    borderRadius: spacing.radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  headerText: {
    flex: 1,
  },
  label: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.accent.dark,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: spacing.xs,
  },
  dateLabel: {
    fontSize: 14,
    fontWeight: '500',
    color: colors.text.primary,
  },
  content: {
    marginBottom: spacing.md,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.text.primary,
    marginBottom: spacing.sm,
    lineHeight: 26,
  },
  description: {
    fontSize: 15,
    lineHeight: 22,
    color: colors.text.primary,
  },
  encouragement: {
    backgroundColor: colors.background.primary,
    borderRadius: spacing.radius.sm,
    padding: spacing.md,
    borderLeftWidth: 3,
    borderLeftColor: colors.accent.main,
  },
  encouragementText: {
    fontSize: 14,
    fontStyle: 'italic',
    color: colors.text.secondary,
    lineHeight: 20,
  },
  compactContainer: {
    backgroundColor: colors.accent.light,
    borderRadius: spacing.radius.sm,
    borderWidth: spacing.borderWidth.thin,
    borderColor: colors.accent.main,
    padding: spacing.md,
  },
  compactHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.xs,
    gap: spacing.xs,
  },
  compactTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.text.primary,
    flex: 1,
  },
  compactDescription: {
    fontSize: 13,
    lineHeight: 18,
    color: colors.text.secondary,
  },
});
