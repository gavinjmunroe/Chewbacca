import React from 'react';
import {
  TouchableOpacity,
  Text,
  StyleSheet,
  ActivityIndicator,
  ViewStyle,
  TextStyle,
  View,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
} from 'react-native-reanimated';
import { colors } from '../constants/colors';
import { spacing } from '../constants/spacing';
import { typography } from '../constants/typography';

const AnimatedTouchable = Animated.createAnimatedComponent(TouchableOpacity);

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'outline' | 'ghost';
export type ButtonSize = 'small' | 'medium' | 'large';

export interface ButtonProps {
  /**
   * Button text content
   */
  title: string;

  /**
   * Button press handler
   */
  onPress: () => void;

  /**
   * Visual variant of the button
   * @default 'primary'
   */
  variant?: ButtonVariant;

  /**
   * Size of the button
   * @default 'medium'
   */
  size?: ButtonSize;

  /**
   * Whether the button is disabled
   * @default false
   */
  disabled?: boolean;

  /**
   * Whether the button is in loading state
   * @default false
   */
  loading?: boolean;

  /**
   * Whether the button takes full width
   * @default false
   */
  fullWidth?: boolean;

  /**
   * Icon component to display before the text
   */
  leftIcon?: React.ReactNode;

  /**
   * Icon component to display after the text
   */
  rightIcon?: React.ReactNode;

  /**
   * Custom style for the button container
   */
  style?: ViewStyle;

  /**
   * Custom style for the button text
   */
  textStyle?: TextStyle;

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

export const Button: React.FC<ButtonProps> = ({
  title,
  onPress,
  variant = 'primary',
  size = 'medium',
  disabled = false,
  loading = false,
  fullWidth = false,
  leftIcon,
  rightIcon,
  style,
  textStyle,
  accessibilityLabel,
  accessibilityHint,
  testID,
}) => {
  const isDisabled = disabled || loading;
  const scale = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const handlePressIn = () => {
    scale.value = withSpring(0.96, { damping: 15, stiffness: 400 });
  };

  const handlePressOut = () => {
    scale.value = withSpring(1, { damping: 15, stiffness: 400 });
  };

  const handlePress = () => {
    if (!isDisabled) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      onPress();
    }
  };

  const getVariantStyles = (): { container: ViewStyle; text: TextStyle } => {
    switch (variant) {
      case 'primary':
        return {
          container: {
            backgroundColor: isDisabled ? colors.neutral.gray300 : colors.primary.main,
          },
          text: {
            color: isDisabled ? colors.text.disabled : colors.primary.contrast,
          },
        };
      case 'secondary':
        return {
          container: {
            backgroundColor: isDisabled ? colors.neutral.gray200 : colors.secondary.main,
          },
          text: {
            color: isDisabled ? colors.text.disabled : colors.secondary.contrast,
          },
        };
      case 'danger':
        return {
          container: {
            backgroundColor: isDisabled ? colors.neutral.gray300 : colors.danger.main,
          },
          text: {
            color: isDisabled ? colors.text.disabled : colors.danger.contrast,
          },
        };
      case 'outline':
        return {
          container: {
            backgroundColor: 'transparent',
            borderWidth: spacing.borderWidth.medium,
            borderColor: isDisabled ? colors.border.light : colors.primary.main,
          },
          text: {
            color: isDisabled ? colors.text.disabled : colors.primary.main,
          },
        };
      case 'ghost':
        return {
          container: {
            backgroundColor: 'transparent',
          },
          text: {
            color: isDisabled ? colors.text.disabled : colors.primary.main,
          },
        };
    }
  };

  const getSizeStyles = (): { container: ViewStyle; text: TextStyle; iconSpacing: number } => {
    switch (size) {
      case 'small':
        return {
          container: {
            paddingVertical: spacing.sm,
            paddingHorizontal: spacing.md,
            minHeight: 36,
          },
          text: typography.buttonSmall,
          iconSpacing: spacing.xs,
        };
      case 'medium':
        return {
          container: {
            paddingVertical: spacing.md,
            paddingHorizontal: spacing.lg,
            minHeight: spacing.touchTarget,
          },
          text: typography.button,
          iconSpacing: spacing.sm,
        };
      case 'large':
        return {
          container: {
            paddingVertical: spacing.lg,
            paddingHorizontal: spacing.xl,
            minHeight: 56,
          },
          text: typography.buttonLarge,
          iconSpacing: spacing.md,
        };
    }
  };

  const variantStyles = getVariantStyles();
  const sizeStyles = getSizeStyles();

  const renderContent = () => {
    if (loading) {
      return (
        <ActivityIndicator
          color={variant === 'outline' || variant === 'ghost' ? colors.primary.main : colors.primary.contrast}
          size={size === 'large' ? 'large' : 'small'}
        />
      );
    }

    return (
      <View style={styles.contentContainer}>
        {leftIcon && (
          <View style={[styles.iconContainer, { marginRight: sizeStyles.iconSpacing }]}>
            {leftIcon}
          </View>
        )}
        <Text
          style={[
            styles.text,
            sizeStyles.text,
            variantStyles.text,
            textStyle,
          ]}
          numberOfLines={1}
        >
          {title}
        </Text>
        {rightIcon && (
          <View style={[styles.iconContainer, { marginLeft: sizeStyles.iconSpacing }]}>
            {rightIcon}
          </View>
        )}
      </View>
    );
  };

  return (
    <AnimatedTouchable
      onPress={handlePress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      disabled={isDisabled}
      activeOpacity={0.9}
      style={[
        styles.container,
        sizeStyles.container,
        variantStyles.container,
        fullWidth && styles.fullWidth,
        isDisabled && styles.disabled,
        animatedStyle,
        style,
      ]}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel || title}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: isDisabled }}
      testID={testID}
    >
      {renderContent()}
    </AnimatedTouchable>
  );
};

const styles = StyleSheet.create({
  container: {
    borderRadius: spacing.radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    overflow: 'hidden',
  },
  contentContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: {
    textAlign: 'center',
  },
  iconContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  fullWidth: {
    width: '100%',
  },
  disabled: {
    opacity: 0.6,
  },
});
