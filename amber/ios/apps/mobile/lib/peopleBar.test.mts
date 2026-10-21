/**
 * THE FOOT OF A PAGE HAS TO CLEAR THE BAR THAT FLOATS OVER IT.
 *
 *   "The bottom part for the 'What Amber Knows' ... doesn't go all the way down.
 *    It is hidden behind the search bar, so I can't see the words 'Nothing Yet'
 *    on Spiritual and the bottom of the card."
 *
 * The profile padded its scroll with clLayout.tabBarClearance. That constant is
 * 132 and it is named for what it clears -- the TAB PILL -- and the search dock
 * floats above the pill. So the last card was always some thirty-five points
 * short, on every phone, and nothing in the code said so: two plausible numbers,
 * one of them describing a different object.
 *
 * These tests assert the RELATIONSHIP rather than the number, which is the only
 * form that survives the bar being resized. The first one fails if the clearance
 * ever stops covering the dock; the second records why the old constant could
 * not have worked, so nobody reinstates it believing it was close enough.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PEOPLE_BAR_GAP,
  PEOPLE_BAR_H,
  TAB_BAR_HEIGHT,
  peopleBarBottom,
  peopleBarClearance,
} from './peopleBar.ts';
import { clLayout } from './classical.ts';

/** Home-indicator phones, older phones, and the degenerate case. */
const INSETS = [0, 12, 20, 34, 44, 59];

test('a page that clears this cannot be overlapped by the dock', () => {
  for (const inset of INSETS) {
    const dockTop = peopleBarBottom(inset) + PEOPLE_BAR_H;
    assert.ok(
      peopleBarClearance(inset) >= dockTop,
      `at inset ${inset} the clearance is ${peopleBarClearance(inset)} and the dock's top edge is ${dockTop}`,
    );
  }
});

test('...with real air above the bar, not a hairline', () => {
  // Ending exactly at the bar's edge is technically unobscured and reads as
  // clipped. The trailing gap is PEOPLE_BAR_GAP, the same distance the bar sits
  // above the pill, so the foot of a page has the rhythm the rest of the stack
  // has.
  for (const inset of INSETS) {
    const slack = peopleBarClearance(inset) - (peopleBarBottom(inset) + PEOPLE_BAR_H);
    assert.equal(slack, PEOPLE_BAR_GAP, `at inset ${inset}`);
  }
});

test('THE OLD CONSTANT COULD NOT HAVE WORKED, and this records by how much', () => {
  /**
   * clLayout.tabBarClearance is not merely a bit small -- it is measuring a
   * different object. Asserting the shortfall keeps the reason legible: if
   * somebody later reads 132 and thinks "close enough, and simpler", the number
   * in this failure tells them it is thirty-odd points of unreadable card on the
   * phone in their hand.
   */
  const inset = 34; // any iPhone with a home indicator
  const dockTop = peopleBarBottom(inset) + PEOPLE_BAR_H;
  assert.ok(
    clLayout.tabBarClearance < dockTop,
    'tabBarClearance now clears the dock, so this test has lost its subject',
  );
  assert.ok(
    dockTop - clLayout.tabBarClearance >= 30,
    `the shortfall was ${dockTop - clLayout.tabBarClearance}pt`,
  );
});

test('the clearance grows with the inset, and never shrinks', () => {
  // A taller home indicator can only push the bar further up the screen, so a
  // clearance that went the other way would mean the formula had been inverted
  // somewhere -- which is exactly the kind of mistake a single hard-coded device
  // makes invisible.
  for (let i = 1; i < INSETS.length; i += 1) {
    assert.ok(
      peopleBarClearance(INSETS[i]!) >= peopleBarClearance(INSETS[i - 1]!),
      `inset ${INSETS[i]} gave less room than ${INSETS[i - 1]}`,
    );
  }
});

test('a phone with no inset still gets padding off the physical edge', () => {
  // peopleBarBottom floors the inset at 12 rather than trusting it: a device
  // reporting 0 is a device whose bar would otherwise touch the bottom of the
  // glass.
  assert.equal(peopleBarClearance(0), peopleBarClearance(12));
  assert.ok(peopleBarClearance(0) > TAB_BAR_HEIGHT + PEOPLE_BAR_H);
});
