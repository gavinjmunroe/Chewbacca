import { StyleSheet, Text, View } from 'react-native';
import { useTodayActive } from '../lib/todayFocus';
import { publishStripExpanded, registerStripCollapse } from '../lib/monthStrip';
import { Pressable } from './Pressable';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import ReAnimated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  type SharedValue,
} from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { ChevronDown, ChevronLeft, Settings, Users, UserPlus } from 'lucide-react-native';
import { CHeader, CText } from './classical';
import { HAIRLINE, cl } from '../lib/classical';
import { hc } from '../lib/homeSurface';
import { fonts } from '../lib/tokens';

// The app's screen headers, in the Classical treatment.
//
// This file used to hand-roll a frosted-glass tab pill (a BlurView with a white
// tint) carrying Circles/Feed. The mockups don't have a shared top tab control —
// tab switching lives in the floating bottom pill (components/TabBar.tsx) — and
// each screen gets its own header instead. So this now exports those two:
// FeedHeader (the two corner icons and the week ⇄ month strip) and PeopleHeader
// (serif title, add-person button, search field).
//
// The strip has no "Month" button: you pull it down to open the month, which is
// how it worked before the reskin. The button was a stopgap while that gesture
// was missing.

// ── Feed / Today ─────────────────────────────────────────────────

export type WeekDay = {
  key: string;
  /** The day itself, so a tap can hand the Date straight back. */
  date: Date;
  /** Weekday initial cluster — "SUN", "MON"… */
  dow: string;
  /** Day of month. */
  n: number;
  today: boolean;
  /** Days after today render dashed and dimmed in the reference. */
  ahead: boolean;
  /** How much happened that day; drives the width of the gold underbar. */
  marks: number;
};

export function FeedHeader({
  week,
  monthAnchor,
  selectedKey,
  todayKey,
  keyFor,
  countFor,
  onSelectDay,
  onMessages,
  unread = 0,
  onSettings,
}: {
  week: WeekDay[];
  /** Month the expanded grid shows. */
  monthAnchor: Date;
  selectedKey: string | null;
  todayKey: string;
  keyFor: (d: Date) => string;
  countFor: (key: string) => number;
  onSelectDay: (d: Date) => void;
  /**
   * THE BUTTON IN THE TOP-LEFT CORNER. Opens the Messages panel.
   *
   * "This upper-left-hand-corner button... If you press this upper-left-hand
   *  button, that slides out, and you are able to see your messages."
   *
   * It sits on the KICKER's row rather than getting a row of its own, which was
   * the first attempt: a bare button above "Monday" reads as a toolbar and costs
   * thirty points of the header on a page whose whole complaint has been
   * whitespace. Beside the weekday it costs nothing -- that line was a single
   * short word with the rest of the width unused.
   *
   * Optional, so the header is unchanged anywhere it is rendered without one.
   */
  onMessages?: () => void;
  /** Unread conversations, for the dot. Never a number -- see the note below. */
  unread?: number;
  /**
   * The gear in the top-right.
   *
   * A MOCK FOR NOW, and deliberately so: "just leave that as a blank mock button
   * for now. We'll build that out later." Rendered whether or not a handler is
   * given, because the rendering has it and a header that is missing its right
   * corner is the thing that would be noticed. It is a real button with a real
   * accessibility label and nothing behind it yet.
   */
  onSettings?: () => void;
}) {
  const insets = useSafeAreaInsets();
  // THE DRAG'S PROGRESS, OWNED HERE so two things can read it: the strip that is
  // being pulled, and the BAND AROUND IT, which lightens toward cream as it opens
  // and returns exactly to the page color as it closes. Owning it in the strip
  // put it below the band in the tree, where the band could not see it.
  const monthOpen = useSharedValue(0);
  return (
    <CHeader paddingTop={insets.top + 12} glass lift={monthOpen}>
      {/*
        THE CORNERS, AND NOTHING ELSE.
        The rendering's header is two icons and then the calendar. The gold
        weekday kicker, the 31pt serif date and the year that used to sit here
        are gone: the strip below already says what day it is, in the same
        numerals, twelve points lower -- so the date line was the same fact
        twice, and it was the single largest thing on the page.
      */}
      <View style={stripStyles.corners}>
        <Pressable
          onPress={onMessages}
          disabled={!onMessages}
          accessibilityRole="button"
          accessibilityLabel={
            unread > 0 ? `Messages, ${unread} unread` : 'Messages and contacts'
          }
          hitSlop={14}
          style={({ pressed }) => ({ opacity: pressed ? 0.55 : 1 })}
        >
          <View>
            <Users size={26} color={hc.ink} strokeWidth={2.4} fill={hc.ink} />
            {/* A DOT, NOT A COUNT. The panel carries the per-thread numbers;
                what this has to say is only "there is something in there", and a
                numeral on a 26pt glyph either shrinks to unreadable or grows the
                glyph. */}
            {unread > 0 ? <View style={stripStyles.unreadDot} /> : null}
          </View>
        </Pressable>

        <Pressable
          onPress={onSettings}
          accessibilityRole="button"
          accessibilityLabel="Settings"
          hitSlop={14}
          style={({ pressed }) => ({ opacity: pressed ? 0.55 : 1 })}
        >
          <Settings size={26} color={hc.ink} strokeWidth={2.2} />
        </Pressable>
      </View>

      {/* Pull the strip DOWN to open the month. There is deliberately no Month
          button: the gesture IS the affordance, as it was before the reskin. */}
      <ExpandableDayStrip
        progress={monthOpen}
        week={week}
        monthAnchor={monthAnchor}
        selectedKey={selectedKey}
        todayKey={todayKey}
        keyFor={keyFor}
        countFor={countFor}
        onSelectDay={onSelectDay}
      />
    </CHeader>
  );
}

// Calendar cells for the month containing `anchor`, padded to whole weeks.
export function getMonthWeeks(anchor: Date): Date[][] {
  const firstOfMonth = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const lastOfMonth = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0);
  const start = new Date(firstOfMonth);
  start.setDate(firstOfMonth.getDate() - firstOfMonth.getDay());
  const end = new Date(lastOfMonth);
  end.setDate(lastOfMonth.getDate() + (6 - lastOfMonth.getDay()));
  const weeks: Date[][] = [];
  const cur = new Date(start);
  while (cur <= end) {
    const w: Date[] = [];
    for (let i = 0; i < 7; i++) {
      w.push(new Date(cur));
      cur.setDate(cur.getDate() + 1);
    }
    weeks.push(w);
  }
  return weeks;
}

// ── The week ⇄ month strip ───────────────────────────────────────
// Restores the pre-reskin gesture: drag the strip down and the week grows into
// the full month; release past the midpoint (or with downward velocity) and it
// springs open. The two layers cross-fade — week out by 40% of the drag, month in
// over the remaining 60% — so neither is ever half-legible on top of the other.
//
// Heights are fixed rather than measured because the animated container needs a
// numeric range to interpolate over.
// 52 -> 62. The rendering's day cell is taller than it is wide: a 10pt weekday
// over a 23pt numeral over a mark, with real air around them. At 52 the three
// were touching.
const WEEK_ROW_H = 62;
const MONTH_HDR_H = 20;
const MONTH_CELL_H = 44;
// A spring, not a snap. 260 stiffness moved a six-week month (~234pt) in about a
// tenth of a second, which reads as the strip teleporting rather than gliding —
// and after a drag that tracks the finger one-to-one, that jump is the part that
// felt rough. Softer stiffness with proportionally more damping keeps the settle
// smooth and still lands without a bounce (overshootClamping stays on, because a
// calendar that springs past its own height and comes back looks broken).
const STRIP_SPRING = { damping: 22, stiffness: 170, mass: 0.9, overshootClamping: true };

// How much deliberate travel counts as "I meant that". Small on purpose: the
// strip tracks the finger exactly, so the gesture never has to be completed —
// releasing after a clear thirty points in either direction springs the rest of
// the way. This is what stops a partial drag from snapping back to where it
// started, which was the whole of "it takes ten tries to push it up".
const INTENT_PX = 30;

const WEEKDAY_INITIALS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

const stripStyles = StyleSheet.create({
  dayPress: { flexGrow: 1, flexShrink: 1, flexBasis: 0 },
  cellPress: { flexGrow: 1, flexShrink: 1, flexBasis: 0 },
  cell: {
    width: '100%',
    height: MONTH_CELL_H,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    borderRadius: 10,
  },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.42)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.55)',
  },
  // The unread marker on the messages button. Positioned rather than laid out,
  // so it cannot move the glyph off center when it appears.
  corners: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 4,
    paddingBottom: 18,
  },
  unreadDot: {
    position: 'absolute',
    top: -2,
    right: -3,
    width: 9,
    height: 9,
    borderRadius: 4.5,
    backgroundColor: hc.tan,
    borderWidth: 1.5,
    borderColor: hc.bg,
  },
  dayBox: {
    width: '100%',
    height: WEEK_ROW_H,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    borderRadius: 14,
  },
  dow: {
    fontFamily: fonts.medium,
    fontSize: 10,
    lineHeight: 12,
    letterSpacing: 1.1,
  },
  dayNum: {
    fontFamily: fonts.regular,
    fontSize: 23,
    lineHeight: 26,
    letterSpacing: -0.4,
  },
  bar: { width: 22, height: 3.5, borderRadius: 2 },
  quietDot: { width: 5, height: 5, borderRadius: 2.5, backgroundColor: hc.inkFaint },
});

function ExpandableDayStrip({
  week,
  monthAnchor,
  selectedKey,
  todayKey,
  keyFor,
  countFor,
  onSelectDay,
  progress,
}: {
  week: WeekDay[];
  monthAnchor: Date;
  selectedKey: string | null;
  todayKey: string;
  keyFor: (d: Date) => string;
  countFor: (key: string) => number;
  onSelectDay: (d: Date) => void;
  /**
   * 0..1 open-ness, supplied by the header so the BAND can be tinted by the same
   * number this strip is sized by. Optional, and the fallback is created
   * unconditionally (never a conditional hook) so this component still works
   * standalone.
   */
  progress?: SharedValue<number>;
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const ownExpanded = useSharedValue(0);
  const expanded = progress ?? ownExpanded;
  const startVal = useSharedValue(0);

  // COLLAPSE WHEN TODAY IS NOT THE PAGE YOU ARE ON. The pager keeps all four pages
  // mounted, so leaving Today unmounts nothing and the month stayed open behind your
  // back — you came back to People, went to Today, and it was still down. Reset on
  // the SETTLED page change (see lib/todayFocus), never mid-slide, or the strip
  // collapses in view on the way out.
  // TELL THE PAGE UNDERNEATH, and give it a way to close this.
  //
  // A month covering most of the screen with no way out except a drag is the
  // complaint; a tap anywhere below it should put it away. The page cannot reach
  // in here through props (see lib/monthStrip), and the collapse is registered
  // rather than reimplemented so the spring and the React flag that mirror each
  // other are only ever set in one place.
  useEffect(() => {
    publishStripExpanded(isExpanded);
  }, [isExpanded]);

  // One place that moves both halves. Every bug in this component has been the
  // spring and the React flag disagreeing about whether the month is open.
  const setOpen = useCallback(
    (open: boolean) => {
      expanded.value = withSpring(open ? 1 : 0, STRIP_SPRING);
      setIsExpanded(open);
    },
    [expanded],
  );

  useEffect(() => {
    registerStripCollapse(() => setOpen(false));
    return () => registerStripCollapse(null);
  }, [setOpen]);

  const todayActive = useTodayActive();
  useEffect(() => {
    if (todayActive) return;
    // Both halves together. They are two representations of one thing and the whole
    // class of bugs here is them disagreeing.
    expanded.value = 0;
    setIsExpanded(false);
  }, [todayActive, expanded]);

  const monthWeeks = useMemo(() => getMonthWeeks(monthAnchor), [monthAnchor]);
  const collapsedH = WEEK_ROW_H;
  const expandedH = MONTH_HDR_H + monthWeeks.length * MONTH_CELL_H;
  const expandRange = expandedH - collapsedH;

  // The LAST layout-property animation in the app, and it is deliberate.
  //
  // Animating `height` runs Yoga every frame — which is exactly the bug that made the
  // tab transition stutter, and why nothing on that path animates layout any more. It
  // survives here because a week⇄month expansion genuinely changes how much vertical
  // space the strip occupies, and the content below it must move down; a transform
  // would slide the strip over the content instead of reflowing around it.
  //
  // It is also not on the transition path: this only runs during a deliberate vertical
  // pull on the Today header, when nothing else is moving. Do NOT copy this pattern to
  // anything that animates alongside a pager slide.
  const containerStyle = useAnimatedStyle(() => ({
    height: collapsedH + expanded.value * expandRange,
  }));
  const weekOpacity = useAnimatedStyle(() => ({
    opacity: Math.max(0, 1 - expanded.value / 0.4),
  }));
  const monthOpacity = useAnimatedStyle(() => ({
    opacity: Math.max(0, (expanded.value - 0.4) / 0.6),
  }));
  // The chevron turns over with the drag rather than on release, so the handle is
  // telling you which way it goes WHILE you are moving it.
  const chevronStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${expanded.value * 180}deg` }],
    // It is pointing the way you can go, so it fades out at the extremes of the
    // travel where there is nothing left to say.
    opacity: 0.55 + 0.45 * Math.abs(0.5 - expanded.value) * 2,
  }));

  // BUILT ONCE, like every gesture in this app should be.
  //
  // This was constructed inline on every render, so GestureDetector received a new
  // gesture object each time — and FeedHeader lives on Today, where a query resolving
  // mid-pull re-renders it and replaces the native recognizer under the finger.
  // Rebuilding recognizers during a live touch is the failure mode that took the app
  // down in FavoritesGrid; nothing here writes React state mid-gesture so it was less
  // likely to bite, but "less likely" is not a reason to leave it.
  //
  // Every dependency is stable: shared values by construction, `setIsExpanded`
  // because React guarantees setter identity, and `expandRange` is a number that
  // only changes when the month grid is remeasured, never during a pull.
  const pan = useMemo(
    () =>
      Gesture.Pan()
        // Require a clearer, deliberate vertical pull before the month expansion
        // takes over — an 8px trigger grabbed ordinary scrolls and made the strip
        // feel like it stuck. Fail fast on any horizontal or upward-scroll intent so
        // the gesture only ever opens the month on a real downward pull.
        .activeOffsetY([-14, 14])
        // THE HORIZONTAL BAND IS A HARD FAIL, so it has to be wide enough to survive
        // the whole gesture, not just its first inch. It was ten points, then thirty,
        // and both were tuned against how far a thumb drifts at the START of a pull.
        // What actually matters is how far it drifts over the FULL pull — and while
        // the travel below was ~234 points, no ordinary thumb stayed inside thirty
        // for that long. It arcs, the recognizer gives up, and a hard fail cannot
        // recover for that touch: the strip freezes half-open and will not move again
        // until you lift. That is the "impossible to drag down, impossible to push
        // back up".
        //
        // Sixty still hands a real horizontal swipe to the pager, because a pager
        // swipe crosses sixty points long before it has moved fourteen vertically,
        // and activeOffsetY now settles the race earlier.
        .failOffsetX([-60, 60])
        .onStart(() => {
          startVal.value = expanded.value;
        })
        .onUpdate((e) => {
          // ONE TO ONE WITH THE FINGER. Dividing by anything other than the real
          // height change makes the strip travel at a different speed from the
          // thumb dragging it — 140 against a 234-point month meant it ran ahead
          // and hit the bottom while the finger was still moving, which reads as
          // popping open rather than being pulled. The edge under the finger has
          // to stay under the finger; the release rule below is what makes the
          // gesture cheap to finish, not a faked ratio.
          expanded.value = Math.max(
            0,
            Math.min(1, startVal.value + e.translationY / expandRange),
          );
        })
        .onEnd((e) => {
          // WHICH WAY YOU WERE GOING DECIDES IT, not how far you got.
          //
          // A midpoint test means closing a six-week month needs 117 points of
          // upward drag before the release even counts — and if you stop short it
          // springs back open, which is why it felt stuck no matter how many times
          // you tried. Intent is obvious long before the halfway mark: thirty
          // points of deliberate travel, or any real flick, is an answer.
          //
          // The midpoint only decides the case where the finger barely moved.
          const flungUp = e.velocityY < -200;
          const flungDown = e.velocityY > 200;
          const draggedUp = e.translationY < -INTENT_PX;
          const draggedDown = e.translationY > INTENT_PX;
          const shouldExpand =
            flungUp || draggedUp
              ? false
              : flungDown || draggedDown
                ? true
                : expanded.value > 0.5;
          expanded.value = withSpring(shouldExpand ? 1 : 0, STRIP_SPRING);
          runOnJS(setIsExpanded)(shouldExpand);
        }),
    [expanded, startVal, expandRange, setIsExpanded],
  );

  // ONE GESTURE, ONE DETECTOR.
  //
  // The strip and the grab handle each had their own <GestureDetector gesture={pan}>,
  // sharing a single Gesture instance. That is not supported: a Gesture carries the
  // handler tag it was attached with, so the second detector re-attaches the same
  // gesture and the two fight over one registration -- and the handle subtree ended
  // up contributing NOTHING to the layout. Measured on a screenshot: the day boxes
  // end and 12.7pt later the header ends, which is exactly CHeader's paddingBottom
  // with no handle in between. That is why "I don't see the little tab" was right
  // every time it was said, and why raising the pill's contrast last round changed
  // nothing.
  //
  // So: one detector around BOTH, with the handle outside the clipping container so
  // the month expansion cannot cut it off. A drag anywhere on the header -- strip or
  // handle -- is the same pan, which is also what it should have been.
  return (
    <GestureDetector gesture={pan}>
    <View>
      <ReAnimated.View
        style={[{ overflow: 'hidden' }, containerStyle]}
      >
        <ReAnimated.View
          style={[{ position: 'absolute', top: 0, left: 0, right: 0 }, weekOpacity]}
          pointerEvents={isExpanded ? 'none' : 'auto'}
        >
          <View style={{ flexDirection: 'row', gap: 4 }}>
            {week.map((w) => (
              <DayBox
                key={w.key}
                day={w}
                selected={selectedKey === w.key}
                onPress={() => onSelectDay(w.date)}
              />
            ))}
          </View>
        </ReAnimated.View>

        <ReAnimated.View
          style={[{ position: 'absolute', top: 0, left: 0, right: 0 }, monthOpacity]}
          pointerEvents={isExpanded ? 'auto' : 'none'}
        >
          <View style={{ flexDirection: 'row', height: MONTH_HDR_H }}>
            {WEEKDAY_INITIALS.map((l, i) => (
              <View key={i} style={{ flex: 1, alignItems: 'center' }}>
                <CText t="labelSm" color={cl.ink38}>
                  {l}
                </CText>
              </View>
            ))}
          </View>
          {monthWeeks.map((w, wi) => (
            <View key={wi} style={{ flexDirection: 'row' }}>
              {w.map((d) => {
                const k = keyFor(d);
                const marks = countFor(k);
                const isToday = k === todayKey;
                const isSelected = selectedKey === k && !isToday;
                const dimmed = d.getMonth() !== monthAnchor.getMonth();
                return (
                  <Pressable
                    key={k}
                    onPress={() => onSelectDay(d)}
                    accessibilityRole="button"
                    accessibilityLabel={d.toLocaleDateString('en-US', {
                      weekday: 'long',
                      month: 'long',
                      day: 'numeric',
                    })}
                    style={stripStyles.cellPress}
                  >
                    {({ pressed }) => (
                      <View
                        style={[
                          stripStyles.cell,
                          {
                            backgroundColor: isToday ? cl.card : 'transparent',
                            borderWidth: isToday || isSelected ? HAIRLINE : 0,
                            borderColor: isToday ? cl.gold55 : cl.gold40,
                          },
                          pressed && { opacity: 0.6 },
                        ]}
                      >
                        <CText
                          t="rank"
                          color={isToday ? cl.goldDeep : dimmed ? cl.ink30 : cl.ink}
                          style={{ fontSize: 15 }}
                        >
                          {d.getDate()}
                        </CText>
                        <View
                          style={{
                            height: 3,
                            borderRadius: 2,
                            width: marks > 0 ? Math.min(6 * marks, 18) : 5,
                            backgroundColor: marks > 0 ? cl.gold : 'rgba(32,31,29,0.1)',
                          }}
                        />
                      </View>
                    )}
                  </Pressable>
                );
              })}
            </View>
          ))}
        </ReAnimated.View>
      </ReAnimated.View>

    {/* THE GRAB HANDLE.
        A drag on a calendar has no affordance — nothing on screen said the week
        could become a month, and when a pull did not take there was no obvious
        thing to try again. A pill does both jobs: it says "this moves", and it is
        a target you can tap when you do not want to drag at all.

        It sits inside the single detector above, so a drag starting here is the
        same pan, and it adds a tap that toggles outright. The hitSlop is generous
        because a 5-point-tall pill is not a 5-point target. */}
      <View style={{ alignItems: 'center', paddingTop: 8 }}>
        <Pressable
          onPress={() => setOpen(!isExpanded)}
          accessibilityRole="button"
          accessibilityState={{ expanded: isExpanded }}
          accessibilityLabel={isExpanded ? 'Collapse the calendar' : 'Expand the calendar'}
          hitSlop={{ top: 14, bottom: 22, left: 70, right: 70 }}
          style={({ pressed }) => ({
            paddingVertical: 7,
            paddingHorizontal: 22,
            opacity: pressed ? 0.55 : 1,
          })}
        >
          {/* CLEAR, because it is now the only thing that says where the
              calendar is. "I am fine with the calendar being the same color as
              the screen IF the tab to pull it down is clear."

              With the band's own color gone, a 44x5 bar at 38% ink was the last
              remaining hint and it was a whisper. This is a pill you can see from
              across the room: gold on a tinted ground, 56 wide, with a chevron
              that turns over as the month opens -- so it states which direction
              it goes as well as that it moves. */}
          <View style={{ alignItems: 'center', gap: 3 }}>
            <View
              style={{
                width: 56,
                height: 6,
                borderRadius: 3,
                backgroundColor: cl.gold55,
              }}
            />
            <ReAnimated.View style={chevronStyle}>
              <ChevronDown size={15} color={cl.goldDeep} strokeWidth={2.6} />
            </ReAnimated.View>
          </View>
        </Pressable>
      </View>
    </View>
    </GestureDetector>
  );
}

function DayBox({
  day,
  selected,
  onPress,
}: {
  day: WeekDay;
  selected: boolean;
  onPress: () => void;
}) {
  /**
   * THREE STATES, AND THEY ARE ABOUT TIME, NOT ABOUT SELECTION.
   *
   * Read straight off the rendering, where SUN 6 and MON 7 carry no outline at
   * all, TUE 8 carries a solid near-black one, and WED through SAT carry a
   * dashed gray one:
   *
   *   past    no border. It happened; there is nothing to commit to.
   *   today   a solid ink border. You are here.
   *   ahead   a dashed border. Pencilled in -- the same language the app already
   *           uses on the web for somebody who is not on Amber yet.
   *
   * SELECTION IS NOT ONE OF THEM, which is the change. It used to be: today got
   * a lifted white chip and a gold edge, and selecting any other day gave it a
   * fainter version of the same. So four states fought over two meanings and
   * every day looked like a button. Selecting a day now moves the ink weight and
   * nothing else -- there is one solid box on the strip and it is today.
   */
  const box = day.today
    ? { borderWidth: 1.5, borderColor: hc.ink }
    : day.ahead
      ? { borderWidth: 1, borderColor: hc.dash, borderStyle: 'dashed' as const }
      : null;
  const fg = day.ahead ? hc.inkFaint : hc.ink;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: day.today || selected }}
      accessibilityLabel={`${day.dow} ${day.n}`}
      style={stripStyles.dayPress}
    >
      {({ pressed }) => (
        <View style={[stripStyles.dayBox, box, pressed && { opacity: 0.6 }]}>
          <Text allowFontScaling={false} style={[stripStyles.dow, { color: fg }]}>
            {day.dow}
          </Text>
          <Text
            allowFontScaling={false}
            style={[
              stripStyles.dayNum,
              { color: fg },
              // The one thing selection changes. A day you have tapped reads
              // heavier; a day you have not is regular whatever else is true.
              selected && !day.today ? { fontFamily: fonts.medium } : null,
            ]}
          >
            {day.n}
          </Text>
          {/*
            A BAR MEANS SOMETHING HAPPENED, A DOT MEANS IT DID NOT.
            Two marks rather than one bar of varying width: the old version drew
            a 7pt stub for an empty day and grew it to 22 for a busy one, so
            "nothing" and "one thing" differed by seven points of width and read
            as the same mark. A dot and a bar cannot be confused at a glance,
            which is the only glance this strip gets.
          */}
          {day.marks > 0 ? (
            <View style={[stripStyles.bar, { backgroundColor: fg }]} />
          ) : (
            <View style={stripStyles.quietDot} />
          )}
        </View>
      )}
    </Pressable>
  );
}

// ── People ───────────────────────────────────────────────────────


/**
 * THE PEOPLE HEADER, and the machinery that used to be in it.
 *
 * This was a four-part header: a title row, a Find/Ask segmented control, a
 * search field that animated away when you slid to the Ask page, and a
 * dictation mic inside that field. All three of the moving parts are gone, and
 * they are gone because the thing they were for is gone:
 *
 *   - the Find/Ask segment switched between two sub-pages of the People tab.
 *     People is one page now, so there is nothing to switch to. Ask lives on
 *     Home and on Profile.
 *   - the search field moved to the app's single bottom bar (SearchDock), which
 *     is on every tab and never unmounts.
 *   - the dictation mic went with it; the bar's leading circle opens the real
 *     recorder instead of dictating into a text field.
 *
 * Deleted rather than left behind a prop, because what was left behind was a
 * 270-line function whose every branch was unreachable — the caller passed
 * showSearch={false} and no onChangeMode — plus a SegButton, a nine-key
 * StyleSheet, a two-ring SVG glyph, and a `searchDismiss` animation with the
 * long explanation of a transition that no longer exists. That is the code that
 * "might interfere with our new look".
 *
 * What is left is what the mockup shows: the word People, and the button that
 * finds new ones.
 */
export function PeopleHeader({
  onAdd,
  onBack,
  title = 'People',
}: {
  onAdd: () => void;
  /**
   * A back arrow on the left, for when this header is on a PUSHED screen rather
   * than a tab.
   *
   * People stopped being a tab: two tabs now, Home and You, and the address book
   * lives in the Messages panel. The fuller contacts screen -- the favorites
   * grid, the address-book sync, the duplicate merge -- is a route you push from
   * that panel, and a pushed screen with no way back is a trap. Omitted, this
   * header is exactly what it was.
   */
  onBack?: () => void;
  title?: string;
}) {
  const insets = useSafeAreaInsets();
  return (
    <CHeader paddingTop={insets.top + 10} glass>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          paddingHorizontal: 4,
          paddingBottom: 10,
        }}
      >
        {onBack ? (
          <Pressable
            onPress={onBack}
            accessibilityRole="button"
            accessibilityLabel="Back"
            hitSlop={10}
          >
            {({ pressed }) => (
              <View style={[stripStyles.iconBtn, pressed && { backgroundColor: cl.gold12 }]}>
                <ChevronLeft size={19} color="#605D5D" strokeWidth={1.9} />
              </View>
            )}
          </Pressable>
        ) : null}
        <CText t="screenTitle" style={{ flex: 1 }} numberOfLines={1}>
          {title}
        </CText>
        <Pressable
          onPress={onAdd}
          accessibilityRole="button"
          accessibilityLabel="Find people"
          hitSlop={10}
        >
          {({ pressed }) => (
            <View style={[stripStyles.iconBtn, pressed && { backgroundColor: cl.gold12 }]}>
              <UserPlus size={17} color="#605D5D" strokeWidth={1.7} />
            </View>
          )}
        </Pressable>
      </View>
    </CHeader>
  );
}
