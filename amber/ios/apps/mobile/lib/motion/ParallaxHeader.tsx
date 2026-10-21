// Tab 9 motion primitives: parallax header.
//
// Item #132: the subtle parallax the person-card header plays as the user
// scrolls. Two pieces that compose:
//
//   - useParallaxScroll(): returns a shared scrollY plus the scroll handler to
//     attach to an Animated.ScrollView. Screens that already track scroll can
//     pass their own shared value instead.
//   - ParallaxHeader: a header container that drifts at half scroll speed,
//     fades as it leaves, and stretches+zooms on over-pull (the iOS "stretchy
//     header" feel).
//
// Everything is driven by the scroll handler on the UI thread. Respects
// reduce-motion (#133): the header holds position and opacity, no drift or
// stretch.

import { type ReactNode } from 'react';
import { type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
  type SharedValue,
} from 'react-native-reanimated';
import { useAppReducedMotion } from './reduceMotion';

/** Track vertical scroll for parallax. Attach handler to Animated.ScrollView. */
export function useParallaxScroll() {
  const scrollY = useSharedValue(0);
  const scrollHandler = useAnimatedScrollHandler({
    onScroll: (e) => {
      scrollY.value = e.contentOffset.y;
    },
  });
  return { scrollY, scrollHandler };
}

type ParallaxHeaderProps = {
  children: ReactNode;
  scrollY: SharedValue<number>;
  /** Rendered header height. Drives the stretch math. Defaults to 240. */
  height?: number;
  /** Drift factor as content scrolls up. 0.5 = half speed. Defaults to 0.5. */
  driftFactor?: number;
  style?: StyleProp<ViewStyle>;
};

export function ParallaxHeader({
  children,
  scrollY,
  height = 240,
  driftFactor = 0.5,
  style,
}: ParallaxHeaderProps) {
  const reduced = useAppReducedMotion();

  const animatedStyle = useAnimatedStyle(() => {
    if (reduced) return {};
    const y = scrollY.value;
    // Over-pull (y < 0): stretch the header and scale it up from the top.
    const scale = interpolate(y, [-height, 0], [1.4, 1], {
      extrapolateLeft: Extrapolation.EXTEND,
      extrapolateRight: Extrapolation.CLAMP,
    });
    // Scrolling up (y > 0): drift slower than content, then fade out.
    const translateY = interpolate(y, [0, height], [0, height * driftFactor], {
      extrapolateLeft: Extrapolation.CLAMP,
      extrapolateRight: Extrapolation.EXTEND,
    });
    const opacity = interpolate(y, [0, height * 0.75], [1, 0], {
      extrapolateLeft: Extrapolation.CLAMP,
      extrapolateRight: Extrapolation.CLAMP,
    });
    return {
      opacity,
      transform: [{ translateY }, { scale }],
    };
  });

  return (
    <Animated.View style={[{ height, overflow: 'hidden' }, style, animatedStyle]}>
      {children}
    </Animated.View>
  );
}
