import { useState } from 'react';
import {
  TextInput as RNTextInput,
  Text,
  View,
  type TextInputProps as RNProps,
  type TextStyle,
  useWindowDimensions,
} from 'react-native';
import { colors, fonts, fontScale, radius, spacing, typography } from '../lib/tokens';

type Props = Omit<RNProps, 'style'> & {
  label?: string;
  error?: string;
  helperText?: string;
  // Optional overrides merged onto the field (used by SearchInput to make room
  // for the leading icon and trailing clear button).
  style?: TextStyle;
};

export function TextInput({ label, error, helperText, style, ...rest }: Props) {
  const { fontScale: deviceScale } = useWindowDimensions();
  const [focused, setFocused] = useState(false);
  // Visible focus state: the border thickens and shifts to ink on focus so
  // keyboard and switch-control users can see where they are.
  const borderColor = error ? colors.errorText : focused ? colors.ink : colors.hairline;
  const borderWidth = 1;

  // Hoist placeholderTextColor out of rest so callers can override it; spreading
  // rest after setting it would have silently clobbered the caller's value.
  const { placeholderTextColor, ...spreadRest } = rest;

  return (
    <View style={{ gap: spacing.xs }}>
      {label ? (
        <Text
          allowFontScaling
          maxFontSizeMultiplier={fontScale.maxBody}
          style={{ ...typography.caption, fontFamily: fonts.regular, color: colors.muted }}
        >
          {label}
        </Text>
      ) : null}
      <RNTextInput
        allowFontScaling
        maxFontSizeMultiplier={fontScale.maxBody}
        accessibilityLabel={label}
        {...spreadRest}
        onFocus={(e) => {
          setFocused(true);
          rest.onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          rest.onBlur?.(e);
        }}
        placeholderTextColor={placeholderTextColor ?? colors.mutedSoft}
        style={{
          fontFamily: fonts.regular,
          fontSize: 16,
          includeFontPadding: true,
          textAlignVertical: rest.multiline ? 'top' : 'center',
          color: colors.ink,
          backgroundColor: colors.canvas,
          borderRadius: radius.sm,
          borderWidth,
          borderColor,
          paddingHorizontal: 12,
          paddingVertical: 14,
          minHeight: Math.max(56, 24 * Math.min(deviceScale, fontScale.maxBody) + 30),
          ...style,
        }}
      />
      {error ? (
        <Text style={{ ...typography.bodySm, color: colors.errorText }} accessibilityRole="alert">
          {error}
        </Text>
      ) : helperText ? (
        <Text style={{ ...typography.bodySm, color: colors.muted }}>{helperText}</Text>
      ) : null}
    </View>
  );
}
