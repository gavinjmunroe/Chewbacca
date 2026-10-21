// Tab 9 motion primitives: shared spring + timing configuration.
//
// Every animated primitive in lib/motion pulls its physics from here so motion
// reads the same across the whole app. Tabs that need a one-off animation should
// import one of these named configs rather than hand-tuning damping in place.
//
// Reanimated 4. All configs are plain objects safe to pass into withSpring /
// withTiming on the UI thread.

import { Easing, type WithSpringConfig, type WithTimingConfig } from 'react-native-reanimated';

/**
 * Named spring physics. Pick by feel, not by number:
 * - gentle:  settles softly, no overshoot. Headers, layout shifts, parallax.
 * - snappy:  quick and crisp, minimal overshoot. Presses, toggles, chips.
 * - bouncy:  playful overshoot. Success states, celebratory reveals.
 * - stiff:   near-instant with a hint of give. Drag-follow, dismiss snap-back.
 */
export const springs = {
  gentle: {
    damping: 20,
    stiffness: 120,
    mass: 1,
    overshootClamping: false,
  },
  snappy: {
    damping: 18,
    stiffness: 260,
    mass: 1,
    overshootClamping: false,
  },
  bouncy: {
    damping: 10,
    stiffness: 180,
    mass: 0.9,
    overshootClamping: false,
  },
  stiff: {
    damping: 30,
    stiffness: 400,
    mass: 1,
    overshootClamping: true,
  },
} satisfies Record<string, WithSpringConfig>;

export type SpringName = keyof typeof springs;

/**
 * Named timing curves for opacity and non-physical transitions where a spring
 * would feel wrong (fades, shimmer sweeps, crossfades).
 */
export const timings = {
  fast: { duration: 160, easing: Easing.out(Easing.cubic) },
  base: { duration: 240, easing: Easing.out(Easing.cubic) },
  slow: { duration: 360, easing: Easing.inOut(Easing.cubic) },
  // Linear loop used by shimmer and pulse so the sweep reads at constant speed.
  loop: { duration: 1100, easing: Easing.linear },
} satisfies Record<string, WithTimingConfig>;

export type TimingName = keyof typeof timings;

/**
 * Stagger cadence for list entrances. Tab 1's hero list caps total reveal near
 * 600ms; capStaggerDelay enforces that ceiling so a 2,000-row network never
 * feels like it is animating forever.
 */
export const STAGGER_STEP_MS = 40;
export const STAGGER_CAP_MS = 600;

export function capStaggerDelay(index: number, step: number = STAGGER_STEP_MS): number {
  'worklet';
  const delay = index * step;
  return delay > STAGGER_CAP_MS ? STAGGER_CAP_MS : delay;
}
