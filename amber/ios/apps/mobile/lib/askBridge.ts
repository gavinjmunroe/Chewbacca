import { useEffect, useState } from 'react';

// THE BAR IS NOT INSIDE THE CONVERSATION ANY MORE, SO THEY NEED A WIRE.
//
// The Ask composer used to live inside AskChat, which lives inside the Circles
// PAGE, which slides. That is why it could never look like the same bar as the one
// on Contacts: one was pinned to the screen and the other moved with its page.
//
// The bar is now rendered once, above the pager. The conversation still owns
// everything about itself — its turns, its streaming, its abort controller — so
// instead of hoisting that state (which would drag the whole chat into the screen
// component and couple the two forever) the two sides publish the small surface
// they need from each other:
//
//   AskChat  -> registerAskSubmitter(fn)   "here is how to send a message to me"
//   AskChat  -> publishAskBusy(bool)       "I am streaming, show a stop button"
//   the dock -> submitAsk(text)            "the user sent this"
//
// A module-level store rather than a context because the two are in DIFFERENT
// provider subtrees on purpose: the voice-capture overlay keeps its own chat
// context so a recorded note never lands in the Ask thread, and that isolation is
// worth keeping. Scales fine — it is two references and a Set of listeners, with no
// per-user or per-row growth.
//
// ── AND MODULE STATE OUTLIVES THE COMPONENT THAT SET IT ─────────────────────
//
//   "For some reason, there's just a black square at the bottom in my search bar.
//    Instead of the waveform, it just shows the black stop square, and if I press
//    it, nothing happens."
//
// Exactly what it looks like: `busy` is a module-level boolean, and the ONLY
// thing that ever set it back to false was the conversation itself. Close the
// Voice Chat overlay while a reply is still streaming and that conversation
// unmounts holding the flag up. The bar, which is global and did not unmount,
// keeps rendering a stop button forever -- and the stopper unregistered on the
// way out, so `stopAsk()` had nothing to call and the button did nothing. The
// one control on the screen that could have cleared it was the one control that
// could not.
//
// A flag that outlives its owner is a leak, so the fix is ownership rather than
// another place that remembers to reset it: the flag belongs to whoever holds
// the wire, and it dies with them.
type Submitter = (text: string) => void;

let submitter: Submitter | null = null;
let busy = false;
const busyListeners = new Set<(b: boolean) => void>();

/**
 * Called by the conversation on mount. Returns an unregister function; the LAST
 * mounted conversation wins, and unmounting only clears the wire if it still owns
 * it, so a remount during a page transition cannot leave the bar talking to a dead
 * component.
 */
export function registerAskSubmitter(fn: Submitter): () => void {
  submitter = fn;
  return () => {
    if (submitter === fn) submitter = null;
  };
}

/** True when a conversation is mounted and listening. */
export function askAvailable(): boolean {
  return submitter !== null;
}

/** Send what the user typed to the conversation. No-op when nothing is listening,
 *  which is the correct behavior while the Circles page is not mounted. */
export function submitAsk(text: string): void {
  const t = text.trim();
  if (!t) return;
  submitter?.(t);
}

export function publishAskBusy(next: boolean): void {
  if (busy === next) return;
  busy = next;
  for (const l of busyListeners) l(next);
}

/**
 * Is a reply streaming right now?
 *
 * The plain read, for anything that is not a component -- and for the hook
 * below, so there is one definition of the answer rather than two.
 */
export function askBusy(): boolean {
  return busy;
}

/** Subscribe to the streaming flag, so the bar can show stop instead of send. */
export function useAskBusy(): boolean {
  const [value, setValue] = useState(askBusy);
  useEffect(() => {
    setValue(askBusy());
    busyListeners.add(setValue);
    return () => {
      busyListeners.delete(setValue);
    };
  }, []);
  return value;
}

let stopper: (() => void) | null = null;

/**
 * The conversation's abort. Registered alongside the submitter.
 *
 * UNREGISTERING TAKES THE BUSY FLAG WITH IT. Nobody else can lower it: the flag
 * is published by the conversation, and once that conversation is gone there is
 * no code left that will ever call publishAskBusy(false). Same ownership guard
 * as the submitter -- a remount that has already claimed the wire keeps its own
 * state, so a page transition cannot blank a live stream's stop button.
 */
export function registerAskStopper(fn: () => void): () => void {
  stopper = fn;
  return () => {
    if (stopper !== fn) return;
    stopper = null;
    publishAskBusy(false);
  };
}

/**
 * Stop the stream.
 *
 * THE FLAG COMES DOWN EVEN WITH NOBODY LISTENING. A stop button that visibly
 * does nothing is worse than no button at all, and "nothing to abort" is
 * precisely the state a stale flag leaves behind. If a conversation IS live, its
 * own abort sets busy false a moment later anyway, so this is not racing it --
 * it is the floor underneath it.
 */
export function stopAsk(): void {
  const fn = stopper;
  publishAskBusy(false);
  fn?.();
}

/**
 * TEST SEAM. The module's state is global by design, which means one test can
 * leave it set for the next one. Not exported to the app.
 */
export function __resetAskBridgeForTests(): void {
  submitter = null;
  stopper = null;
  busy = false;
  busyListeners.clear();
}

/**
 * TEST SEAM. useAskBusy's subscription, reachable without a renderer -- the
 * point of these tests is who lowers the flag, and "was anybody told" is half of
 * that. Not exported to the app.
 */
export function __askBusyListenersForTests(): Set<(b: boolean) => void> {
  return busyListeners;
}
