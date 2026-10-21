import { useRef } from 'react';
import { Animated, Pressable, type ViewStyle } from 'react-native';
import { colors, control, press, radius } from '../lib/tokens';
import { haptics } from './haptics';
import { useReducedMotion } from './useReducedMotion';

type Props = {
  children: React.ReactNode;
  onPress?: () => void;
  size?: 32 | 40 | 48;
  variant?: 'soft' | 'outline' | 'rausch';
  accessibilityLabel: string;
  haptic?: boolean;
};

export function IconButton({
  children,
  onPress,
  size = 40,
  variant = 'outline',
  accessibilityLabel,
  haptic = true,
}: Props) {
  const reduceMotion = useReducedMotion();
  const scale = useRef(new Animated.Value(1)).current;
  const focusOpacity = useRef(new Animated.Value(0)).current;

  const bg =
    variant === 'rausch'
      ? colors.primary
      : variant === 'soft'
        ? colors.surfaceStrong
        : colors.canvas;
  const border = variant === 'outline' ? 1 : 0;

  // Pad smaller buttons up to the 44px minimum tap target without changing
  // their visual size.
  const hitSlop = Math.max(0, (control.minTapTarget - size) / 2 + control.hitSlop);

  const style: ViewStyle = {
    width: size,
    height: size,
    borderRadius: radius.full,
    backgroundColor: bg,
    borderWidth: border,
    borderColor: colors.hairline,
    alignItems: 'center',
    justifyContent: 'center',
  };

  const pressIn = () => {
    if (reduceMotion) return;
    Animated.timing(scale, {
      toValue: press.scale,
      duration: press.durationIn,
      useNativeDriver: true,
    }).start();
  };
  const pressOut = () => {
    Animated.timing(scale, {
      toValue: 1,
      duration: press.durationOut,
      useNativeDriver: true,
    }).start();
  };
  const handlePress = () => {
    if (haptic) haptics.tap();
    onPress?.();
  };

  return (
    <Animated.View style={{ transform: [{ scale }] }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        onPress={handlePress}
        onPressIn={pressIn}
        onPressOut={pressOut}
        onFocus={() => focusOpacity.setValue(1)}
        onBlur={() => focusOpacity.setValue(0)}
        hitSlop={hitSlop}
        style={style}
      >
        {children}
      </Pressable>
      <Animated.View
        pointerEvents="none"
        style={{
          position: 'absolute',
          top: -3,
          left: -3,
          right: -3,
          bottom: -3,
          borderRadius: radius.full,
          borderWidth: 2,
          borderColor: colors.focusRing,
          opacity: focusOpacity,
        }}
      />
    </Animated.View>
  );
}
