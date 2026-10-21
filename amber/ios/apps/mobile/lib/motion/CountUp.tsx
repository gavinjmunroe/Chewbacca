// Tab 9 motion primitives: CountUp.
//
// Item #130: a number that animates from a start value up to its target. Used
// for PeopleRank scores, stat tiles, and the person-card score breakdown so a
// "92" rolls up instead of snapping in.
//
// Implemented with the UI-thread text trick: an uneditable TextInput whose
// `text` prop is driven by a Reanimated animatedProps worklet, so the digits
// update at 60fps without round-tripping to JS. Respects reduce-motion (#133):
// when reduced, the final value is shown immediately with no roll.

import { useEffect } from 'react';
import { StyleSheet, type TextStyle, TextInput } from 'react-native';
import Animated, {
  useAnimatedProps,
  useSharedValue,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import { useAppReducedMotion } from './reduceMotion';

const AnimatedTextInput = Animated.createAnimatedComponent(TextInput);

type CountUpProps = {
  /** Target value to count to. */
  value: number;
  /** Value to count from on first mount. Defaults to 0. */
  from?: number;
  /** Decimal places to render. Defaults to 0. */
  decimals?: number;
  /** Optional fixed string before/after the number. */
  prefix?: string;
  suffix?: string;
  duration?: number;
  style?: TextStyle;
};

export function CountUp({
  value,
  from = 0,
  decimals = 0,
  prefix = '',
  suffix = '',
  duration = 700,
  style,
}: CountUpProps) {
  const reduced = useAppReducedMotion();
  const animated = useSharedValue(reduced ? value : from);

  useEffect(() => {
    if (reduced) {
      animated.value = value;
      return;
    }
    animated.value = withTiming(value, { duration, easing: Easing.out(Easing.cubic) });
  }, [value, reduced, duration, animated]);

  const animatedProps = useAnimatedProps(() => {
    const text = `${prefix}${animated.value.toFixed(decimals)}${suffix}`;
    return { text, defaultValue: text } as Partial<{ text: string; defaultValue: string }>;
  });

  return (
    <AnimatedTextInput
      underlineColorAndroid="transparent"
      editable={false}
      pointerEvents="none"
      accessibilityRole="text"
      accessibilityLabel={`${prefix}${value.toFixed(decimals)}${suffix}`}
      style={[styles.base, style]}
      animatedProps={animatedProps}
    />
  );
}

const styles = StyleSheet.create({
  base: {
    padding: 0,
    margin: 0,
  },
});
