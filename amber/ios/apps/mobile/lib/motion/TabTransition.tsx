// Tab 9 motion primitives: tab-switch transition.
//
// Item #128: a tab-switch crossfade/slide with gesture interactivity. Two
// exports:
//
//   - Crossfade: swaps between keyed children with a fade. For lightweight
//     segmented content (filters, sub-views) where a full pager is overkill.
//   - SwipeTabs: a gesture-interactive pager. Drag horizontally to move between
//     panes with live tracking; release snaps to the nearest pane by distance
//     or velocity and reports the new index. Panes also crossfade slightly so
//     the switch reads as a transition, not just a slide.
//
// Drag, snap, and crossfade run on the UI thread. Only the index change crosses
// to JS. Respects reduce-motion (#133): drag still tracks the finger (direct
// manipulation), but the snap resolves with a short timing curve instead of a
// spring and the crossfade is dropped.

import { type ReactNode, useEffect, useState } from 'react';
import { type LayoutChangeEvent, type StyleProp, View, type ViewStyle } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { useAppReducedMotion } from './reduceMotion';
import { springs, timings } from './springs';

/** Crossfade between keyed children. Re-fades whenever `activeKey` changes. */
export function Crossfade({
  activeKey,
  children,
  duration = 240,
  style,
}: {
  activeKey: string;
  children: ReactNode;
  duration?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const reduced = useAppReducedMotion();
  const opacity = useSharedValue(1);

  useEffect(() => {
    if (reduced) {
      opacity.value = 1;
      return;
    }
    opacity.value = 0;
    opacity.value = withTiming(1, { duration });
  }, [activeKey, reduced, duration, opacity]);

  const animatedStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return <Animated.View style={[style, animatedStyle]}>{children}</Animated.View>;
}

type SwipePane = { key: string; render: () => ReactNode };

type SwipeTabsProps = {
  panes: SwipePane[];
  index: number;
  onIndexChange: (index: number) => void;
  /** Velocity past which a flick advances a pane regardless of distance. */
  velocityThreshold?: number;
  style?: StyleProp<ViewStyle>;
};

export function SwipeTabs({
  panes,
  index,
  onIndexChange,
  velocityThreshold = 500,
  style,
}: SwipeTabsProps) {
  const reduced = useAppReducedMotion();
  const [width, setWidth] = useState(0);
  const translateX = useSharedValue(0);
  const startX = useSharedValue(0);
  const count = panes.length;

  // Keep the pager aligned when index changes from outside (tab-bar tap).
  useEffect(() => {
    if (width === 0) return;
    const target = -index * width;
    translateX.value = reduced
      ? withTiming(target, timings.fast)
      : withSpring(target, springs.snappy);
  }, [index, width, reduced, translateX]);

  const onLayout = (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width);

  const settle = (next: number) => {
    if (next !== index) onIndexChange(next);
  };

  const pan = Gesture.Pan()
    .activeOffsetX([-12, 12])
    .failOffsetY([-12, 12])
    .onBegin(() => {
      'worklet';
      startX.value = translateX.value;
    })
    .onUpdate((e) => {
      'worklet';
      let next = startX.value + e.translationX;
      // Rubber-band at the ends.
      const min = -(count - 1) * width;
      if (next > 0) next = next * 0.3;
      if (next < min) next = min + (next - min) * 0.3;
      translateX.value = next;
    })
    .onEnd((e) => {
      'worklet';
      if (width === 0) return;
      const current = Math.round(-startX.value / width);
      // Net horizontal drag this gesture. Negative = dragged content left =
      // moving toward the next pane; positive = toward the previous pane.
      const delta = translateX.value - startX.value;
      let next = current;
      if (e.velocityX < -velocityThreshold || delta < -width * 0.4) next = current + 1;
      else if (e.velocityX > velocityThreshold || delta > width * 0.4) next = current - 1;
      next = Math.max(0, Math.min(count - 1, next));
      const target = -next * width;
      translateX.value = reduced
        ? withTiming(target, timings.fast)
        : withSpring(target, { ...springs.snappy, velocity: e.velocityX });
      runOnJS(settle)(next);
    });

  const rowStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
    width: width * count,
  }));

  return (
    <View style={[{ flex: 1, overflow: 'hidden' }, style]} onLayout={onLayout}>
      <GestureDetector gesture={pan}>
        <Animated.View style={[{ flexDirection: 'row', flex: 1 }, rowStyle]}>
          {panes.map((pane, i) => (
            <Pane key={pane.key} width={width} i={i} translateX={translateX} reduced={reduced}>
              {pane.render()}
            </Pane>
          ))}
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

function Pane({
  children,
  width,
  i,
  translateX,
  reduced,
}: {
  children: ReactNode;
  width: number;
  i: number;
  translateX: SharedValue<number>;
  reduced: boolean;
}) {
  const animatedStyle = useAnimatedStyle(() => {
    if (reduced || width === 0) return { opacity: 1 };
    const offset = -translateX.value; // current scroll position in px
    const distance = Math.abs(offset - i * width) / width; // 0 at center, 1 one pane away
    return {
      opacity: interpolate(distance, [0, 1], [1, 0.4], { extrapolateRight: Extrapolation.CLAMP }),
    };
  });

  return <Animated.View style={[{ width }, animatedStyle]}>{children}</Animated.View>;
}
