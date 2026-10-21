// Tab 9 motion primitives: HeroExpand (destination side of the hero transition).
//
// Item #121: pairs with hero.ts. Wrap the person card's hero element (its header
// / avatar block) in <HeroTarget heroKey={contactId}>. On mount it reads the
// source frame registered by the rank card, then springs from that rect
// (center-anchored translate + uniform scale) into its own laid-out position.
//
// If no source frame exists (deep link, cold open, reduce-motion), it falls back
// to a plain fade so the screen is never blank or jumpy. The spring runs on the
// UI thread; only the one-time self-measure touches JS.

import { type ReactNode, useRef } from 'react';
import { type LayoutChangeEvent, type StyleProp, View, type ViewStyle } from 'react-native';
import Animated, {
  runOnUI,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { consumeHeroFrame } from './hero';
import { useAppReducedMotion } from './reduceMotion';
import { springs, timings } from './springs';

type HeroTargetProps = {
  /** Same key the source rank card registered (the contact id). */
  heroKey: string;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
};

export function HeroTarget({ heroKey, children, style }: HeroTargetProps) {
  const reduced = useAppReducedMotion();
  const ref = useRef<View>(null);
  const started = useRef(false);

  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const scale = useSharedValue(1);
  const opacity = useSharedValue(reduced ? 0 : 1);

  const onLayout = (e: LayoutChangeEvent) => {
    if (started.current) return;
    started.current = true;

    const source = consumeHeroFrame(heroKey);

    if (reduced || !source) {
      // No hero to play: simple fade so a cold open is not jarring.
      opacity.value = withTiming(1, timings.base);
      return;
    }

    const node = ref.current;
    if (!node || typeof node.measureInWindow !== 'function') {
      opacity.value = 1;
      return;
    }

    node.measureInWindow((dx, dy, dw, dh) => {
      if (dw <= 0 || dh <= 0) {
        opacity.value = 1;
        return;
      }
      const srcCx = source.x + source.width / 2;
      const srcCy = source.y + source.height / 2;
      const dstCx = dx + dw / 2;
      const dstCy = dy + dh / 2;

      // Seed the shared values at the source rect, then release the spring on
      // the UI thread so the very first frame already shows the start pose.
      runOnUI((tx: number, ty: number, s: number) => {
        'worklet';
        translateX.value = tx;
        translateY.value = ty;
        scale.value = s;
        opacity.value = 1;
        translateX.value = withSpring(0, springs.gentle);
        translateY.value = withSpring(0, springs.gentle);
        scale.value = withSpring(1, springs.gentle);
      })(srcCx - dstCx, srcCy - dstCy, source.width / dw);
    });
  };

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: scale.value },
    ],
  }));

  return (
    <Animated.View ref={ref} onLayout={onLayout} style={[style, animatedStyle]}>
      {children}
    </Animated.View>
  );
}
