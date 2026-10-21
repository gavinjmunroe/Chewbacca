/**
 * Error View Component
 * Reusable component for displaying errors with retry functionality
 */

import React from 'react';
import { View, Text, StyleSheet, ViewStyle } from 'react-native';
import { SymbolView } from 'expo-symbols';
import { colors } from '../constants/colors';
import { spacing } from '../constants/spacing';
import { typography } from '../constants/typography';
import { Button } from './Button';
import { formatErrorForDisplay } from '../utils/errorHandling';

interface ErrorViewProps {
  /**
   * The error to display
   */
  error: any;

  /**
   * Callback when retry is pressed
   */
  onRetry?: () => void;

  /**
   * Is currently retrying
   */
  isRetrying?: boolean;

  /**
   * Custom title
   */
  title?: string;

  /**
   * Custom message
   */
  message?: string;

  /**
   * Show retry button
   */
  showRetry?: boolean;

  /**
   * Retry button text
   */
  retryText?: string;

  /**
   * Additional action button
   */
  actionButton?: {
    text: string;
    onPress: () => void;
    variant?: 'primary' | 'secondary' | 'outline';
  };

  /**
   * Style variant
   */
  variant?: 'default' | 'inline' | 'card';

  /**
   * Custom container style
   */
  style?: ViewStyle;

  /**
   * Test ID
   */
  testID?: string;
}

/**
 * Error View Component
 *
 * Displays user-friendly error messages with optional retry functionality.
 *
 * @example
 * ```tsx
 * <ErrorView
 *   error={error}
 *   onRetry={handleRetry}
 *   isRetrying={isRetrying}
 * />
 * ```
 */
export const ErrorView: React.FC<ErrorViewProps> = ({
  error,
  onRetry,
  isRetrying = false,
  title,
  message,
  showRetry = true,
  retryText = 'Try Again',
  actionButton,
  variant = 'default',
  style,
  testID = 'error-view',
}) => {
  const errorDisplay = formatErrorForDisplay(error);
  const canRetry = showRetry && errorDisplay.canRetry && onRetry;

  const containerStyles = [
    styles.container,
    variant === 'inline' && styles.containerInline,
    variant === 'card' && styles.containerCard,
    style,
  ];

  const getIcon = () => {
    if (isRetrying) return 'arrow.circlepath';

    if (errorDisplay.title.includes('Connection')) return 'antenna.radiowaves.left.and.right';
    if (errorDisplay.title.includes('Authentication')) return 'lock.fill';
    if (errorDisplay.title.includes('Bluetooth')) return 'wifi';
    if (errorDisplay.title.includes('Permission')) return 'key.fill';
    if (errorDisplay.title.includes('Network')) return 'globe';

    return 'exclamationmark.triangle.fill';
  };

  return (
    <View style={containerStyles} testID={testID}>
      {variant !== 'inline' && (
        <View style={styles.iconContainer}>
          <SymbolView
            name={getIcon()}
            size={48}
            type="hierarchical"
            tintColor={colors.text.secondary}
          />
        </View>
      )}

      <Text style={[styles.title, variant === 'inline' && styles.titleInline]}>
        {title || errorDisplay.title}
      </Text>

      <Text style={[styles.message, variant === 'inline' && styles.messageInline]}>
        {message || errorDisplay.message}
      </Text>

      {errorDisplay.suggestion && !isRetrying && (
        <View style={styles.suggestionContainer}>
          <Text style={styles.suggestionTitle}>What to do:</Text>
          <Text style={styles.suggestion}>{errorDisplay.suggestion}</Text>
        </View>
      )}

      {isRetrying && (
        <View style={styles.retryingContainer}>
          <Text style={styles.retryingText}>Retrying...</Text>
        </View>
      )}

      <View style={styles.buttonContainer}>
        {canRetry && (
          <Button
            title={retryText}
            onPress={onRetry}
            variant="primary"
            size={variant === 'inline' ? 'medium' : 'large'}
            fullWidth={variant !== 'inline'}
            disabled={isRetrying}
            loading={isRetrying}
            testID={`${testID}-retry-button`}
            style={variant === 'inline' ? undefined : styles.button}
          />
        )}

        {actionButton && (
          <Button
            title={actionButton.text}
            onPress={actionButton.onPress}
            variant={actionButton.variant || 'secondary'}
            size={variant === 'inline' ? 'medium' : 'large'}
            fullWidth={variant !== 'inline'}
            testID={`${testID}-action-button`}
            style={variant === 'inline' ? undefined : styles.button}
          />
        )}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    padding: spacing.xl,
    alignItems: 'center',
  },
  containerInline: {
    padding: spacing.md,
    alignItems: 'flex-start',
  },
  containerCard: {
    backgroundColor: colors.background.secondary,
    borderRadius: spacing.radius.lg,
    borderWidth: 1,
    borderColor: colors.border.light,
  },
  iconContainer: {
    marginBottom: spacing.lg,
  },
  title: {
    ...typography.heading3,
    color: colors.text.primary,
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  titleInline: {
    ...typography.subtitle1,
    textAlign: 'left',
  },
  message: {
    ...typography.body1,
    color: colors.text.secondary,
    textAlign: 'center',
    marginBottom: spacing.md,
  },
  messageInline: {
    ...typography.body2,
    textAlign: 'left',
  },
  suggestionContainer: {
    backgroundColor: colors.primary.light,
    borderRadius: spacing.radius.md,
    padding: spacing.md,
    marginBottom: spacing.lg,
    width: '100%',
  },
  suggestionTitle: {
    ...typography.subtitle2,
    color: colors.primary.dark,
    marginBottom: spacing.xs,
    fontWeight: '600',
  },
  suggestion: {
    ...typography.body2,
    color: colors.primary.dark,
  },
  retryingContainer: {
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  retryingText: {
    ...typography.body1,
    color: colors.text.tertiary,
    textAlign: 'center',
    fontStyle: 'italic',
  },
  buttonContainer: {
    width: '100%',
    gap: spacing.md,
  },
  button: {
    marginBottom: spacing.sm,
  },
});
