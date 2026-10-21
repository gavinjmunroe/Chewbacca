import { useEffect, useState } from 'react';

// IS THE MONTH OPEN, AND HOW DOES ANYTHING ELSE CLOSE IT?
//
// The strip lives in the header, above the pager, and the thing that most needs
// to close it — a tap on the page underneath — lives inside the page. There is no
// prop path between them that does not cross the memoized page boundary that
// exists specifically to keep tab changes cheap, so this is published the same
// way todayFocus is: a module store, two variables, one Set.
//
// The collapse function is registered by the strip rather than reimplemented by
// the caller, so the spring and the React state that mirror each other are set in
// exactly one place. The whole class of bug in this component has been those two
// disagreeing.

let expanded = false;
const listeners = new Set<(v: boolean) => void>();
let collapseFn: (() => void) | null = null;

export function publishStripExpanded(next: boolean): void {
  if (next === expanded) return;
  expanded = next;
  for (const fn of listeners) fn(next);
}

export function registerStripCollapse(fn: (() => void) | null): void {
  collapseFn = fn;
}

/** Close the month, animated. Safe to call when it is already closed. */
export function collapseStrip(): void {
  collapseFn?.();
}

export function useStripExpanded(): boolean {
  const [value, setValue] = useState(expanded);
  useEffect(() => {
    setValue(expanded);
    listeners.add(setValue);
    return () => {
      listeners.delete(setValue);
    };
  }, []);
  return value;
}
