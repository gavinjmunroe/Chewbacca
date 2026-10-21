import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  ViewStyle,
  TouchableOpacity,
  TouchableOpacityProps,
} from 'react-native';
import { colors } from '../constants/colors';
import { spacing } from '../constants/spacing';

export type CardVariant = 'elevated' | 'outlined' | 'flat';

export interface CardProps {
  /**
   * Content to display inside the card
   */
  children: React.ReactNode;

  /**
   * Visual variant of the card
   * @default 'elevated'
   */
  variant?: CardVariant;

  /**
   * Whether the card is pressable
   * @default false
   */
  pressable?: boolean;

  /**
   * Press handler when card is pressable
   */
  onPress?: () => void;

  /**
   * Whether the card is disabled (only applies when pressable)
   * @default false
   */
  disabled?: boolean;

  /**
   * Custom padding inside the card
   */
  padding?: number;

  /**
   * Custom style for the card container
   */
  style?: ViewStyle;

  /**
   * Accessibility label for screen readers
   */
  accessibilityLabel?: string;

  /**
   * Accessibility hint for screen readers
   */
  accessibilityHint?: string;

  /**
   * Test ID for testing
   */
  testID?: string;
}

export const Card: React.FC<CardProps> = ({
  children,
  variant = 'elevated',
  pressable = false,
  onPress,
  disabled = false,
  padding = spacing.cardPadding,
  style,
  accessibilityLabel,
  accessibilityHint,
  testID,
}) => {
  const getVariantStyles = (): ViewStyle => {
    switch (variant) {
      case 'elevated':
        return {
          backgroundColor: colors.background.primary,
          boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
        };
      case 'outlined':
        return {
          backgroundColor: colors.background.primary,
          borderWidth: spacing.borderWidth.thin,
          borderColor: colors.border.light,
        };
      case 'flat':
        return {
          backgroundColor: colors.background.secondary,
        };
    }
  };

  const cardStyle: ViewStyle = {
    ...getVariantStyles(),
    padding,
  };

  if (pressable && onPress) {
    return (
      <TouchableOpacity
        onPress={onPress}
        disabled={disabled}
        activeOpacity={0.7}
        style={[styles.container, cardStyle, disabled && styles.disabled, style]}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        accessibilityHint={accessibilityHint}
        accessibilityState={{ disabled }}
        testID={testID}
      >
        {children}
      </TouchableOpacity>
    );
  }

  return (
    <View
      style={[styles.container, cardStyle, style]}
      accessibilityLabel={accessibilityLabel}
      testID={testID}
    >
      {children}
    </View>
  );
};

/**
 * Card header component for consistent card headers
 */
export interface CardHeaderProps {
  /**
   * Title text
   */
  title: string;

  /**
   * Optional subtitle text
   */
  subtitle?: string;

  /**
   * Optional icon or component to display on the left
   */
  leftContent?: React.ReactNode;

  /**
   * Optional action or component to display on the right
   */
  rightContent?: React.ReactNode;

  /**
   * Custom style for the header container
   */
  style?: ViewStyle;
}

export const CardHeader: React.FC<CardHeaderProps> = ({
  title,
  subtitle,
  leftContent,
  rightContent,
  style,
}) => {
  return (
    <View style={[styles.header, style]}>
      {leftContent && (
        <View style={styles.headerLeft}>
          {leftContent}
        </View>
      )}
      <View style={styles.headerContent}>
        <Text style={styles.headerTitle}>{title}</Text>
        {subtitle && (
          <Text style={styles.headerSubtitle}>{subtitle}</Text>
        )}
      </View>
      {rightContent && (
        <View style={styles.headerRight}>
          {rightContent}
        </View>
      )}
    </View>
  );
};

/**
 * Card content component for consistent card body content
 */
export interface CardContentProps {
  /**
   * Content to display
   */
  children: React.ReactNode;

  /**
   * Custom style for the content container
   */
  style?: ViewStyle;
}

export const CardContent: React.FC<CardContentProps> = ({ children, style }) => {
  return (
    <View style={[styles.content, style]}>
      {children}
    </View>
  );
};

/**
 * Card footer component for consistent card footers
 */
export interface CardFooterProps {
  /**
   * Content to display
   */
  children: React.ReactNode;

  /**
   * Custom style for the footer container
   */
  style?: ViewStyle;
}

export const CardFooter: React.FC<CardFooterProps> = ({ children, style }) => {
  return (
    <View style={[styles.footer, style]}>
      {children}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    borderRadius: spacing.radius.lg,
    overflow: 'hidden',
  },
  disabled: {
    opacity: 0.6,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  headerLeft: {
    marginRight: spacing.md,
  },
  headerContent: {
    flex: 1,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.text.primary,
    marginBottom: spacing.xs,
  },
  headerSubtitle: {
    fontSize: 14,
    color: colors.text.secondary,
  },
  headerRight: {
    marginLeft: spacing.md,
  },
  content: {
    // No default styles, fully customizable
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: spacing.borderWidth.thin,
    borderTopColor: colors.border.light,
  },
});
