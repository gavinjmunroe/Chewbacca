// Tab 9 motion primitives: PressableScale.
//
// Item #125: the press-scale + haptic primitive every tappable in the app
// should route through. Scales to 0.97 on press-in with a snappy spring, fires
// a light haptic, and exposes the same press/disabled semantics as a plain
// Pressable so it is a drop-in upgrade.
//
// Animation runs entirely on the UI thread via a Reanimated shared value; the
// only JS-thread work is the optional haptic and the onPress callback. Respects
// reduce-motion (#133) by holding scale at 1 and skipping the spring.

import { type ReactNode } from 'react';
import { type StyleProp, type ViewStyle } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { hapticPress } from './haptics';
import { useAppReducedMotion } from './reduceMotion';
import { springs } from './springs';

type PressableScaleProps = {
  children: ReactNode;
  onPress?: () => void;
  onLongPress?: () => void;
  disabled?: boolean;
  /** Target scale at the bottom of the press. Defaults to 0.97. */
  pressedScale?: number;
  /** Light haptic on press-in. Defaults to true. Set false for dense lists. */
  haptic?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  /** accessibilityRole override; defaults to "button". */
  accessibilityRole?: 'button' | 'link' | 'none';
  hitSlop?: number;
};

export function PressableScale({
  children,
  onPress,
  onLongPress,
  disabled = false,
  pressedScale = 0.97,
  haptic = true,
  style,
  accessibilityLabel,
  accessibilityHint,
  accessibilityRole = 'button',
  hitSlop = 0,
}: PressableScaleProps) {
  const reduced = useAppReducedMotion();
  const scale = useSharedValue(1);
  const opacity = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    opacity: opacity.value,
  }));

  const press = () => {
    if (onPress) onPress();
  };
  const longPress = () => {
    if (onLongPress) onLongPress();
  };

  const settle = () => {
    'worklet';
    scale.value = reduced ? 1 : withSpring(1, springs.snappy);
    opacity.value = withSpring(1, springs.snappy);
  };

  const tap = Gesture.Tap()
    .enabled(!disabled)
    .maxDuration(100000)
    .onBegin(() => {
      'worklet';
      if (!reduced) scale.value = withSpring(pressedScale, springs.snappy);
      opacity.value = withSpring(0.92, springs.snappy);
      if (haptic) runOnJS(hapticPress)();
    })
    .onEnd((_e, success) => {
      'worklet';
      settle();
      if (success) runOnJS(press)();
    })
    .onFinalize(() => {
      'worklet';
      settle();
    });

  const long = Gesture.LongPress()
    .enabled(!disabled && !!onLongPress)
    .minDuration(450)
    .onStart(() => {
      'worklet';
      runOnJS(longPress)();
    });

  const gesture = Gesture.Simultaneous(tap, long);

  return (
    <GestureDetector gesture={gesture}>
      <Animated.View
        accessible
        accessibilityRole={accessibilityRole}
        accessibilityLabel={accessibilityLabel}
        accessibilityHint={accessibilityHint}
        accessibilityState={{ disabled }}
        hitSlop={hitSlop}
        style={[{ opacity: disabled ? 0.4 : 1 }, style, animatedStyle]}
      >
        {children}
      </Animated.View>
    </GestureDetector>
  );
}
