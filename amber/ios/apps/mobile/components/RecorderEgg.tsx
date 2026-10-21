import { memo, useCallback, useMemo, useRef } from 'react';
import { useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { Text } from './Text';
import { GlassSurface } from './LiquidGlass';
import { elevation } from '../lib/tokens';

// THE LIVE RECORDER, AS A THING YOU CAN PUT WHERE YOU WANT IT.
//
// The minimized recorder used to be a pill pinned above the tab bar with "Tap to
// finish" on it. Pinned to the bottom of a tall phone it is a reach, and it sits
// exactly where the tab bar and both bottom bars already compete for the thumb.
//
// So it is an egg you drag anywhere and it stays there. It carries the running
// clock, because the one thing you need to know while the sheet is out of sight is
// that it is still going — and it pulses, slowly, for the same reason. The pulse is
// deliberately gentle: a recorder that strobes pulls the eye off whatever you
// opened the app to do, which defeats the purpose of minimising it.
//
// A TAP REOPENS, IT DOES NOT STOP. Finishing is destructive-ish — it ends the take
// — and this thing now lives under your thumb while you scroll, so a stray tap must
// not end a recording. Reopening puts Finish and Cancel one deliberate tap away.

const EGG_W = 58;
const EGG_H = 70;
// Slow enough to read as breathing rather than blinking.
const PULSE_MS = 1500;

// WHERE YOU LEFT IT, ACROSS MOUNTS.
//
// Tapping the egg reopens the recorder sheet, which UNMOUNTS the egg — so minimising
// again put it back at the resting corner and threw away the place you had chosen.
// Module scope rather than state because it must survive the unmount, and because
// nothing renders from it: it is only ever read once, to seed the shared values.
// Cleared when a recording ends so the next take starts from the resting corner
// rather than wherever the last one happened to finish.
let lastDrop: { x: number; y: number } | null = null;
export function forgetRecorderEggPosition(): void {
  lastDrop = null;
}

function rememberDrop(x: number, y: number) {
  lastDrop = { x, y };
}

function RecorderEggImpl({
  elapsed,
  onPress,
}: {
  /** mm:ss, already formatted by the recorder. */
  elapsed: string;
  /** Reopen the recorder sheet. */
  onPress: () => void;
}) {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();

  // Resting place before it is ever dragged: right side, above the tab bar, clear of
  // the bottom bars. Everything after that is the user's choice.
  const restX = width - EGG_W - 18;
  const restY = height - insets.bottom - EGG_H - 150;

  // Committed position, and the in-flight drag on top of it. Two values rather than
  // one so the drag can be released back to zero without recomputing where "here" is.
  // Clamped on read as well as on drop: the remembered point came from a previous
  // mount and the screen may have rotated since.
  const x = useSharedValue(
    lastDrop ? Math.min(width - EGG_W - 10, Math.max(10, lastDrop.x)) : restX,
  );
  const y = useSharedValue(
    lastDrop
      ? Math.min(height - insets.bottom - EGG_H - 10, Math.max(insets.top + 10, lastDrop.y))
      : restY,
  );
  const dx = useSharedValue(0);
  const dy = useSharedValue(0);
  const grabbed = useSharedValue(0);
  // 1 once onEnd has run, so onFinalize can tell a real release from a cancellation.
  const ended = useSharedValue(0);

  // The pulse. Started once, runs for the life of the component. It drives the HALO
  // ONLY — see the note on `shell` below for why it must never touch the egg.
  const pulse = useSharedValue(0);
  const started = useRef(false);
  if (!started.current) {
    started.current = true;
    pulse.value = withRepeat(
      withTiming(1, { duration: PULSE_MS, easing: Easing.inOut(Easing.quad) }),
      -1,
      true,
    );
  }

  // The recorder re-renders once a second to tick the clock, and the parent hands
  // down a fresh onPress arrow each time. Reading it through a ref keeps the gesture
  // out of that churn: the gesture depends on GEOMETRY only, so it is rebuilt when
  // the screen actually changes and never once per second.
  const onPressRef = useRef(onPress);
  onPressRef.current = onPress;
  const fire = useCallback(() => onPressRef.current(), []);

  // useMemo, not useRef. A ref pinned the FIRST gesture object forever, which meant
  // `width`, `height` and the insets stayed frozen at first render — so after a
  // rotation the egg clamped itself to the old screen's bounds.
  const gesture = useMemo(
    () =>
      Gesture.Race(
      Gesture.Pan()
        // No long-press arming here, unlike the favorites grid: this floats over the
        // whole app and nothing underneath it competes for the same touch, so a drag
        // should start the instant the finger moves.
        .onStart(() => {
          ended.value = 0;
          // withTiming, not withSpring. The old spring was underdamped (damping 16
          // against a critical value near 31), so `grabbed` overshot past 1 — which
          // also drove the old `1 - grabbed` term NEGATIVE and inverted the pulse.
          // A short timing cannot overshoot at all.
          grabbed.value = withTiming(1, { duration: 110, easing: Easing.out(Easing.quad) });
        })
        .onUpdate((e) => {
          dx.value = e.translationX;
          dy.value = e.translationY;
        })
        .onEnd(() => {
          ended.value = 1;
          // IT STOPS DEAD WHERE YOU LET GO. The old code did
          // `x.value = withSpring(clamped)` while zeroing dx in the same frame, so
          // the very next frame rendered `oldX + 0` — the egg teleported back the
          // whole drag distance and then sprang forward to the drop point. That is
          // the shudder on release. Committing nx FIRST makes the swap invisible:
          // `nx + 0` is exactly the pixel the finger was on.
          const nx = x.value + dx.value;
          const ny = y.value + dy.value;
          x.value = nx;
          y.value = ny;
          dx.value = 0;
          dy.value = 0;

          // Only if the drop was actually off-screen does anything animate, and then
          // it is overdamped so it slides back without a bounce.
          const minX = 10;
          const maxX = width - EGG_W - 10;
          const minY = insets.top + 10;
          const maxY = height - insets.bottom - EGG_H - 10;
          const cx = Math.min(maxX, Math.max(minX, nx));
          const cy = Math.min(maxY, Math.max(minY, ny));
          // Remember the CLAMPED point, so a drop past the edge is remembered where
          // it actually settles rather than where the finger let go.
          runOnJS(rememberDrop)(cx, cy);
          if (cx !== nx) x.value = withSpring(cx, { damping: 30, stiffness: 220 });
          if (cy !== ny) y.value = withSpring(cy, { damping: 30, stiffness: 220 });

          grabbed.value = withTiming(0, { duration: 140, easing: Easing.out(Easing.quad) });
        })
        .onFinalize(() => {
          // A CANCELLED gesture (a call arrives, the app backgrounds) never reaches
          // onEnd and would leave the egg stranded mid-drag. But onFinalize also runs
          // AFTER a normal onEnd, where re-zeroing dx and restarting the animation on
          // top of one already running added a second wobble to every release. The
          // flag makes this the cancel path only.
          if (ended.value === 1) return;
          dx.value = 0;
          dy.value = 0;
          grabbed.value = withTiming(0, { duration: 140, easing: Easing.out(Easing.quad) });
        }),
      Gesture.Tap()
        .maxDuration(300)
        .onEnd((_e, ok) => {
          if (ok) runOnJS(fire)();
        }),
    ),
    [width, height, insets.top, insets.bottom, fire, x, y, dx, dy, grabbed, ended],
  );

  // THE EGG ITSELF DOES NOT BREATHE. It used to carry `pulse * 0.03` on its scale,
  // which sounds like nothing and is not: a 3% cycle on a 58x70 view walks every edge
  // a point or two, forever, on the one element the user is trying to place exactly.
  // "It moves around when you don't want it to, without you touching it" is that term.
  // The halo behind it carries the whole pulse now, so the thing still reads as live
  // while the thing you are dragging holds perfectly still.
  const shell = useAnimatedStyle(() => ({
    transform: [
      { translateX: x.value + dx.value },
      { translateY: y.value + dy.value },
      { scale: 1 + grabbed.value * 0.06 },
    ],
  }));

  // A halo rather than a flashing dot: it reads as "live" without a hard edge
  // blinking in the corner of your eye.
  const halo = useAnimatedStyle(() => ({
    opacity: (0.42 - pulse.value * 0.34) * (1 - grabbed.value * 0.6),
    transform: [{ scale: 1 + pulse.value * 0.28 }],
  }));

  return (
    <Animated.View
      pointerEvents="box-none"
      style={[
        { position: 'absolute', left: 0, top: 0, width: EGG_W, height: EGG_H },
        shell,
      ]}
    >
      <GestureDetector gesture={gesture}>
        <View
          accessibilityRole="button"
          accessibilityLabel={`Recording, ${elapsed}. Tap to open the recorder. Drag to move.`}
          style={{ width: EGG_W, height: EGG_H }}
        >
          <Animated.View
            pointerEvents="none"
            style={[
              {
                position: 'absolute',
                left: -6,
                top: -6,
                right: -6,
                bottom: -6,
                borderRadius: EGG_W / 2 + 6,
                backgroundColor: '#E0913B',
              },
              halo,
            ]}
          />
          <GlassSurface
            glassStyle="regular"
            tintColor="rgba(224,145,59,0.55)"
            fallbackStyle={{ backgroundColor: '#201E1D' }}
            style={{
              width: EGG_W,
              height: EGG_H,
              // Egg, not capsule: the top curve is tighter than the bottom, which is
              // what stops a tall rounded rect from reading as a pill.
              borderTopLeftRadius: EGG_W / 2,
              borderTopRightRadius: EGG_W / 2,
              borderBottomLeftRadius: EGG_W / 2.3,
              borderBottomRightRadius: EGG_W / 2.3,
              alignItems: 'center',
              justifyContent: 'center',
              gap: 5,
              overflow: 'hidden',
              ...elevation.lg,
            }}
          >
            {/* The record dot. Solid, not blinking — the halo is what moves. */}
            <View style={{ width: 9, height: 9, borderRadius: 4.5, backgroundColor: '#E0552B' }} />
            <Text
              variant="captionSm"
              style={{
                color: '#FFF8F0',
                fontVariant: ['tabular-nums'],
                fontSize: 11,
                lineHeight: 13,
              }}
            >
              {elapsed}
            </Text>
          </GlassSurface>
        </View>
      </GestureDetector>
    </Animated.View>
  );
}

// Memoized because the recorder ticks a clock once a second and would otherwise
// re-render this whole subtree — and its GlassSurface — sixty times a minute for a
// string that lives in one Text node. `elapsed` is the only prop that really changes;
// `onPress` is read through a ref inside, so an unstable arrow from the parent no
// longer costs anything.
export const RecorderEgg = memo(RecorderEggImpl);
