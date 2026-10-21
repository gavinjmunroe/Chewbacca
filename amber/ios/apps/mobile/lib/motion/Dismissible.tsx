// Tab 9 motion primitives: Dismissible.
//
// Item #131: gesture-driven dismiss for sheets and the person card. Drag down
// to follow the finger; release past the distance threshold or with enough
// downward velocity and it animates out and calls onDismiss. Short drags spring
// back. An optional backdrop dims in proportion to drag progress so the gesture
// reads as "peel this off the screen".
//
// Drag, snap-back, and fling-out all run on the UI thread. Only onDismiss
// crosses to JS. Respects reduce-motion (#133): the content still follows the
// finger (direct manipulation is not "motion"), but dismissal resolves with a
// short fade instead of a sprung slide.

import { type ReactNode } from 'react';
import { Dimensions, type StyleProp, type ViewStyle } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useAppReducedMotion } from './reduceMotion';
import { springs } from './springs';

const SCREEN_H = Dimensions.get('window').height;

type DismissibleProps = {
  children: ReactNode;
  onDismiss: () => void;
  /** Drag distance past which release dismisses. Defaults to 120. */
  threshold?: number;
  /** Downward velocity that dismisses regardless of distance. Defaults to 800. */
  velocityThreshold?: number;
  /** Render a dimming backdrop that fades with drag. Defaults to true. */
  backdrop?: boolean;
  style?: StyleProp<ViewStyle>;
};

export function Dismissible({
  children,
  onDismiss,
  threshold = 120,
  velocityThreshold = 800,
  backdrop = true,
  style,
}: DismissibleProps) {
  const reduced = useAppReducedMotion();
  const translateY = useSharedValue(0);

  const finish = () => {
    onDismiss();
  };

  const pan = Gesture.Pan()
    .activeOffsetY(12) // only claim the gesture once a downward drag is clear
    .failOffsetY(-12) // let upward scroll pass through
    .onUpdate((e) => {
      'worklet';
      translateY.value = e.translationY > 0 ? e.translationY : e.translationY * 0.2;
    })
    .onEnd((e) => {
      'worklet';
      const shouldDismiss = translateY.value > threshold || e.velocityY > velocityThreshold;
      if (shouldDismiss) {
        if (reduced) {
          translateY.value = withTiming(SCREEN_H, { duration: 180 }, (done) => {
            if (done) runOnJS(finish)();
          });
        } else {
          translateY.value = withSpring(
            SCREEN_H,
            { ...springs.stiff, velocity: e.velocityY },
            (done) => {
              if (done) runOnJS(finish)();
            },
          );
        }
      } else {
        translateY.value = withSpring(0, springs.gentle);
      }
    });

  const contentStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));

  const backdropStyle = useAnimatedStyle(() => ({
    opacity: interpolate(translateY.value, [0, threshold * 2], [1, 0], {
      extrapolateLeft: Extrapolation.CLAMP,
      extrapolateRight: Extrapolation.CLAMP,
    }),
  }));

  return (
    <>
      {backdrop ? (
        <Animated.View
          pointerEvents="none"
          style={[
            {
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              backgroundColor: 'rgba(0,0,0,0.5)',
            },
            backdropStyle,
          ]}
        />
      ) : null}
      <GestureDetector gesture={pan}>
        <Animated.View style={[{ flex: 1 }, style, contentStyle]}>{children}</Animated.View>
      </GestureDetector>
    </>
  );
}
