import React, { useState } from 'react';
import {
  View,
  TextInput,
  Text,
  StyleSheet,
  ViewStyle,
  TextStyle,
  TextInputProps,
  TouchableOpacity,
} from 'react-native';
import { colors } from '../constants/colors';
import { spacing } from '../constants/spacing';
import { typography } from '../constants/typography';

export interface InputProps extends Omit<TextInputProps, 'style'> {
  /**
   * Label text displayed above the input
   */
  label?: string;

  /**
   * Error message displayed below the input
   */
  error?: string;

  /**
   * Helper text displayed below the input
   */
  helperText?: string;

  /**
   * Whether the input is disabled
   * @default false
   */
  disabled?: boolean;

  /**
   * Whether the input is required
   * @default false
   */
  required?: boolean;

  /**
   * Icon component to display on the left side
   */
  leftIcon?: React.ReactNode;

  /**
   * Icon component to display on the right side
   */
  rightIcon?: React.ReactNode;

  /**
   * Whether the input is a password field with show/hide toggle
   * @default false
   */
  isPassword?: boolean;

  /**
   * Custom style for the container
   */
  containerStyle?: ViewStyle;

  /**
   * Custom style for the input
   */
  inputStyle?: TextStyle;

  /**
   * Custom style for the label
   */
  labelStyle?: TextStyle;

  /**
   * Test ID for testing
   */
  testID?: string;
}

export const Input: React.FC<InputProps> = ({
  label,
  error,
  helperText,
  disabled = false,
  required = false,
  leftIcon,
  rightIcon,
  isPassword = false,
  containerStyle,
  inputStyle,
  labelStyle,
  testID,
  ...textInputProps
}) => {
  const [isFocused, setIsFocused] = useState(false);
  const [isPasswordVisible, setIsPasswordVisible] = useState(false);

  const hasError = !!error;
  const showHelperText = !hasError && !!helperText;

  const getBorderColor = () => {
    if (hasError) return colors.danger.main;
    if (isFocused) return colors.border.focus;
    return colors.border.main;
  };

  const togglePasswordVisibility = () => {
    setIsPasswordVisible(!isPasswordVisible);
  };

  const renderPasswordToggle = () => {
    if (!isPassword) return null;

    return (
      <TouchableOpacity
        onPress={togglePasswordVisibility}
        style={styles.iconContainer}
        accessibilityRole="button"
        accessibilityLabel={isPasswordVisible ? 'Hide password' : 'Show password'}
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
      >
        <Text style={styles.passwordToggle}>
          {isPasswordVisible ? 'Hide' : 'Show'}
        </Text>
      </TouchableOpacity>
    );
  };

  return (
    <View style={[styles.container, containerStyle]} testID={testID}>
      {label && (
        <View style={styles.labelContainer}>
          <Text style={[styles.label, labelStyle]}>
            {label}
            {required && <Text style={styles.required}> *</Text>}
          </Text>
        </View>
      )}

      <View
        style={[
          styles.inputContainer,
          { borderColor: getBorderColor() },
          disabled && styles.disabled,
          hasError && styles.errorContainer,
        ]}
      >
        {leftIcon && (
          <View style={[styles.iconContainer, styles.leftIcon]}>
            {leftIcon}
          </View>
        )}

        <TextInput
          {...textInputProps}
          style={[
            styles.input,
            typography.body1 as TextStyle,
            leftIcon ? styles.inputWithLeftIcon : null,
            (rightIcon || isPassword) ? styles.inputWithRightIcon : null,
            inputStyle,
          ]}
          placeholderTextColor={colors.text.tertiary}
          editable={!disabled}
          onFocus={(e) => {
            setIsFocused(true);
            textInputProps.onFocus?.(e);
          }}
          onBlur={(e) => {
            setIsFocused(false);
            textInputProps.onBlur?.(e);
          }}
          secureTextEntry={isPassword && !isPasswordVisible}
          accessibilityLabel={label || textInputProps.placeholder}
          accessibilityHint={helperText}
          accessibilityState={{ disabled }}
        />

        {isPassword ? renderPasswordToggle() : rightIcon && (
          <View style={[styles.iconContainer, styles.rightIcon]}>
            {rightIcon}
          </View>
        )}
      </View>

      {hasError && (
        <Text style={styles.errorText} accessibilityRole="alert">
          {error}
        </Text>
      )}

      {showHelperText && (
        <Text style={styles.helperText}>
          {helperText}
        </Text>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    width: '100%',
  },
  labelContainer: {
    marginBottom: spacing.xs,
  },
  label: {
    ...typography.subtitle2,
    color: colors.text.primary,
  },
  required: {
    color: colors.danger.main,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.background.primary,
    borderWidth: spacing.borderWidth.medium,
    borderColor: colors.border.main,
    borderRadius: spacing.radius.md,
    minHeight: spacing.touchTarget,
    paddingHorizontal: spacing.md,
  },
  input: {
    flex: 1,
    color: colors.text.primary,
    paddingVertical: spacing.sm,
  },
  inputWithLeftIcon: {
    paddingLeft: spacing.xs,
  },
  inputWithRightIcon: {
    paddingRight: spacing.xs,
  },
  iconContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  leftIcon: {
    marginRight: spacing.xs,
  },
  rightIcon: {
    marginLeft: spacing.xs,
  },
  passwordToggle: {
    ...typography.subtitle2,
    color: colors.primary.main,
  },
  disabled: {
    backgroundColor: colors.neutral.gray100,
    opacity: 0.6,
  },
  errorContainer: {
    borderColor: colors.danger.main,
  },
  errorText: {
    ...typography.caption,
    color: colors.danger.main,
    marginTop: spacing.xs,
  },
  helperText: {
    ...typography.caption,
    color: colors.text.secondary,
    marginTop: spacing.xs,
  },
});
