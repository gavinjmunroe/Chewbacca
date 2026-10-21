import { useState } from 'react';
import { View, type LayoutChangeEvent } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { CalendarDays, List } from 'lucide-react-native';
import { Pressable } from './Pressable';
import { hShadow, hc } from '../lib/homeSurface';
import { springs, timings, useAppReducedMotion } from '../lib/motion';

/**
 * YOU / FEED.
 *
 * TWO ICONS NOW, NOT TWO WORDS.
 *
 *   "Make the you and feed buttons smaller, and actually just make them icons.
 *    The you icon: make it a small little calendar icon, and the feed, make it a
 *    little list-looking icon. Make them smaller and more elegant, and give them
 *    a small, very light burnt orange glow around them, very light but
 *    aesthetically pleasing."
 *
 * A calendar for YOU -- which is the day, the agenda, the reminders -- and a list
 * for FEED. Both at 17pt, which is small enough to read as a control rather than
 * as a heading and large enough that the calendar's grid does not turn to mush.
 *
 * WHAT THE WORDS WERE COSTING. 14pt semibold at 0.6 tracking inside 26pt of
 * side padding and a 96pt floor made a capsule 200pt wide sitting directly under
 * the day strip -- two rows of type competing before you reach the first note.
 * Icons take it to about 120pt, and the control stops being the loudest thing on
 * the screen.
 *
 * THE GLOW IS THE THUMB'S ONLY SHADOW, and that is deliberate. React Native
 * gives a view one shadow, so a neutral lift plus a warm glow means two nested
 * views -- and the inner one's shadow lands on the outer one's identical white
 * fill and cannot be seen. So the single shadow is burnt orange doing both jobs:
 * offset a point down so the thumb still sits above the track, radius 5 and
 * opacity 0.22 so it is a warmth around the edge rather than a ring. hc.amber is
 * the app's burnt orange already; nothing new was invented for this.
 *
 * AND THE ACTIVE ICON IS PAINTED IN IT. A white thumb with a warm glow under a
 * near-black icon reads as two ideas. The glow and the icon being the same hue is
 * what makes it look intended rather than applied.
 *
 * A CENTERED PILL, which is what the design asks for and what the first attempt
 * got wrong: two words with a rule under the active one, hard against the left
 * gutter. That read as a heading, not as a control -- nothing about it said the
 * other word was pressable.
 *
 * The pill is a neutral track with a white thumb that SLIDES between the two
 * halves. Sliding rather than crossfading is deliberate and it is not the banned
 * kind of motion: the thumb is a direct, short, spring-settled move between two
 * known positions, which is the "elegant slide" half of the rule. What is banned
 * is a panel flung up from off the bottom edge, and scripts/motion-check.mts
 * polices exactly that.
 *
 * NO SWIPE BETWEEN THE PAGES. This page already lives inside a horizontal pager
 * (People / Today / Profile), and a second horizontal gesture nested in the
 * first is the reason a swipe "worked sometimes and did nothing other times"
 * the last time two of them met.
 */
export type HomeTab = 'you' | 'feed';

/**
 * THE LABEL IS NOW ONLY FOR SCREEN READERS, and it must stay. An icon-only
 * control with no accessibilityLabel is a button that announces itself as
 * "button" -- the tab becomes unusable with VoiceOver, which is the quiet way
 * icon-only navigation goes wrong.
 */
export const HOME_TABS: { key: HomeTab; label: string; Icon: typeof CalendarDays }[] = [
  { key: 'you', label: 'YOU', Icon: CalendarDays },
  { key: 'feed', label: 'FEED', Icon: List },
];

/** Inset of the thumb inside the track, on every side. */
const PAD = 3;

/** Small enough to be a control, big enough for the calendar's grid to survive. */
const ICON = 17;

/**
 * The burnt orange glow. Very light: it is a warmth at the thumb's edge, not a
 * ring, and at 0.22 on white it is nearer to a blush than to a color.
 */
const thumbGlow = {
  shadowColor: hc.amber,
  shadowOffset: { width: 0, height: 1 },
  shadowOpacity: 0.22,
  shadowRadius: 5,
  elevation: hShadow.thumb.elevation,
} as const;

export function HomeTabs({
  active,
  onChange,
}: {
  active: HomeTab;
  onChange: (tab: HomeTab) => void;
}) {
  const reduced = useAppReducedMotion();
  /**
   * MEASURED, NOT ASSUMED. The two halves are equal, but the pill's width comes
   * from its content, which differs by device text size -- so the thumb is
   * positioned from a real measurement rather than from a constant that is right
   * on one phone.
   */
  const [trackW, setTrackW] = useState(0);
  const x = useSharedValue(0);
  const half = trackW > 0 ? (trackW - PAD * 2) / HOME_TABS.length : 0;
  const index = Math.max(0, HOME_TABS.findIndex((t) => t.key === active));

  const onLayout = (e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width;
    setTrackW(w);
    // Land it in place on the first measurement rather than animating in from
    // the left edge on mount, which reads as the control correcting itself.
    x.value = ((w - PAD * 2) / HOME_TABS.length) * index;
  };

  const press = (tab: HomeTab, i: number) => {
    if (half > 0) {
      x.value = reduced ? withTiming(half * i, timings.fast) : withSpring(half * i, springs.snappy);
    }
    onChange(tab);
  };

  const thumb = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));

  return (
    <View style={{ alignItems: 'center', paddingBottom: 6 }}>
      <View
        onLayout={onLayout}
        style={{
          flexDirection: 'row',
          padding: PAD,
          borderRadius: 999,
          // A NEUTRAL TRACK. It used to be a shade of the warm page, on the
          // argument that a gray capsule on a warm ground reads as a foreign
          // control. The page is white, so the argument runs the other way: a
          // warm capsule is the foreign thing, and the rendering's track is a
          // plain light gray.
          backgroundColor: hc.trough,
        }}
      >
        {/* The thumb, under the icons, so they never animate. */}
        {half > 0 ? (
          <Animated.View
            pointerEvents="none"
            style={[
              {
                position: 'absolute',
                top: PAD,
                left: PAD,
                width: half,
                bottom: PAD,
                borderRadius: 999,
                backgroundColor: hc.bg,
                ...thumbGlow,
              },
              thumb,
            ]}
          />
        ) : null}

        {HOME_TABS.map((t, i) => {
          const on = t.key === active;
          const { Icon } = t;
          return (
            <Pressable
              key={t.key}
              onPress={() => press(t.key, i)}
              accessibilityRole="tab"
              accessibilityState={{ selected: on }}
              accessibilityLabel={t.label}
              style={({ pressed }) => ({
                opacity: pressed ? 0.7 : 1,
                paddingHorizontal: 22,
                paddingVertical: 8,
                minWidth: 56,
                alignItems: 'center',
                justifyContent: 'center',
              })}
            >
              <Icon
                size={ICON}
                // Burnt orange when it is the one you are on, so the glow beneath
                // it and the mark inside it are the same idea. Gray otherwise --
                // the same muted ink the labels used, so the off state is exactly
                // as quiet as it was.
                color={on ? hc.amber : hc.inkMuted}
                strokeWidth={on ? 2 : 1.75}
              />
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
