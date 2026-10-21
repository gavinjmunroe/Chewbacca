import { useCallback, useEffect, useRef } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

/**
 * Clear something after the user has been away long enough that coming back
 * should feel like a fresh start.
 *
 * WHY IT IS TIED TO FOREGROUNDING AND NOT TO A TIMER. A timer that fires while the
 * app is open would wipe a thread the user is in the middle of reading, which is a
 * far worse bug than a stale one. And a timer that fires while BACKGROUNDED cannot
 * be trusted anyway: iOS suspends JS timers, so it would land at an arbitrary
 * moment after the user returns rather than at the moment they left plus ten
 * minutes. So the only thing measured is wall-clock time spent away, and the only
 * moment anything is cleared is the instant the app becomes active again.
 *
 * `touch()` is what "actively using it" means — call it on send, on typing, on any
 * deliberate interaction. Anything after the last touch counts as idle.
 *
 *   const touch = useIdleReset(resetChat, { afterMs: 10 * 60_000, enabled: hasContent })
 */
export function useIdleReset(
  onReset: () => void,
  { afterMs = 10 * 60_000, enabled = true }: { afterMs?: number; enabled?: boolean } = {},
): () => void {
  const lastTouch = useRef(Date.now());
  // Read through refs so changing either never re-subscribes the AppState listener:
  // a listener that churns can miss the very transition it exists for.
  const resetRef = useRef(onReset);
  resetRef.current = onReset;
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  const afterRef = useRef(afterMs);
  afterRef.current = afterMs;

  const touch = useCallback(() => {
    lastTouch.current = Date.now();
  }, []);

  useEffect(() => {
    let previous: AppStateStatus = AppState.currentState;
    const sub = AppState.addEventListener('change', (next) => {
      const cameBack = previous !== 'active' && next === 'active';
      previous = next;
      if (!cameBack) {
        // Leaving: the clock starts now. Without this, time spent away only counted
        // from the last INTERACTION, so putting the phone down mid-sentence and
        // returning a minute later could still clear.
        lastTouch.current = Date.now();
        return;
      }
      if (!enabledRef.current) return;
      if (Date.now() - lastTouch.current < afterRef.current) return;
      resetRef.current();
    });
    return () => sub.remove();
  }, []);

  return touch;
}
