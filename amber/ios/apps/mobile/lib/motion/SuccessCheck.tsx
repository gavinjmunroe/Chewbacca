// Tab 9 motion primitives: SuccessCheck.
//
// Item #127: the checkmark that draws itself on for a completed action
// (onboarding sync done, platform connected, message sent). A ring scales in,
// then the check strokes on via animated stroke-dashoffset, and a success
// haptic fires as the stroke completes.
//
// SVG stroke animation runs on the UI thread through Reanimated animatedProps.
// Respects reduce-motion (#133): the fully drawn check appears instantly with
// no draw-on, and the haptic still fires once.

import { useEffect } from 'react';
import { type StyleProp, View, type ViewStyle } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import Animated, {
  runOnJS,
  useAnimatedProps,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import { colors } from '../tokens';
import { hapticSuccess } from './haptics';
import { useAppReducedMotion } from './reduceMotion';
import { springs } from './springs';

const AnimatedPath = Animated.createAnimatedComponent(Path);
const AnimatedCircle = Animated.createAnimatedComponent(Circle);

// Length of the check path below; used as the dash length so offset can sweep
// it from hidden (full length) to drawn (0).
const CHECK_LENGTH = 26;

type SuccessCheckProps = {
  size?: number;
  color?: string;
  /** Fire a success haptic when the stroke completes. Defaults to true. */
  haptic?: boolean;
  /** Called once the draw-on finishes (or immediately when reduced). */
  onComplete?: () => void;
  style?: StyleProp<ViewStyle>;
};

export function SuccessCheck({
  size = 64,
  color = colors.primary,
  haptic = true,
  onComplete,
  style,
}: SuccessCheckProps) {
  const reduced = useAppReducedMotion();
  const ringScale = useSharedValue(reduced ? 1 : 0);
  const dashOffset = useSharedValue(reduced ? 0 : CHECK_LENGTH);

  const finish = () => {
    if (haptic) hapticSuccess();
    if (onComplete) onComplete();
  };

  useEffect(() => {
    if (reduced) {
      finish();
      return;
    }
    ringScale.value = withSpring(1, springs.bouncy);
    dashOffset.value = withDelay(
      140,
      withTiming(0, { duration: 320, easing: Easing.out(Easing.cubic) }, (done) => {
        'worklet';
        if (done) runOnJS(finish)();
      }),
    );
    // finish() is stable for the life of the component; deps intentionally minimal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduced]);

  const ringProps = useAnimatedProps(() => ({
    // Scale via radius growth keeps the stroke crisp (no transform blur).
    r: 28 * ringScale.value,
    opacity: ringScale.value,
  }));

  const checkProps = useAnimatedProps(() => ({
    strokeDashoffset: dashOffset.value,
  }));

  return (
    <View style={style}>
      <Svg width={size} height={size} viewBox="0 0 64 64">
        <AnimatedCircle
          cx={32}
          cy={32}
          stroke={color}
          strokeWidth={3}
          fill="none"
          animatedProps={ringProps}
        />
        <AnimatedPath
          d="M20 33 L29 42 L45 24"
          stroke={color}
          strokeWidth={4}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
          strokeDasharray={CHECK_LENGTH}
          animatedProps={checkProps}
        />
      </Svg>
    </View>
  );
}
