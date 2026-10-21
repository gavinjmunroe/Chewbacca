import { useKeyboardObserver } from '../lib/useKeyboardLift';

/**
 * THE APP'S ONE KEYBOARD OBSERVER. RENDERS NOTHING.
 *
 * Reanimated does not support `useAnimatedKeyboard` in more than one component
 * at a time, and it was mounted three times: SearchDock called useKeyboardLift
 * for the fade and useKeyboardBarLift for the position -- two in a single
 * component -- and AskChat made a third whenever it was open.
 *
 * The failure is silent and does not look like a keyboard bug. The live height
 * stops arriving: readers get 0, then the final height, and nothing between. So
 * every animation built on it degrades from a smooth ride into a single jump at
 * the end. Measured off a screen recording: the keyboard rises over frames
 * 102-119 and the search bar does not move at all, then appears at frame 127 --
 * one frame, fully opaque, already at its destination, 130ms AFTER the keyboard
 * had finished. Which is what "it shows up much slower than the keyboard, and it
 * looks bad" actually was.
 *
 * WHY A COMPONENT AND NOT A HOOK SOMEBODY CALLS. Because "exactly once" has to
 * be a structural fact rather than a convention. A hook can be called from two
 * places by accident -- it was, in the same file, sixty lines apart, and the
 * comments in useKeyboardLift did not stop it. Mounting one element in one
 * layout is a thing a reviewer can see is true.
 *
 * WHY THE GATED LAYOUT. Above every screen in the group, so navigation cannot
 * unmount it mid-keyboard, and it is outside the pager so a tab change cannot
 * re-create it. Not the root layout: the sign-in screen has its own keyboard and
 * no bar riding it, and an observer mounted before the session exists would
 * outlive sign-out.
 */
export function KeyboardProbe(): null {
  useKeyboardObserver();
  return null;
}
