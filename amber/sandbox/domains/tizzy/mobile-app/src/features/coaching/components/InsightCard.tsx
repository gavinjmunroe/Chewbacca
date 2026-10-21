import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { SymbolView } from 'expo-symbols';
import { colors } from '../../../shared/constants/colors';
import { spacing } from '../../../shared/constants/spacing';

export type InsightType = 'positive' | 'growth';

export interface InsightCardProps {
  type: InsightType;
  insights: string[];
}

/**
 * Card component to display coaching insights
 * - Positive insights: What went well
 * - Growth insights: What to improve
 */
export function InsightCard({ type, insights }: InsightCardProps) {
  const isPositive = type === 'positive';

  const config = isPositive
    ? {
        title: 'What Went Well',
        symbolName: 'sparkles',
        backgroundColor: colors.success.light,
        borderColor: colors.success.main,
        iconBackground: colors.success.main,
      }
    : {
        title: 'Opportunities to Grow',
        symbolName: 'leaf.fill',
        backgroundColor: colors.info.light,
        borderColor: colors.info.main,
        iconBackground: colors.info.main,
      };

  if (insights.length === 0) {
    return null;
  }

  return (
    <View style={[styles.card, { backgroundColor: config.backgroundColor, borderColor: config.borderColor }]}>
      <View style={styles.header}>
        <View style={[styles.iconContainer, { backgroundColor: config.iconBackground }]}>
          <SymbolView name={config.symbolName} size={20} tintColor={colors.white} />
        </View>
        <Text style={styles.title}>{config.title}</Text>
      </View>

      <View style={styles.insightsList}>
        {insights.map((insight, index) => (
          <View key={index} style={styles.insightItem}>
            <View style={styles.bullet}>
              <Text style={styles.bulletText}>•</Text>
            </View>
            <Text style={styles.insightText}>{insight}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: spacing.radius.md,
    borderWidth: spacing.borderWidth.medium,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  iconContainer: {
    width: 36,
    height: 36,
    borderRadius: spacing.radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.sm,
  },
  title: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.text.primary,
    flex: 1,
  },
  insightsList: {
    gap: spacing.sm,
  },
  insightItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  bullet: {
    width: 20,
    marginTop: 2,
  },
  bulletText: {
    fontSize: 16,
    color: colors.text.primary,
    fontWeight: '600',
  },
  insightText: {
    flex: 1,
    fontSize: 15,
    lineHeight: 22,
    color: colors.text.primary,
  },
});
