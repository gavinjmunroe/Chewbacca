/**
 * THE STOP BUTTON THAT WOULD NOT GO AWAY.
 *
 *   "For some reason, there's just a black square at the bottom in my search
 *    bar. Instead of the waveform, it just shows the black stop square, and if I
 *    press it, nothing happens."
 *
 * `busy` is module state and the bar that reads it is global, so it outlives the
 * conversation that raised it. Close the chat mid-stream and the flag stays up
 * with nobody left who can lower it -- including the stop button, because the
 * stopper unregistered on the way out.
 *
 * These are about LIFECYCLE, not rendering: who raises the flag, who lowers it,
 * and what happens when whoever raised it is gone. That is the whole bug, and
 * none of it needs a renderer.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  __resetAskBridgeForTests,
  askAvailable,
  askBusy,
  publishAskBusy,
  registerAskStopper,
  registerAskSubmitter,
  stopAsk,
  submitAsk,
  __askBusyListenersForTests,
} from './askBridge.ts';

test('the flag comes down when the conversation that raised it unmounts', () => {
  /**
   * THE BUG, EXACTLY. A reply is streaming, the user closes Voice Chat, and the
   * conversation unmounts holding the flag up. Before this, `busy` stayed true
   * for the life of the app and the global bar drew a stop square on every
   * screen from then on.
   */
  __resetAskBridgeForTests();
  const off = registerAskStopper(() => {});
  publishAskBusy(true);
  assert.equal(askBusy(), true);

  off();
  assert.equal(askBusy(), false, 'the flag outlived the conversation that set it');
});

test('subscribers are told, not just the flag reset', () => {
  // The bar is already mounted and only re-renders when it hears. A silent
  // reset would fix the state and leave the square on screen anyway.
  __resetAskBridgeForTests();
  const heard: boolean[] = [];
  const off = registerAskStopper(() => {});
  publishAskBusy(true);

  // Subscribe the way useAskBusy does, through the exported surface.
  const seen: boolean[] = [];
  const unsub = subscribe((b) => seen.push(b));
  off();
  unsub();

  heard.push(...seen);
  assert.deepEqual(heard, [false], 'nobody was told the stream had ended');
});

test('a remount that already owns the wire keeps its own state', () => {
  /**
   * The guard the submitter already had, extended to the flag. During a page
   * transition React can mount the new conversation before the old one's cleanup
   * runs; an unconditional clear on the way out would blank the stop button on a
   * stream that is genuinely live.
   */
  __resetAskBridgeForTests();
  const offOld = registerAskStopper(() => {});
  const offNew = registerAskStopper(() => {});
  publishAskBusy(true);

  offOld();
  assert.equal(askBusy(), true, 'a stale unmount lowered a live stream');

  offNew();
  assert.equal(askBusy(), false);
});

test('stopping calls the abort AND lowers the flag', () => {
  __resetAskBridgeForTests();
  let aborted = 0;
  const off = registerAskStopper(() => {
    aborted += 1;
  });
  publishAskBusy(true);

  stopAsk();
  assert.equal(aborted, 1, 'the conversation was never told to stop');
  assert.equal(askBusy(), false);
  off();
});

test('STOPPING WITH NOTHING LISTENING STILL CLEARS IT', () => {
  /**
   * The half the user actually pressed. With the conversation gone there is no
   * abort to call, and the old stopAsk did exactly nothing: `stopper?.()` on a
   * null. A button that does nothing is the one thing this app cannot ship, so
   * the floor is that the flag always comes down.
   */
  __resetAskBridgeForTests();
  publishAskBusy(true);
  assert.doesNotThrow(() => stopAsk());
  assert.equal(askBusy(), false);
});

test('a repeat publish does not wake every subscriber', () => {
  // publishAskBusy is called from an effect on every render of the conversation.
  // Announcing an unchanged value would re-render the bar on every token.
  __resetAskBridgeForTests();
  const seen: boolean[] = [];
  const unsub = subscribe((b) => seen.push(b));
  publishAskBusy(true);
  publishAskBusy(true);
  publishAskBusy(true);
  publishAskBusy(false);
  unsub();
  assert.deepEqual(seen, [true, false]);
});

test('the submitter wire is unchanged by any of this', () => {
  // The flag now rides on the stopper's registration. The submitter's ownership
  // rule is what it always was, and a regression here would silently stop the
  // shared bar from reaching the conversation at all.
  __resetAskBridgeForTests();
  assert.equal(askAvailable(), false);
  const sent: string[] = [];
  const off = registerAskSubmitter((t) => sent.push(t));
  assert.equal(askAvailable(), true);

  submitAsk('  what is on my calendar  ');
  submitAsk('   ');
  assert.deepEqual(sent, ['what is on my calendar'], 'blank input reached the conversation');

  off();
  assert.equal(askAvailable(), false);
  submitAsk('nobody is listening');
  assert.equal(sent.length, 1, 'a message reached a conversation that had unmounted');
});

/**
 * Subscribe the way useAskBusy does, without a renderer.
 *
 * The listener Set is private on purpose, so this goes in through the hook's own
 * mechanism: a listener is added by the hook's effect and called on change. The
 * test drives that contract directly rather than reaching into the module.
 */
function subscribe(fn: (b: boolean) => void): () => void {
  // useAskBusy's effect body, minus React: add to the Set, return the remover.
  // Exercised through the exported reset + publish, which is the same path the
  // app uses.
  const listeners = __askBusyListenersForTests();
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
