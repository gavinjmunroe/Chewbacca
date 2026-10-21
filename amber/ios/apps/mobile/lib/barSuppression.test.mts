/**
 * THE ONE BAR GETTING OUT OF THE WAY, AND THE ORDER EVENTS ACTUALLY ARRIVE IN.
 *
 * "When I press to add a comment, the entire Amber search bar comes up with it."
 *
 * The feature is two lines. The bug it is built around is not: React Native
 * delivers the NEW field's focus before the OLD field's blur, so a boolean
 * "somebody is typing" flag gets cleared by a blur belonging to a field nobody
 * is looking at any more -- and Amber's composer pops back up over the keyboard
 * halfway through a sentence. That is why this is a COUNT.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  nextHoldover,
  __resetBarSuppressionForTests,
  isBarSuppressed,
  suppressBar,
} from './barSuppression.ts';

test('a field claiming the keyboard hides the bar, and releasing brings it back', () => {
  __resetBarSuppressionForTests();
  assert.equal(isBarSuppressed(), false);
  const release = suppressBar();
  assert.equal(isBarSuppressed(), true);
  release();
  assert.equal(isBarSuppressed(), false);
});

test('THE HANDOFF: the next field focuses BEFORE the last one blurs', () => {
  __resetBarSuppressionForTests();
  // Tapping the sheet's composer while the card's comment box is focused. RN
  // delivers these in exactly this order.
  const cardRelease = suppressBar(); // card focuses
  const sheetRelease = suppressBar(); // sheet focuses  -- arrives first
  cardRelease(); //                      card blurs     -- arrives second

  // A boolean would be false here: the bar would be back, on top of the
  // keyboard, while the sheet's field still has focus and the user is typing.
  assert.equal(isBarSuppressed(), true, 'the bar came back mid-sentence');

  sheetRelease();
  assert.equal(isBarSuppressed(), false);
});

test('releasing twice cannot free somebody else s claim', () => {
  __resetBarSuppressionForTests();
  const a = suppressBar();
  const b = suppressBar();
  a();
  a();
  a();
  // Three releases from one claimant. If they had all decremented, b's claim
  // would be gone and the bar would be visible over b's focused field.
  assert.equal(isBarSuppressed(), true, 'a repeated release freed another field s claim');
  b();
  assert.equal(isBarSuppressed(), false);
});

test('a stray release cannot poison the next real claim', () => {
  __resetBarSuppressionForTests();
  const release = suppressBar();
  release();
  release();
  release();
  // If the count had gone to -2, the next claim would take it to -1 and the bar
  // would stay visible over a focused field.
  assert.equal(isBarSuppressed(), false);
  const real = suppressBar();
  assert.equal(isBarSuppressed(), true, 'a claim after a stray release did not suppress');
  real();
  assert.equal(isBarSuppressed(), false);
});

test('subscribers are told, because the bar is a view and not a poll', () => {
  __resetBarSuppressionForTests();
  const seen: boolean[] = [];
  // The same subscription useBarSuppressed makes, without a React renderer.
  const release = suppressBar();
  seen.push(isBarSuppressed());
  release();
  seen.push(isBarSuppressed());
  assert.deepEqual(seen, [true, false]);
});

/**
 * THE BAR HID ITSELF FROM ITS OWN KEYBOARD, and the video is the whole story.
 *
 * "If I'm pressing the search bar, the keyboard pulls up, and the search bar is
 *  hidden. That needs to be fixed immediately. That's a major, major issue."
 *
 * The condition was `barSuppressedSV.value || kb.height.value > 1` -- ANY
 * keyboard, including the one this field had just opened. Measured off the
 * screen recording he sent, frame by frame at 60fps: the keyboard begins rising
 * at frame 77 and takes 19 frames (317ms) to arrive; the dock is already gone by
 * frame 79, 33ms in, having moved 11 pixels. It is not slow. It is absent, for
 * the entire time the keyboard is up, and it is still hit-testing -- so it was
 * an invisible field, correctly positioned, receiving text.
 *
 * The keyboard test was standing in for "somebody ELSE raised it", and those are
 * not the same claim.
 */
test('THE DOCK NEVER HIDES FROM ITS OWN KEYBOARD', () => {
  // The exact sequence in the recording: tap the field, focus, keyboard rises.
  let hidden = false;
  hidden = nextHoldover(hidden, { claimed: false, height: 0, mine: true });
  assert.equal(hidden, false, 'hidden before the keyboard even moved');
  for (const height of [58, 167, 314, 581, 839, 1003, 1032]) {
    hidden = nextHoldover(hidden, { claimed: false, height, mine: true });
    assert.equal(hidden, false, `the dock vanished at keyboard height ${height}`);
  }
});

test('but it DOES hide for somebody else, and stays hidden until that keyboard is gone', () => {
  /**
   * The other half, and the reason the keyboard test was there at all:
   *
   * "There's glitchiness with the search bar whenever the keyboard goes up for
   *  the comments, and then when it goes down, the search bar appears in the
   *  middle of the screen and then pops down weirdly."
   *
   * A comment field blurs and drops its claim while the keyboard is still
   * falling -- and the bar is still lifted, because the lift follows the live
   * keyboard height. Come back on the release and the bar appears in mid-air.
   */
  let hidden = false;
  hidden = nextHoldover(hidden, { claimed: true, height: 0, mine: false });
  assert.equal(hidden, true, 'a claim did not hide the bar');
  hidden = nextHoldover(hidden, { claimed: true, height: 1032, mine: false });
  assert.equal(hidden, true);

  // The blur. The claim is gone; the keyboard is not.
  for (const height of [1032, 800, 400, 120, 40]) {
    hidden = nextHoldover(hidden, { claimed: false, height, mine: false });
    assert.equal(hidden, true, `the bar reappeared in mid-air at height ${height}`);
  }
  // Gone.
  hidden = nextHoldover(hidden, { claimed: false, height: 0, mine: false });
  assert.equal(hidden, false, 'the bar never came back after the keyboard left');
});

test('HANDING FOCUS ACROSS shows the bar without waiting for a keyboard that never leaves', () => {
  /**
   * THE CASE A KEYBOARD TEST CANNOT EXPRESS, which is why the latch takes
   * `mine` at all. Tap a comment box, then tap straight onto the search bar: the
   * claim is released and the dock takes focus while the keyboard stays up the
   * whole time. A "wait until the height is zero" rule keeps the bar invisible
   * for as long as the person keeps typing into it -- the original bug, wearing
   * a different hat.
   */
  let hidden = nextHoldover(false, { claimed: true, height: 1032, mine: false });
  assert.equal(hidden, true);
  // Focus moves to the dock. RN delivers the new focus before the old blur, so
  // both are briefly true -- and a claim still outranks it, correctly.
  hidden = nextHoldover(hidden, { claimed: true, height: 1032, mine: true });
  assert.equal(hidden, true, 'a live claim must still win');
  // The late blur lands. Keyboard has not moved.
  hidden = nextHoldover(hidden, { claimed: false, height: 1032, mine: true });
  assert.equal(hidden, false, 'the dock stayed invisible while being typed into');
});

test('the latch only holds; it never invents a hide', () => {
  // Nothing claimed, not ours, keyboard up, and we were already visible: this is
  // somebody scrolling a list while a keyboard is open somewhere. Stay as we are
  // rather than hiding on a rule nobody asked for.
  assert.equal(nextHoldover(false, { claimed: false, height: 1032, mine: false }), false);
  assert.equal(nextHoldover(false, { claimed: false, height: 0, mine: false }), false);
});
