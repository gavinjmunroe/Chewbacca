// Tab 9 motion primitives: reduce-motion awareness.
//
// Item #133: every primitive respects the OS "Reduce Motion" setting. Rather
// than each component reading AccessibilityInfo itself, they call
// useAppReducedMotion() and branch through the small helpers below so the
// fallback behavior (instant value, plain fade) is consistent everywhere.
//
// Reanimated ships useReducedMotion(), which reads the same accessibility flag
// and stays reactive when the user toggles it in Settings. We re-export it under
// an app-specific name so the dependency is centralised and easy to mock.

import { useReducedMotion } from 'react-native-reanimated';

/**
 * True when the user has asked the OS to reduce motion. Reactive: flips without
 * an app restart when toggled in iOS Settings > Accessibility > Motion.
 */
export function useAppReducedMotion(): boolean {
  return useReducedMotion();
}

/**
 * Pick between a motion-rich value and a calm fallback based on the live
 * reduce-motion flag. Use inside components, not worklets.
 *
 *   const distance = pickMotion(reduced, 24, 0); // no travel when reduced
 */
export function pickMotion<T>(reduced: boolean, full: T, calm: T): T {
  return reduced ? calm : full;
}
