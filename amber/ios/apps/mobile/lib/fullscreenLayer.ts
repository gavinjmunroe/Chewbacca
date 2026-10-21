import { useEffect, useState } from 'react';

// "IS SOMETHING COVERING THE WHOLE SCREEN RIGHT NOW?"
//
// "When you go into a direct message, the bottom banner tabs should go away and
//  the search bar should go away. The only thing that should be in there is the
//  messages between you and the person and the ability to send voice."
//
// A direct message is an absolute layer inside the Contacts page, which is inside
// the pager -- pushing a route from within a pager loses the pager's position, so
// the chat covers the tab instead. That works, but the People header, the one
// search bar and the tab pill all live OUTSIDE the pager, above it, so they were
// still drawn on top of the conversation: two headers stacked at the top and the
// composer sitting behind a search field and a tab bar. His screenshot is exactly
// that.
//
// The page cannot reach those. So it says so here, and home.tsx listens.
//
// WHY A STORE RATHER THAN A PROP, same reasoning as todayFocus: the three pages
// are memoized elements so that a tab change re-renders the screen and the tab
// bar and nothing else. Threading "a DM is open" up through the pager would
// rebuild every page on open and on close.
//
// It is a COUNT, not a boolean. Two things could conceivably cover the screen at
// once (a DM, and a sheet opened from inside it), and a boolean would let the
// first one to close reveal the chrome underneath the second.

let depth = 0;
const listeners = new Set<(v: boolean) => void>();

function publish(): void {
  const covered = depth > 0;
  for (const fn of listeners) fn(covered);
}

/** Claim the screen. Returns the release function; call it exactly once. */
export function enterFullscreenLayer(): () => void {
  depth += 1;
  publish();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    depth = Math.max(0, depth - 1);
    publish();
  };
}

export function isFullscreenLayerOpen(): boolean {
  return depth > 0;
}

export function useFullscreenLayer(): boolean {
  const [value, setValue] = useState(depth > 0);
  useEffect(() => {
    // Re-sync on mount: the value may have changed between render and subscribe.
    setValue(depth > 0);
    listeners.add(setValue);
    return () => {
      listeners.delete(setValue);
    };
  }, []);
  return value;
}
