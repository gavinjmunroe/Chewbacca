import { useRef } from 'react';
import { Animated, Pressable, View, type ViewStyle } from 'react-native';
import {colors, elevation, press, spacing } from '../lib/tokens';
import { cl, clRadius } from '../lib/classical';
import { haptics } from './haptics';
import { useReducedMotion } from './useReducedMotion';

type Elevation = 'none' | 'sm' | 'md' | 'lg';

type CardProps = {
  children: React.ReactNode;
  onPress?: () => void;
  padded?: boolean;
  hairline?: boolean;
  // `elevated` is kept as a boolean alias of the md tier for existing call
  // sites; `elevation` is the granular control for new code.
  elevated?: boolean;
  elevation?: Elevation;
  style?: ViewStyle;
  accessibilityLabel?: string;
  haptic?: boolean;
};

export function Card({
  children,
  onPress,
  padded = true,
  hairline = true,
  elevated = false,
  elevation: elevationProp,
  style,
  accessibilityLabel,
  haptic = false,
}: CardProps) {
  const reduceMotion = useReducedMotion();
  const scale = useRef(new Animated.Value(1)).current;
  const focusOpacity = useRef(new Animated.Value(0)).current;

  const tier: Elevation = elevationProp ?? (elevated ? 'md' : 'none');
  const base: ViewStyle = {
    backgroundColor: colors.canvas,
    borderRadius: clRadius.card,
    borderWidth: hairline ? 1 : 0,
    borderColor: cl.cardHairline,
    padding: padded ? spacing.lg : 0,
    overflow: 'hidden',
    ...(tier === 'none' ? {} : elevation[tier]),
    ...style,
  };

  if (!onPress) {
    return <View style={base}>{children}</View>;
  }

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
    onPress();
  };

  return (
    <Animated.View style={{ transform: [{ scale }] }}>
      <Pressable
        onPress={handlePress}
        onPressIn={pressIn}
        onPressOut={pressOut}
        onFocus={() => focusOpacity.setValue(1)}
        onBlur={() => focusOpacity.setValue(0)}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        style={base}
      >
        {children}
      </Pressable>
      {/* Ring lives outside the overflow-hidden surface so it is not clipped. */}
      <Animated.View
        pointerEvents="none"
        style={{
          position: 'absolute',
          top: -3,
          left: -3,
          right: -3,
          bottom: -3,
          borderRadius: clRadius.card + 3,
          borderWidth: 2,
          borderColor: colors.focusRing,
          opacity: focusOpacity,
        }}
      />
    </Animated.View>
  );
}
