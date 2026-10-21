// Tab 9 motion primitives: staggered list entrance.
//
// Item #122 (consumed by Tab 1's PeopleRank list and anywhere rows reveal):
// a FadeInUp wrapper plus a staggeredEntering() builder for FlatList rows.
//
// The stagger step is 40ms and total reveal is capped at 600ms (see springs.ts)
// so a long network never feels like it is animating forever. Reanimated layout
// animations run on the UI thread and honor the system reduce-motion flag
// (#133) via ReduceMotion.System: when reduced, the row simply appears.

import { type ReactNode } from 'react';
import { type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  FadeInUp as RNFadeInUp,
  type EntryExitAnimationFunction,
  ReduceMotion,
} from 'react-native-reanimated';
import { capStaggerDelay, STAGGER_STEP_MS } from './springs';

/**
 * Build a capped, springy FadeInUp entering animation for a row at `index`.
 * Pass straight to a FlatList item's `entering` prop:
 *
 *   <Animated.View entering={staggeredEntering(index)} />
 */
export function staggeredEntering(
  index: number,
  step: number = STAGGER_STEP_MS,
): EntryExitAnimationFunction {
  return RNFadeInUp.springify()
    .damping(18)
    .stiffness(220)
    .mass(1)
    .delay(capStaggerDelay(index, step))
    .reduceMotion(ReduceMotion.System) as unknown as EntryExitAnimationFunction;
}

type FadeInUpProps = {
  children: ReactNode;
  /** Row position; drives the capped stagger delay. Defaults to 0. */
  index?: number;
  /** Per-row stagger step in ms. Defaults to 40. */
  step?: number;
  style?: StyleProp<ViewStyle>;
};

/**
 * Drop-in wrapper for non-virtualized lists (Views in a map). For FlatList,
 * prefer passing staggeredEntering(index) directly to the row's entering prop
 * so layout animations register correctly per item.
 */
export function FadeInUp({ children, index = 0, step = STAGGER_STEP_MS, style }: FadeInUpProps) {
  return (
    <Animated.View entering={staggeredEntering(index, step)} style={style}>
      {children}
    </Animated.View>
  );
}
