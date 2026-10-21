import { shouldUseRedesignedRoute } from '../../lib/redesignRoute';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import PagerView from 'react-native-pager-view';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
// Shared with ContactsPage's inner pager. It was defined locally here, and the other
// pager hand-rolled a broken inline version of it instead -- see lib/pagerScroll.ts.
import { usePagerScrollHandler } from '../../lib/pagerScroll';
import { MessagesPanel } from '../../components/MessagesPanel';
import { SearchDock } from '../../components/SearchDock';
import { modeForTab } from '../../lib/searchModes';
import { AskOverlay } from '../../components/AskOverlay';
import { HomePage } from '../../components/pages/HomePage';
import { ProfilePage } from '../../components/pages/ProfilePage';
import { HomeVoiceCapture } from '../../components/HomeVoiceCapture';
import { AmberBackdrop } from '../../components/AmberBackdrop';
import { TabBar } from '../../components/TabBar';
import { ConnectionsWebOverlay } from '../../components/ConnectionsWeb';
import { ChatProvider } from '../../lib/ChatContext';
import {
  usePendingVoiceCapture,
  consumeVoiceCapture,
  PENDING_RECORD_TTL_MS,
} from '../../lib/pendingRecord';
import { useDmThreads } from '../../lib/dms';
import { LIGHT } from '../../lib/theme';
import { publishTodayActive } from '../../lib/todayFocus';
import { useFullscreenLayer } from '../../lib/fullscreenLayer';

// ONE PAGER, TWO PAGES, ONE PER TAB: 0 Home, 1 You.
//
// It was three, and before that four. The four collapsed to three when Ask
// stopped being a page (it is an overlay the shared bar opens); the three
// collapse to two here because People stopped being a destination:
//
//   "For the bottom tab, just have two tabs now: the profile page and the
//    homepage."
//
// NOTHING WENT IN THE BIN WITH IT, and that is the part worth checking rather
// than trusting. People held three things:
//
//   the address book       -> the ALL CONTACTS half of the Messages panel,
//                             alphabetical, searchable, a circle under each name
//   direct messages        -> the DIRECT MESSAGES half of the same panel, five
//                             most recent with a See-more, the same lib/dms
//   favorites / sync /     -> app/(gated)/contacts.tsx, a route pushed from the
//   duplicates / enrich       foot of that panel. Same component, same page,
//                             reached by a push instead of a swipe.
//
// The panel opens from the button in Home's header (FeedHeader's onMessages) and
// is a LAYER over the pager rather than a route, for the reason every other
// full-screen thing in this file is: pushing a route from inside a pager and
// coming back loses the pager's position.
//
// WHAT THIS SIMPLIFIED. Pages and tabs were already 1:1; now there are two of
// them, adjacent, so `goToPage` can never be asked to travel two steps. The
// entire two-step teleport -- the fade out, the swap under cover, the fade back
// in, and the `teleporting` flag that stopped the pager's own scroll reports
// from dragging the cursor back through the middle tab -- existed only because
// People and You had Today between them. It is gone with the page that made it
// necessary, and a tab change is now the native slide it always should have
// been. The `jump` value stays, at a constant 1, because TabBar takes it as
// `bubbleFade` and a surface that fades is worth keeping a handle on.

const PAGE_TODAY = 0;
const PAGE_YOU = 1;

/**
 * EVERY TAB NAME THAT HAS EVER BEEN SENT STILL RESOLVES.
 *
 * `people` and `contacts` are the ones that matter here: the deep-link table in
 * app/_layout.tsx and months of notification payloads send them, and the page
 * they named does not exist any more. They land on Home -- which is where the
 * Messages panel that now holds the address book opens from -- rather than
 * 404ing into a default, which would look like the notification doing nothing.
 * `openMessagesFor` below is what actually opens the panel for them.
 */
function tabToIndex(tab: string | undefined): number {
  if (tab === 'you' || tab === 'profile' || tab === 'circles') return PAGE_YOU;
  return PAGE_TODAY;
}

/** True for the tab names that used to mean the People page. */
function wantsMessages(tab: string | undefined): boolean {
  return tab === 'people' || tab === 'contacts' || tab === 'messages';
}

// The pager, wrapped so Reanimated can attach a native event handler to it.
const AnimatedPagerView = Animated.createAnimatedComponent(PagerView);

// ── THE CHROME'S CURVE ───────────────────────────────────────────────────────
//
// These were the People <-> You cross-dissolve's numbers. That transition is
// gone -- two adjacent tabs slide -- and the curve survives it because the app
// chrome still fades: the header, the bar and the tab pill step aside when a
// full-screen layer (a conversation, the Messages panel) covers the screen.
//
// The curve is worth keeping the note for. It was Easing.in(Easing.cubic) going
// out and Easing.out(Easing.cubic) coming back: Easing.in ENDS at maximum
// velocity and Easing.out STARTS at maximum velocity, so the content was
// traveling as fast as it ever goes at exactly the moment it crossed zero. The
// eye reads a fast crossing of the invisible point as a snap, which is why a
// transition made of two individually-smooth halves still felt like it had a
// seam in the middle.
//
// A symmetric ease-in-out has zero velocity at BOTH ends of both halves. The
// bezier is the standard 0.4/0/0.2/1 rather than inOut(quad) because its
// outgoing half is slightly quicker, which keeps it from feeling slow.
//
// Asymmetric durations on purpose: leaving should be brisker than arriving. The
// thing you are going to is the one worth watching land.
const FADE_OUT_MS = 150;
const FADE_IN_MS = 230;
const FADE_EASING = Easing.bezier(0.4, 0, 0.2, 1);


export default function HomeScreen() {
  const params = useLocalSearchParams<{ tab?: string; reminder?: string; dm?: string; legacy?: string }>();
  if (shouldUseRedesignedRoute(__DEV__, process.env.EXPO_PUBLIC_CONNECTED_ROLODEX, params)) {
    // Keep this dependency inside the branch so Metro excludes it from release bundles.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { ConnectedRolodex } = require('../../components/ConnectedRolodex');
    return <ConnectedRolodex />;
  }
  return <OriginalHomeScreen />;
}

function OriginalHomeScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const win = useWindowDimensions();
  // `reminder` is a tapped reminder notification: destinationForNotification in
  // app/_layout.tsx routes to /(gated)/home?tab=today&reminder=<id> and this is
  // the other end of it. Held in state and cleared once HomePage has opened the
  // sheet, because the param itself persists and would re-open it forever.
  const { tab, reminder, dm } = useLocalSearchParams<{
    tab?: string;
    reminder?: string;
    dm?: string;
  }>();
  const initialIndex = tabToIndex(tab);

  const pagerRef = useRef<PagerView>(null);
  const [currentPage, setCurrentPage] = useState(initialIndex);
  // The finger cursor: a UI-thread shared value swept 0..2 by the pager's own
  // scroll offset. It drives the TabBar highlight bubble via useAnimatedStyle, so
  // the bubble tracks the swipe (and the tap animation) finger-for-finger without
  // any React re-render. Written ONLY from the onPageScroll worklet below.
  //
  // ONE VALUE NOW, NOT THREE. It used to feed the pages, the tab bubble and the
  // Find/Ask segment, and animating it to glide the bubble therefore also swept
  // the segment through Ask on the way to Today -- one value, three consumers,
  // one of which had no business seeing the trip. With pages and tabs 1:1 the
  // bubble reads this directly and the other two consumers no longer exist.
  const pagerPosition = useSharedValue(initialIndex);
  // THE BUBBLE KEEPS ITS OWN VALUE, and it is now the same number as
  // `pagerPosition` in every frame.
  //
  // It was separate because People <-> You was two steps: the page had to JUMP
  // (sliding would have swept Today past on the way) while the bubble had to
  // GLIDE, and those are two animations of one quantity. Two adjacent tabs
  // cannot be two steps apart, so there is no longer a case where they differ --
  // and the worklet below writes both, so they cannot drift.
  //
  // KEPT AS ITS OWN VALUE RATHER THAN COLLAPSED. TabBar takes it as a prop, and
  // handing the pager's cursor straight to a component that is free to animate
  // it is how the fight this comment used to describe started.
  const tabBubble = useSharedValue(initialIndex);
  // Opacity of the whole content area. Held at 1: there is no two-step
  // transition left to fade for, and TabBar reads it as `bubbleFade`.
  const jump = useSharedValue(1);
  // THE `teleporting` GUARD IS GONE WITH THE TELEPORT.
  //
  // It existed because setPageWithoutAnimation still emits onPageScroll -- the
  // native pager reports its own bookkeeping as it re-lays the pages out -- so
  // right after the two-step transition placed the cursor on its destination,
  // the pager overwrote it with intermediate positions for a scroll that was not
  // happening. Nothing calls setPageWithoutAnimation any more: two adjacent tabs
  // are always one animated step, and the only writer of the cursor is the
  // pager's own scroll.
  const pageScrollHandler = usePagerScrollHandler({
    onPageScroll: (e) => {
      'worklet';
      const pos = e.position + e.offset;
      pagerPosition.value = pos;
      tabBubble.value = pos;
    },
  });
  // The voice journal: press and hold HOME to wake it.
  const [voiceOpen, setVoiceOpen] = useState(false);
  // TRUE WHILE THE RECORDER IS MINIMIZED AND FLOATING.
  //
  // The bar stays on screen while you record -- nothing jumps -- but it goes
  // inert: grayed, unfocusable, no send. Offering a text field and a second
  // record button while a recording is already in flight is how you end up with
  // two.
  const [voiceFloating, setVoiceFloating] = useState(false);

  // External-entry auto-start: a Home Screen quick action ("New voice note" on
  // icon long-press) — and, later, a widget / the Action Button — asks the app
  // to open straight into recording. Those entries set the shared pending-record
  // signal; here we consume it and open the SAME recorder a manual long-press
  // opens. This never fires on a normal open: the effect only reacts when a
  // pending request is present, and it consumes it so it runs exactly once.
  const pendingRecord = usePendingVoiceCapture();
  useEffect(() => {
    if (!pendingRecord) return;
    // Consume immediately so it fires exactly once, even if home remounts.
    consumeVoiceCapture();
    // Drop a stale request: if the user detoured through sign-in / onboarding /
    // biometric unlock before home mounted, don't surprise them by recording
    // long after the launch that asked for it.
    if (Date.now() - pendingRecord.at > PENDING_RECORD_TTL_MS) return;
    // Same surface as onLongPressCenter. VoiceNoteRecorder auto-starts on
    // visible and requests the mic via the same path as the manual button, so a
    // permission denial fails gracefully (toast + close) with no stuck state.
    setVoiceOpen(true);
  }, [pendingRecord]);
  // react-native-pager-view frequently fails to take its flex height under
  // Fabric/newArch and collapses. Measure the space actually available to it
  // and pass an explicit height instead of flex:1.
  //
  // SEEDED, NOT ZERO. The pager only renders once both are > 0, so starting at 0 meant
  // the first frame after the splash drew the ground, the backdrop and the tab bar with
  // NOTHING in the middle — and then all four pages mounted at once on the next commit,
  // so it was a visible hold rather than one frame. The window is the right first
  // guess (the pager fills the screen minus the tab bar); onLayout still owns the real
  // number a frame later.
  // Seeded with the FULL window height, not window minus tab bar: TabBar is
  // position:absolute (TabBar.tsx:177) so it is out of flow and this container
  // genuinely fills the screen. Subtracting it would under-size the pager by 72pt
  // for exactly one frame and then jump when onLayout corrected it — trading the
  // blank hold for a smaller, twitchier version of the same thing.
  const [pagerHeight, setPagerHeight] = useState(() => win.height);
  // Same Fabric problem, width axis: pager-view can leave pages at an auto
  // (content) width, so flex:1 rows inside have no definite width to divide and
  // collapse — the People rows stack and the month grid jams. Give pages a
  // definite measured width.
  const [pagerWidth, setPagerWidth] = useState(() => win.width);

  // MESSAGES: the slide-out that holds the conversations and the address book.
  // Opened by the button in Home's header, and by every deep link that used to
  // name the People page.
  const [messagesOpen, setMessagesOpen] = useState(() => wantsMessages(tab));

  // If the screen is already mounted and the tab param changes (e.g. a second
  // push with a different tab from AgentChat), jump to the new page immediately.
  useEffect(() => {
    const idx = tabToIndex(tab);
    pagerRef.current?.setPage(idx);
    setCurrentPage(idx);
    if (wantsMessages(tab)) setMessagesOpen(true);
  }, [tab]);

  const [openReminderId, setOpenReminderId] = useState<string | null>(reminder ?? null);
  useEffect(() => {
    if (!reminder) return;
    setOpenReminderId(reminder);
    // A warm tap can arrive while People or You is the page on screen, and the
    // reminder sheet is mounted by Today. Without this the sheet renders behind
    // whichever page the pager is on -- which looks exactly like the
    // notification doing nothing, again.
    pagerRef.current?.setPage(PAGE_TODAY);
    setCurrentPage(PAGE_TODAY);
  }, [reminder]);
  const consumeReminder = useCallback(() => setOpenReminderId(null), []);

  // A TAPPED MESSAGE NOTIFICATION. The conversation opens inside the Messages
  // panel, so the panel has to be open first -- it used to be a layer over the
  // People page, and the pager was moved there instead. The panel resolves the
  // thread id to a name off the list it already holds; see the effect there.
  const [openDmThreadId, setOpenDmThreadId] = useState<string | null>(dm ?? null);
  useEffect(() => {
    if (!dm) return;
    setOpenDmThreadId(dm);
    setMessagesOpen(true);
  }, [dm]);
  const consumeDm = useCallback(() => setOpenDmThreadId(null), []);

  // THE THREAD LIST, OWNED HERE AND READ TWICE: by the unread dot on Home's
  // header button, and by the panel itself. One hook, one twenty-second poll,
  // one answer -- see the note on MessagesPanel's `dms` prop for why two would
  // let a badge disagree with the inbox under it.
  const dms = useDmThreads();
  const unreadDms = useMemo(
    () => dms.threads.reduce((n, t) => n + (t.unread > 0 ? 1 : 0), 0),
    [dms.threads],
  );
  const openMessages = useCallback(() => setMessagesOpen(true), []);
  const closeMessages = useCallback(() => setMessagesOpen(false), []);

  /**
   * MOVE THE PAGER. ONE STEP, ALWAYS.
   *
   * This used to be forty lines, and every one of them was about the People <->
   * You case being TWO steps with Today in between: a fade out, a swap under
   * cover with setPageWithoutAnimation, a fade back in, a `teleporting` flag so
   * the pager's own scroll reports could not drag the cursor back through the
   * middle tab, and a branch at the top for a tap arriving mid-transition. Two
   * adjacent tabs cannot be two steps apart, so all of it is deleted rather than
   * adjusted.
   *
   * The native transition emits onPageScroll, whose worklet drives
   * pagerPosition -- so the page and the highlight bubble move together as one,
   * on a natural native curve. We deliberately do NOT touch pagerPosition here:
   * a manual animation would fight the worklet and double-drive the bubble.
   */
  const goToPage = useCallback((index: number) => {
    pagerRef.current?.setPage(index);
    // Synchronous so `active` / `isActive` (highlight recolor + Profile focus
    // refetch) update instantly; onPageSelected remains the settle signal.
    setCurrentPage(index);
  }, []);

  const openPerson = useCallback(
    (id: string) => {
      router.push(`/(gated)/person/${id}`);
    },
    [router],
  );

  // THE THREE PAGES ARE MEMOIZED ELEMENTS, and this is the bottom-nav smoothness fix.
  //
  // `currentPage` is written twice per tab change: synchronously in goToPage (for an
  // instant `active` / `isActive`) and again in onPageSelected at settle. Each write
  // re-rendered HomeScreen, and because these pages were inline JSX every write
  // produced fresh elements for all three — so React re-rendered ContactsPage (a
  // 968-row FlatList with a live header), HomePage and ProfilePage. Twice. Once
  // DURING the native slide and once as it landed. Nothing about the tab bar itself
  // was slow; the pages were being rebuilt underneath it.
  //
  // Holding the element identities means a `currentPage` write re-renders only this
  // component and the TabBar. React bails out of the page subtrees entirely.
  // ProfilePage is keyed to `profileActive` alone, so it still refetches on focus and
  // does not re-render when the other two tabs are visited.
  const profileActive = currentPage === PAGE_YOU;

  // ── THE APP CHROME STEPS ASIDE FOR A FULL-SCREEN LAYER ────────────────────
  //
  // "When you go into a direct message, the bottom banner tabs should go away
  //  and the search bar should go away."
  //
  // The one bar and the tab pill are rendered HERE, above the pager, for a good
  // reason (a bar inside a page slides with that page). The cost is that a
  // full-screen layer -- a DM, or the Messages panel -- cannot get out from
  // under them, which is why his screenshot has two headers stacked at the top
  // and a composer behind a search field.
  //
  // So they fade. Faded rather than unmounted: unmounting is a cut, and a cut is
  // the thing every one of these notes is about. One shared value drives all
  // three so they cannot drift, on the same curve as the tab cross-dissolve.
  const covered = useFullscreenLayer();
  const chrome = useSharedValue(covered ? 0 : 1);
  useEffect(() => {
    chrome.value = withTiming(covered ? 0 : 1, {
      // Out faster than in: the conversation should feel like it is already there
      // by the time you look, and the chrome coming back is the thing worth
      // watching settle.
      duration: covered ? FADE_OUT_MS : FADE_IN_MS,
      easing: FADE_EASING,
    });
  }, [covered, chrome]);
  const chromeStyle = useAnimatedStyle(() => ({ opacity: chrome.value }));
  // DECLARED BEFORE EVERY STYLE THAT READS IT, and that is not a stylistic
  // preference. useAnimatedStyle runs its worklet ONCE on the JS thread to
  // produce the first frame's style, so a worklet that closes over a `const`
  // declared further down the component throws "Cannot access 'chrome' before
  // initialization" during render -- which the route error boundary catches and
  // renders as "This screen hit a snag", on every launch, for the whole gated
  // group. TypeScript cannot see it (it has no way to know when a callback
  // runs), which is why the lint rule in .eslintrc.js now does.

  const jumpStyle = useAnimatedStyle(() => ({ opacity: jump.value }));
  // THE ONE BAR'S FADE. It is the app's bar on every tab, so the only thing that
  // takes it away is a full-screen layer -- a conversation, or the Messages
  // panel -- and `chrome` is that. Its own hook rather than a shared style
  // object: one useAnimatedStyle result is not meant to be handed to two
  // components.
  //
  // THE FLOATING PEOPLE HEADER IS GONE, along with the `onPeoplePages` boolean
  // that kept an invisible one from swallowing taps. It existed because page 0
  // was a list that needed a title bar the pager could not scroll away; page 0
  // is Home now, and Home brings its own header inside the page.
  const dockStyle = useAnimatedStyle(() => ({ opacity: chrome.value }));

  // ── THE ASK SURFACE, MOUNTED ONCE ────────────────────────────────────────
  //
  // Opened two ways, and it is the same surface either way: expanding a voice
  // note on Today, or typing a question into the bar on Today or Profile. One
  // mount, because two would be two chat heads with two histories, each thinking
  // it was Ask. Owned here rather than by HomePage for the same reason -- Profile
  // has to be able to open it too.
  //
  // It carries its OWN ChatProvider (see components/AskOverlay). That is
  // load-bearing: this tree is the publishLive provider that owns voice-note
  // capture, and putting Ask in it would let a recorded note land in a typed
  // conversation.
  const [askNoteId, setAskNoteId] = useState<string | null>(null);
  const [askQuestion, setAskQuestion] = useState<string | undefined>(undefined);
  const askOpen = askNoteId !== null || askQuestion !== undefined;
  const openNote = useCallback((id: string) => {
    setAskQuestion(undefined);
    setAskNoteId(id);
  }, []);
  const openAsk = useCallback((text: string) => {
    setAskNoteId(null);
    setAskQuestion(text);
  }, []);
  const closeAsk = useCallback(() => {
    setAskNoteId(null);
    setAskQuestion(undefined);
  }, []);

  /**
   * THE GEAR. A ROUTE, NOT A FOURTH PAGE IN THE PAGER.
   *
   * The pager keeps every page it holds mounted from cold launch, which is why
   * ProfilePage guards its own queries behind `everActive`. Settings is a screen
   * you open twice a year and it carries five queries; as a pushed route it
   * costs nothing until it is opened and takes them with it when it closes.
   *
   * Held here rather than in HomePage for the same reason openMessages is: a
   * page inside the pager should not be pushing routes.
   */
  const openSettings = useCallback(() => {
    router.push('/(gated)/settings');
  }, [router]);

  /**
   * PRESS AND HOLD THE BAR TO TALK TO AMBER.
   *
   *   "Basically, if you press either tab in a long-form way, the voice thing
   *    shows up."
   *
   * Both tab items get this one handler. A hold that works on one half of a
   * two-item pill and does nothing on the other is a gesture you have to
   * remember the position of, which means most people never find it.
   *
   * A useCallback rather than the inline arrow it was, because TabItem is
   * memoized: an inline arrow is a new function on every render of this screen,
   * so both items re-rendered constantly and the memo was decoration. It only
   * mattered a little with one item holding it; it is worth being right with
   * two.
   */
  const holdToTalk = useCallback(() => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    setVoiceOpen(true);
  }, []);

  const todayPage = useMemo(
    () => (
      <HomePage
        goToPage={goToPage}
        openPerson={openPerson}
        onOpenNote={openNote}
        openReminderId={openReminderId}
        onReminderConsumed={consumeReminder}
        onAsk={openAsk}
        onMessages={openMessages}
        messagesUnread={unreadDms}
        onSettings={openSettings}
      />
    ),
    [
      goToPage,
      openPerson,
      openNote,
      openReminderId,
      consumeReminder,
      openAsk,
      openMessages,
      openSettings,
      // THE UNREAD COUNT IS A REAL DEPENDENCY, and leaving it out is why this
      // list is spelled out rather than trimmed. The page element is memoized so
      // that a tab change does not rebuild it; the cost is that anything the
      // page reads has to be named here, or it freezes at the value it had when
      // the element was first built -- in this case a messages button whose dot
      // never appears.
      unreadDms,
    ],
  );
  const youPage = useMemo(() => <ProfilePage isActive={profileActive} />, [profileActive]);

  return (
    // publishLive: this is the tree that owns voice-note capture, so it is the one
    // whose streaming turn the Today overlay needs to mirror. See lib/liveTurn.
    <ChatProvider publishLive>
      <View style={{ flex: 1, backgroundColor: LIGHT.canvas }}>
        <AmberBackdrop />
        {/* No SharedHeader: the mockups give each screen its own header (the
            date + day strip on Today, the title + search on People), and tab
            switching moved to the floating pill nav below. */}
        {/* The pager, the People header and the bottom bar fade AS ONE on a
            tab-to-tab cut. Fading the pager alone would leave the header and the bar
            hanging there for the duration, which is worse than the hard cut it
            replaces. The TabBar and the backdrop sit outside this on purpose: the
            nav stays lit and steady so the tap reads as instant, and what fades up
            is only the content. */}
        <Animated.View
          style={[{ flex: 1 }, jumpStyle]}
          onLayout={(e) => {
            const { height: h, width: w } = e.nativeEvent.layout;
            setPagerHeight((prev) => (Math.abs(prev - h) > 0.5 ? h : prev));
            setPagerWidth((prev) => (Math.abs(prev - w) > 0.5 ? w : prev));
          }}
        >
          {pagerHeight > 0 && pagerWidth > 0 ? (
            <AnimatedPagerView
              ref={pagerRef}
              style={{ width: pagerWidth, height: pagerHeight }}
              initialPage={initialIndex}
              // The pager is driven IMPERATIVELY (ref.setPage on tap, native
              // gesture on swipe) — never by a controlled `page` prop. The active
              // tab is derived from `currentPage`, which is written in exactly two
              // places: synchronously in `goToPage` for an instant tap highlight,
              // and here in `onPageSelected` when a page finally SETTLES.
              //
              // We deliberately do NOT write state from `onPageScroll`. That
              // per-frame callback reports intermediate positions/offsets during
              // the tap animation (offset sweeping 0→1), and feeding those back
              // into `currentPage` snapped the highlight old→new→old→new for a few
              // frames — the visible "bounce". Killing that writer breaks the loop.
              // Trade-off used to be that the highlight no longer finger-tracked
              // mid-swipe. That is now solved separately: `onPageScroll` below is a
              // Reanimated WORKLET that writes only `pagerPosition` (a shared value)
              // on the UI thread — no setState — so the TabBar bubble tracks the
              // finger without reintroducing the bounce.
              // Cast: the pager's codegen types `onPageScroll` as a plain
              // DirectEventHandler, but Reanimated's useEvent returns its own
              // processed-handler shape that the animated component consumes at
              // runtime. The event payload ({position, offset}) is identical.
              onPageScroll={pageScrollHandler as never}
              onPageSelected={(e) => {
                const pos = e.nativeEvent.position;
                setCurrentPage(pos);
                // Tell the Today page whether it is the one being looked at. Published
                // rather than passed as a prop: a prop would have to cross HomePage's
                // memo, rebuilding the whole page on every tab change during the
                // slide. On the SETTLED signal only, so nothing collapses in view.
                publishTodayActive(pos === PAGE_TODAY);
              }}
            >
              {/* collapsable={false}: on Fabric/newArch, a plain flex:1 View here
              can get optimized away by the native view-flattening pass and end up
              stuck at zero height after a keyboard show/hide cycle (modal name
              field, inline search box) — forcing a real native backing view keeps
              its layout stable across those transitions. */}
              <View key="0" style={{ width: pagerWidth, flex: 1 }} collapsable={false}>
                {todayPage}
              </View>
              {/* Profile is a pager page (it was a separate pushed route, which is
                  why You couldn't be swiped to). It doesn't pad its own safe-area
                  top, so the page wrapper supplies it. */}
              <View
                key="1"
                style={{ width: pagerWidth, flex: 1, paddingTop: insets.top + 8 }}
                collapsable={false}
              >
                {youPage}
              </View>
            </AnimatedPagerView>
          ) : null}

          {/* THE ONE BOTTOM BAR, on both tabs. Rendered here, once, because a bar
              inside a page slides with that page. It never re-mounts; the words
              come from the mode table and the text goes to the agent.

              THE KEYWORD BRANCH IS GONE. `query`/`onChangeQuery` fed the People
              tab's live filter over the address book -- that list is in the
              Messages panel now, beside its own field, which is where a filter
              belongs. Both tabs ask Amber, so the bar has one job again. */}
          <SearchDock
            // The dock takes a MODE now, not a tab index — so that surfaces
            // which are not tabs (an open note, a voice chat) can have the same
            // bar. See the note on the prop.
            mode={modeForTab(currentPage)}
            onRecord={() => setVoiceOpen(true)}
            recording={voiceFloating}
            onAsk={openAsk}
            fade={dockStyle}
            // Faded AND inert. See the note on `covered`.
            disabled={covered}
          />
        </Animated.View>
        <Animated.View
          pointerEvents={covered ? 'none' : 'box-none'}
          style={[StyleSheet.absoluteFill, chromeStyle]}
        >
        <TabBar
          active={currentPage === PAGE_YOU ? 'you' : 'home'}
          pagerPosition={tabBubble}
          bubbleFade={jump}
          onSelect={(key) => {
            goToPage(key === 'you' ? PAGE_YOU : PAGE_TODAY);
          }}
          // Press and hold EITHER tab. It was the center egg's gesture; the egg
          // went with the third tab and the gesture did not.
          onLongPressCenter={holdToTalk}
        />
        </Animated.View>
        {/* MESSAGES. Above the pager, the one bar and the tab pill -- which is
            the whole point, and why it is out here rather than inside HomePage.
            Below the voice recorder, the Ask surface and the expanded web,
            because those three are opened from further in than this and a layer
            should never be covered by the thing that launched it.

            It renders nothing at all while closed. The unread dot on the button
            that opens it and the list inside it read the same `dms`; see the
            note on the prop. */}
        <MessagesPanel
          visible={messagesOpen}
          dms={dms}
          onClose={closeMessages}
          onOpenPerson={openPerson}
          openThreadId={openDmThreadId}
          onThreadConsumed={consumeDm}
        />

        <HomeVoiceCapture
          visible={voiceOpen}
          onClose={() => setVoiceOpen(false)}
          onFloatingChange={setVoiceFloating}
        />

        {/* One Ask surface, opened by the bar or by expanding a note. */}
        <AskOverlay
          visible={askOpen}
          conversationId={askNoteId}
          initialAsk={askQuestion}
          onClose={closeAsk}
          openPerson={openPerson}
        />

        {/* THE EXPANDED CIRCLES WEB, AND IT IS RENDERED HERE FOR ONE REASON.
            It was a Modal owned by the card on the Profile page, which is a
            NATIVE overlay above the whole navigation stack -- so opening a
            circle from it had to dismiss it, wait for iOS to say the dismissal
            had finished, then push (that gap IS the flash of the profile page),
            and coming back had to re-open it from useFocusEffect (that IS the
            second glitch on the way back). As an ordinary view inside the stack,
            opening a circle is a plain push that slides OVER it and the back
            gesture slides off again revealing it untouched. Last child, so it
            covers the pager, the bar and the tabs; it renders nothing at all
            until something publishes to lib/webOverlay. */}
        <ConnectionsWebOverlay />
      </View>
    </ChatProvider>
  );
}
