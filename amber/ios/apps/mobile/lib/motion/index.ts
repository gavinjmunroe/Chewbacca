// Tab 9 motion primitives: public barrel.
//
// Import everything motion-related from '@/lib/motion'. These primitives are
// the single source of truth for animation in the app; screens should consume
// them rather than hand-rolling withSpring/withTiming so motion stays
// consistent and reduce-motion is respected everywhere.
//
//   import { PressableScale, FadeInUp, springs } from '@/lib/motion';

// Physics + config
export { springs, timings, capStaggerDelay, STAGGER_STEP_MS, STAGGER_CAP_MS } from './springs';
export type { SpringName, TimingName } from './springs';

// Accessibility
export { useAppReducedMotion, pickMotion } from './reduceMotion';

// Haptics
export {
  hapticPress,
  hapticSelection,
  hapticImpact,
  hapticSuccess,
  hapticWarning,
  hapticError,
} from './haptics';

// Press + entrance
export { PressableScale } from './PressableScale';
export { FadeInUp, staggeredEntering } from './FadeInUp';

// Loading + numbers
export { Shimmer } from './Shimmer';
export { CountUp } from './CountUp';

// Streaming + success
export { CitationChip } from './CitationChip';
export { SuccessCheck } from './SuccessCheck';

// Pull-to-refresh
export { AmberRefresh, AmberPulse } from './AmberRefresh';

// Gestures
export { Dismissible } from './Dismissible';
export { useParallaxScroll, ParallaxHeader } from './ParallaxHeader';
export { Crossfade, SwipeTabs } from './TabTransition';

// Shared-element hero
export {
  registerHeroFrame,
  peekHeroFrame,
  consumeHeroFrame,
  clearHeroFrame,
  measureAndRegister,
} from './hero';
export type { HeroFrame } from './hero';
export { HeroTarget } from './HeroExpand';
