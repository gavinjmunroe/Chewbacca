import { memo, useCallback, useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import { Pressable } from './Pressable';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  type SharedValue,
} from 'react-native-reanimated';
import { HomeMark, YouMark } from './marks';
import { hShadow, hc } from '../lib/homeSurface';
import { TAB_BAR_HEIGHT } from '../lib/peopleBar';

// ── TWO TABS, BUILT TO THE RENDERING ─────────────────────────────────────────
//
// "For the bottom tab, just have two tabs now: the profile page and the
//  homepage. Make the tab icons this third picture I'm sending you with the two
//  tab icons."
//
// A white pill that HUGS ITS TWO ITEMS -- it is about a third of the screen in
// the rendering, not the seventy percent of the search bar the old three-tab
// pill was -- with a tan lozenge behind whichever one you are on and the mark
// alone inside it. No labels: the rendering has none, and two marks this
// distinct do not need naming.
//
// WHAT WAS DELETED, and it is most of the file. The old pill was a glass
// surface: a LinearGradient body, an optional Liquid Glass material on iOS 26, a
// gold inset rim, a white-to-cream sliding bubble carrying its own gradient and
// a top sheen, and a two-layer ink/gold crossfade on every icon AND its label.
// All of that was warm-on-warm separation -- ways of making a soft-white pill
// read against an amber page. On white paper the pill is white, the lozenge is
// tan, and the separation is the shadow. Nine gradients became none.
//
// THE EGG'S LONG-PRESS DID NOT GO WITH THE THIRD TAB. Press-and-hold on the
// center used to wake the voice journal, and that is the fastest way into the
// thing this app is for. It moved onto Home. `onLongPressCenter` keeps its name
// so nothing that passes it had to change.
//
// AND IT IS ON BOTH TABS NOW.
//
//   "Let's also extend the functionality where you long-press the left tab and
//    the voice thing shows up. Let's extend that to the right tab as well.
//    Basically, if you press either tab in a long-form way, the voice thing
//    shows up."
//
// Which is right, and the reason is that holding the bar is not a Home gesture
// -- it is THE gesture. A hold that works on one half of a two-item pill and
// does nothing on the other is a gesture you have to remember the position of,
// so most people never find it at all. Both halves, same handler, one hint in
// both accessibility labels.

// Re-exported so every existing import keeps working.
//
// IMPORTED AND RE-EXPORTED, NOT JUST RE-EXPORTED. `export { X } from '...'`
// creates no LOCAL binding, and this component uses TAB_BAR_HEIGHT for its own
// height. It has now been lost twice to a bulk edit of this file's header, which
// is why the note is this loud and why the import sits at the top with the rest.
export { TAB_BAR_HEIGHT } from '../lib/peopleBar';

/** The tan lozenge behind the active mark. Measured off the rendering. */
const SLOT_W = 74;
const SLOT_H = 42;
/** Air inside the pill, around and between the two slots. */
const PILL_PAD_X = 7;
const ITEM_GAP = 6;
const MARK = 25;

export type TabKey = 'home' | 'you';

export function TabBar({
  active,
  onSelect,
  onLongPressCenter,
  pagerPosition,
  bubbleFade,
}: {
  active: TabKey;
  onSelect: (key: TabKey) => void;
  // Press-and-hold HOME to wake the voice journal. Named for the center egg it
  // used to live on; see the note at the top of this file.
  /**
   * Press and hold EITHER tab to talk to Amber.
   *
   * The name is historical -- it was the center egg's gesture when there were
   * three tabs -- and it is kept because every caller passes it by that name.
   * What it means now is "the bar's hold", and both items get it.
   */
  onLongPressCenter?: () => void;
  /**
   * UI-thread cursor (0..1) written by the pager's onPageScroll worklet. Drives
   * the lozenge's X so it tracks the finger with no re-render.
   *
   * Optional: routes that render a standalone TabBar with no pager (the pushed
   * /(gated)/profile screen) omit it and the lozenge simply sits on `active`.
   */
  pagerPosition?: SharedValue<number>;
  /** 1 normally. Kept so a caller can fade the lozenge during a transition. */
  bubbleFade?: SharedValue<number>;
}) {
  const insets = useSafeAreaInsets();

  // Fallback cursor for pager-less TabBars: parked on the active tab index. When
  // a real pagerPosition is supplied it wins; this shared value stays unused.
  const activeIndex = active === 'you' ? 1 : 0;
  const fallbackPosition = useSharedValue(activeIndex);
  useEffect(() => {
    fallbackPosition.value = activeIndex;
  }, [activeIndex, fallbackPosition]);
  const position = pagerPosition ?? fallbackPosition;

  const selectHome = useCallback(() => onSelect('home'), [onSelect]);
  const selectYou = useCallback(() => onSelect('you'), [onSelect]);

  /**
   * THE PILL IS SIZED BY ITS CONTENTS, NOT BY THE SCREEN.
   *
   * It used to be a fraction of the search bar's width, which was the right idea
   * for three items that had to divide it evenly. Two fixed slots have a natural
   * width, and deriving it from the screen instead means the lozenge is a
   * different size on every device while the marks inside it are not -- so the
   * air around the mark changes and the pill looks wrong on exactly the phones
   * nobody tested on. Measured, once, here.
   */
  const pillWidth = SLOT_W * 2 + ITEM_GAP + PILL_PAD_X * 2;
  // Slot centers, relative to the pill's inner box.
  const x0 = PILL_PAD_X;
  const x1 = PILL_PAD_X + SLOT_W + ITEM_GAP;

  const lozenge = useAnimatedStyle(() => ({
    transform: [
      { translateX: interpolate(position.value, [0, 1], [x0, x1], Extrapolation.CLAMP) },
    ],
    opacity: bubbleFade ? Math.min(1, Math.max(0.25, bubbleFade.value)) : 1,
  }));

  return (
    <View
      pointerEvents="box-none"
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 40,
        paddingBottom: Math.max(insets.bottom, 12) + 8,
        alignItems: 'center',
      }}
    >
      <View
        style={{
          width: pillWidth,
          height: TAB_BAR_HEIGHT,
          borderRadius: TAB_BAR_HEIGHT / 2,
          backgroundColor: hc.bg,
          justifyContent: 'center',
          ...hShadow.float,
        }}
      >
        {/* The tan lozenge. First in the tree, so it is behind both marks, and
            non-interactive so it never eats a tap meant for the other tab. */}
        <Animated.View
          pointerEvents="none"
          style={[
            {
              position: 'absolute',
              left: 0,
              top: (TAB_BAR_HEIGHT - SLOT_H) / 2,
              width: SLOT_W,
              height: SLOT_H,
              borderRadius: SLOT_H / 2,
              backgroundColor: hc.tan,
            },
            lozenge,
          ]}
        />

        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            paddingHorizontal: PILL_PAD_X,
            gap: ITEM_GAP,
          }}
        >
          <TabItem
            label="Home"
            index={0}
            position={position}
            active={active === 'home'}
            onPress={selectHome}
            onLongPress={onLongPressCenter}
            accessibilityLabel="Home. Press and hold to talk to Amber."
            Mark={HomeMark}
          />
          <TabItem
            label="You"
            index={1}
            position={position}
            active={active === 'you'}
            onPress={selectYou}
            onLongPress={onLongPressCenter}
            accessibilityLabel="You. Press and hold to talk to Amber."
            Mark={YouMark}
          />
        </View>
      </View>
    </View>
  );
}

const TabItem = memo(function TabItem({
  label,
  index,
  position,
  active,
  onPress,
  onLongPress,
  accessibilityLabel,
  Mark,
}: {
  label: string;
  /** This tab's page index, so its color can track the pager. */
  index: number;
  /** 0..1 pager cursor, written on the UI thread. */
  position: SharedValue<number>;
  active: boolean;
  onPress: () => void;
  onLongPress?: () => void;
  accessibilityLabel?: string;
  Mark: (props: { size: number; color: string }) => React.ReactElement;
}) {
  /**
   * THE MARK IS CROSS-FADED FROM THE PAGER, NOT SWITCHED ON `active`.
   *
   * The lozenge already slides continuously under the finger; a mark that
   * snapped colors in one frame when `active` finally flipped at settle is a
   * slide that ends in a pop. Two stacked layers whose opacities interpolate
   * from the same cursor the lozenge uses means the recolor IS the slide: UI
   * thread, per frame, no re-render. `active` is now only an accessibility fact.
   *
   * Both layers are the same near-black; what changes is nothing, today --
   * ink reads on the tan lozenge (8.2:1) and on white (17.6:1) alike, which is
   * the point of a single-ink palette. The crossfade stays because the moment
   * either state wants its own tone, this is where it goes, and re-deriving it
   * from `active` is how the pop comes back.
   */
  const near = useAnimatedStyle(() => ({
    opacity: 1 - Math.min(1, Math.abs(position.value - index)),
  }));
  const far = useAnimatedStyle(() => ({
    opacity: Math.min(1, Math.abs(position.value - index)),
  }));
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={220}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      accessibilityLabel={accessibilityLabel ?? label}
      style={tabStyles.press}
    >
      {({ pressed }) => (
        <View style={[tabStyles.item, pressed && { opacity: 0.7 }]}>
          <Animated.View style={far}>
            <Mark size={MARK} color={hc.ink} />
          </Animated.View>
          <Animated.View style={[tabStyles.overlay, near]} pointerEvents="none">
            <Mark size={MARK} color={hc.ink} />
          </Animated.View>
        </View>
      )}
    </Pressable>
  );
});

const tabStyles = StyleSheet.create({
  press: { width: SLOT_W },
  item: {
    width: SLOT_W,
    height: SLOT_H,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Absolute, so cross-fading can never reflow the item.
  overlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
