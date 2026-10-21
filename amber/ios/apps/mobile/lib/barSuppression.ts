import { useEffect, useRef, useState } from 'react';
import { makeMutable } from 'react-native-reanimated';

/**
 * WHEN THE ONE BAR SHOULD GET OUT OF THE WAY.
 *
 * "When I press to add a comment, the entire Amber search bar comes up with it.
 *  When I press somewhere to type, the search bar should not come up with it;
 *  just the keyboard should."
 *
 * WHY IT HAPPENS. SearchDock rides the keyboard from the first frame -- see
 * useKeyboardBarLift, which exists because the bar used to sit still while the
 * keyboard slid up over it. It rides ANY keyboard, because a keyboard event
 * says nothing about who opened it. So a comment field on a feed card raises
 * the keyboard, and Amber's own composer comes up riding on top of it, four
 * points above the field you are actually typing into.
 *
 * THE FIX IS NOT A KEYBOARD HEURISTIC. "Only lift if the dock's own field has
 * focus" sounds right and is wrong the other way: the dock has to keep riding
 * when its OWN field is focused, and RN gives no reliable "which input" signal
 * across the two-view boundary the pager creates. Guessing produces a bar that
 * sometimes hides when it should not.
 *
 * So a field that owns the keyboard SAYS SO. Any surface with its own text
 * input claims suppression while focused and releases it on blur; the dock
 * fades out and stops hit-testing while anything holds a claim. Explicit,
 * symmetric, and the same shape as lib/monthStrip -- a module store, because
 * the dock lives above the pager and the field lives inside a memoized page,
 * with no prop path between them that does not defeat the memo.
 *
 * A COUNT, NOT A BOOLEAN. Two fields can be mounted and one can take focus from
 * the other -- a comment box and the sheet's composer -- and the blur of the
 * first arrives AFTER the focus of the second. A boolean would be cleared by
 * that late blur and the bar would pop back up mid-typing.
 */

let claims = 0;
const listeners = new Set<(v: boolean) => void>();

/**
 * THE SAME ANSWER ON THE UI THREAD, and this is not a convenience.
 *
 * "There's glitchiness with the search bar whenever the keyboard goes up for
 *  the comments, and then when it goes down, the search bar appears in the
 *  middle of the screen and then pops down weirdly."
 *
 * That is a thread race, and it is worth naming precisely. The bar's POSITION
 * is a pure function of the live keyboard height computed on the UI thread --
 * it has to be, see the three failed versions in useKeyboardLift. Its
 * VISIBILITY was React state on the JS thread. So on dismissal the keyboard
 * starts falling and the bar starts falling with it, both at 60fps on the UI
 * thread, while the "you can be visible again" flag crosses from JS a frame or
 * two later -- and it arrives while the bar is still halfway up the screen.
 * The bar appears in mid-air and rides the rest of the way down.
 *
 * A shared value fixes it because the opacity is then decided on the same
 * thread, in the same frame, as the position.
 */
export const barSuppressedSV = makeMutable(false);

function publish() {
  const suppressed = claims > 0;
  barSuppressedSV.value = suppressed;
  for (const fn of listeners) fn(suppressed);
}

/** Claim the keyboard. Returns the release, so a caller cannot forget which. */
export function suppressBar(): () => void {
  claims += 1;
  publish();
  let released = false;
  return () => {
    // Idempotent: a component that releases on blur AND on unmount must not
    // decrement twice and free somebody else's claim.
    if (released) return;
    released = true;
    claims = Math.max(0, claims - 1);
    publish();
  };
}

/**
 * Is anything currently holding the keyboard?
 *
 * The plain read, for a test and for imperative code. The hook below is what a
 * view uses; this is the same value without a subscription.
 */
export function isBarSuppressed(): boolean {
  return claims > 0;
}

/** Is anything currently holding the keyboard? */
export function useBarSuppressed(): boolean {
  const [value, setValue] = useState(claims > 0);
  useEffect(() => {
    setValue(claims > 0);
    listeners.add(setValue);
    return () => {
      listeners.delete(setValue);
    };
  }, []);
  return value;
}

/**
 * The pair of handlers for one text input.
 *
 * RELEASES ON UNMOUNT TOO. A card scrolled off, a sheet dismissed while
 * focused, a screen popped -- none of those fire onBlur, and a claim left
 * behind hides the app's main control until the next reload.
 */
export function useKeyboardClaim(): { onFocus: () => void; onBlur: () => void } {
  const release = useRef<null | (() => void)>(null);
  useEffect(
    () => () => {
      release.current?.();
      release.current = null;
    },
    [],
  );
  return {
    onFocus: () => {
      if (!release.current) release.current = suppressBar();
    },
    onBlur: () => {
      release.current?.();
      release.current = null;
    },
  };
}

/**
 * SHOULD THE BAR STAY HIDDEN THIS FRAME, given where it was last frame?
 *
 * IT LIVES HERE, NOT IN SearchDock, for the same reason `barLift` lives in
 * useKeyboardLift rather than in the bar that uses it: the bar's visibility has now been wrong four times, every one of them
 * found by a person holding a phone, and it is three booleans in and one boolean
 * out -- the most testable thing in the file, and it was living inside a
 * reaction where nothing could reach it.
 *
 *   claimed   another field is holding the keyboard (lib/barSuppression)
 *   height    the live keyboard height, this frame
 *   mine      this dock's own field has focus
 *
 * The latch exists because "hidden" outlasts "claimed": a comment box blurs and
 * releases while the keyboard is still falling, and the bar is still lifted, so
 * fading in on the release makes it appear in mid-air. It must wait for the
 * keyboard to be gone -- UNLESS this field now has focus, which is how the
 * keyboard stays up while the claim disappears.
 *
 * `'worklet'` keeps it callable from the UI thread; at runtime the directive is
 * only a string, so plain Node can call it too.
 */
export function nextHoldover(
  was: boolean,
  { claimed, height, mine }: { claimed: boolean; height: number; mine: boolean },
): boolean {
  'worklet';
  // Somebody else has the keyboard: hide, and remember that we are hiding.
  if (claimed) return true;
  // Our own field has it: this bar is the thing being typed into. Never hide.
  if (mine) return false;
  // Released, and the keyboard has finished leaving: safe to come back.
  if (height <= 1) return false;
  // Released, keyboard still falling, not ours: this is the mid-air frame.
  return was;
}

/** Test seam: forget every claim. Never called by the app. */
export function __resetBarSuppressionForTests(): void {
  claims = 0;
  publish();
}
