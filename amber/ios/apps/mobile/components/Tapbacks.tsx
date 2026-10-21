import { useEffect } from 'react';
import { View } from 'react-native';
import * as Haptics from 'expo-haptics';
import ReAnimated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { Pin, ThumbsDown, ThumbsUp } from 'lucide-react-native';
import { Pressable } from './Pressable';
import { CText } from './classical';
import {
  REACTION_GLYPH,
  REACTION_LABEL,
  REACTION_ORDER,
  type ReactionKind,
} from '../lib/noteMedia';

// TAPBACKS, THE WAY MESSAGES DOES THEM.
//
// "The reactions in the DMs are bad, should be much better, just like the Apple
//  ones."
//
// What was there: a row of outlined pills sitting UNDER every bubble, with the
// used ones always visible and a dashed "+" that expanded the rest inline. Three
// things are wrong with that and they compound.
//
// It takes permanent space. Every message in the thread reserved a 26pt row for
// a control almost none of them use, so a conversation reads as a list of forms
// rather than as things people said.
//
// It puts the control where the RESULT goes. In Messages a reaction is a mark ON
// the message -- a small badge overlapping its corner, the way a stamp sits on an
// envelope. Under the bubble in a row of buttons, a reaction is indistinguishable
// from an offer to react.
//
// And it is always on show, so there is no moment of choosing. Apple's is a
// gesture: hold the message, a capsule of glyphs appears over it, tap one, it
// snaps onto the bubble. The picker is transient, the mark is permanent, and
// nothing is on screen when nobody is reacting.
//
// So: TapbackPicker is that capsule and TapbackBadges is that mark.
//
// WHY NOT A MODAL for the picker. It has to appear anchored to the bubble it
// belongs to, and a modal would need the bubble measured in window coordinates,
// re-measured on every scroll. Rendered inside the message row at
// `bottom: 100%` it is anchored by layout, costs no measurement, and scrolls with
// its message -- which is also what Apple's does.

const CARD = '#FFFDF8';
const BORDER = 'rgba(32,30,29,0.10)';
const ACCENT_500 = '#D67F48';
const ACCENT_700 = '#B2622D';
const INK_62 = 'rgba(32,30,29,0.62)';
const INK_45 = 'rgba(32,30,29,0.45)';

/** The capsule's own height, and the badge's. Kept apart: they are not the same control. */
const PICKER_H = 46;
const GLYPH_D = 34;
const BADGE_H = 26;

function Glyph({ kind, color, size }: { kind: ReactionKind; color: string; size: number }) {
  if (kind === 'like') return <ThumbsUp size={size} color={color} strokeWidth={2.2} />;
  if (kind === 'dislike') return <ThumbsDown size={size} color={color} strokeWidth={2.2} />;
  const label = REACTION_GLYPH[kind] ?? '';
  // The laugh is "HA\nHA": two lines inside the same box as a one-line glyph, so
  // its type is smaller and its leading tighter or the capsule grows for one item.
  const stacked = label.includes('\n');
  return (
    <CText
      t="metaSm"
      color={color}
      style={{
        fontSize: stacked ? size * 0.52 : size * 0.85,
        lineHeight: stacked ? size * 0.56 : size * 1.05,
        textAlign: 'center',
        fontVariant: ['tabular-nums'],
      }}
    >
      {label}
    </CText>
  );
}

/**
 * The floating capsule. Rendered by the message that is being held; not mounted
 * at all otherwise.
 *
 * `side` puts it on the same edge as the bubble, so it grows out of the message
 * rather than floating in the middle of the thread.
 */
export function TapbackPicker({
  mine,
  side,
  onPick,
  onPin,
  pinned,
}: {
  /** The viewer's current reaction, so it reads as selected and can be cleared. */
  mine: ReactionKind | null;
  side: 'left' | 'right';
  onPick: (kind: ReactionKind | null) => void;
  /** Pin lives in here because the long press used to BE pin. See DmThreadView. */
  onPin?: () => void;
  pinned?: boolean;
}) {
  // In from 0.86 and 4pt low, on a short ease-out. Apple's grows out of the
  // bubble; this is the same read without measuring an origin.
  const appear = useSharedValue(0);
  useEffect(() => {
    appear.value = withTiming(1, { duration: 160, easing: Easing.out(Easing.cubic) });
  }, [appear]);
  const style = useAnimatedStyle(() => ({
    opacity: appear.value,
    transform: [
      { scale: 0.86 + 0.14 * appear.value },
      { translateY: 4 * (1 - appear.value) },
    ],
  }));

  return (
    <ReAnimated.View
      style={[
        {
          position: 'absolute',
          bottom: '100%',
          marginBottom: 6,
          [side]: 2,
          flexDirection: 'row',
          alignItems: 'center',
          height: PICKER_H,
          paddingHorizontal: 6,
          borderRadius: PICKER_H / 2,
          backgroundColor: CARD,
          borderWidth: 1,
          borderColor: BORDER,
          // The lift that makes it read as floating over the thread rather than
          // as another row in it.
          shadowColor: '#2A1D0E',
          shadowOpacity: 0.14,
          shadowRadius: 14,
          shadowOffset: { width: 0, height: 5 },
          elevation: 6,
          zIndex: 20,
        },
        style,
      ]}
    >
      {REACTION_ORDER.map((kind) => {
        const on = mine === kind;
        return (
          <Pressable
            key={kind}
            onPress={() => {
              void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
              // Tapping the one you already gave takes it back -- the same tap
              // both ways, so there is never a reaction you cannot undo.
              onPick(on ? null : kind);
            }}
            accessibilityRole="button"
            accessibilityLabel={REACTION_LABEL[kind]}
            accessibilityState={{ selected: on }}
            style={({ pressed }) => ({ opacity: pressed ? 0.55 : 1 })}
          >
            <View
              style={{
                width: GLYPH_D,
                height: GLYPH_D,
                borderRadius: GLYPH_D / 2,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: on ? 'rgba(214,127,72,0.16)' : 'transparent',
              }}
            >
              <Glyph kind={kind} color={on ? ACCENT_700 : INK_62} size={18} />
            </View>
          </Pressable>
        );
      })}

      {onPin ? (
        <>
          {/* Pin is in here because holding a message used to pin it outright,
              with no way to react at all. Both live on the one gesture now, and
              the divider says they are different kinds of thing. */}
          <View
            style={{
              width: 1,
              height: 20,
              marginHorizontal: 4,
              backgroundColor: BORDER,
            }}
          />
          <Pressable
            onPress={() => {
              void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
              onPin();
            }}
            accessibilityRole="button"
            accessibilityLabel={pinned ? 'Unpin this message' : 'Pin this message'}
            accessibilityState={{ selected: !!pinned }}
            style={({ pressed }) => ({ opacity: pressed ? 0.55 : 1 })}
          >
            <View
              style={{
                width: GLYPH_D,
                height: GLYPH_D,
                borderRadius: GLYPH_D / 2,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: pinned ? 'rgba(214,127,72,0.16)' : 'transparent',
              }}
            >
              <Pin size={17} color={pinned ? ACCENT_700 : INK_62} strokeWidth={2.2} />
            </View>
          </Pressable>
        </>
      ) : null}
    </ReAnimated.View>
  );
}

/**
 * THE MARK ON THE MESSAGE. Overlaps the bubble's top corner, on the side away
 * from the tail, exactly as a tapback does in Messages.
 *
 * Renders nothing when nobody has reacted, which is the whole point: a thread
 * with no reactions has no reaction furniture in it.
 *
 * Up to three kinds are shown side by side; beyond that they would be wider than
 * the message they are marking, so the rest becomes a count.
 */
export function TapbackBadges({
  reactions,
  side,
  onToggle,
}: {
  /**
   * Narrower than lib/noteMedia's ReactionSummary on purpose: this draws counts
   * and highlights the viewer's own, and never needs `total`. Taking the wider
   * type would make every caller supply a field this component ignores -- the DM
   * store's shape carries no `total` at all.
   */
  reactions: {
    counts: Partial<Record<ReactionKind, number>>;
    mine: ReactionKind | null;
  };
  /** The corner to sit on: 'right' for your own messages, 'left' for theirs. */
  side: 'left' | 'right';
  onToggle: (kind: ReactionKind | null) => void;
}) {
  const used = REACTION_ORDER.filter((k) => (reactions.counts[k] ?? 0) > 0);
  if (used.length === 0) return null;
  const shown = used.slice(0, 3);
  const hidden = used.length - shown.length;

  return (
    <View
      style={{
        position: 'absolute',
        top: -BADGE_H / 2 - 2,
        [side]: 8,
        flexDirection: 'row',
        alignItems: 'center',
        gap: -6,
        zIndex: 10,
      }}
    >
      {shown.map((kind) => {
        const on = reactions.mine === kind;
        const count = reactions.counts[kind] ?? 0;
        return (
          <Pressable
            key={kind}
            // Tapping your own mark removes it, which is the gesture Messages
            // uses and the only way to undo one without opening the picker again.
            onPress={() => onToggle(on ? null : kind)}
            accessibilityRole="button"
            accessibilityLabel={`${REACTION_LABEL[kind]}${count > 1 ? `, ${count}` : ''}`}
            accessibilityState={{ selected: on }}
            hitSlop={8}
            style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
          >
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 3,
                height: BADGE_H,
                minWidth: BADGE_H,
                paddingHorizontal: count > 1 ? 7 : 0,
                justifyContent: 'center',
                borderRadius: BADGE_H / 2,
                // Its own surface with a hairline, so it reads as sitting ON the
                // bubble rather than being part of it.
                backgroundColor: on ? ACCENT_500 : CARD,
                borderWidth: 1,
                borderColor: on ? ACCENT_500 : BORDER,
                shadowColor: '#2A1D0E',
                shadowOpacity: 0.1,
                shadowRadius: 5,
                shadowOffset: { width: 0, height: 2 },
              }}
            >
              <Glyph kind={kind} color={on ? '#FFF6EE' : INK_62} size={14} />
              {count > 1 ? (
                <CText t="metaSm" color={on ? '#FFF6EE' : INK_62} style={{ fontSize: 11 }}>
                  {String(count)}
                </CText>
              ) : null}
            </View>
          </Pressable>
        );
      })}
      {hidden > 0 ? (
        <View
          style={{
            height: BADGE_H,
            paddingHorizontal: 7,
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: BADGE_H / 2,
            backgroundColor: CARD,
            borderWidth: 1,
            borderColor: BORDER,
          }}
        >
          <CText t="metaSm" color={INK_45} style={{ fontSize: 11 }}>
            {`+${hidden}`}
          </CText>
        </View>
      ) : null}
    </View>
  );
}
