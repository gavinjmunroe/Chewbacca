import AsyncStorage from '@react-native-async-storage/async-storage';
import { useReanimatedKeyboardAnimation } from 'react-native-keyboard-controller';
import {
  makeMutable,
  runOnJS,
  useAnimatedReaction,
  type SharedValue,
} from 'react-native-reanimated';

// THE KEYBOARD'S HEIGHT, ON THE UI THREAD, IN STEP WITH THE KEYBOARD ITSELF.
//
// FIVE VERSIONS OF THIS HAVE BEEN WRONG. The fifth is the one worth reading,
// because four of them were arguments about the right formula and the fifth was
// the discovery that the INPUT had been two numbers the whole time.
//
//   1. Its own withTiming from a keyboardWillShow handler, matching the duration
//      iOS reported. Judged "visibly late, because the START was wrong".
//
//   2. Proportional travel, destination read from that same JS notification.
//      Lag one way, lead the other -- keyboardWillHide zeroed the target before
//      the keyboard had gone anywhere.
//
//   3. Welded to the keyboard's top edge: dy = max(0, height + gap - resting).
//      Correct, and flat for the first third of the travel, which reads as lag.
//
//   4. Proportional again, with the destination LEARNED from the live height and
//      `max()`ed against the welded floor. This is still the formula (see
//      barLift) and it is right.
//
//   5. And none of it mattered, because the live height was not live.
//
// ── WHAT WAS ACTUALLY WRONG, MEASURED OFF THREE SCREEN RECORDINGS ───────────
//
// Every version above read the keyboard through Reanimated's
// `useAnimatedKeyboard`. It was mounted three times -- twice inside SearchDock
// alone -- which Reanimated does not support, and the way it fails is silent.
// Fixing that to a single observer helped and did not solve it: frame by frame
// at 60fps, the bar then moved for exactly two frames, stopped for
// twenty-two while the keyboard kept climbing over it, and snapped to its
// destination seven frames AFTER the keyboard had arrived.
//
// So the value updated a few times per keyboard and then went quiet. Four
// carefully-reasoned formulas were interpolating between two samples.
//
// ── AND THEN THE RIGHT DIAGNOSIS, WHICH DID NOT COME FROM THE CODE ─────────
//
// "It seems like every single platform has this linking done very well, where
//  you press the search bar, and the keyboard seems attached to it and comes up.
//  It's not like a separate entity that relies on it... Right now, I think you
//  have action events where the search bar comes up, then the keyboard comes up,
//  and everything relies on timing. In reality, they should be linked as the
//  same object."
//
// That is the whole thing, and it retires an entire line of attempts. Every
// version above -- including a sixth, written and thrown away, that drove a
// withTiming from `keyboardWillShow` using iOS's own duration and easing curve
// -- was an IMITATION of the keyboard's motion. An imitation can be very close
// and is still two objects agreeing to do the same thing: it begins a frame or
// two late because the notification has to cross to JS, and it cannot follow an
// interactive drag-to-dismiss at all, because a finger is not a duration.
//
// Apps that get this right do not animate anything. On iOS the input is part of
// the keyboard -- an accessory view, which UIKit moves as one piece.
//
// react-native-keyboard-controller reaches the same place differently: it hooks
// the system keyboard's actual animation natively and publishes its position as
// a Reanimated shared value, updated on the UI thread every frame. So `height`
// below is not a model of where the keyboard probably is by now. It is where the
// keyboard is. Everything downstream -- barLift, the Ask composer's padding --
// was always written against a live per-frame height and finally has one.
//
// The learned height stays for exactly one reason: barLift needs a denominator
// on the very first frame of a cold launch, before anything has been seen.

const LEARNED_KEY = 'amber.keyboardHeight.v1';

/**
 * WHAT WE ASSUME BEFORE WE HAVE EVER SEEN A KEYBOARD, and this number is why the
 * last version still looked wrong.
 *
 * It used to be 0, meaning "unknown", and unknown fell back to welding the bar to
 * the keyboard's top edge -- which does not start moving until the keyboard has
 * climbed past the bar's own resting height. That is a third of the way up. So
 * the FIRST keyboard after every install and every update was exactly the
 * behavior he reported: "the keyboard flashes up, and then the search bar slowly
 * drags up behind it". The proportional path only kicked in from the second
 * keyboard onward, by which point he had already seen the bad one.
 *
 * 336 is a portrait iPhone keyboard with a predictive bar. It does not need to be
 * right -- see the max() in useKeyboardBarLift, which makes an over-estimate cost
 * a few points of extra clearance and an under-estimate cost nothing at all. It
 * only needs to be non-zero, so the bar leaves on the first frame of the first
 * keyboard anybody ever sees.
 */
const ASSUMED_HEIGHT = 336;

/**
 * The keyboard's full height: assumed, then learned, then remembered. One value
 * for the whole app, so the bar and the padding beneath it cannot disagree, and
 * it survives every unmount.
 *
 * CREATED LAZILY, on the first render that asks for it, rather than at module
 * load. `makeMutable` is a documented API for exactly this and works at module
 * scope -- but a throw at module scope happens while the app's imports are still
 * resolving, which is not a screen error, it is a blank app with no boundary to
 * catch it. This module is imported by the one bottom bar, which is imported by
 * the gated layout, so that blast radius is the whole app. On the first hook call
 * Reanimated is unambiguously initialized.
 */
let learnedHeightRef: SharedValue<number> | null = null;
function learnedHeight(): SharedValue<number> {
  if (!learnedHeightRef) learnedHeightRef = makeMutable(ASSUMED_HEIGHT);
  return learnedHeightRef;
}
/**
 * THE KEYBOARD'S LIVE HEIGHT, MIRRORED HERE BY THE ONE OBSERVER.
 *
 * Separate from `learnedHeight` above -- that is where the keyboard is GOING,
 * this is where it IS this frame. Module-level and created lazily for the same
 * reasons: one value for every reader, stable identity so a worklet can close
 * over it, and nothing thrown while imports are still resolving.
 */
let liveHeightRef: SharedValue<number> | null = null;
function liveHeight(): SharedValue<number> {
  if (!liveHeightRef) liveHeightRef = makeMutable(0);
  return liveHeightRef;
}

let persisted = 0;
let seeded = false;

function seedFromDisk(): void {
  if (seeded) return;
  seeded = true;
  void AsyncStorage.getItem(LEARNED_KEY)
    .then((raw) => {
      const n = Number(raw);
      // A plausible keyboard, not whatever happened to be in storage. The floor
      // rules out a stray "1" making the proportion enormous; the ceiling rules
      // out a value from a tablet or a corrupted write.
      if (Number.isFinite(n) && n >= 180 && n <= 600 && n > learnedHeight().value) {
        learnedHeight().value = n;
        persisted = n;
      }
    })
    .catch(() => {
      // Not knowing costs one imperfect keyboard, never a broken one.
    });
}

function rememberHeight(h: number): void {
  // The disk copy is a SEED for the first keyboard of a cold launch, so it wants
  // the biggest plausible height rather than the most recent one -- a numeric pad
  // remembered from last session would under-seed the letter keyboard that comes
  // up first. Only grows, and only past a plausible floor; writing on every frame
  // of every keyboard would be a disk write per frame.
  if (h <= persisted + 4) return;
  persisted = h;
  void AsyncStorage.setItem(LEARNED_KEY, String(Math.round(h))).catch(() => {});
}

/**
 * THE ONE KEYBOARD OBSERVER IN THE APP. MOUNT IT EXACTLY ONCE.
 *
 * ── WHY THIS EXISTS, MEASURED OFF A SCREEN RECORDING ────────────────────────
 *
 * Reanimated does not support `useAnimatedKeyboard` in more than one component
 * at a time. It was mounted THREE times: SearchDock called `useKeyboardLift`
 * directly for the fade AND `useKeyboardBarLift` for the position -- two in one
 * component -- and AskChat made a third whenever it was open.
 *
 * The observers fight, and the way they fail is not an error. The live height
 * simply stops arriving: you get 0, and then the final height, and nothing in
 * between. Every careful thing in this file about leaving on the first frame and
 * riding the keyboard's own curve was computing a perfect animation from a value
 * that only ever held two numbers.
 *
 * On screen that is not lag, it is a POP. From the recording, frame by frame at
 * 60fps: the keyboard begins rising at frame 102 and is fully up by 119. The
 * search bar does not move at all -- it stays at its resting position, which the
 * keyboard covers -- and then at frame 127 it appears, in ONE frame, fully
 * opaque, already at its destination. 383ms after the keyboard started and 130ms
 * after it finished. No fade (that would take ten frames) and no slide.
 *
 * "Even when the search bar does eventually show up above the keyboard, it shows
 *  up much slower than the keyboard, and it looks bad."
 *
 * ── SO THERE IS ONE OBSERVER AND EVERYTHING ELSE READS IT ──────────────────
 *
 * This hook owns the single `useAnimatedKeyboard` and mirrors it into a
 * module-level shared value on the UI thread. `useKeyboardLift` below is now a
 * pure READER -- no hook call, no listener, no possible conflict, and any number
 * of components may use it.
 *
 * The mirror costs nothing: a reaction on a shared value runs on the UI thread
 * in the same frame the value changes, so readers see the same number on the
 * same frame they would have seen it natively.
 *
 * Mounted by components/KeyboardProbe in app/(gated)/_layout -- above every
 * screen, so it cannot be unmounted by navigation and cannot be mounted twice.
 */
export function useKeyboardObserver(): void {
  const live = liveHeight();
  const full = learnedHeight();
  seedFromDisk();

  /**
   * THE REAL KEYBOARD'S REAL POSITION, EVERY FRAME.
   *
   * react-native-keyboard-controller hooks the system keyboard's own animation
   * natively and publishes it as a Reanimated shared value on the UI thread.
   * Not a duration we match and not a curve we imitate -- the actual frame of
   * the actual keyboard, which is the only thing that makes the bar and the
   * keyboard one motion instead of two that agree.
   *
   * IT REPORTS HEIGHT AS A NEGATIVE NUMBER, because its own components feed it
   * straight into `translateY` (see KeyboardStickyView: `translateY: height +
   * offset`). Everything downstream here -- barLift, AskChat's padding -- was
   * written against a positive height and is correct as it stands, so the sign
   * is flipped once, here, at the boundary. Getting this backwards would move
   * the bar DOWN behind the keyboard, which is a thing worth naming rather than
   * leaving to be rediscovered.
   */
  const { height } = useReanimatedKeyboardAnimation();

  useAnimatedReaction(
    () => -height.value,
    (h) => {
      live.value = h;
      /**
       * AND THE DESTINATION IS LEARNED, still. barLift wants a denominator on
       * the very first frame; this raises it only, so a shorter keyboard (a
       * numeric pad) never shrinks the number a taller one established, and it
       * never follows the height back down mid-fall and rescales the fall as it
       * happens.
       */
      if (h > full.value) {
        full.value = h;
        runOnJS(rememberHeight)(h);
      }
    },
    [],
  );
}

/**
 * The live keyboard height, and the full height it travels to.
 *
 * A PURE READER. It used to call `useAnimatedKeyboard` itself, which is why
 * mounting it from two places in one component broke the keyboard tracking for
 * the whole app -- see useKeyboardObserver. Safe to call from anywhere, any
 * number of times.
 */
export function useKeyboardLift(): { height: SharedValue<number>; full: SharedValue<number> } {
  seedFromDisk();
  return { height: liveHeight(), full: learnedHeight() };
}

/**
 * THE LIFT FORMULA IS GONE, AND THAT IS THE FIX RATHER THAN A TIDY-UP.
 *
 * `useKeyboardBarLift` and `barLift` lived here: 40 lines of carefully-argued
 * geometry, `max(proportional, welded)`, with unit tests asserting it was
 * monotonic in both directions and never under the keyboard when the keyboard
 * was fully up. All of that was true. It was also the problem.
 *
 * A formula that models where the keyboard probably is cannot be the same object
 * as the keyboard, however good the formula and however live its input. The
 * `proportional` term in particular deliberately put the bar somewhere the
 * keyboard was not -- lower than its top edge -- for the early part of the
 * travel, precisely to avoid a flat start. That trade only exists if you are
 * animating alongside the keyboard instead of being attached to it.
 *
 * components/SearchDock uses KeyboardStickyView now, which is the keyboard's own
 * frame plus one offset. There is no curve to get right.
 *
 * DELETED RATHER THAN LEFT EXPORTED, because dead code that looks like the
 * answer is worse than no code: `labelFor` sat exported and unit-tested in
 * lib/connectionsWeb for a day after nothing called it, reading like the
 * function that decided a name. The tests went with it -- there is nothing left
 * for them to be right about.
 *
 * What remains here is the height itself (useKeyboardObserver / useKeyboardLift),
 * which the Ask composer's padding still reads, and the learned full height it
 * uses to interpolate.
 */
