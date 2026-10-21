import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  ViewStyle,
  TextStyle,
  Image,
  ImageSourcePropType,
} from 'react-native';
import { colors } from '../constants/colors';
import { spacing } from '../constants/spacing';
import { typography } from '../constants/typography';
import { Button, ButtonProps } from './Button';

export interface EmptyStateProps {
  /**
   * Title text for the empty state
   */
  title: string;

  /**
   * Description text providing more context
   */
  description?: string;

  /**
   * Icon or illustration component to display
   */
  icon?: React.ReactNode;

  /**
   * Image source for illustration
   */
  image?: ImageSourcePropType;

  /**
   * Primary action button configuration
   */
  primaryAction?: {
    title: string;
    onPress: () => void;
  } & Partial<ButtonProps>;

  /**
   * Secondary action button configuration
   */
  secondaryAction?: {
    title: string;
    onPress: () => void;
  } & Partial<ButtonProps>;

  /**
   * Custom style for the container
   */
  style?: ViewStyle;

  /**
   * Custom style for the title
   */
  titleStyle?: TextStyle;

  /**
   * Custom style for the description
   */
  descriptionStyle?: TextStyle;

  /**
   * Test ID for testing
   */
  testID?: string;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  title,
  description,
  icon,
  image,
  primaryAction,
  secondaryAction,
  style,
  titleStyle,
  descriptionStyle,
  testID,
}) => {
  return (
    <View style={[styles.container, style]} testID={testID}>
      <View style={styles.content}>
        {/* Icon or Image */}
        {icon && (
          <View style={styles.iconContainer}>
            {icon}
          </View>
        )}

        {image && (
          <View style={styles.imageContainer}>
            <Image
              source={image}
              style={styles.image}
              resizeMode="contain"
            />
          </View>
        )}

        {/* Text Content */}
        <View style={styles.textContainer}>
          <Text style={[styles.title, titleStyle]}>
            {title}
          </Text>

          {description && (
            <Text style={[styles.description, descriptionStyle]}>
              {description}
            </Text>
          )}
        </View>

        {/* Actions */}
        {(primaryAction || secondaryAction) && (
          <View style={styles.actionsContainer}>
            {primaryAction && (
              <Button
                variant={primaryAction.variant || 'primary'}
                size={primaryAction.size || 'medium'}
                fullWidth
                style={styles.primaryAction}
                {...primaryAction}
              />
            )}

            {secondaryAction && (
              <Button
                variant={secondaryAction.variant || 'outline'}
                size={secondaryAction.size || 'medium'}
                fullWidth
                style={styles.secondaryAction}
                {...secondaryAction}
              />
            )}
          </View>
        )}
      </View>
    </View>
  );
};

/**
 * Compact empty state component for smaller spaces
 */
export interface CompactEmptyStateProps {
  /**
   * Message text
   */
  message: string;

  /**
   * Optional icon component
   */
  icon?: React.ReactNode;

  /**
   * Optional action button
   */
  action?: {
    title: string;
    onPress: () => void;
  };

  /**
   * Custom style for the container
   */
  style?: ViewStyle;

  /**
   * Test ID for testing
   */
  testID?: string;
}

export const CompactEmptyState: React.FC<CompactEmptyStateProps> = ({
  message,
  icon,
  action,
  style,
  testID,
}) => {
  return (
    <View style={[styles.compactContainer, style]} testID={testID}>
      {icon && (
        <View style={styles.compactIcon}>
          {icon}
        </View>
      )}

      <Text style={styles.compactMessage}>
        {message}
      </Text>

      {action && (
        <Button
          title={action.title}
          onPress={action.onPress}
          variant="ghost"
          size="small"
          style={styles.compactAction}
        />
      )}
    </View>
  );
};

/**
 * Error state component for displaying errors
 */
export interface ErrorStateProps {
  /**
   * Error title
   */
  title?: string;

  /**
   * Error message
   */
  message: string;

  /**
   * Optional error icon
   */
  icon?: React.ReactNode;

  /**
   * Retry action
   */
  onRetry?: () => void;

  /**
   * Retry button text
   * @default 'Try Again'
   */
  retryText?: string;

  /**
   * Custom style for the container
   */
  style?: ViewStyle;

  /**
   * Test ID for testing
   */
  testID?: string;
}

export const ErrorState: React.FC<ErrorStateProps> = ({
  title = 'Something went wrong',
  message,
  icon,
  onRetry,
  retryText = 'Try Again',
  style,
  testID,
}) => {
  return (
    <View style={[styles.container, style]} testID={testID}>
      <View style={styles.content}>
        {icon && (
          <View style={styles.iconContainer}>
            {icon}
          </View>
        )}

        <View style={styles.textContainer}>
          <Text style={[styles.title, styles.errorTitle]}>
            {title}
          </Text>

          <Text style={styles.description}>
            {message}
          </Text>
        </View>

        {onRetry && (
          <View style={styles.actionsContainer}>
            <Button
              title={retryText}
              onPress={onRetry}
              variant="primary"
              size="medium"
              fullWidth
            />
          </View>
        )}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.screenPadding,
    backgroundColor: colors.background.primary,
  },
  content: {
    alignItems: 'center',
    justifyContent: 'center',
    maxWidth: 400,
    width: '100%',
  },
  iconContainer: {
    marginBottom: spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  imageContainer: {
    marginBottom: spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    maxWidth: 300,
    aspectRatio: 1,
  },
  image: {
    width: '100%',
    height: '100%',
  },
  textContainer: {
    alignItems: 'center',
    marginBottom: spacing.xl,
  },
  title: {
    ...typography.heading3,
    color: colors.text.primary,
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  description: {
    ...typography.body1,
    color: colors.text.secondary,
    textAlign: 'center',
    lineHeight: 24,
  },
  errorTitle: {
    color: colors.danger.main,
  },
  actionsContainer: {
    width: '100%',
    gap: spacing.md,
  },
  primaryAction: {
    marginBottom: spacing.sm,
  },
  secondaryAction: {
    // No additional styles needed
  },
  compactContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xl,
    paddingHorizontal: spacing.lg,
  },
  compactIcon: {
    marginBottom: spacing.md,
  },
  compactMessage: {
    ...typography.body2,
    color: colors.text.secondary,
    textAlign: 'center',
    marginBottom: spacing.md,
  },
  compactAction: {
    marginTop: spacing.sm,
  },
});
