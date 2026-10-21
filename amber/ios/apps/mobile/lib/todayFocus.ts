import { useEffect, useState } from 'react';

// "IS THE TODAY PAGE THE ONE YOU ARE LOOKING AT?", published without re-rendering
// Today.
//
// The month strip stays expanded when you leave the People tab and come back,
// because nothing tells it you left. The pager keeps all four pages MOUNTED — that
// is what makes the swipe smooth — so there is no unmount, and expo-router's focus
// never changes because all four pages are one route.
//
// The obvious fix is to pass `isActive` into HomePage the way ProfilePage gets it.
// That is exactly what the long note in home.tsx warns against: the pages are held
// as memoized elements precisely so a `currentPage` write re-renders the screen and
// the tab bar and NOTHING else. Threading a prop through HomePage would rebuild a
// 1,300-line page on every tab change, during the slide, which is the stutter that
// took a long time to remove.
//
// So the signal is published module-side and only the ONE component that cares
// subscribes. Same pattern and same reasoning as askBridge: a tiny store beats a
// prop when the prop would have to cross something expensive to reach its consumer.
// Two variables and a Set of listeners; nothing grows per user or per row.

let active = true;
const listeners = new Set<(v: boolean) => void>();

/** Called by the pager when a page SETTLES. Deliberately the settled signal and not
 *  the synchronous one: resetting mid-slide would collapse the strip in view. */
export function publishTodayActive(next: boolean): void {
  if (next === active) return;
  active = next;
  for (const fn of listeners) fn(next);
}

export function useTodayActive(): boolean {
  const [value, setValue] = useState(active);
  useEffect(() => {
    // Re-sync on mount: the value may have changed between render and subscribe.
    setValue(active);
    listeners.add(setValue);
    return () => {
      listeners.delete(setValue);
    };
  }, []);
  return value;
}
