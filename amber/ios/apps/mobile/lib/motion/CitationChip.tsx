// Tab 9 motion primitives: CitationChip.
//
// Item #126: the pop-and-glow a citation chip plays as it streams into an
// answer. Tab 1 (PeopleRank) and Tab 3 (Medha chat) mount one of these per
// inline [[p:CONTACT_ID]] marker as it resolves, so the chip lands with a
// springy scale and a brand-colored glow that blooms once and fades.
//
// All animation is on the UI thread (Reanimated shared values). The optional
// onPress routes through the press-scale primitive so the chip is a real
// rabbit-hole tap target. Respects reduce-motion (#133): plain fade-in, no
// scale or glow pulse.

import { type ReactNode, useEffect } from 'react';
import { type StyleProp, View, type ViewStyle } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { colors, radius } from '../tokens';
import { PressableScale } from './PressableScale';
import { useAppReducedMotion } from './reduceMotion';
import { springs, timings } from './springs';

type CitationChipProps = {
  children: ReactNode;
  onPress?: () => void;
  /** Glow + accent color. Defaults to the design-system primary. */
  accentColor?: string;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
};

export function CitationChip({
  children,
  onPress,
  accentColor = colors.primary,
  style,
  accessibilityLabel,
}: CitationChipProps) {
  const reduced = useAppReducedMotion();
  const scale = useSharedValue(reduced ? 1 : 0.8);
  const opacity = useSharedValue(0);
  const glow = useSharedValue(0);

  useEffect(() => {
    opacity.value = withTiming(1, timings.fast);
    if (reduced) {
      scale.value = 1;
      return;
    }
    scale.value = withSpring(1, springs.bouncy);
    // Bloom the glow once, then settle to a quiet resting halo.
    glow.value = withSequence(
      withTiming(1, timings.fast),
      withDelay(120, withTiming(0.0, timings.slow)),
    );
  }, [reduced, scale, opacity, glow]);

  const containerStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    opacity: opacity.value,
  }));

  const glowStyle = useAnimatedStyle(() => ({
    opacity: glow.value,
    shadowColor: accentColor,
    shadowOpacity: glow.value,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 0 },
  }));

  const content = (
    <View
      style={{
        paddingHorizontal: 8,
        paddingVertical: 2,
        borderRadius: radius.full,
        backgroundColor: `${accentColor}1A`, // ~10% tint
        borderWidth: 1,
        borderColor: `${accentColor}33`,
      }}
    >
      {children}
    </View>
  );

  return (
    <Animated.View style={[containerStyle, style]}>
      <Animated.View style={glowStyle}>
        {onPress ? (
          <PressableScale
            onPress={onPress}
            haptic
            accessibilityRole="link"
            accessibilityLabel={accessibilityLabel}
          >
            {content}
          </PressableScale>
        ) : (
          content
        )}
      </Animated.View>
    </Animated.View>
  );
}
