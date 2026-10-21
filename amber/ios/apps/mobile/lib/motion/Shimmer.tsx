// Tab 9 motion primitives: Shimmer.
//
// Item #129: an animated gradient-sweep skeleton primitive. A highlight band
// translates left-to-right across a neutral block on a constant-speed loop.
// Skeleton-shaped surfaces (Tab 8's Skeleton variants, Tab 1's RankCard
// placeholders) place this behind their layout to read as "loading" rather than
// a static gray box.
//
// The sweep runs on the UI thread (Reanimated shared value + repeat). Respects
// reduce-motion (#133): when reduced, it renders the neutral block with no
// sweep so there is no looping animation on screen.

import { useEffect, useState } from 'react';
import { type StyleProp, View, type ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, {
  cancelAnimation,
  Easing,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { colors, radius as radiusTokens } from '../tokens';
import { useAppReducedMotion } from './reduceMotion';

type ShimmerProps = {
  width?: number | `${number}%`;
  height?: number;
  radius?: number;
  /** Base (unlit) block color. Defaults to the design-system strong surface. */
  baseColor?: string;
  /** Sweep highlight color. Defaults to white at low opacity. */
  highlightColor?: string;
  style?: StyleProp<ViewStyle>;
};

export function Shimmer({
  width = '100%',
  height = 16,
  radius = radiusTokens.sm,
  baseColor = colors.surfaceStrong,
  highlightColor = 'rgba(255,255,255,0.55)',
  style,
}: ShimmerProps) {
  const reduced = useAppReducedMotion();
  const [boxWidth, setBoxWidth] = useState(0);
  const progress = useSharedValue(0);

  useEffect(() => {
    if (reduced) return;
    progress.value = withRepeat(
      withTiming(1, { duration: 1100, easing: Easing.linear }),
      -1,
      false,
    );
    return () => cancelAnimation(progress);
  }, [reduced, progress]);

  const sweepStyle = useAnimatedStyle(() => {
    const travel = boxWidth + boxWidth; // start fully off-left, end fully off-right
    return {
      transform: [{ translateX: interpolate(progress.value, [0, 1], [-boxWidth, travel]) }],
    };
  });

  return (
    <View
      onLayout={(e) => setBoxWidth(e.nativeEvent.layout.width)}
      style={[
        { width, height, borderRadius: radius, backgroundColor: baseColor, overflow: 'hidden' },
        style,
      ]}
    >
      {!reduced && boxWidth > 0 ? (
        <Animated.View style={[{ width: boxWidth, height: '100%' }, sweepStyle]}>
          <LinearGradient
            colors={['transparent', highlightColor, 'transparent']}
            start={{ x: 0, y: 0.5 }}
            end={{ x: 1, y: 0.5 }}
            style={{ flex: 1 }}
          />
        </Animated.View>
      ) : null}
    </View>
  );
}
