// Tab 9 motion primitives: branded pull-to-refresh.
//
// Item #124: a custom pull-to-refresh with a branded Amber pulse instead of the
// stock gray spinner. Two exports:
//
//   - AmberPulse:   the looping brand-colored pulse ring. Reusable anywhere a
//                   lightweight "working" indicator is needed.
//   - AmberRefresh: a drop-in ScrollView replacement. Over-pull past the
//                   threshold and release to trigger onRefresh; the pulse stays
//                   pinned open while refreshing, then springs closed.
//
// Pull tracking runs on the UI thread via useAnimatedScrollHandler. The only
// JS-thread work is the onRefresh trigger fired from onScrollEndDrag. Respects
// reduce-motion (#133): the pulse holds steady instead of looping, and the
// open/close uses a short fade rather than a spring.

import { type ReactNode, useEffect } from 'react';
import { type StyleProp, View, type ViewStyle } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { colors } from '../tokens';
import { useAppReducedMotion } from './reduceMotion';
import { springs } from './springs';

const INDICATOR_HEIGHT = 64;
const TRIGGER_DISTANCE = 84;

/** The looping brand pulse: a ring that scales out and fades on a steady loop. */
export function AmberPulse({
  size = 28,
  color = colors.primary,
  style,
}: {
  size?: number;
  color?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const reduced = useAppReducedMotion();
  const progress = useSharedValue(0);

  useEffect(() => {
    if (reduced) {
      progress.value = 0.5;
      return;
    }
    progress.value = withRepeat(
      withTiming(1, { duration: 1100, easing: Easing.out(Easing.cubic) }),
      -1,
      false,
    );
    return () => cancelAnimation(progress);
  }, [reduced, progress]);

  const ringStyle = useAnimatedStyle(() => ({
    transform: [{ scale: interpolate(progress.value, [0, 1], [0.4, 1.1]) }],
    opacity: interpolate(progress.value, [0, 0.5, 1], [0.9, 0.5, 0]),
  }));

  const coreStyle = useAnimatedStyle(() => ({
    opacity: reduced ? 0.9 : interpolate(progress.value, [0, 1], [1, 0.7]),
  }));

  return (
    <View
      style={[{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }, style]}
    >
      <Animated.View
        style={[
          {
            position: 'absolute',
            width: size,
            height: size,
            borderRadius: size / 2,
            borderWidth: 2,
            borderColor: color,
          },
          ringStyle,
        ]}
      />
      <Animated.View
        style={[
          { width: size / 2.6, height: size / 2.6, borderRadius: size, backgroundColor: color },
          coreStyle,
        ]}
      />
    </View>
  );
}

type AmberRefreshProps = {
  refreshing: boolean;
  onRefresh: () => void;
  children: ReactNode;
  contentContainerStyle?: StyleProp<ViewStyle>;
  style?: StyleProp<ViewStyle>;
  /** Forwarded to the underlying ScrollView. */
  showsVerticalScrollIndicator?: boolean;
  testID?: string;
};

/**
 * ScrollView with a branded Amber pull-to-refresh. Use in place of a plain
 * ScrollView; for virtualized lists, render AmberPulse manually as a list
 * header alongside FlatList's own refreshing prop.
 */
export function AmberRefresh({
  refreshing,
  onRefresh,
  children,
  contentContainerStyle,
  style,
  showsVerticalScrollIndicator = true,
  testID,
}: AmberRefreshProps) {
  const reduced = useAppReducedMotion();
  const pull = useSharedValue(0); // live over-pull distance (>= 0)
  const open = useSharedValue(0); // pinned-open height while refreshing

  useEffect(() => {
    if (refreshing) {
      open.value = reduced
        ? withTiming(INDICATOR_HEIGHT, { duration: 160 })
        : withSpring(INDICATOR_HEIGHT, springs.gentle);
    } else {
      open.value = reduced ? withTiming(0, { duration: 160 }) : withSpring(0, springs.gentle);
    }
  }, [refreshing, reduced, open]);

  const trigger = () => {
    if (!refreshing) onRefresh();
  };

  const scrollHandler = useAnimatedScrollHandler({
    onScroll: (e) => {
      const overscroll = -e.contentOffset.y;
      pull.value = overscroll > 0 ? overscroll : 0;
    },
    onEndDrag: (e) => {
      if (-e.contentOffset.y >= TRIGGER_DISTANCE) {
        runOnJS(trigger)();
      }
    },
  });

  // The indicator zone height: whichever is larger, the live pull or the pinned
  // open height. Caps the visible pull so a hard fling does not gap the list.
  const zoneStyle = useAnimatedStyle(() => {
    const live = interpolate(pull.value, [0, TRIGGER_DISTANCE * 1.5], [0, INDICATOR_HEIGHT], {
      extrapolateRight: Extrapolation.CLAMP,
    });
    return { height: Math.max(live, open.value) };
  });

  const pulseStyle = useAnimatedStyle(() => {
    const progress = interpolate(Math.max(pull.value, open.value), [0, INDICATOR_HEIGHT], [0, 1], {
      extrapolateRight: Extrapolation.CLAMP,
    });
    return {
      opacity: progress,
      transform: [{ scale: reduced ? 1 : interpolate(progress, [0, 1], [0.6, 1]) }],
    };
  });

  return (
    <Animated.ScrollView
      testID={testID}
      style={style}
      contentContainerStyle={contentContainerStyle}
      onScroll={scrollHandler}
      scrollEventThrottle={16}
      showsVerticalScrollIndicator={showsVerticalScrollIndicator}
    >
      <Animated.View style={[{ alignItems: 'center', justifyContent: 'flex-end' }, zoneStyle]}>
        <Animated.View style={[{ paddingBottom: 12 }, pulseStyle]}>
          <AmberPulse />
        </Animated.View>
      </Animated.View>
      {children}
    </Animated.ScrollView>
  );
}
