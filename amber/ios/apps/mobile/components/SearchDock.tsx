import { useCallback, useEffect, useState } from 'react';
import { Keyboard, StyleSheet, TextInput, View, type StyleProp, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { KeyboardStickyView } from 'react-native-keyboard-controller';
import Animated, {
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { ArrowUp, AudioLines as Waveform, Plus, Square, X } from 'lucide-react-native';
import { Pressable } from './Pressable';
import { PeopleBottomBar } from './PeopleBottomBar';
import { barSuppressedSV, nextHoldover, useBarSuppressed } from '../lib/barSuppression';
import { useKeyboardLift } from '../lib/useKeyboardLift';
import { SEARCH_MODES, type SearchModeId } from '../lib/searchModes';
import { PEOPLE_BAR_SIDE, peopleBarBottom } from '../lib/peopleBar';
import { stopAsk, useAskBusy } from '../lib/askBridge';
import { hFont, hc } from '../lib/homeSurface';

/**
 * How much air to leave between the bar and the keyboard's top edge.
 *
 * The ONLY number in the dock's vertical position that is a choice. Everything
 * else comes from the keyboard itself -- see the note on KeyboardStickyView
 * below, and the four formulas that were deleted to get here.
 */
const DOCK_KEYBOARD_GAP = 12;

// ONE BAR, RENDERED ONCE, ABOVE THE TABS.
//
// It lives outside every page, so it cannot slide with one of them, cannot be
// re-mounted by a page change, and has no second copy of any dimension to drift
// from. What changes as you move between tabs is the words and what the text does
// with itself -- from lib/searchModes.
//
// SEPARATION, deliberately:
//   PeopleBottomBar  the shell. Glass, height, radius, border. Presentational.
//   searchModes      the words and the controls. Data.
//   this file        the field, the record button, and where the text goes.
//   askBridge        the wire to the conversation, which still owns itself.
//
// THE RECORD BUTTON LEADS EVERY MODE. The circle on the left is not dictation
// into this field -- it opens the voice recorder, the same modal the center tab
// has always opened, unchanged. Wanting to say something out loud is not a
// property of which tab you are standing on, so it is not in the mode table.
//
// The field's TRAILING mic used to be dictation-into-the-box, a third way to get
// words into the app alongside the recorder and the keyboard. It is gone: two
// ways to speak into one bar, one of which quietly appended to whatever was
// already typed, was a coin flip rather than a choice.

export function SearchDock({
  /**
   * WHICH BAR THIS IS. A mode, not a tab index.
   *
   * It took `tab: number` and called modeForTab itself, which quietly made this
   * component a thing only the home pager could use: an opened note, a voice
   * chat or a journal entry is not a tab, so it had no number to pass and could
   * not have a bar at all. That is why the Ask field disappeared the moment you
   * opened a note. Home passes modeForTab(currentPage); everything else passes
   * the mode it wants.
   *
   * Still the SETTLED value on home rather than the live pager cursor: the words
   * should swap once, when the page lands, not blend halfway through a swipe.
   */
  mode: modeId,
  /** Keyword filter for the People list. Owned by the screen so the list and the
   *  bar cannot disagree about what was typed. */
  // KEYWORD MODE ONLY, and optional for that reason. The People bar's text IS
  // the filter, so the screen owns it; an agent bar keeps its own draft and has
  // no use for either of these.
  query = '',
  onChangeQuery,
  /** Open the voice recorder. The screen owns it, because the recorder outlives
   *  this bar: it can be minimized and floated while you move around. */
  // Absent on a surface that has no recorder to open — the record button is
  // simply not drawn. Better than a dead button: this one starts a recording,
  // and a recording started from behind an overlay is a recording nobody can
  // see or stop.
  onRecord,
  /**
   * True while the recorder is floating (minimized). The bar stays on screen so
   * nothing jumps, but it is INERT: grayed, unfocusable, no send. Tapping the
   * floating egg is how you get back to the recorder -- see VoiceNoteRecorder.
   */
  recording = false,
  /** Hand a question to the Ask surface. The screen opens it; this only asks. */
  onAsk,
  /** Animated opacity supplied by the screen, for tab transitions that fade. */
  fade,
  /**
   * Resting distance from the bottom, overriding the default.
   *
   * The default clears the floating tab pill, because on home the bar sits above
   * it. A surface that covers the tabs -- an Ask overlay, an expanded note --
   * has nothing to clear and should sit lower, or it floats with a pill-shaped
   * hole of nothing beneath it.
   */
  restingBottom,
  disabled = false,
}: {
  mode: SearchModeId;
  query?: string;
  onChangeQuery?: (v: string) => void;
  onRecord?: () => void;
  recording?: boolean;
  onAsk: (text: string) => void;
  fade?: StyleProp<ViewStyle>;
  restingBottom?: number;
  /**
   * Faded out and inert, for a surface that owns the whole screen (a direct
   * message). A view at opacity 0 still HIT-TESTS, so fading this without
   * disabling it left an invisible search field swallowing taps meant for the
   * conversation underneath -- which is worse than leaving it visible.
   */
  disabled?: boolean;
}) {
  const insets = useSafeAreaInsets();
  const base = restingBottom ?? peopleBarBottom(insets.bottom);
  /**
   * SOMEBODY ELSE IS TYPING.
   *
   * "When I press to add a comment, the entire Amber search bar comes up with
   *  it. When I press somewhere to type, the search bar should not come up with
   *  it; just the keyboard should."
   *
   * This bar rides the keyboard from the first frame -- see useKeyboardBarLift,
   * which exists because it used to sit still while the keyboard slid up over
   * it. A keyboard event says nothing about who opened it, so a comment field on
   * a feed card raised the keyboard and Amber's composer came up on top of it.
   *
   * Any field that owns the keyboard claims it (lib/barSuppression) and this
   * gets out of the way. `disabled` rather than only faded, because a view at
   * opacity 0 still hit-tests -- the same trap the prop's own comment describes.
   */
  const suppressed = useBarSuppressed();
  const hidden = disabled || suppressed;
  /**
   * THE FADE IS DECIDED ON THE UI THREAD, in the same frame as the position.
   *
   * `hidden` above is React state and is still what turns hit-testing off --
   * that is a JS-side concern and a frame late is harmless. The OPACITY cannot
   * be, because the bar's position is a pure function of the live keyboard
   * height computed on the UI thread. Flipping opacity from JS meant the "you
   * are visible again" frame landed while the bar was still halfway up behind
   * the falling keyboard: it appeared in mid-air and rode the rest of the way
   * down. Reported exactly that way.
   *
   * ── AND IT USED TO HIDE THE BAR FROM ITS OWN KEYBOARD ───────────────────────
   *
   * "If I'm pressing the search bar, the keyboard pulls up, and the search bar
   *  is hidden. That needs to be fixed immediately. That's a major, major
   *  issue... most of the time, if I press the search bar, the keyboard flashes
   *  up very quickly, and the search bar slowly pops up."
   *
   * The condition was `barSuppressedSV.value || kb.height.value > 1` -- ANY
   * keyboard, including the one this field just opened. So tapping the search
   * bar focused it, the keyboard rose, and the bar rode up correctly while
   * fading to nothing. It was still hit-testing (only `suppressed` turns that
   * off), which is why it could be typed into: an invisible field, receiving
   * text, exactly where it should have been.
   *
   * The `kb.height > 1` term was defending something real -- see the paragraph
   * below -- but "the keyboard is up" is not the same claim as "somebody else
   * raised it", and it was written as the first.
   *
   * ── WHAT THE HOLD-OVER IS ACTUALLY FOR ──────────────────────────────────────
   *
   * "There's glitchiness with the search bar whenever the keyboard goes up for
   *  the comments, and then when it goes down, the search bar appears in the
   *  middle of the screen and then pops down weirdly."
   *
   * A comment field blurs, drops its claim, and the keyboard begins to fall --
   * but the bar is still lifted, because the lift follows the live keyboard. Fade
   * it in on the release and it appears in mid-air. So the bar must stay hidden
   * from the release until the keyboard has actually gone.
   *
   * That is a LATCH, not a keyboard test: set when somebody else claims the
   * keyboard, cleared when the keyboard is gone -- or the moment this field takes
   * focus, which is the case a pure keyboard test cannot express at all. Tapping
   * the dock's field directly while a comment box is open hands focus over
   * without the keyboard ever reaching zero, so a "wait for height 0" rule would
   * keep the bar invisible for as long as the person kept typing.
   *
   * Maintained in a reaction rather than inside useAnimatedStyle, because a style
   * that writes a value it also reads is a loop waiting to happen.
   */
  const kb = useKeyboardLift();
  const holdover = useSharedValue(false);
  const ownFocus = useSharedValue(false);
  useAnimatedReaction(
    () => ({
      claimed: barSuppressedSV.value,
      height: kb.height.value,
      mine: ownFocus.value,
    }),
    (now) => {
      holdover.value = nextHoldover(holdover.value, now);
    },
    [],
  );
  const suppressFade = useAnimatedStyle(() => {
    const away = barSuppressedSV.value || holdover.value;
    return {
      opacity: withTiming(away ? 0 : 1, { duration: away ? 90 : 160 }),
    };
  });
  const busy = useAskBusy();

  const mode = SEARCH_MODES[modeId];

  // The agent field keeps its own draft. The keyword field does not: its text IS
  // the filter, so it belongs to the screen. Two buffers rather than one because
  // changing tabs should not carry a half-written question into a name filter.
  const [draft, setDraft] = useState('');
  const value = mode.kind === 'keyword' ? query : draft;
  const setValue = mode.kind === 'keyword' ? (onChangeQuery ?? (() => {})) : setDraft;

  // A question written on Today and sent from You is not a thing anyone means to
  // do, and an agent draft surviving a tab change is how it happens.
  useEffect(() => {
    if (mode.kind !== 'agent') setDraft('');
  }, [modeId, mode.kind]);

  const commit = useCallback(() => {
    // THE BACKEND SWITCH. People is a keyword filter and has already applied
    // itself on every keystroke, so committing is just dismissing. Today and You
    // hand the text to the conversation, which does the whole job: contacts,
    // notes, and the open web.
    if (mode.kind === 'keyword') {
      // AND DISMISSING IS SOMETHING IT NOW ACTUALLY DOES. This said "committing
      // is just dismissing" and then returned without dismissing anything, with
      // blurOnSubmit off besides -- so on People the Search key was a dead key.
      // Combined with the list not dismissing on a downward drag, that is "it
      // doesn't go away no matter what": there was no gesture and no button
      // anywhere on that screen that put the keyboard down.
      Keyboard.dismiss();
      return;
    }
    const t = draft.trim();
    if (!t) return;
    onAsk(t);
    setDraft('');
  }, [mode.kind, draft, onAsk]);

  const showSend = mode.trailing.includes('send') && !recording;
  const showClear = mode.trailing.includes('clear') && value.length > 0 && !recording;
  const canSend = busy || draft.trim().length > 0;

  return (
    /**
     * THE BAR IS ATTACHED TO THE KEYBOARD. IT IS NOT ANIMATED TO MATCH IT.
     *
     * "I told you they should be one object that comes up together... Make them
     *  one object. The keyboard and the search bar are one object. If you press
     *  the search bar, the keyboard should come up with it."
     *
     * KeyboardStickyView is that, and it is the library's own primitive rather
     * than anything computed here: `translateY = keyboardFrame + offset`, where
     * keyboardFrame is the REAL keyboard's position read natively every frame.
     * The bar moves one-to-one with the keyboard from the first frame of the
     * first pixel, in both directions, and through an interactive drag, because
     * it is reading the same number the keyboard is drawn from.
     *
     * ── WHAT WAS HERE AND WHY IT COULD NOT WORK ────────────────────────────
     *
     * `lift` -- useKeyboardBarLift -- and it survived the switch to native
     * tracking, which is why that switch changed nothing. Its formula was
     * `max(proportional, welded)`:
     *
     *   welded        pins the bar `gap` above the keyboard's top edge. Correct,
     *                 and zero until the keyboard climbs past the bar's own
     *                 resting height, which is a flat start that reads as lag.
     *   proportional  the same total distance spread over the whole animation,
     *                 to kill the flat start.
     *
     * The max of the two is a curve that is DELIBERATELY NOT THE KEYBOARD'S. For
     * the early part of the travel `proportional` governs, and it puts the bar
     * lower than the keyboard's top edge -- behind it. So however perfect the
     * height became, the geometry still said "be somewhere the keyboard is not".
     * A frame-perfect input into a formula that models the keyboard instead of
     * following it is still two objects.
     *
     * The offset is what makes the rest position work: the bar sits `base` off
     * the bottom at rest, and the keyboard's closed position is the bottom of
     * the screen, so the two are `base - GAP` apart. Interpolated on the
     * keyboard's own progress, so at rest it is 0 and the bar is exactly where it
     * has always been.
     */
    <Animated.View
      pointerEvents={hidden ? 'none' : 'box-none'}
      style={[
        { position: 'absolute', left: 0, right: 0, bottom: base, paddingHorizontal: PEOPLE_BAR_SIDE },
        fade,
        // Faded as well as inert. See suppressFade: on the UI thread, because
        // the position it is fading is computed there.
        suppressFade,
      ]}
    >
      {/* KeyboardStickyView uses React Native Animated internally. Keep the
          Reanimated styles on this outer Reanimated view; passing them through
          its style prop freezes its animated-style ref and crashes on render. */}
      <KeyboardStickyView
        offset={{ closed: 0, opened: base - DOCK_KEYBOARD_GAP }}
      >
        <PeopleBottomBar
        left={
          !onRecord ? null : (
            <Pressable
              onPress={recording ? undefined : onRecord}
              disabled={recording}
              accessibilityRole="button"
              accessibilityLabel={
                recording ? 'Recording — tap the recorder to return' : 'New note'
              }
              hitSlop={12}
              style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
            >
              {/*
                A PLUS, NOT A RING AND A DOT.
                It was a filled gold circle inside a gold ring -- a record
                affordance, deliberately not a mic, so it could not be mistaken
                for "dictate into this box". The rendering replaces it with a
                thin plus, which says the more general and more accurate thing:
                this button starts something new. What it starts is unchanged --
                the same voice recorder, the same onRecord.
              */}
              <Plus size={26} color={recording ? hc.inkFaint : hc.ink} strokeWidth={1.8} />
            </Pressable>
          )
        }
        right={
          <>
            {showClear ? (
              <Pressable
                onPress={() => setValue('')}
                accessibilityRole="button"
                accessibilityLabel="Clear"
                hitSlop={10}
                style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
              >
                <X size={17} color={hc.inkMuted} strokeWidth={2} />
              </Pressable>
            ) : null}
            {showSend ? (
              <Pressable
                onPress={busy ? stopAsk : canSend ? commit : onRecord}
                accessibilityRole="button"
                accessibilityLabel={busy ? 'Stop' : canSend ? 'Send' : 'Talk to Amber'}
                hitSlop={10}
                style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
              >
                {busy ? (
                  <View style={sendStyles.filled}>
                    <Square size={14} color="#FFFFFF" fill="#FFFFFF" strokeWidth={2} />
                  </View>
                ) : canSend ? (
                  <View style={sendStyles.filled}>
                    <ArrowUp size={18} color="#FFFFFF" strokeWidth={2.4} />
                  </View>
                ) : (
                  /*
                    THE WAVEFORM IS THE RESTING STATE, and the send arrow only
                    appears once there is something to send.
                    It used to be an arrow in a gray disc whatever was typed --
                    a permanently disabled button, which is a control that
                    teaches you it does not work. The rendering puts a waveform
                    there instead, and an empty bar with a waveform on the end is
                    an offer to talk rather than a dead send key. Same handler as
                    the plus: both start the recorder, which is the honest
                    mapping when the field is empty.
                  */
                  <Waveform size={24} color={hc.ink} />
                )}
              </Pressable>
            ) : null}
          </>
        }
      >
        <TextInput
          value={recording ? '' : value}
          onChangeText={setValue}
          editable={!recording}
          // The words, from the mode table. The only thing about this bar the
          // user is supposed to notice changing.
          placeholder={recording ? 'Recording…' : mode.placeholder}
          accessibilityLabel={mode.label}
          // WARM, NOT GRAY. The rendering sets the placeholder in a soft brown
          // rather than in the page's ink -- it is the one warm word on the
          // screen, and it is what stops an empty white pill from reading as a
          // disabled field. The long note this replaces was about legibility
          // over a refracting surface; the surface is opaque now.
          placeholderTextColor={hc.searchInk}
          autoCorrect={mode.kind === 'agent'}
          autoCapitalize={mode.kind === 'agent' ? 'sentences' : 'none'}
          returnKeyType={mode.submitsWhileTyping ? 'search' : 'send'}
          onSubmitEditing={commit}
          /**
           * THIS FIELD SAYS WHEN IT HAS THE KEYBOARD, which is the one fact the
           * hold-over above cannot infer. See the long note on `holdover`: a
           * comment box open, then a tap straight onto this field, hands focus
           * across without the keyboard ever returning to zero -- so "wait until
           * the keyboard is gone" would leave this bar invisible for as long as
           * somebody kept typing in it.
           *
           * WRITTEN TO A SHARED VALUE, NOT TO STATE. It is read by a UI-thread
           * reaction in the same frame as the keyboard height and the bar's
           * position; routing it through React would put it a frame or two behind
           * the thing it is supposed to correct, which is the whole class of bug
           * this file keeps having.
           *
           * This does NOT claim suppression -- the dock must keep riding its own
           * keyboard. It only cancels the hold-over.
           */
          onFocus={() => {
            ownFocus.value = true;
          }}
          onBlur={() => {
            ownFocus.value = false;
          }}
          // Both modes give the field up on submit. It was conditional, and the
          // condition was backwards for the one mode where the return key has
          // nothing else to do.
          blurOnSubmit
          multiline={mode.kind === 'agent'}
          style={{
            // 15 -> 17. THE FIX FOR "the text looks way too small and I can
            // barely see it against the background".
            //
            // 15pt is the size of a LABEL, and this field holds a sentence
            // somebody is composing on top of a translucent surface with the
            // feed sliding under it. Legibility on glass is mostly a function
            // of size, not of tint: bigger type has more ink per stroke and
            // stops competing with whatever is passing behind. 17 is the iOS
            // body size, which is what this field always should have been.
            minHeight: 34,
            maxHeight: 112,
            paddingVertical: 6,
            // The sans, not the serif. `clType.body` is Newsreader; the
            // rendering sets the field in Outfit like everything else on the
            // page, and a serif in a search field reads as a quotation.
            fontFamily: hFont.regular,
            fontSize: 17,
            includeFontPadding: true,
            color: recording ? hc.inkMuted : hc.ink,
          }}
        />
        </PeopleBottomBar>
      </KeyboardStickyView>
    </Animated.View>
  );
}

const sendStyles = StyleSheet.create({
  filled: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: hc.ink,
  },
});
