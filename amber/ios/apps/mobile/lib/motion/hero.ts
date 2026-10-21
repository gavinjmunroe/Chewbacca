// Tab 9 motion primitives: shared-element hero registry.
//
// Item #121: a shared-element transition from a PeopleRank card to the person
// card. Reanimated 4 removed the experimental sharedTransitionTag API, so this
// is implemented with a tiny frame registry instead:
//
//   1. The source (Tab 1's rank card) measures itself on press and stores its
//      on-screen frame keyed by contact id  -> registerHeroFrame.
//   2. The destination (Tab 2's HeroTarget) reads that frame on mount and
//      springs from the source rect into its own laid-out position.
//
// The registry is a plain module-level map: synchronous, no React state, and
// the entry is consumed once so a stale frame never drives a later, unrelated
// navigation. measureInWindow runs on the JS thread; the spring that follows
// runs on the UI thread (see HeroExpand.tsx).

import { type RefObject } from 'react';
import { type View } from 'react-native';

export type HeroFrame = {
  x: number;
  y: number;
  width: number;
  height: number;
};

const frames = new Map<string, HeroFrame>();

/** Store the source element's window frame for `key` (e.g. a contact id). */
export function registerHeroFrame(key: string, frame: HeroFrame): void {
  frames.set(key, frame);
}

/** Read a stored frame without consuming it. */
export function peekHeroFrame(key: string): HeroFrame | undefined {
  return frames.get(key);
}

/** Read and remove a stored frame. The destination consumes it exactly once. */
export function consumeHeroFrame(key: string): HeroFrame | undefined {
  const frame = frames.get(key);
  if (frame) frames.delete(key);
  return frame;
}

/** Drop a stored frame (e.g. if navigation was cancelled). */
export function clearHeroFrame(key: string): void {
  frames.delete(key);
}

/**
 * Measure a source view and register its frame, then run `then` (typically the
 * navigation push). Call from the rank card's onPress. Falls back to navigating
 * immediately if the ref is not measurable yet.
 */
export function measureAndRegister(
  ref: RefObject<View | null>,
  key: string,
  then: () => void,
): void {
  const node = ref.current;
  if (!node || typeof node.measureInWindow !== 'function') {
    then();
    return;
  }
  node.measureInWindow((x, y, width, height) => {
    if (width > 0 && height > 0) {
      registerHeroFrame(key, { x, y, width, height });
    }
    then();
  });
}
