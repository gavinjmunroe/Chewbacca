// THE ONE BOTTOM BAR.
//
// It belongs to the app rather than to a tab: one instance above the pager, on
// every page, changing only its words and what it does with them (see
// lib/searchModes). The geometry lives here so anything that positions it
// imports these rather than recomputing them -- which is the only way two
// components stay aligned through later edits.
//
// It used to be two bars, one on Contacts and one on the Ask page, computing
// their resting position from the same ingredients and arriving at different
// answers (126pt vs 116pt). The bar visibly jumped ten points as the pages
// crossed. That cannot recur now that there is one of it, but the numbers stay
// here anyway: the dock positions it and PeopleBottomBar shapes it, and those
// are two files that have to agree.

import { clLayout } from './classical';

/**
 * Height of the tab pill the bar sits above.
 *
 * DEFINED HERE, NOT IN TabBar.tsx, and that is a deliberate reversal. It is a
 * layout NUMBER, shared by the component that draws the pill and the geometry
 * that positions everything above it -- and while it lived in the component,
 * this module (and anything else that needed the number) had to import a .tsx
 * file to get it. That pulls a whole React component, its icons and its
 * animation library in behind one integer.
 *
 * components/TabBar.tsx re-exports it, so every existing import still works.
 *
 * 72 -> 56, with the icons, the egg and the row all coming down with it. The bar
 * above it went 56 -> 62 in the same pass, so the ranking is the right way round:
 * the primary control out-sizes the navigation under it.
 */
export const TAB_BAR_HEIGHT = 56;

/**
 * Bar height. Deliberately generous: this is the primary control of the whole
 * app, so it earns its size — and it now has to out-rank the tab pill below it,
 * which shrank for exactly that reason. 54 -> 56 -> 62.
 */
export const PEOPLE_BAR_H = 62;

/** Clearance between the top of the tab pill and the bottom of the bar. */
export const PEOPLE_BAR_GAP = 14;

/**
 * Inset from the screen edge. The Contacts bar used 16 and the Circles composer
 * used spacing.lg (24), so the Circles bar was 32pt narrower overall — the most
 * visible of the differences between them, and one that no amount of sharing the
 * HEIGHT could have fixed, because it lives on the wrapper rather than the bar.
 * Both import this now.
 */
export const PEOPLE_BAR_SIDE = clLayout.barSide;

/**
 * Resting distance from the bottom of the screen. A notch above the tab pill:
 * enough air that the two do not read as one stacked block, not so much that the
 * bar eats into the content above it.
 */
export function peopleBarBottom(insetBottom: number): number {
  return Math.max(insetBottom, 12) + TAB_BAR_HEIGHT + PEOPLE_BAR_GAP;
}

/**
 * HOW MUCH ROOM A SCROLLING PAGE HAS TO LEAVE AT ITS FOOT.
 *
 *   "The bottom part for the 'What Amber Knows' ... doesn't go all the way down.
 *    It is hidden behind the search bar, so I can't see the words 'Nothing Yet'
 *    on Spiritual and the bottom of the card."
 *
 * The profile padded its scroll with clLayout.tabBarClearance, which is 132 and
 * is named for what it clears: the TAB PILL. The search dock floats above the
 * pill, and its top edge is at peopleBarBottom + PEOPLE_BAR_H -- about 166 on a
 * phone with a home indicator. So the last card was some thirty-five points
 * short of the bar, every time, and the fix cannot be a bigger literal because
 * the number depends on the device's own inset.
 *
 * THE FOURTH TIME THIS CODEBASE HAS SHIPPED ONE NUMBER COMPUTED IN TWO PLACES
 * (the web's hub, its lines, its labels, the splash). AskChat already derived
 * this same total inline as `peopleBarBottom(insets.bottom) + PEOPLE_BAR_H +
 * spacing.md`, correctly and separately -- which is what a shared number looks
 * like just before it stops agreeing.
 *
 * The trailing gap is PEOPLE_BAR_GAP again, so content ends the same distance
 * above the bar as the bar sits above the pill. That is a rhythm rather than a
 * guess, and it is why this is not just "+16".
 */
export function peopleBarClearance(insetBottom: number): number {
  return peopleBarBottom(insetBottom) + PEOPLE_BAR_H + PEOPLE_BAR_GAP;
}

// The placeholders moved to lib/searchModes with the rest of the per-tab
// configuration, so there is one table describing what the bar is rather than a
// table for its words and a separate pair of constants here.
