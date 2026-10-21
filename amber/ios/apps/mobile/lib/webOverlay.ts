import { useEffect, useState } from 'react';
import type { CirclePreview } from './circles';
import type { WebPerson } from './connectionsWeb';

/**
 * IS THE EXPANDED WEB OPEN, AND WHO OWNS THE SURFACE IT DRAWS ON?
 *
 * (Carried over from lib/circlesWeb.ts, which this replaces. The reasoning below
 * is the expensive part and none of it changed when the nodes became people.)
 *
 * It used to be a React Native `Modal` living inside the card on the Profile
 * page, and every complaint about that transition came from that one decision. A
 * Modal is a NATIVE overlay above the entire navigation stack, so:
 *
 *   * `router.push` from inside it puts the pushed screen UNDERNEATH it, which
 *     meant the web had to be dismissed first, the push deferred until iOS said
 *     the dismissal had finished, and the screen opened one whole animation
 *     later -- the "flash of the profile page" was the profile page, genuinely
 *     on screen, in the gap between those two animations;
 *   * coming back had to RE-OPEN it from useFocusEffect, which is a second
 *     un-asked-for animation after the pop has already finished -- the "it
 *     glitches and shows another screen" on the way back;
 *   * gestures inside it are inert unless its content carries its own
 *     GestureHandlerRootView, because it is outside the app's.
 *
 * None of that is a timing problem, so none of it is fixable by tuning delays.
 * The web is an ordinary absolutely-positioned overlay rendered by
 * app/(gated)/home.tsx, INSIDE the navigation stack. Opening somebody is a plain
 * push over it; the pop reveals it again exactly as it was, because it never
 * went anywhere. Nothing to dismiss, nothing to re-open, no nested root view.
 *
 * It is published the same way todayFocus and the month strip are: the card is
 * inside HomePage's memoized page boundary and the overlay is outside it, and
 * there is no prop path between them that does not defeat the memo that exists
 * to keep tab changes cheap. Module-level state, one Set of listeners.
 */

export type WebOverlayPayload = {
  people: WebPerson[];
  circles: CirclePreview[];
  /** Circle ids in the order the person pinned them, so the pill row agrees
   *  with the grid on the screen behind this one. */
  pinnedIds: string[];
  monogram: string;
  /** Which circle is filtered when it opens, so the card and the overlay agree. */
  circleId: string | null;
};

let payload: WebOverlayPayload | null = null;
const listeners = new Set<(v: WebOverlayPayload | null) => void>();

function emit(): void {
  for (const fn of listeners) fn(payload);
}

/** Open the full-screen web over whatever is on screen. */
export function openWebOverlay(p: WebOverlayPayload): void {
  payload = p;
  emit();
}

/** Close it. Safe to call when it is already closed. */
export function closeWebOverlay(): void {
  if (!payload) return;
  payload = null;
  emit();
}

export function useWebOverlay(): WebOverlayPayload | null {
  const [value, setValue] = useState(payload);
  useEffect(() => {
    setValue(payload);
    listeners.add(setValue);
    return () => {
      listeners.delete(setValue);
    };
  }, []);
  return value;
}
