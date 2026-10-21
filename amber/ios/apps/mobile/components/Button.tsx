import { useRef, useState } from 'react';
import { ActivityIndicator, Animated, Pressable, Text, View, type ViewStyle } from 'react-native';
import { colors, control, press, radius, spacing, typography } from '../lib/tokens';
import { HAIRLINE, cl, clRadius } from '../lib/classical';
import { haptics } from './haptics';
import { useReducedMotion } from './useReducedMotion';

type Variant = 'primary' | 'secondary' | 'tertiary' | 'pill';

type ButtonProps = {
  label: string;
  onPress?: () => void;
  variant?: Variant;
  disabled?: boolean;
  loading?: boolean;
  fullWidth?: boolean;
  accessibilityLabel?: string;
  // Suppress the tap haptic when the press itself already produces a stronger
  // signal elsewhere (a sheet open, a navigation push that haptics on arrival).
  haptic?: boolean;
  // Optional color overrides — when omitted the component renders exactly as it
  // does today (colors.primary bg, colors.onPrimary text). Only applied when the
  // button is enabled; disabled state always uses its own muted treatment.
  backgroundColor?: string;
  textColor?: string;
};

export function Button({
  label,
  onPress,
  variant = 'primary',
  disabled = false,
  loading = false,
  fullWidth = false,
  accessibilityLabel,
  haptic = true,
  backgroundColor,
  textColor: labelColor,
}: ButtonProps) {
  const isDisabled = disabled || loading;
  // Apply color overrides only when enabled; disabled keeps its muted treatment.
  const resolvedBg = !isDisabled && backgroundColor ? backgroundColor : undefined;
  const resolvedLabel = !isDisabled && labelColor ? labelColor : undefined;
  const reduceMotion = useReducedMotion();
  const scale = useRef(new Animated.Value(1)).current;
  const focusOpacity = useRef(new Animated.Value(0)).current;

  const [pressed, setPressed] = useState(false);

  const pressIn = () => {
    setPressed(true);
    if (reduceMotion) return;
    Animated.timing(scale, {
      toValue: press.scale,
      duration: press.durationIn,
      useNativeDriver: true,
    }).start();
  };
  const pressOut = () => {
    setPressed(false);
    Animated.timing(scale, {
      toValue: 1,
      duration: press.durationOut,
      useNativeDriver: true,
    }).start();
  };
  const handlePress = () => {
    if (isDisabled) return;
    if (haptic) haptics.tap();
    onPress?.();
  };

  return (
    <View style={{ alignSelf: fullWidth ? 'stretch' : 'flex-start' }}>
      <Animated.View style={{ transform: [{ scale }], opacity: pressed && !isDisabled ? 0.72 : 1 }}>
        <Pressable
          onPress={isDisabled ? undefined : handlePress}
          onPressIn={isDisabled ? undefined : pressIn}
          onPressOut={isDisabled ? undefined : pressOut}
          onFocus={() => focusOpacity.setValue(1)}
          onBlur={() => focusOpacity.setValue(0)}
          accessibilityRole="button"
          accessibilityLabel={accessibilityLabel ?? label}
          accessibilityState={{ disabled: isDisabled, busy: loading }}
          hitSlop={control.hitSlop}
          style={{ ...surfaceStyle(variant, isDisabled), ...(resolvedBg ? { backgroundColor: resolvedBg } : {}) }}
        >
          {loading ? (
            <ActivityIndicator color={resolvedLabel ?? textColor(variant, isDisabled)} />
          ) : (
            <Text
              allowFontScaling
              maxFontSizeMultiplier={1.25}
              style={{
                ...typography.buttonMd,
                fontFamily: 'Newsreader_600SemiBold',
                color: resolvedLabel ?? textColor(variant, isDisabled),
              }}
            >
              {label}
            </Text>
          )}
          <Animated.View
            pointerEvents="none"
            style={[focusRingStyle(variant), { opacity: focusOpacity }]}
          />
        </Pressable>
      </Animated.View>
    </View>
  );
}

// The Classical primary action is an accent OUTLINE on a warm tint, not a solid
// fill — the reference is explicit: "Do not fill cards or buttons with solid
// accent color", and every filled button in the mockups is the gold-edged pill.
function bgColor(variant: Variant, disabled: boolean): string {
  if (variant === 'primary' || variant === 'pill') {
    if (disabled) return colors.surfaceStrong;
    return cl.tint100;
  }
  if (variant === 'secondary') return colors.canvas;
  return 'transparent';
}

function textColor(variant: Variant, disabled: boolean): string {
  if (variant === 'primary' || variant === 'pill') {
    return disabled ? colors.mutedSoft : cl.goldDeep;
  }
  return colors.ink;
}

function borderConfig(
  variant: Variant,
  disabled: boolean,
): {
  borderWidth: number;
  borderColor: string;
} {
  if (variant === 'secondary') return { borderWidth: HAIRLINE, borderColor: colors.borderStrong };
  if (variant === 'primary' || variant === 'pill') {
    return disabled
      ? { borderWidth: HAIRLINE, borderColor: colors.hairline }
      : { borderWidth: HAIRLINE, borderColor: cl.gold55 };
  }
  return { borderWidth: 0, borderColor: 'transparent' };
}

function surfaceStyle(variant: Variant, disabled: boolean): ViewStyle {
  const border = borderConfig(variant, disabled);
  return {
    backgroundColor: bgColor(variant, disabled),
    paddingHorizontal: variant === 'pill' ? control.paddingXPill : control.paddingX,
    height: variant === 'pill' ? undefined : control.height,
    minHeight: control.height,
    borderRadius: variant === 'pill' ? radius.full : clRadius.chip,
    borderWidth: border.borderWidth,
    borderColor: border.borderColor,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    width: '100%',
  };
}

// Visible focus ring for keyboard and switch-control users. Sits just outside
// the surface so it reads against both the canvas and the brand fill.
function focusRingStyle(variant: Variant): ViewStyle {
  return {
    position: 'absolute',
    top: -3,
    left: -3,
    right: -3,
    bottom: -3,
    borderRadius: (variant === 'pill' ? radius.full : clRadius.chip) + 3,
    borderWidth: 2,
    borderColor: colors.focusRing,
  };
}

export function ButtonRow({ children }: { children: React.ReactNode }) {
  return (
    <View style={{ flexDirection: 'row', gap: spacing.md, flexWrap: 'wrap' }}>{children}</View>
  );
}
