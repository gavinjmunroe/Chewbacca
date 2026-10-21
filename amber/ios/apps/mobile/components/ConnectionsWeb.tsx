import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle as SvgCircle, Defs, Path, RadialGradient, Stop } from 'react-native-svg';
import { X } from 'lucide-react-native';
import { Pressable } from './Pressable';
import { Avatar } from './Avatar';
import { CCard, CText } from './classical';
import { cl, clLayout, clShadow } from '../lib/classical';
import { NAMED_COLORS } from '../lib/circleColors';
import { closeWebOverlay, openWebOverlay, useWebOverlay } from '../lib/webOverlay';
import {
  LABEL_GAP_Y,
  LABEL_LINE_H,
  boardForCount,
  filterByCircle,
  filterPills,
  hubDiameter,
  layoutWeb,
  sortPeople,
  webCapacity,
  webSummary,
} from '../lib/connectionsWeb';
import { inviteContactToAmber } from '../lib/inviteBySms';
import type { Placed, WebPerson } from '../lib/connectionsWeb';
import type { CirclePreview } from '../lib/circles';

/**
 * YOUR PEOPLE ON AMBER, AS A SYSTEM YOU ARE IN THE MIDDLE OF.
 *
 * WHAT THIS REPLACED. The same drawing with CIRCLES as the nodes. That was a
 * picture of how you have filed people, and the pinned grid directly underneath
 * already says that better -- it can print the names and the counts instead of
 * making you decode them off a ring. The most expensive real estate on the
 * profile was spending itself on the weaker of two views of one thing.
 *
 * Circles do not connect to each other. People do. So the nodes are the people
 * you are actually connected to on Amber, and the circles moved to the bottom as
 * FILTERS, which is what a grouping is for in a drawing like this: not something
 * to look at, a way to look at fewer things. Pressing Work re-forms the ring
 * around the three people in it, at their own size.
 *
 * The arrangement carries no information, deliberately, and it is the same
 * meaninglessness every time -- see sortPeople in lib/connectionsWeb.ts. What
 * the drawing says is the true thing about the shape: these people are all the
 * same distance from you, they are held in something, and there are more of them
 * than the eye counts at a glance. Hence the orbits: overlapping ellipses at
 * different rotations rather than concentric circles, because concentric rings
 * read as a target and a target has a middle worth more than its edge.
 *
 * THE MATH IS NOT IN THIS FILE. Who is on the ring, where they sit and which
 * pills exist all live in lib/connectionsWeb.ts, which is pure and tested. This
 * file is paint and gestures. That split is the only reason the boundary cases
 * -- the fifth connection, one person in six circles, a filter matching nobody
 * -- are checkable at all.
 */

/**
 * HOW MUCH TALLER THAN WIDE THE RING IS ALLOWED TO GET.
 *
 * "You have real estate to play with, especially when you open the card, so
 *  please open the card well."
 *
 * A circle in a portrait screen wastes the screen: the drawing is boxed by the
 * width, and the room above and below it goes to nothing. Stretching the ring
 * vertically buys room that was already paid for, and every extra point of
 * perimeter is more space between two names. Placement is by arc length, so the
 * stretch does not clump anybody -- see unitEllipseAt, which is the only reason
 * this can be raised at all.
 *
 * IT IS A CEILING, NOT A SHAPE. `ry` is min(what the box actually has, rx x
 * this), so on the square profile card it never binds and the card stays a
 * circle. It binds only in the overlay, which is the tall one -- and at 1.3 it
 * bound HARD: a 393x780 screen is about 1.94 wide-to-tall, so the ring was
 * letterboxed into the middle 67% of it with a band of nothing top and bottom.
 * That is the "open the card well" complaint, and it is one number.
 *
 * 1.6 rather than the full 1.94 because at the screen's own ratio the ring
 * touches the top and bottom edges, and a node hangs half a disc plus a name
 * past the ring. 1.6 fills the height and keeps the overhang inside the box.
 */
const RING_STRETCH = 1.6;

function colorOfCircle(color: string | null): string {
  return (color && NAMED_COLORS[color]) || NAMED_COLORS.orange;
}

function withAlpha(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = parseInt(full, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/**
 * THE WEB ITSELF: one line from you to each person, and nothing else.
 *
 * WHAT THIS REPLACED. Five overlapping ellipses at even rotations, plus a dotted
 * ring. The idea was texture -- "one ellipse reads as a ring seen at an angle,
 * five reads as a system" -- and on screen it read as a scribble behind the
 * names. Worse, it was decoration that connected nothing: the lines a viewer
 * naturally traced went between arbitrary points on arbitrary ellipses, so the
 * drawing implied relationships that do not exist.
 *
 * A web is lines to the people you are connected to. Each spoke starts at the
 * edge of your disc and stops at the edge of theirs, so it reads as a tie
 * between two things rather than a line crossing under them. A connection's line
 * is solid; a suggestion's is dashed and fainter, the same grammar as its node,
 * so the drawing says at a glance which ties are real.
 */
function Spokes({
  width,
  height,
  placed,
  hubRadius,
}: {
  width: number;
  height: number;
  placed: Placed[];
  hubRadius: number;
}) {
  const cx = width / 2;
  const cy = height / 2;
  return (
    <Svg width={width} height={height} style={{ position: 'absolute' }} pointerEvents="none">
      <Defs>
        {/* The bloom behind the middle. Terminal stops are the ground color at
            zero alpha, never "transparent" -- that premultiplies to black on
            iOS and grays the whole thing.

            NEUTRAL, NOT CREAM. "Make everything a white background. No more
            need for this orange and yellow and burnt color theme." A cream
            bloom on a white page is a faint yellow stain around your own face,
            and it was the last warm thing left on this screen. Now it is the
            page lifting very slightly, which is all it was ever for. */}
        <RadialGradient id="connWebGlow" cx="50%" cy="50%" r="50%">
          <Stop offset="0%" stopColor="#F4F2F0" stopOpacity={0.9} />
          <Stop offset="60%" stopColor="#F4F2F0" stopOpacity={0.4} />
          <Stop offset="100%" stopColor="#F4F2F0" stopOpacity={0} />
        </RadialGradient>
      </Defs>
      <SvgCircle cx={cx} cy={cy} r={hubRadius * 2.1} fill="url(#connWebGlow)" />
      {placed.map((p) => {
        /**
         * THE LINE IS THE LAYOUT'S, DRAWN AS GIVEN.
         *
         * "They can be crisscrossing and going all over the place, not
         *  crisscrossing per se in terms of the lines, but curving around and
         *  going all over the place... as long as the icons don't overlap and
         *  the lines don't cross."
         *
         * This used to draw a straight `M x1 y1 L x2 y2` from `spokeFrom` to the
         * node and compute both ends itself -- which threw away the curve the
         * layout had already built and, worse, meant the shape the no-crossing
         * test measured was not the shape on screen. `p.path` is a spiral whose
         * disjointness is a property of those exact points, so drawing anything
         * else forfeits the guarantee.
         *
         * Straight rays from a common center cannot cross either, and that is
         * what this was: correct, and a diagram of a wheel. Congruent spirals
         * about a common center cannot cross AND they turn. See SPIRAL_S.
         */
        if (p.path.length < 2) return null;
        const faint = p.person.kind === 'suggestion';
        const d = p.path
          .map((q, i) => `${i === 0 ? 'M' : 'L'} ${(cx + q.x).toFixed(1)} ${(cy + q.y).toFixed(1)}`)
          .join(' ');

        return (
          <Path
            key={`spoke-${p.person.key}`}
            d={d}
            fill="none"
            stroke={faint ? 'rgba(26,25,23,0.13)' : 'rgba(26,25,23,0.26)'}
            strokeWidth={faint ? 1 : 1.25}
            strokeDasharray={faint ? '2 5' : undefined}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        );
      })}
    </Svg>
  );
}

/** You, in the middle: a warm disc with your initial. */
function Hub({ monogram, d }: { monogram: string; d: number }) {
  return (
    <View
      pointerEvents="none"
      style={{
        width: d,
        height: d,
        borderRadius: d / 2,
        backgroundColor: '#FFFDF9',
        alignItems: 'center',
        justifyContent: 'center',
        shadowColor: '#B2622D',
        shadowOpacity: 0.16,
        shadowRadius: 24,
        shadowOffset: { width: 0, height: 6 },
      }}
    >
      <CText
        t="cardTitle"
        color={cl.goldDeep}
        style={{ fontSize: Math.round(d * 0.42), lineHeight: Math.round(d * 0.5) }}
      >
        {monogram}
      </CText>
    </View>
  );
}

/**
 * ONE PERSON, AND THE TWO KINDS OF PERSON READ DIFFERENTLY AT A GLANCE.
 *
 * A CONNECTION is solid: their avatar if they have one, their initials if not,
 * on an opaque disc with a soft shadow. They are really there.
 *
 * A SUGGESTION is faint and dashed: no fill worth the name, a dashed ring, ink
 * at low opacity. It has to read as an OUTLINE of a person rather than a person,
 * because the whole message is "this could be somebody here". Making them merely
 * a bit lighter would be worse than making them identical -- a user would take
 * them for connections and wonder why tapping offers to text them.
 *
 * The node ANIMATES to its position rather than jumping, which is what makes a
 * filter feel like the ring re-forming instead of a new screen. Position and
 * size are shared values so the whole thing runs on the UI thread; the person's
 * key is stable across filters, so React keeps the same node and it slides.
 */
function PersonNode({
  placed,
  cx,
  cy,
  labels,
  onPress,
}: {
  placed: Placed;
  cx: number;
  cy: number;
  labels: boolean;
  onPress?: (p: WebPerson) => void;
}) {
  const { person, d } = placed;
  const suggestion = person.kind === 'suggestion';
  const width = labels ? placed.labelWidth : d;
  /**
   * THE NAME IS DECIDED BY THE LAYOUT, NOT HERE.
   *
   * This used to call a `labelFor(name, width)` helper with this node's own
   * width allowance, which is a question one node cannot answer: whether "Sagar
   * Tiwari" fits depends on where every OTHER node, name and line ended up.
   * resolveLabels answers it for the whole board at once -- including which side
   * of the disc the name sits on -- and this draws the answer.
   *
   * labelFor itself is gone. It stayed exported and unit-tested for a while
   * after nothing called it, which is worse than dead code: it read like the
   * function that decides a name. The screen contract is what noticed, by way of
   * this file no longer mentioning it.
   */
  const label = labels ? placed.label : '';
  const above = placed.labelAbove;

  const x = useSharedValue(cx + placed.x - width / 2);
  const y = useSharedValue(cy + placed.y - d / 2);
  const size = useSharedValue(d);

  useEffect(() => {
    const spring = { damping: 20, stiffness: 150, mass: 0.9 };
    x.value = withSpring(cx + placed.x - width / 2, spring);
    y.value = withSpring(cy + placed.y - d / 2, spring);
    size.value = withSpring(d, spring);
  }, [placed.x, placed.y, d, cx, cy, width, x, y, size]);

  const boxStyle = useAnimatedStyle(() => ({
    position: 'absolute',
    left: x.value,
    top: y.value,
  }));
  const discStyle = useAnimatedStyle(() => ({
    width: size.value,
    height: size.value,
    borderRadius: size.value / 2,
  }));

  const body = (
    // The disc is the laid-out box; the name is absolute above or below it, so a
    // label can never change where the face sits.
    <View style={{ alignItems: 'center', width, height: d }}>
      <Animated.View
        style={[
          discStyle,
          {
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: suggestion ? 'rgba(255,253,249,0.55)' : '#FFFDF9',
            borderWidth: suggestion ? 1 : 0,
            borderColor: 'rgba(182,130,53,0.42)',
            borderStyle: suggestion ? 'dashed' : 'solid',
            ...(suggestion ? {} : clShadow.chip),
          },
        ]}
      >
        {person.avatarUrl && !suggestion ? (
          <Avatar name={person.name} url={person.avatarUrl} size={d} />
        ) : (
          <CText
            t="cardTitle"
            color={suggestion ? cl.ink32 : cl.goldDeep}
            style={{ fontSize: Math.round(d * 0.34), lineHeight: Math.round(d * 0.42) }}
          >
            {person.initials}
          </CText>
        )}
      </Animated.View>
      {label ? (
        <CText
          t="metaSm"
          color={suggestion ? cl.ink45 : cl.ink70}
          numberOfLines={1}
          style={{
            textAlign: 'center',
            // ABOVE OR BELOW, matching the box resolveLabels reserved. Drawing
            // it on the other side would put it somewhere nothing was checked.
            position: 'absolute',
            left: 0,
            right: 0,
            [above ? 'bottom' : 'top']: d + LABEL_GAP_Y,
            fontSize: 11,
            lineHeight: LABEL_LINE_H,
          }}
        >
          {label}
        </CText>
      ) : null}
    </View>
  );

  /**
   * TWO BRANCHES FOR ONE PRESSABLE, AND THE REASON IS THE CONTRACT.
   *
   * The obvious way to write this is one Pressable with a ternary in
   * accessibilityLabel. scripts/screen-contract.mts records string literals and
   * template expressions and returns null for a conditional, so written that way
   * BOTH labels are invisible to the contract -- and the label is exactly the
   * kind of thing a redesign drops without noticing, which is the whole reason
   * the contract records labels at all. A gate that cannot see the thing it
   * exists to protect is worse than no gate, because it reports a clean sweep.
   *
   * Spreading the shared props and branching on the label keeps both of them
   * literal, so both are recorded and neither can quietly disappear.
   */
  const pressProps = {
    onPress: () => onPress?.(person),
    accessibilityRole: 'button' as const,
    hitSlop: 8,
    style: ({ pressed }: { pressed: boolean }) => ({ opacity: pressed ? 0.6 : 1 }),
  };

  return (
    <Animated.View style={boxStyle}>
      {!onPress ? (
        body
      ) : suggestion ? (
        <Pressable {...pressProps} accessibilityLabel={`Invite ${person.name || 'this contact'} to Amber`}>
          {body}
        </Pressable>
      ) : (
        <Pressable {...pressProps} accessibilityLabel={`Open ${person.name || 'this person'}`}>
          {body}
        </Pressable>
      )}
    </Animated.View>
  );
}

/**
 * THE FILTER PILLS: All, then one per circle, in the circle's own color.
 *
 * HORIZONTALLY SCROLLABLE, because a pill per circle is however many circles the
 * person has and a fixed row would either wrap into three lines or silently drop
 * the ones that did not fit. Scrolling is the only one of those three that never
 * hides a circle from its owner.
 *
 * A pill is only offered for a circle somebody on the ring is actually in, so
 * pressing one always leads somewhere. See filterPills.
 */
function FilterPills({
  pills,
  active,
  onSelect,
  total,
}: {
  pills: { id: string; name: string; color: string | null; count: number }[];
  active: string | null;
  onSelect: (id: string | null) => void;
  total: number;
}) {
  const Pill = ({
    id,
    label,
    tint,
    count,
  }: {
    id: string | null;
    label: string;
    tint: string;
    count: number;
  }) => {
    const on = active === id;
    return (
      <Pressable
        /**
         * PRESSING THE LIT PILL TURNS IT OFF.
         *
         * It used to re-select what was already selected, which is a press that
         * visibly does nothing -- and the only way back to everybody was to
         * notice All and aim at it. A filter you can switch on but not off is a
         * mode, and nothing else on this screen has modes.
         */
        onPress={() => onSelect(on ? null : id)}
        accessibilityRole="button"
        accessibilityState={{ selected: on }}
        accessibilityLabel={`Show ${label}`}
        hitSlop={6}
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: 12,
          paddingVertical: 7,
          borderRadius: 999,
          marginRight: 8,
          opacity: pressed ? 0.7 : 1,
          backgroundColor: on ? withAlpha(tint, 0.16) : 'rgba(255,255,255,0.72)',
          borderWidth: 1,
          borderColor: on ? withAlpha(tint, 0.5) : 'rgba(182,130,53,0.16)',
        })}
      >
        <View
          style={{
            width: 6,
            height: 6,
            borderRadius: 3,
            marginRight: 7,
            backgroundColor: tint,
            opacity: on ? 1 : 0.55,
          }}
        />
        <CText t="metaSm" color={on ? cl.ink : cl.ink55} style={{ fontSize: 12 }}>
          {label}
        </CText>
        <CText t="metaSm" color={cl.ink48} style={{ marginLeft: 6, fontSize: 11 }}>
          {count}
        </CText>
      </Pressable>
    );
  };

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ paddingHorizontal: 2, alignItems: 'center' }}
      // The pills are a control, not the board. Keeping the scroll view's own
      // gestures from being swallowed by the pan detector is why the row lives
      // outside it in both the card and the overlay.
      keyboardShouldPersistTaps="handled"
    >
      <Pill id={null} label="All" tint={cl.gold55} count={total} />
      {pills.map((p) => (
        <Pill key={p.id} id={p.id} label={p.name} tint={colorOfCircle(p.color)} count={p.count} />
      ))}
    </ScrollView>
  );
}

/** The drawing, at whatever size it is handed. */
function Board({
  people,
  monogram,
  width,
  height,
  labels,
  onPressPerson,
}: {
  people: WebPerson[];
  monogram: string;
  width: number;
  height: number;
  labels: boolean;
  onPressPerson?: (p: WebPerson) => void;
}) {
  const cx = width / 2;
  const cy = height / 2;
  /**
   * THE RING SITS INSIDE THE BOX BY THE WIDEST THING THAT HANGS OFF IT.
   *
   * A node is centered ON the ring, so it hangs half a disc plus its label
   * outside. The old version reserved a flat 30% of a square, which on a phone
   * left the drawing small and floating in a field of nothing -- the "spread it
   * out" complaint. Reserving the actual overhang instead lets the ring grow to
   * fill what is really there.
   */
  const inset = labels ? 62 : 30;
  const rx = Math.max(40, width / 2 - inset);
  const ry = Math.max(40, Math.min(height / 2 - inset, rx * RING_STRETCH));
  const placed = useMemo(() => layoutWeb(people, rx, ry, { labels }), [people, rx, ry, labels]);
  /**
   * YOUR DISC IS SIZED BY THE LAYOUT, NOT HERE. THIS IS THE THIRD TIME.
   *
   * "Nothing should be touching the center circle."
   *
   * This line was `Math.max(56, Math.min(Math.min(rx, ry) * 0.66, 128))` -- its
   * own copy of a formula that lib/connectionsWeb also has, and the two had
   * drifted apart again. The layout clears the innermost ring against
   * hubDiameter's 0.42; the component then DREW 0.66 and handed that to Spokes.
   * On the profile card that is a hub of radius 43 inside a ring cleared for 28,
   * so the first ring of people is drawn on the edge of your own face -- and
   * every clearance the layout proved, and every test that checked one, was
   * measuring a circle that is not the one on screen.
   *
   * There is exactly one formula now and it lives next to the code that plans
   * around it. Nothing about the hub may be computed in this file.
   */
  const hubD = hubDiameter(rx, ry);

  return (
    <View style={{ width, height }}>
      <Spokes width={width} height={height} placed={placed} hubRadius={hubD / 2} />
      <View style={{ position: 'absolute', left: cx - hubD / 2, top: cy - hubD / 2 }}>
        <Hub monogram={monogram} d={hubD} />
      </View>
      {placed.map((p) => (
        <PersonNode
          key={p.person.key}
          placed={p}
          cx={cx}
          cy={cy}
          labels={labels}
          onPress={onPressPerson}
        />
      ))}
    </View>
  );
}

/**
 * WHAT TAPPING SOMEBODY DOES.
 *
 * A connection opens their Amber profile. A suggestion opens Messages with an
 * invite in it, which the person sends themselves.
 *
 * THE INVITE DEFAULTS RATHER THAN BEING PASSED IN. The card lives on the profile
 * and the overlay is mounted by home.tsx, which shares none of the profile's
 * state -- so a required `onInvite` prop means threading a handler down two
 * unrelated trees, and the predictable outcome is the overlay quietly not having
 * it while the card does. Both get the same behavior by default; `onInvite`
 * stays as an override for a caller that wants something else.
 */
function useOpenPerson(onInvite?: (p: WebPerson) => void) {
  return useCallback(
    (p: WebPerson) => {
      if (p.kind === 'connection') {
        /**
         * THEIR CARD FIRST, THE ACCOUNT ONLY AS A FALLBACK.
         *
         * This pushed /u/<amberId> unconditionally, which draws the Amber
         * profile -- and an account that has filled nothing in renders as
         * "Amber user". That is a stranger's screen for somebody whose card you
         * have been keeping notes on for months, and the notes, the name you
         * call them, their number and their history were all one screen away
         * the whole time.
         *
         * /u/ is still right when there genuinely is no card: connected by a
         * link, never in the address book.
         */
        if (p.contactId) {
          router.push(`/(gated)/person/${p.contactId}`);
          return;
        }
        if (p.amberId) {
          router.push(`/(gated)/u/${p.amberId}`);
          return;
        }
      }
      if (onInvite) {
        onInvite(p);
        return;
      }
      if (p.contactId) void inviteContactToAmber(p.contactId, p.name);
    },
    [onInvite],
  );
}

/**
 * The card on the profile. Tap it and the same drawing fills the screen.
 *
 * NODES ARE NOT INDIVIDUALLY TAPPABLE HERE, and that is the point of a card. The
 * whole surface opens the overlay; a 30pt disc inside a big Pressable that does
 * something else is the most reliable way to make a tap feel broken, and at card
 * width the discs are too small to aim at anyway. Tapping a person happens in
 * the overlay, where they are big enough to hit and carry their names.
 *
 * The filter pills are the one exception, and they sit OUTSIDE that Pressable
 * for exactly this reason.
 */
export function ConnectionsWebCard({
  people,
  circles,
  pinnedIds,
  monogram,
}: {
  people: WebPerson[];
  circles: CirclePreview[];
  /** Circle ids in pin order. The pill row follows the grid below it. */
  pinnedIds: string[];
  monogram: string;
}) {
  const { width } = useWindowDimensions();
  // A CCard's content box: the screen less two 14pt gutters and two 18pt paddings.
  const size = width - 64;
  const [circleId, setCircleId] = useState<string | null>(null);

  const sorted = useMemo(() => sortPeople(people), [people]);
  const pills = useMemo(() => filterPills(sorted, circles, pinnedIds), [sorted, circles, pinnedIds]);
  const shown = useMemo(() => filterByCircle(sorted, circleId), [sorted, circleId]);

  /**
   * THE CARD DRAWS WHAT FITS, AND SAYS HOW MANY IT DID NOT.
   *
   * "Nothing should be touching other circles."
   *
   * The card is a fixed square and was handed everybody -- so a person with
   * thirty-three people in their web got thirty-three faces on one ring,
   * overlapping by 8pt, and forty-eight got 15pt. The overlay has no such
   * problem because boardForCount grows its board and it pans; the card cannot
   * grow, so it has to choose.
   *
   * ASKED, NOT GUESSED. webCapacity runs the same planner at the same disc floor
   * and the same bare-disc arc, so the number is whatever the layout would
   * genuinely fit rather than a constant that drifts away from it.
   *
   * SORTED ORDER IS ALREADY THE RIGHT ORDER -- sortPeople puts the people you
   * are actually connected to first -- so the faces that survive the cut are the
   * ones that matter, and arrangeAroundRing still spreads them around the ring
   * rather than bunching them in a corner.
   */
  const cardRx = Math.max(40, size / 2 - 30);
  const cardCap = useMemo(() => webCapacity(cardRx, cardRx, { labels: false }), [cardRx]);
  const onCard = useMemo(() => shown.slice(0, cardCap), [shown, cardCap]);
  const hidden = shown.length - onCard.length;

  /**
   * A FILTERED CIRCLE THAT GETS DELETED, OR EMPTIES, MUST NOT STRAND THE WEB.
   *
   * filterPills only offers circles somebody on the ring is in, so if the active
   * one stops qualifying -- the last person in it left, the circle was deleted
   * on another screen -- its pill disappears while the filter stays applied. The
   * ring goes blank with no lit pill explaining why and no way back except All,
   * which is not obviously the fix when nothing looks wrong.
   */
  useEffect(() => {
    if (circleId && !pills.some((p) => p.id === circleId)) setCircleId(null);
  }, [circleId, pills]);

  if (people.length === 0) return null;

  return (
    <CCard>
      <View style={{ alignItems: 'center' }}>
        <Pressable
          onPress={() => openWebOverlay({ people: sorted, circles, pinnedIds, monogram, circleId })}
          accessibilityRole="button"
          accessibilityLabel="Open your web"
          style={({ pressed }) => ({ alignSelf: 'stretch', opacity: pressed ? 0.9 : 1 })}
        >
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              alignSelf: 'stretch',
              justifyContent: 'space-between',
            }}
          >
            <CText t="kicker" color={cl.goldKicker}>
              YOUR WEB
            </CText>
            <CText t="metaSm" color={cl.ink48}>
              {hidden > 0 ? `+${hidden} more · tap to explore` : 'Tap to explore'}
            </CText>
          </View>
          {/* Names off on the card and on in the overlay -- the drawing is
              identical otherwise, which is the point: the card is that screen,
              smaller. At card width a fifteen-node web cannot carry fifteen
              names, and half-legible names are worse than none. */}
          <View style={{ marginTop: 2, alignItems: 'center' }}>
            <Board people={onCard} monogram={monogram} width={size} height={size} labels={false} />
          </View>
        </Pressable>
        {/* OUTSIDE the pressable, so pressing a pill filters instead of opening
            the overlay. A control nested in a bigger control that does something
            else is the most reliable way to make a tap feel broken. */}
        <View style={{ alignSelf: 'stretch', marginTop: 2, marginBottom: 2 }}>
          <FilterPills pills={pills} active={circleId} onSelect={setCircleId} total={sorted.length} />
        </View>
        {shown.length === 0 ? (
          <CText t="metaSm" color={cl.ink48} style={{ marginTop: 6, textAlign: 'center' }}>
            Nobody from that circle is on Amber yet.
          </CText>
        ) : null}
      </View>
    </CCard>
  );
}

/**
 * THE FULL-SCREEN VIEW. Rendered once, by home.tsx, above the pager and the bar.
 *
 * Drag to move it, pinch to scale it, tap somebody to open them. One
 * GestureDetector, one composed gesture: a `Gesture` instance cannot be attached
 * to two detectors -- the second subtree silently contributes nothing.
 *
 * Opening a person does NOT close this. It is a plain push onto the stack, so
 * their profile slides over the overlay and the back gesture slides it off
 * again, revealing this still open and still where it was panned to.
 */
export function ConnectionsWebOverlay({ onInvite }: { onInvite?: (p: WebPerson) => void }) {
  const payload = useWebOverlay();
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();

  const [shown, setShown] = useState(payload);
  const [circleId, setCircleId] = useState<string | null>(payload?.circleId ?? null);
  const enter = useSharedValue(0);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const scale = useSharedValue(1);
  const startX = useSharedValue(0);
  const startY = useSharedValue(0);
  const startScale = useSharedValue(1);

  useEffect(() => {
    if (payload) {
      setShown(payload);
      // THE CARD'S FILTER CARRIES IN. Opening a web you had narrowed to Work and
      // landing on everybody is the overlay contradicting the thing you tapped.
      setCircleId(payload.circleId);
      tx.value = 0;
      ty.value = 0;
      scale.value = fitScaleRef.current;
      enter.value = withTiming(1, { duration: 260, easing: Easing.out(Easing.cubic) });
    } else {
      enter.value = withTiming(0, { duration: 180, easing: Easing.in(Easing.quad) }, (done) => {
        if (done) runOnJS(setShown)(null);
      });
    }
  }, [payload, enter, tx, ty, scale]);

  /**
   * READ THROUGH A REF, because the open effect must run when the payload
   * arrives and not again when the fit changes -- re-running it on a rotation
   * would snap somebody's pan back to the middle mid-gesture.
   *
   * DECLARED HERE AND ASSIGNED BELOW, where fitScale exists. Assigning it here
   * reads fitScale during render, a hundred lines before its const -- a
   * temporal dead zone, which is a crash on first paint rather than a subtle
   * bug. scripts/tdz-check.mts catches this class; it is the second time this
   * exact shape has come up today.
   */
  const fitScaleRef = useRef(1);

  // MEMOIZED, because `?? []` makes a NEW array on every render, and a useMemo
  // keyed on a fresh literal is a memo that never hits -- on a screen that
  // re-renders on every frame of a pan.
  const people = useMemo(() => sortPeople(shown?.people ?? []), [shown]);
  const circles = useMemo(() => shown?.circles ?? [], [shown]);
  const pinnedIds = useMemo(() => shown?.pinnedIds ?? [], [shown]);
  const pills = useMemo(() => filterPills(people, circles, pinnedIds), [people, circles, pinnedIds]);
  const visible = useMemo(() => filterByCircle(people, circleId), [people, circleId]);

  useEffect(() => {
    if (circleId && !pills.some((p) => p.id === circleId)) setCircleId(null);
  }, [circleId, pills]);

  /**
   * THE BOARD TAKES THE ROOM THAT IS ACTUALLY THERE.
   *
   * It was a square sized to the narrower dimension, which on a portrait phone
   * meant a 393pt drawing floating in an 850pt screen with a third of the height
   * empty above it and a third below. Taking the full width and everything
   * between the title and the pills is most of the "spread it out" fix on its
   * own; the ring stretches into the extra height rather than the drawing simply
   * scaling up, so the gain goes into space BETWEEN people.
   */
  const screenW = width;
  const screenH = Math.max(320, height - (insets.top + 120) - (Math.max(insets.bottom, 12) + 92));

  /**
   * AND THE BOARD GROWS PAST THE SCREEN WHEN THERE ARE ENOUGH PEOPLE.
   *
   * "The web needs to be spaced out much better. Everything is scrunched up."
   *
   * Now that the ring holds everybody in every circle rather than a dozen, the
   * screen is simply not big enough: a hundred people at a tappable disc size
   * need several times the arc a phone offers. The three ways to pretend
   * otherwise are smaller discs (a test forbids it -- below 30pt they are not
   * reliably tappable), overlapping discs (the complaint), or a bigger board.
   *
   * This is the bigger board, and it costs nothing because the pan and pinch
   * that make it explorable were already here. boardForCount decides how much
   * bigger; every extra point goes into the space BETWEEN people rather than
   * into the faces, which is what the absolute disc cap in layoutWeb is for.
   */
  const board = useMemo(
    () => boardForCount(visible.length, { rx: screenW / 2, ry: screenH / 2 }),
    [visible.length, screenW, screenH],
  );
  const boardW = board.rx * 2;
  const boardH = board.ry * 2;

  /**
   * OPENS SHOWING THE WHOLE WEB, then pinch in.
   *
   * A board three times the screen that opens at 1:1 shows the middle of it and
   * nothing else -- which reads as a broken drawing rather than as a big one.
   * The entry scale is whatever fits, so the first thing somebody sees is all of
   * their people at once, and getting closer is a gesture they already have.
   */
  const fitScale = useMemo(
    () => Math.min(1, Math.min(screenW / boardW, screenH / boardH)),
    [screenW, screenH, boardW, boardH],
  );
  fitScaleRef.current = fitScale;

  const gesture = useMemo(() => {
    const pan = Gesture.Pan()
      .onStart(() => {
        startX.value = tx.value;
        startY.value = ty.value;
      })
      .onUpdate((e) => {
        tx.value = startX.value + e.translationX;
        ty.value = startY.value + e.translationY;
      });
    const pinch = Gesture.Pinch()
      .onStart(() => {
        startScale.value = scale.value;
      })
      .onUpdate((e) => {
        // Clamped on the UI thread. Unclamped, one careless pinch leaves the
        // board at 0.02x with no way back short of closing the screen.
        scale.value = Math.min(2.6, Math.max(0.6, startScale.value * e.scale));
      });
    return Gesture.Simultaneous(pan, pinch);
  }, [tx, ty, scale, startX, startY, startScale]);

  const shellStyle = useAnimatedStyle(() => ({
    opacity: enter.value,
    transform: [{ scale: 0.94 + enter.value * 0.06 }],
  }));
  const boardStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.value }, { translateY: ty.value }, { scale: scale.value }],
  }));

  const recenter = () => {
    tx.value = withSpring(0, { damping: 22, stiffness: 170 });
    ty.value = withSpring(0, { damping: 22, stiffness: 170 });
    scale.value = withSpring(1, { damping: 22, stiffness: 170 });
  };

  const open = useOpenPerson(onInvite);

  if (!shown) return null;

  return (
    <Animated.View
      pointerEvents={payload ? 'auto' : 'none'}
      style={[
        StyleSheet.absoluteFill,
        {
          backgroundColor: cl.groundCream,
          // ABOVE THE TAB PILL, and it has to be said explicitly: TabBar sets
          // zIndex 40 on itself, and an explicit z-index beats document order,
          // so the pill painted on top of this and sat there looking tappable.
          zIndex: 60,
        },
        shellStyle,
      ]}
    >
      {/* Chrome, OUTSIDE the detector, so a tap on either control is never read
          as the start of a pan. */}
      <View
        style={{
          position: 'absolute',
          top: insets.top + 10,
          left: clLayout.gutter + 6,
          right: clLayout.gutter + 6,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          zIndex: 2,
        }}
      >
        <Pressable
          onPress={recenter}
          accessibilityRole="button"
          accessibilityLabel="Center the view"
          hitSlop={10}
          style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <View style={{ width: 14, height: 1, backgroundColor: cl.gold55 }} />
            <CText t="kicker" color={cl.goldKicker}>
              RECENTER
            </CText>
          </View>
        </Pressable>
        <Pressable
          onPress={closeWebOverlay}
          accessibilityRole="button"
          accessibilityLabel="Close"
          hitSlop={12}
          style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
        >
          <View
            style={{
              width: 34,
              height: 34,
              borderRadius: 17,
              backgroundColor: cl.card,
              alignItems: 'center',
              justifyContent: 'center',
              ...clShadow.chip,
            }}
          >
            <X size={17} color={cl.ink62} strokeWidth={2} />
          </View>
        </Pressable>
      </View>

      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          top: insets.top + 44,
          left: clLayout.gutter + 6,
          right: clLayout.gutter + 6,
          zIndex: 2,
        }}
      >
        <CText t="screenTitle" color={cl.ink}>
          Your web
        </CText>
        <CText t="metaSm" color={cl.ink48} style={{ marginTop: 4 }}>
          {webSummary(visible)}
        </CText>
      </View>

      <GestureDetector gesture={gesture}>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <Animated.View style={boardStyle}>
            <Board
              people={visible}
              monogram={shown.monogram}
              width={boardW}
              height={boardH}
              labels
              onPressPerson={open}
            />
          </Animated.View>
          {visible.length === 0 ? (
            <View pointerEvents="none" style={{ position: 'absolute', left: 24, right: 24 }}>
              <CText t="metaSm" color={cl.ink48} style={{ textAlign: 'center' }}>
                Nobody from that circle is on Amber yet. Press All to see everyone.
              </CText>
            </View>
          ) : null}
        </View>
      </GestureDetector>

      {/* The pills, pinned to the bottom and outside the detector, so panning the
          board never drags them and they stay pressable while you do. */}
      <View
        style={{
          position: 'absolute',
          left: clLayout.gutter,
          right: clLayout.gutter,
          bottom: Math.max(insets.bottom, 12) + 14,
        }}
      >
        <FilterPills pills={pills} active={circleId} onSelect={setCircleId} total={people.length} />
      </View>
    </Animated.View>
  );
}
