"use client";

/**
 * IS THE SCREEN I AM ON ACTUALLY BEING LOOKED AT?
 *
 * The console keeps every tab mounted and hides it with CSS, because
 * unmounting and rebuilding a screen on every click is what made it feel
 * slow. The honest cost of that choice is that a hidden screen is still
 * alive: its state is intact, which is the point, but so are its intervals,
 * which is not.
 *
 * `document.visibilityState` does not help here — the browser tab is visible,
 * it is OUR tab that is not — so the information has to come from the thing
 * that did the hiding. A screen that polls reads this and holds still; a
 * screen with no timers can ignore it.
 *
 * Defaults to true, so a component rendered outside any Keep behaves exactly
 * as it did before this existed.
 */

import { createContext, useContext } from "react";

export const ScreenVisible = createContext(true);

export const useScreenVisible = () => useContext(ScreenVisible);
