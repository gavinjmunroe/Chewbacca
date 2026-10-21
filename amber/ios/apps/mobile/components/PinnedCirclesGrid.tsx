import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import ReAnimated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { Plus } from 'lucide-react-native';
import { Pressable } from './Pressable';
import { CText } from './classical';
import { ChordEmblem } from './ChordEmblem';
import { cl } from '../lib/classical';
import { NAMED_COLORS } from '../lib/circleColors';
import { MAX_PINNED_CIRCLES, type PinnedCircle } from '../lib/circleFavorites';

/**
 * PINNED CIRCLES — three across, nine at most, arranged by hand.
 *
 * The interaction is the same one FavoritesGrid uses for pinned people, and the
 * gesture architecture here is copied from it ON PURPOSE rather than
 * generalised, because that file's comments are a list of things that crashed
 * this app and the safest thing to do with hard-won gesture code is not to
 * refactor it a week before submission. The three lessons it paid for, carried
 * over verbatim in shape:
 *
 *  1. ONE PAN, decided at release. Moved = reorder, held still = the unpin
 *     menu. Racing a Pan on activateAfterLongPress against a LongPress cannot
 *     work: the pan activates on its duration WITHOUT needing movement, so it
 *     always wins and the hold is unreachable. The difference between a hold
 *     and a drag is not when the touch started, it is whether the finger moved.
 *
 *  2. NOTHING THE WORKLET CALLS CROSSES A THREAD. The slot arithmetic is
 *     INLINE. A worklet calling a plain module-scope arrow throws on the UI
 *     thread inside a gesture callback, which is not recoverable — Hermes
 *     reports it through throwPendingError, C++ has no handler, and the process
 *     aborts. That was a real SIGABRT, and it looked like a swipe bug because
 *     these tiles sit where a thumb starts a horizontal page swipe.
 *
 *  3. THE GESTURE IS BUILT ONCE. Everything it reads is a shared value or a
 *     ref-backed stable callback, so `setDragging` and `setHover` re-rendering
 *     mid-drag cannot hand GestureDetector a new gesture. Tearing native
 *     recognizers down under a live finger takes the app out.
 *
 * The order commits on RELEASE, not during the drag: live reshuffling changes
 * the dragged tile's own index underneath the gesture, so its accumulated
 * translation stops measuring from where the finger started and it drifts a
 * slot per swap. Instead the tile follows the finger, a ring shows where it will
 * land, and everything re-renders into place on the drop.
 */

const COLUMNS = 3;
// 118 -> 130 and 62 -> 78, because the mark changed and it needs the room.
// A chord emblem is a ring with points ON it and strings across it; at 62pt the
// ring is 62 and everything inside it is fighting for the middle 40. 78 is the
// largest tile that still leaves air between three columns on the narrowest
// phone this ships to.
const ROW_H = 130;
const TILE = 78;

function tintOf(color: string | null): string {
  if (!color) return NAMED_COLORS.orange;
  const key = color.trim();
  if (key.startsWith('#')) return key;
  return NAMED_COLORS[key.toLowerCase()] ?? NAMED_COLORS.orange;
}

export function PinnedCirclesGrid({
  circles,
  onOpenCircle,
  onAdd,
  onUnpin,
  onReorder,
}: {
  circles: PinnedCircle[];
  onOpenCircle: (id: string) => void;
  onAdd: () => void;
  /** Held still → the caller shows Unpin / Cancel. */
  onUnpin: (circle: PinnedCircle) => void;
  /** Commit a new order. Called with every id, in the new order. */
  onReorder: (ids: string[]) => void;
}) {
  // Local order so a drag lands instantly rather than waiting for the PUT.
  // Re-synced when the SET of ids changes (a pin, an unpin, a refetch) but NOT
  // when only the order differs — otherwise a slow response carrying the old
  // order yanks a just-dropped tile back.
  const [order, setOrder] = useState<PinnedCircle[]>(circles);
  const idKey = circles.map((c) => c.id).sort().join(',');
  useEffect(() => {
    setOrder((prev) => {
      const byId = new Map(circles.map((c) => [c.id, c]));
      const kept = prev.filter((c) => byId.has(c.id)).map((c) => byId.get(c.id)!);
      const added = circles.filter((c) => !prev.some((p) => p.id === c.id));
      return [...kept, ...added];
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idKey]);

  const [width, setWidth] = useState(0);
  const cellW = width > 0 ? width / COLUMNS : 0;
  const [hover, setHover] = useState<number | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);

  const canAdd = order.length < MAX_PINNED_CIRCLES;
  const cellCount = order.length + (canAdd ? 1 : 0);
  const rows = Math.max(1, Math.ceil(cellCount / COLUMNS));

  const commit = useCallback(
    (from: number, to: number) => {
      if (to === from || to < 0 || to >= order.length) return;
      const next = order.slice();
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      setOrder(next);
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      onReorder(next.map((c) => c.id));
    },
    [order, onReorder],
  );

  const grid = useMemo(
    () =>
      order.map((circle, index) => (
        <DragTile
          key={circle.id}
          circle={circle}
          index={index}
          cellW={cellW}
          count={order.length}
          isDragging={dragging === circle.id}
          isTarget={hover === index && dragging !== null && dragging !== circle.id}
          onPress={() => onOpenCircle(circle.id)}
          onHold={() => onUnpin(circle)}
          onDragStart={() => setDragging(circle.id)}
          onHover={setHover}
          onDrop={(to) => {
            setDragging(null);
            setHover(null);
            commit(index, to);
          }}
        />
      )),
    [order, cellW, dragging, hover, onOpenCircle, onUnpin, commit],
  );

  return (
    <View
      onLayout={(e) => {
        const w = Math.floor(e.nativeEvent.layout.width);
        setWidth((prev) => (Math.abs(prev - w) > 1 ? w : prev));
      }}
      style={{
        flexDirection: 'row',
        flexWrap: 'wrap',
        // A fixed row height rather than letting content decide: tiles have to
        // line up across rows, and one two-line name would push its whole row
        // taller than the others.
        minHeight: rows * ROW_H,
      }}
    >
      {cellW > 0 ? grid : null}
      {canAdd && cellW > 0 ? (
        <Pressable
          onPress={onAdd}
          accessibilityRole="button"
          accessibilityLabel="Pin another circle"
          style={({ pressed }) => ({
            width: cellW,
            height: ROW_H,
            alignItems: 'center',
            opacity: pressed ? 0.7 : 1,
          })}
        >
          <View
            style={{
              width: TILE,
              height: TILE,
              // Round, to match the emblems beside it. A rounded square next to
              // a row of circles reads as a different kind of thing.
              borderRadius: TILE / 2,
              borderWidth: 1,
              borderStyle: 'dashed',
              borderColor: 'rgba(178,98,45,0.45)',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Plus size={16} color={cl.goldDeep} strokeWidth={2.5} />
          </View>
          <CText t="metaXs" color={cl.ink48} style={{ marginTop: 6 }} numberOfLines={1}>
            Pin
          </CText>
        </Pressable>
      ) : null}
    </View>
  );
}

function DragTile({
  circle,
  index,
  cellW,
  count,
  isDragging,
  isTarget,
  onPress,
  onHold,
  onDragStart,
  onHover,
  onDrop,
}: {
  circle: PinnedCircle;
  index: number;
  cellW: number;
  count: number;
  isDragging: boolean;
  isTarget: boolean;
  onPress: () => void;
  onHold: () => void;
  onDragStart: () => void;
  onHover: (slot: number | null) => void;
  onDrop: (to: number) => void;
}) {
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const lift = useSharedValue(0);
  // The last slot JS was told about, so a drag reports a handful of times
  // rather than sixty times a second.
  const lastSlot = useSharedValue(-1);
  // Did this touch travel far enough to be a DRAG? UI thread only.
  const moved = useSharedValue(0);

  // Props the worklet needs become SHARED VALUES, so a reorder does not
  // invalidate a gesture that is mid-touch.
  const idx = useSharedValue(index);
  const cw = useSharedValue(cellW);
  const cnt = useSharedValue(count);
  useEffect(() => {
    idx.value = index;
    cw.value = cellW;
    cnt.value = count;
  }, [index, cellW, count, idx, cw, cnt]);

  // The callbacks come through a ref behind stable wrappers. The parent
  // recreates these arrows every render (they close over `index` and `commit`),
  // and capturing them directly meant a live gesture kept calling the versions
  // from the render BEFORE the drag started.
  const cb = useRef({ onPress, onHold, onDragStart, onHover, onDrop });
  useEffect(() => {
    cb.current = { onPress, onHold, onDragStart, onHover, onDrop };
  }, [onPress, onHold, onDragStart, onHover, onDrop]);

  const fireDragStart = useCallback(() => cb.current.onDragStart(), []);
  const fireHover = useCallback((slot: number) => cb.current.onHover(slot), []);
  const fireDrop = useCallback((to: number) => cb.current.onDrop(to), []);
  const firePress = useCallback(() => cb.current.onPress(), []);
  const fireHold = useCallback(() => {
    // The haptic fires HERE, on the JS thread. runOnJS(Haptics.impactAsync)
    // resolves that property on the UI thread, which drags the whole
    // expo-haptics namespace into the worklet's closure for no reason.
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    cb.current.onHold();
  }, []);

  const gesture = useMemo(() => {
    const pan = Gesture.Pan()
      // A SHORT HOLD BEFORE A DRAG CAN START. These tiles are inside a
      // horizontal pager, so a pan that activates on 10pt of travel alone
      // steals every page swipe that happens to begin over one of them. 180ms
      // is longer than a flick takes to get moving and shorter than a
      // deliberate press-and-drag feels.
      .activateAfterLongPress(180)
      .activeOffsetX([-10, 10])
      .activeOffsetY([-10, 10])
      .onStart(() => {
        lift.value = withSpring(1, { damping: 18, stiffness: 220 });
        lastSlot.value = -1;
        moved.value = 0;
        runOnJS(fireDragStart)();
      })
      .onUpdate((e) => {
        tx.value = e.translationX;
        ty.value = e.translationY;
        // 8pt of travel is a drag; under it is a hand resting still.
        if (Math.abs(e.translationX) > 8 || Math.abs(e.translationY) > 8) moved.value = 1;
        // INLINE. A worklet may only call another worklet; calling a plain
        // module-scope helper from here aborts the process.
        const w = cw.value > 0 ? cw.value : 1;
        const col = Math.min(
          COLUMNS - 1,
          Math.max(0, Math.round((idx.value % COLUMNS) + e.translationX / w)),
        );
        const row = Math.max(
          0,
          Math.round(Math.floor(idx.value / COLUMNS) + e.translationY / ROW_H),
        );
        const slot = Math.min(cnt.value - 1, row * COLUMNS + col);
        if (slot !== lastSlot.value) {
          lastSlot.value = slot;
          runOnJS(fireHover)(slot);
        }
      })
      .onEnd(() => {
        // Whatever the last update computed. Recomputing here would duplicate
        // the arithmetic and could disagree with the ring the user is looking at.
        const to = lastSlot.value;
        const didMove = moved.value === 1;
        // Home before the commit: the tile is about to re-render into its new
        // slot and a leftover translation would offset it from there.
        tx.value = withTiming(0, { duration: 160 });
        ty.value = withTiming(0, { duration: 160 });
        lift.value = withSpring(0, { damping: 18, stiffness: 220 });
        if (didMove && to >= 0) runOnJS(fireDrop)(to);
        else if (!didMove) runOnJS(fireHold)();
      })
      .onFinalize(() => {
        // A cancelled gesture (a call arrives, the app backgrounds) never
        // reaches onEnd and would leave the tile stranded mid-screen.
        tx.value = withTiming(0, { duration: 160 });
        ty.value = withTiming(0, { duration: 160 });
        lift.value = withSpring(0, { damping: 18, stiffness: 220 });
      });

    const tap = Gesture.Tap()
      .maxDuration(300)
      .onEnd((_e, ok) => {
        if (ok) runOnJS(firePress)();
      });

    // Race, not Simultaneous: exactly one of the two wins a touch. A quick tap
    // opens the circle; anything held past 180ms is the pan, which then decides
    // between reorder and unpin by whether the finger moved.
    return Gesture.Race(pan, tap);
  }, [
    tx,
    ty,
    lift,
    lastSlot,
    moved,
    idx,
    cw,
    cnt,
    fireDragStart,
    fireHover,
    fireDrop,
    firePress,
    fireHold,
  ]);

  const style = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.value }, { translateY: ty.value }, { scale: 1 + lift.value * 0.08 }],
    shadowOpacity: lift.value * 0.22,
  }));

  const tint = tintOf(circle.color);

  return (
    <GestureDetector gesture={gesture}>
      <ReAnimated.View
        // No `layout={LinearTransition}` here, deliberately: a Reanimated layout
        // animation on the same view that carries a gesture-driven transform is
        // a documented instability on Fabric, and this view is also inside a
        // GestureDetector. zIndex is a static style driven by React state for
        // the same reason.
        style={[
          {
            width: cellW,
            height: ROW_H,
            alignItems: 'center',
            shadowColor: '#2D2B2B',
            shadowOffset: { width: 0, height: 6 },
            shadowRadius: 10,
            zIndex: isDragging ? 20 : 0,
          },
          style,
        ]}
      >
        {/* Where the dragged tile will land. A ring rather than a gap, because a
            gap needs the neighbors to move, which is the live reshuffling this
            design exists to avoid. */}
        {isTarget ? (
          <View
            style={{
              position: 'absolute',
              top: -3,
              width: TILE + 8,
              height: TILE + 8,
              borderRadius: (TILE + 8) / 2,
              borderWidth: 2,
              borderColor: 'rgba(178,98,45,0.55)',
            }}
          />
        ) : null}
        {/* THE CIRCLE'S OWN MARK -- THE SAME DRAWING THE INFO TAB RENDERS.
            Three marks have stood here. A rounded square with a member count in
            it: a swatch with a number on it, saying how many people were in the
            circle and nothing about WHICH circle it was, which is the only
            question a shortlist has to answer. Then ContactEmblem, which is a
            PERSON's tile -- a ring, an inner lens and a letter between them --
            and at tile size that reads as a basketball. Then a hand-rolled
            three-node mark, which had the right idea and the wrong curves.
            This is ChordEmblem, the emblem the circle's own Info tab draws:
            members on a ring joined by chords that sag inward, geometry
            transcribed from the design source. Not a second drawing that has to
            be kept in visual step with that one -- literally that one, at tile
            size, with `nodeStyle="dots"` so the 30pt initials floor does not eat
            the tile. `preview` is why the favorites payload carries member
            names now: with no members there is nothing to plot and the emblem
            falls back to its decorative lens. */}
        <View style={{ opacity: isDragging ? 0.96 : 1 }}>
          <ChordEmblem
            name={circle.name}
            memberCount={circle.memberCount}
            members={(circle.preview ?? []).map((m) => ({ id: m.id, name: m.name }))}
            accent={tint}
            size={TILE}
            nodeStyle="dots"
            showLabels={false}
            showCount={false}
            centerText={(circle.name || '?').trim().charAt(0).toUpperCase() || '?'}
            decorativeChords={(circle.preview ?? []).length === 0}
          />
        </View>
        <CText
          t="metaXs"
          color={cl.ink55}
          style={{ marginTop: 6, maxWidth: '100%', textAlign: 'center' }}
          numberOfLines={1}
        >
          {circle.name}
        </CText>
        <CText t="metaXs" color={cl.ink38} numberOfLines={1}>
          {circle.memberCount}
        </CText>
      </ReAnimated.View>
    </GestureDetector>
  );
}
