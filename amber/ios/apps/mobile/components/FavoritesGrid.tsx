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
import { ContactEmblem } from './ContactEmblem';
import { CText } from './classical';
import { cl } from '../lib/classical';
import { MAX_FAVORITES, type Favorite } from '../lib/favorites';

// THE FAVORITES GRID — four across, sixteen at most, arranged by hand.
//
// Three gestures on one face, which is the whole design problem here:
//   tap        → open that person
//   drag       → move them to another slot
//   hold still → the menu (Remove / Cancel)
//
// Drag and hold are ONE gesture, separated by what the finger did rather than by
// which recognizer fired first. A short hold (180ms) arms the pan; from there,
// moving reorders and staying still opens the menu on release.
//
// They used to be two gestures in a Race — pan on activateAfterLongPress(180),
// LongPress on minDuration(400). That could never work: activateAfterLongPress
// activates the pan after its duration WITHOUT requiring movement, so at 180ms the
// pan always won and cancelled the 400ms hold. The Remove menu was unreachable.
// Racing them was the wrong shape for the question being asked.
//
// THE ORDER IS COMMITTED ON RELEASE, NOT DURING THE DRAG. Live reshuffling means the
// dragged item's own index changes underneath the gesture, so the translation it is
// accumulating no longer measures from where the finger started, and the item drifts
// away from the finger by one slot per swap. The fixes for that are all bookkeeping
// on a moving baseline. Instead: the face follows the finger, a ring shows the slot
// it will land in, and everyone slides into place after the drop via
// LinearTransition. Fewer moving parts, and the target is visible the whole time
// rather than inferred from things shuffling.

const COLUMNS = 4;
const ROW_H = 96;
const EMBLEM = 56;

// NO MODULE-SCOPE HELPERS FOR THE WORKLET TO CALL. This is THE crash.
//
// There were two one-liners here — `rowOf` and `colOf` — and `slotFor` (a worklet,
// running on the UI thread inside a pan handler) called them. Reanimated does not
// workletize an arbitrary module-scope arrow function, so calling one from the UI
// thread throws "Tried to synchronously call a non-worklet function". A JS exception
// raised inside a gesture callback on the main thread is not recoverable: Hermes
// reports it through throwPendingError, C++ has no handler for it, and the process
// aborts. That is precisely the crash report — SIGABRT, main thread,
// HermesRuntimeImpl::throwPendingError under _UIGestureRecognizerSendActions.
//
// And it explains why it looked like a SWIPE problem rather than a drag problem: the
// favorites row sits at the top of the Contacts page, which is where a thumb starts
// a horizontal swipe. Start the swipe over a face, the pan wins after 10pt, onUpdate
// runs, and the app is gone. Start it lower over the contact list and nothing
// happens. "Back and forth a few times and it crashes" is that coin flip.
//
// The arithmetic is now INLINE in the worklet. Nothing it calls crosses a thread
// boundary, so there is nothing left to get wrong.

export function FavoritesGrid({
  favorites,
  onOpenPerson,
  onAdd,
  onRemove,
  onReorder,
}: {
  favorites: Favorite[];
  onOpenPerson: (id: string) => void;
  onAdd: () => void;
  /** Long-press → the caller shows Remove / Cancel. */
  onRemove: (fav: Favorite) => void;
  /** Commit a new order. Called with every id, in the new order. */
  onReorder: (ids: string[]) => void;
}) {
  // Local order so a drag lands instantly instead of waiting for the round trip.
  // Re-synced from props whenever the SET of ids changes (an add, a removal, a
  // refetch) but NOT when only the order differs — otherwise a slow PUT response
  // carrying the old order would yank a just-dropped face back.
  const [order, setOrder] = useState<Favorite[]>(favorites);
  const idKey = favorites.map((f) => f.id).sort().join(',');
  useEffect(() => {
    setOrder((prev) => {
      const byId = new Map(favorites.map((f) => [f.id, f]));
      const kept = prev.filter((f) => byId.has(f.id)).map((f) => byId.get(f.id)!);
      const added = favorites.filter((f) => !prev.some((p) => p.id === f.id));
      return [...kept, ...added];
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idKey]);

  const [width, setWidth] = useState(0);
  const cellW = width > 0 ? width / COLUMNS : 0;
  // Which slot the finger is currently over, or null. Drives the target ring.
  const [hover, setHover] = useState<number | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);

  const canAdd = order.length < MAX_FAVORITES;
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
      onReorder(next.map((f) => f.id));
    },
    [order, onReorder],
  );

  const grid = useMemo(
    () =>
      order.map((fav, index) => (
        <DragFace
          key={fav.id}
          fav={fav}
          index={index}
          cellW={cellW}
          count={order.length}
          isDragging={dragging === fav.id}
          isTarget={hover === index && dragging !== null && dragging !== fav.id}
          onPress={() => onOpenPerson(fav.id)}
          onHold={() => onRemove(fav)}
          onDragStart={() => setDragging(fav.id)}
          onHover={setHover}
          onDrop={(to) => {
            setDragging(null);
            setHover(null);
            commit(index, to);
          }}
        />
      )),
    [order, cellW, dragging, hover, onOpenPerson, onRemove, commit],
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
        // A fixed row height rather than letting content decide it: the faces have to
        // line up across rows, and a name that wraps to two lines on one face would
        // otherwise push its whole row taller than the others.
        minHeight: rows * ROW_H,
      }}
    >
      {cellW > 0 ? grid : null}
      {canAdd && cellW > 0 ? (
        <Pressable
          onPress={onAdd}
          accessibilityRole="button"
          accessibilityLabel="Pin another favorite"
          style={({ pressed }) => ({
            width: cellW,
            height: ROW_H,
            alignItems: 'center',
            opacity: pressed ? 0.7 : 1,
          })}
        >
          <View
            style={{
              width: EMBLEM,
              height: EMBLEM,
              borderRadius: EMBLEM / 2,
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
            Add
          </CText>
        </Pressable>
      ) : null}
    </View>
  );
}

function DragFace({
  fav,
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
  fav: Favorite;
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
  // The last slot we told JS about, so a drag reports a handful of times instead of
  // sixty times a second.
  const lastSlot = useSharedValue(-1);
  const first = (fav.name ?? '').trim().split(/\s+/)[0] || fav.name;

  // ── EVERYTHING THE GESTURES READ IS A SHARED VALUE OR A STABLE FUNCTION ──────────
  //
  // This is the shape that actually fixes the crash, and the previous attempt only
  // looked like it did. `useMemo(() => Gesture.Race(pan, hold, tap), [pan, hold, tap])`
  // is a no-op when pan/hold/tap are themselves rebuilt on every render: all three dep
  // identities change every time, the memo never hits, and GestureDetector is handed a
  // brand new Race on every render — including the renders that `setDragging` and
  // `setHover` cause DURING a drag. Tearing native recognizers down and rebuilding
  // them under a live finger is what takes the app out.
  //
  // So the gestures are built ONCE per mounted face and never again. That is only
  // possible if nothing they close over ever changes identity:
  //
  //   - `index`, `cellW` and `count` become SHARED VALUES. The worklet reads them at
  //     gesture time instead of capturing this render's props, so a reorder does not
  //     invalidate the gesture.
  //   - the five callbacks are read through a ref behind stable wrappers. The parent
  //     recreates those arrows on every render (they close over `index` and `commit`);
  //     capturing them directly meant a live gesture kept calling the versions from
  //     the render BEFORE the drag started.
  const idx = useSharedValue(index);
  const cw = useSharedValue(cellW);
  const cnt = useSharedValue(count);
  useEffect(() => {
    idx.value = index;
    cw.value = cellW;
    cnt.value = count;
  }, [index, cellW, count, idx, cw, cnt]);

  const cb = useRef({ onPress, onHold, onDragStart, onHover, onDrop });
  useEffect(() => {
    cb.current = { onPress, onHold, onDragStart, onHover, onDrop };
  }, [onPress, onHold, onDragStart, onHover, onDrop]);

  // Stable identities (empty deps), each reading the CURRENT callback off the ref.
  const fireDragStart = useCallback(() => cb.current.onDragStart(), []);
  const fireHover = useCallback((slot: number) => cb.current.onHover(slot), []);
  const fireDrop = useCallback((to: number) => cb.current.onDrop(to), []);
  const firePress = useCallback(() => cb.current.onPress(), []);
  const fireHold = useCallback(() => {
    // The haptic fires HERE, on the JS thread, not from inside the worklet.
    // `runOnJS(Haptics.impactAsync)` resolved that property on the UI thread, which
    // drags the whole expo-haptics module namespace into the worklet's closure for no
    // reason. Every other haptic in the app is called from JS; so is this one now.
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    cb.current.onHold();
  }, []);

  // Did this touch travel far enough to be a DRAG? Written on the UI thread only.
  //
  // THIS IS THE FIX FOR "I CAN'T DELETE WHEN I LONG HOLD". The gesture used to be
  // Race(pan, hold, tap) with the pan on activateAfterLongPress(180) and the hold on
  // minDuration(400). activateAfterLongPress activates the pan after that duration
  // WITHOUT needing movement — so at 180ms the pan always won the race and cancelled
  // the 400ms LongPress. onHold could never fire, and the Remove menu was
  // unreachable. My own regression, introduced with the crash fix.
  //
  // Racing two gestures to decide hold-vs-drag was the wrong shape anyway: the
  // difference is not WHEN the touch started, it is whether the finger MOVED. So
  // there is one pan now, and what it does is decided at release: still means the
  // Remove menu, moved means reorder. Which is exactly the rule asked for — holding
  // and dragging must never ask to delete.
  const moved = useSharedValue(0);

  const gesture = useMemo(() => {
    const pan = Gesture.Pan()
      // A SHORT HOLD BEFORE A DRAG CAN START, and this is not fussiness.
      //
      // These faces sit at the top of the Contacts page, directly under where a thumb
      // begins a horizontal swipe between pages. A pan that activates on 10pt of
      // travel alone steals every one of those swipes and reorders instead of paging.
      // 180ms is long enough that a flick never reaches it — a swipe is already moving
      // by then — and short enough that a deliberate press-and-drag still feels
      // immediate.
      //
      // It also separates the three things a press can mean: move within 180ms and the
      // pager gets it, hold still past 400ms and you get the Remove menu, hold briefly
      // then move and you are reordering.
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
        // 8pt of travel is a drag; anything under it is a hand resting still.
        if (Math.abs(e.translationX) > 8 || Math.abs(e.translationY) > 8) moved.value = 1;
        // INLINE, not a call to a helper. A worklet may only call another worklet, and
        // the module-scope one-liners this used to call were plain JS — which threw on
        // the UI thread and aborted the process. Nothing here leaves the worklet.
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
        // The slot to land in is whatever the last update computed — recomputing it
        // here would duplicate the arithmetic and could disagree with the ring the
        // user was just looking at.
        const to = lastSlot.value;
        const didMove = moved.value === 1;
        // Home before the commit: the face is about to re-render into its new slot,
        // and a leftover translation would offset it from there.
        tx.value = withTiming(0, { duration: 160 });
        ty.value = withTiming(0, { duration: 160 });
        lift.value = withSpring(0, { damping: 18, stiffness: 220 });
        // Moved = reorder. Never moved = the Remove menu. One gesture, decided by
        // what the finger actually did rather than by which recognizer fired first.
        if (didMove && to >= 0) runOnJS(fireDrop)(to);
        else if (!didMove) runOnJS(fireHold)();
      })
      .onFinalize(() => {
        // Covers a cancelled gesture (a call arrives, the app backgrounds) which never
        // reaches onEnd and would otherwise leave the face stranded mid-screen.
        tx.value = withTiming(0, { duration: 160 });
        ty.value = withTiming(0, { duration: 160 });
        lift.value = withSpring(0, { damping: 18, stiffness: 220 });
      });

    const tap = Gesture.Tap()
      .maxDuration(300)
      .onEnd((_e, ok) => {
        if (ok) runOnJS(firePress)();
      });

    // Race, not Simultaneous: exactly one of the two should ever win a touch. A quick
    // tap opens the person; anything held past 180ms is the pan, which then decides
    // between reorder and Remove by whether the finger moved.
    return Gesture.Race(pan, tap);
    // Every dependency here is stable for the life of the component — the shared
    // values by construction, the fire* wrappers by having empty deps. So this runs
    // once and GestureDetector never sees a new gesture object. Rebuilding a native
    // recognizer mid-touch is what crashed this screen before.
  }, [tx, ty, lift, lastSlot, moved, idx, cw, cnt, fireDragStart, fireHover, fireDrop, firePress, fireHold]);

  const style = useAnimatedStyle(() => ({
    transform: [
      { translateX: tx.value },
      { translateY: ty.value },
      { scale: 1 + lift.value * 0.08 },
    ],
    shadowOpacity: lift.value * 0.22,
  }));

  return (
    <GestureDetector gesture={gesture}>
      <ReAnimated.View
        // NO `layout={LinearTransition}` HERE, DELIBERATELY.
        //
        // It was on this view to slide the other faces into place after a drop, which
        // looked good and was the wrong place for it: a Reanimated layout animation on
        // the same view that carries a gesture-driven transform is a documented
        // instability on Fabric, and this view is also inside a GestureDetector. The
        // reorder now just re-renders into the new arrangement. Slightly less fancy,
        // and it does not close the app.
        //
        // zIndex is a STATIC style driven by React state rather than a value inside
        // useAnimatedStyle, for the same reason — animating zIndex on Fabric forces
        // view-hierarchy reshuffles mid-gesture. `isDragging` already re-renders this
        // face exactly once at drag start, which is when the raise is needed.
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
        {/* The slot the dragged face will land in. A ring rather than a gap, because
            a gap would need the neighbors to move, which is exactly the live
            reshuffling this design avoids. */}
        {isTarget ? (
          <View
            style={{
              position: 'absolute',
              top: -2,
              width: EMBLEM + 8,
              height: EMBLEM + 8,
              borderRadius: (EMBLEM + 8) / 2,
              borderWidth: 2,
              borderColor: 'rgba(178,98,45,0.55)',
            }}
          />
        ) : null}
        <View style={{ opacity: isDragging ? 0.96 : 1 }}>
          <ContactEmblem name={fav.name} initials={initialsOf(fav.name)} size={EMBLEM} />
        </View>
        <CText
          t="metaXs"
          color={cl.ink55}
          style={{ marginTop: 6, maxWidth: '100%' }}
          numberOfLines={1}
        >
          {first}
        </CText>
        {(fav.tags?.length ?? 0) > 0 ? (
          <CText t="metaXs" color={cl.goldDeep} numberOfLines={1} style={{ maxWidth: '100%' }}>
            {fav.tags![0]!.toUpperCase()}
          </CText>
        ) : null}
      </ReAnimated.View>
    </GestureDetector>
  );
}

function initialsOf(name: string): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}
