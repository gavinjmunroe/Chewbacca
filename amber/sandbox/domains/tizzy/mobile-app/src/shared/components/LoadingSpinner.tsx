import React from 'react';
import {
  View,
  ActivityIndicator,
  Text,
  StyleSheet,
  ViewStyle,
  TextStyle,
} from 'react-native';
import { colors } from '../constants/colors';
import { spacing } from '../constants/spacing';
import { typography } from '../constants/typography';

export type LoadingSpinnerSize = 'small' | 'medium' | 'large';
export type LoadingSpinnerColor = 'primary' | 'secondary' | 'white';

export interface LoadingSpinnerProps {
  /**
   * Size of the spinner
   * @default 'medium'
   */
  size?: LoadingSpinnerSize;

  /**
   * Color variant of the spinner
   * @default 'primary'
   */
  color?: LoadingSpinnerColor;

  /**
   * Optional text to display below the spinner
   */
  text?: string;

  /**
   * Whether to display as fullscreen overlay
   * @default false
   */
  fullscreen?: boolean;

  /**
   * Custom style for the container
   */
  style?: ViewStyle;

  /**
   * Custom style for the text
   */
  textStyle?: TextStyle;

  /**
   * Test ID for testing
   */
  testID?: string;
}

export const LoadingSpinner: React.FC<LoadingSpinnerProps> = ({
  size = 'medium',
  color = 'primary',
  text,
  fullscreen = false,
  style,
  textStyle,
  testID,
}) => {
  const getSpinnerSize = (): 'small' | 'large' => {
    switch (size) {
      case 'small':
        return 'small';
      case 'medium':
      case 'large':
        return 'large';
    }
  };

  const getSpinnerColor = (): string => {
    switch (color) {
      case 'primary':
        return colors.primary.main;
      case 'secondary':
        return colors.secondary.main;
      case 'white':
        return colors.neutral.white;
    }
  };

  const content = (
    <View
      style={[
        styles.container,
        fullscreen && styles.fullscreenContainer,
        style,
      ]}
      testID={testID}
    >
      <ActivityIndicator
        size={getSpinnerSize()}
        color={getSpinnerColor()}
        accessibilityLabel="Loading"
      />
      {text && (
        <Text
          style={[
            styles.text,
            color === 'white' && styles.whiteText,
            textStyle,
          ]}
        >
          {text}
        </Text>
      )}
    </View>
  );

  if (fullscreen) {
    return (
      <View style={styles.fullscreenOverlay}>
        {content}
      </View>
    );
  }

  return content;
};

/**
 * Loading overlay component for displaying a loading state over content
 */
export interface LoadingOverlayProps extends Omit<LoadingSpinnerProps, 'fullscreen'> {
  /**
   * Whether the overlay is visible
   */
  visible: boolean;

  /**
   * Background color of the overlay
   */
  backgroundColor?: string;

  /**
   * Opacity of the overlay background
   * @default 0.7
   */
  opacity?: number;
}

export const LoadingOverlay: React.FC<LoadingOverlayProps> = ({
  visible,
  backgroundColor = colors.overlay.main,
  opacity = 0.7,
  size = 'large',
  color = 'white',
  text,
  style,
  textStyle,
  testID,
}) => {
  if (!visible) return null;

  return (
    <View
      style={[
        styles.overlayContainer,
        { backgroundColor, opacity },
      ]}
      testID={testID}
    >
      <LoadingSpinner
        size={size}
        color={color}
        text={text}
        style={style}
        textStyle={textStyle}
      />
    </View>
  );
};

/**
 * Inline loading component for displaying loading state inline with content
 */
export interface InlineLoadingProps {
  /**
   * Loading text to display
   */
  text?: string;

  /**
   * Size of the spinner
   * @default 'small'
   */
  size?: LoadingSpinnerSize;

  /**
   * Color variant of the spinner
   * @default 'primary'
   */
  color?: LoadingSpinnerColor;

  /**
   * Custom style for the container
   */
  style?: ViewStyle;

  /**
   * Test ID for testing
   */
  testID?: string;
}

export const InlineLoading: React.FC<InlineLoadingProps> = ({
  text = 'Loading...',
  size = 'small',
  color = 'primary',
  style,
  testID,
}) => {
  return (
    <View style={[styles.inlineContainer, style]} testID={testID}>
      <ActivityIndicator
        size={size === 'small' ? 'small' : 'large'}
        color={color === 'primary' ? colors.primary.main : colors.secondary.main}
      />
      <Text style={styles.inlineText}>{text}</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  fullscreenContainer: {
    flex: 1,
  },
  fullscreenOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.background.primary,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 9999,
  },
  overlayContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 9999,
  },
  text: {
    ...typography.body2,
    color: colors.text.secondary,
    marginTop: spacing.md,
    textAlign: 'center',
  },
  whiteText: {
    color: colors.text.inverse,
  },
  inlineContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.sm,
  },
  inlineText: {
    ...typography.body2,
    color: colors.text.secondary,
    marginLeft: spacing.sm,
  },
});
