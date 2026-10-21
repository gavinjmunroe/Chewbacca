import { type ReactNode } from 'react';
import { Dimensions, ScrollView, StyleSheet, View, Text as RNText, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, type SharedValue } from 'react-native-reanimated';
import { Pressable } from './Pressable';
import { LinearGradient } from 'expo-linear-gradient';
import { GlassView } from 'expo-glass-effect';
import { ChevronRight } from 'lucide-react-native';
import { liquidGlassEnabled } from './LiquidGlass';
import {
  HAIRLINE,
  avatarFace,
  cl,
  clLayout,
  clRadius,
  clShadow,
  clType,
} from '../lib/classical';

// The Classical primitive set. Every screen composes from these so the language
// is defined once — see lib/classical.ts for where the numbers come from.

// ── Type ─────────────────────────────────────────────────────────
// A thin wrapper over RNText that takes a clType entry directly. Deliberately
// separate from components/Text.tsx: that one carries the older variant map and
// its own Dynamic Type capping, and rewiring it would churn every screen at
// once. New Classical surfaces use this; both render the same fonts.
type CType = keyof typeof clType;

export function CText({
  t,
  color,
  style,
  children,
  numberOfLines,
  ...rest
}: {
  t: CType;
  color?: string;
  style?: StyleProp<TextStyle>;
  children: ReactNode;
  numberOfLines?: number;
} & Omit<React.ComponentProps<typeof RNText>, 'style' | 'children'>) {
  return (
    <RNText
      allowFontScaling
      // Classical leading is tight and the rows are dense; past ~1.2 the serif
      // headings collide with their metadata. Body copy gets more room.
      maxFontSizeMultiplier={t.startsWith('body') || t.startsWith('quote') ? 1.3 : 1.15}
      numberOfLines={numberOfLines}
      style={[clType[t], color ? { color } : { color: cl.ink }, style]}
      {...rest}
    >
      {children}
    </RNText>
  );
}

// ── Ground ───────────────────────────────────────────────────────
// The page behind everything. The reference lays three wide radial gradients
// over #f3f2f2; RN has no radial gradient, and the previous approach —
// oversized circles bled off each edge — showed its own ARCS as hard visible
// edges across the middle of the screen, which the mockups plainly don't have.
//
// A single smooth vertical LinearGradient with a warm middle reproduces the
// reference's read (cool near-white at the very top, warmed through the body)
// with no geometry to give itself away. Kept deliberately narrow in range: in
// the mockups this is a whisper of warmth, not a visible gradient.
export function ClassicalGround({ width, height }: { width?: number; height?: number } = {}) {
  // WHITE PAPER. There is no wash any more.
  //
  // Twenty-five lines of notes used to sit here arguing with a warm gradient --
  // first a three-radial mesh whose darkest point landed in the top-right corner
  // of every screen and read as a smudge, then a linear amber-to-cream that
  // replaced it. Both are gone: the renderings are white, and the tokens (see
  // the note on groundTop) are now white too.
  //
  // KEPT AS A GRADIENT RATHER THAN A PLAIN VIEW, and it is one line either way.
  // The three stops still exist in the palette, the foot still carries the
  // half-point of warmth that stops a full screen of white from reading blue,
  // and the day the ground wants a tint again this is where it goes -- rather
  // than a plain View that somebody would have to turn back into a gradient.
  const win = Dimensions.get('window');
  const w = width ?? win.width;
  const h = (height ?? win.height) + 40;
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <LinearGradient
        colors={[cl.groundTop, cl.groundMid, cl.groundFoot]}
        // Weighted: half the travel is spent in the top third, so the warmth is
        // concentrated where the header is and the body settles into cream.
        locations={[0, 0.34, 1]}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
        style={[StyleSheet.absoluteFill, { width: w, height: h }]}
      />
    </View>
  );
}

// ── Pressable ────────────────────────────────────────────────────
// In this build a `style` FUNCTION on Pressable is not applied to the underlying
// view. Proved by measurement: the day strip's boxes carried
// `style={({pressed}) => ({flex:1, height:56, ...})}` and came back 20x34 —
// content-sized, with flex and height both dropped. It is why the People network
// rows rendered as a vertical pile: their `flexDirection:'row'` never landed and
// a View defaults to column.
//
// So every tappable that needs LAYOUT puts it on a real inner View and keeps the
// Pressable to a static outer style. `CPressable` is that shape, once.
export function CPressable({
  onPress,
  onLongPress,
  disabled,
  outer,
  inner,
  pressedOpacity = 0.6,
  accessibilityLabel,
  accessibilityRole = 'button',
  accessibilityState,
  children,
}: {
  onPress?: () => void;
  onLongPress?: () => void;
  disabled?: boolean;
  /** Static style for the Pressable itself — sizing within its parent. */
  outer?: StyleProp<ViewStyle>;
  /** The row/box layout. Lives on a View so it actually applies. */
  inner?: StyleProp<ViewStyle>;
  pressedOpacity?: number;
  accessibilityLabel?: string;
  accessibilityRole?: 'button' | 'radio';
  accessibilityState?: { selected?: boolean; checked?: boolean; disabled?: boolean };
  children: ReactNode;
}) {
  const interactive = !!onPress || !!onLongPress;
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      disabled={disabled || !interactive}
      accessibilityRole={interactive ? accessibilityRole : undefined}
      accessibilityLabel={accessibilityLabel}
      accessibilityState={accessibilityState}
      style={outer}
    >
      {({ pressed }) => (
        <View style={[inner, pressed && interactive ? { opacity: pressedOpacity } : null]}>
          {children}
        </View>
      )}
    </Pressable>
  );
}

const cPress = StyleSheet.create({
  /** Fills the parent's cross axis — the default for a full-width row. */
  stretch: { alignSelf: 'stretch' },
  /** An equal-share child of a row (stat tiles, tab items). */
  flexItem: { flexGrow: 1, flexShrink: 1, flexBasis: 0 },
});

// ── Cards ────────────────────────────────────────────────────────
/**
 * 'plain'    — the resting white card. Lifts off the ground on a wide shadow.
 * 'warm'     — the gold-tinted feature card.
 * 'recessed' — sits INTO the ground instead of on top of it: a translucent ink
 *              tint, a fainter edge and NO shadow at all. This is the quiet
 *              tier. Home ranks its own notes by prominence (a note that tagged
 *              someone is loud, a note to yourself is quieter, a reminder is
 *              quieter still), and a shadow is what makes a card read as being
 *              in front of the page — so the quiet tiers must not have one, or
 *              they compete with the loud one for exactly the wrong reason.
 */
export type CardTone = 'plain' | 'warm' | 'recessed';

// The resting surface: near-white, hairline, whisper shadow. `flush` drops the
// inner padding for cards that host their own full-bleed rows (list groups).
export function CCard({
  children,
  tone = 'plain',
  flush = false,
  large = false,
  style,
  onPress,
  accessibilityLabel,
  glass = false,
}: {
  children: ReactNode;
  tone?: CardTone;
  flush?: boolean;
  large?: boolean;
  style?: StyleProp<ViewStyle>;
  onPress?: () => void;
  accessibilityLabel?: string;
  /**
   * Opt in to an iOS 26 Liquid Glass container for this (plain-tone) card. Off
   * by default so every existing card is unchanged. On iOS < 26 / Android it
   * renders exactly today's semi-translucent surface. Content rows inside the
   * card keep their own solid backgrounds, so legibility is unaffected.
   */
  glass?: boolean;
}) {
  // Soft-touch surfaces: translucent panes that blend into the luminous mesh
  // ground, held apart by only a faint white rim and a wide, low-opacity shadow.
  // Bigger rounding than the old editorial card so the edges read as frosted.
  const radius = large ? 28 : 26;
  const shadow =
    tone === 'recessed'
      ? null
      : tone === 'warm'
      ? clShadow.warm
      : {
          shadowColor: '#2E2E3A',
          shadowOpacity: 0.16,
          shadowRadius: 26,
          shadowOffset: { width: 0, height: 16 },
          elevation: 2,
        };
  const pad = flush
    ? undefined
    : { paddingHorizontal: clLayout.cardPadX, paddingVertical: clLayout.cardPadY };

  const inner =
    tone === 'recessed' ? (
      <View
        style={[
          {
            borderRadius: radius,
            backgroundColor: cl.cardRecessed,
            borderWidth: 1,
            borderColor: cl.cardRecessedHairline,
            overflow: 'hidden',
          },
          pad,
          style,
        ]}
      >
        {children}
      </View>
    ) : tone === 'warm' ? (
      <LinearGradient
        // Lifted with the plain card and the glass one, so a warm-tone card does
        // not become the faintest of the three on the lighter wash.
        colors={['rgba(255,250,242,0.8)', 'rgba(255,246,234,0.7)']}
        start={{ x: 0.15, y: 0 }}
        end={{ x: 0.85, y: 1 }}
        style={[{ borderRadius: radius, borderWidth: 1, borderColor: 'rgba(255,255,255,0.6)', overflow: 'hidden' }, pad, style]}
      >
        {children}
      </LinearGradient>
    ) : glass && liquidGlassEnabled ? (
      // Liquid Glass container (iOS 26+). Same geometry and edge as the plain
      // card; the opaque fill is dropped so the glass shows. The fallback path
      // below is what every other card and all unsupported OSes render.
      <GlassView
        glassEffectStyle="clear"
        // Same reason as the plain card below: a lighter page needs a little
        // more tint for the glass to read as a container rather than as nothing.
        tintColor="rgba(255,255,255,0.42)"
        style={[
          {
            borderRadius: radius,
            borderWidth: 1,
            borderColor: 'rgba(255,255,255,0.6)',
            overflow: 'hidden',
          },
          pad,
          style,
        ]}
      >
        {children}
      </GlassView>
    ) : (
      <View
        style={[
          {
            borderRadius: radius,
            // 0.5 -> 0.72, AND THIS IS THE COST OF LIGHTENING THE PAGE.
            //
            // A card here is a half-white veil over the wash rather than a solid
            // fill, so how much it reads depends entirely on how dark the wash
            // is. Lifting the ground to 89-94% lightness (see cl.groundTop) left
            // a 0.5 veil about four points lighter than the page it sits on --
            // a panel held up by its shadow alone. At 0.72 it is a surface
            // again, on the lighter page, with the same geometry and the same
            // edge as before.
            backgroundColor: 'rgba(255,255,255,0.72)',
            borderWidth: 1,
            borderColor: 'rgba(255,255,255,0.6)',
            overflow: 'hidden',
          },
          pad,
          style,
        ]}
      >
        {children}
      </View>
    );

  // The shadow lives on an outer, unclipped view — overflow:hidden on the same
  // view as the shadow would clip the shadow itself.
  const card = <View style={[{ borderRadius: radius }, shadow]}>{inner}</View>;

  if (!onPress) return card;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}
    >
      {card}
    </Pressable>
  );
}

// ── Section header ───────────────────────────────────────────────
// The mockups' "CIRCLES ———— EDIT" pattern: gold small-caps kicker, a hairline
// that eats the remaining width, and an optional right-hand note or action.
export function CSectionHeader({
  title,
  right,
  onPressRight,
  tone = 'gold',
  rule = 'faint',
  insetRight = 0,
  prominent = false,
}: {
  title: string;
  right?: string;
  onPressRight?: () => void;
  tone?: 'gold' | 'neutral';
  /**
   * Rule weight. 'ink' is the near-black rule from the design — used where the
   * header is a structural divider ("ALL CONTACTS ———— 968") rather than a soft
   * grouping label. The faint gold hairline reads as almost nothing on cream.
   */
  rule?: 'faint' | 'ink';
  /**
   * Extra right padding. Screens with a floating A-Z index pass the rail width so
   * the right-hand count is not painted underneath the letters.
   */
  insetRight?: number;
  /**
   * A LOUDER SECTION HEAD, for the ones that own a whole screen region.
   *
   * The default is deliberately quiet: an 11.5pt kicker and a 10.5pt right-hand
   * action in 42%-opacity ink, which is right for "ALL CONTACTS ———— 968" where
   * the header is a label on a list you are already looking at. It is wrong for
   * "CIRCLES ———— + NEW" on the profile, where the right-hand side is the ONLY
   * way to make a circle and it was rendering as pale gray uppercase at ten and
   * a half points. That is not a small button, it is a caption that happens to
   * be tappable.
   *
   * Prominent keeps every one of the same ingredients — same face, same tracking,
   * same hairline rule, no fill, no border — and only makes them bigger and the
   * action gold. Opt-in, so the thirty other headers in the app are untouched.
   */
  prominent?: boolean;
}) {
  const isGold = tone === 'gold';
  const ruleColor = rule === 'ink' ? 'rgba(32,30,29,0.55)' : isGold ? cl.ruleGold : cl.ruleFaint;
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        paddingLeft: clLayout.textGutter,
        paddingRight: clLayout.textGutter + insetRight,
        paddingBottom: clLayout.kickerGap,
      }}
    >
      <CText
        t="kicker"
        color={isGold ? cl.goldKicker : cl.ink50}
        numberOfLines={1}
        style={prominent ? { fontSize: 13.5, lineHeight: 17, letterSpacing: 2.1 } : undefined}
      >
        {title}
      </CText>
      <View
        style={{
          flex: 1,
          // An ink rule needs a real pixel; a hairline in near-black disappears
          // against cream on a 3x screen.
          height: rule === 'ink' ? 1 : HAIRLINE,
          backgroundColor: ruleColor,
        }}
      />
      {right ? (
        onPressRight ? (
          <Pressable
            onPress={onPressRight}
            accessibilityRole="button"
            accessibilityLabel={right}
            hitSlop={prominent ? 14 : 8}
            style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
          >
            <CText
              t="label"
              color={prominent ? cl.goldDeep : cl.ink42}
              style={prominent ? { fontSize: 13, letterSpacing: 1.3 } : undefined}
            >
              {right}
            </CText>
          </Pressable>
        ) : (
          <CText
            t="label"
            color={prominent ? cl.ink50 : cl.ink38}
            style={prominent ? { fontSize: 13, letterSpacing: 1.3 } : undefined}
          >
            {right}
          </CText>
        )
      ) : null}
    </View>
  );
}

// ── Avatar ───────────────────────────────────────────────────────
// The mockups' "DA / RL / EC" chip: tan gradient face, deep-gold initials, a
// gold hairline edge. `tone="neutral"` is the grayed face the reference uses for
// lower-ranked rows.
export function CAvatar({
  name,
  size = 42,
  tone = 'gold',
  style,
}: {
  name?: string;
  size?: number;
  tone?: 'gold' | 'neutral';
  style?: StyleProp<ViewStyle>;
}) {
  const face = avatarFace[tone];
  // Initials scale with the face: the reference runs 19px glyphs in a 48px
  // circle, 17 in 42, 10.5 in 26 — about 0.4×.
  const glyph = Math.max(9, Math.round(size * 0.4));
  return (
    // Fixed-size plain View owns the layout; the gradient is only a fill behind
    // it. Under the New Architecture, a LinearGradient given an explicit
    // width/height could still stretch to its parent and shove a row's siblings
    // onto the next line — the network rows were stacking for exactly this reason.
    <View
      style={[
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          overflow: 'hidden',
          alignItems: 'center',
          justifyContent: 'center',
          borderWidth: HAIRLINE,
          borderColor: face.border,
        },
        style,
      ]}
    >
      <LinearGradient
        colors={face.gradient}
        start={{ x: 0.15, y: 0 }}
        end={{ x: 0.85, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      <RNText
        allowFontScaling={false}
        style={{
          fontFamily: 'Newsreader_600SemiBold',
          fontSize: glyph,
          lineHeight: glyph * 1.15,
          color: face.ink,
        }}
      >
        {initialsOf(name)}
      </RNText>
    </View>
  );
}

export function initialsOf(name?: string): string {
  const n = (name ?? '').trim();
  if (!n) return '?';
  const parts = n.split(/\s+/);
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

// ── Chips ────────────────────────────────────────────────────────
export function CChip({
  label,
  tone = 'neutral',
  onPress,
}: {
  label: string;
  tone?: 'neutral' | 'gold' | 'outline' | 'dashed';
  onPress?: () => void;
}) {
  const style: ViewStyle =
    tone === 'gold'
      ? { backgroundColor: cl.tint100, borderColor: cl.gold40, borderWidth: HAIRLINE }
      : tone === 'outline'
        ? { backgroundColor: 'transparent', borderColor: cl.gold40, borderWidth: HAIRLINE }
        : tone === 'dashed'
          ? { backgroundColor: 'rgba(255,255,255,0.5)', borderColor: 'rgba(182,130,53,0.45)', borderWidth: 1, borderStyle: 'dashed' }
          : { backgroundColor: 'rgba(255,255,255,0.62)', borderColor: cl.ruleFaint, borderWidth: HAIRLINE };
  const fg = tone === 'neutral' ? cl.ink50 : tone === 'gold' ? cl.goldDeep : cl.goldDeep;

  const body = (
    <View
      style={[
        {
          paddingHorizontal: 10,
          paddingVertical: 4,
          borderRadius: 11,
          alignSelf: 'flex-start',
        },
        style,
      ]}
    >
      <CText t="labelXs" color={fg}>
        {label}
      </CText>
    </View>
  );
  if (!onPress) return body;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={6}
      style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
    >
      {body}
    </Pressable>
  );
}

// ── Icon square ──────────────────────────────────────────────────
// The 27–40px rounded square that fronts a suggestion card or a settings row.
export function CIconSquare({
  children,
  size = 34,
  tone = 'plain',
}: {
  children: ReactNode;
  size?: number;
  tone?: 'plain' | 'gold';
}) {
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size >= 38 ? clRadius.iconSqLg : clRadius.iconSq,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(255,255,255,0.62)',
        borderWidth: HAIRLINE,
        borderColor: tone === 'gold' ? cl.gold40 : 'rgba(32,31,29,0.10)',
      }}
    >
      {children}
    </View>
  );
}

// ── List rows ────────────────────────────────────────────────────
// The grouped-settings row from mockup-2: title, sub, a gold value, a chevron.
// Rows separate with a hairline; the first row in a group omits it.
export function CListRow({
  title,
  sub,
  value,
  valueMuted = false,
  icon,
  onPress,
  first = false,
  danger = false,
  right,
}: {
  title: string;
  sub?: string;
  value?: string;
  valueMuted?: boolean;
  icon?: ReactNode;
  onPress?: () => void;
  first?: boolean;
  danger?: boolean;
  right?: ReactNode;
}) {
  return (
    <CPressable
      onPress={onPress}
      accessibilityLabel={title}
      outer={cPress.stretch}
      pressedOpacity={0.65}
      inner={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 13,
        paddingHorizontal: clLayout.cardPadX,
        paddingVertical: clLayout.rowPadY,
        borderTopWidth: first ? 0 : HAIRLINE,
        borderTopColor: cl.ruleSoft,
      }}
    >
      {icon ? <CIconSquare>{icon}</CIconSquare> : null}
      <View style={{ flex: 1, minWidth: 0 }}>
        <CText t="listTitle" color={danger ? '#B3402C' : cl.ink} numberOfLines={1}>
          {title}
        </CText>
        {sub ? (
          <CText t="metaSm" color={cl.ink48} numberOfLines={2} style={{ marginTop: 1 }}>
            {sub}
          </CText>
        ) : null}
      </View>
      {right}
      {value ? (
        <CText t="metaSm" color={valueMuted ? cl.ink32 : cl.goldKicker} style={{ letterSpacing: 0.36 }}>
          {value}
        </CText>
      ) : null}
      {onPress ? <ChevronRight size={15} color={cl.ink30} strokeWidth={2} /> : null}
    </CPressable>
  );
}

// ── Stat tile ────────────────────────────────────────────────────
export function CStatTile({
  n,
  label,
  onPress,
}: {
  n: number | string;
  label: string;
  onPress?: () => void;
}) {
  const body = (
    <View
      style={{
        flex: 1,
        borderRadius: clRadius.tile,
        paddingHorizontal: 12,
        paddingVertical: 16,
        alignItems: 'center',
        backgroundColor: cl.card,
        borderWidth: HAIRLINE,
        borderColor: cl.cardHairline,
        ...clShadow.card,
      }}
    >
      <CText t="statNumeral" color={cl.goldDeep}>
        {n}
      </CText>
      <CText t="labelSm" color={cl.ink45} style={{ marginTop: 6 }}>
        {label}
      </CText>
    </View>
  );
  if (!onPress) return body;
  return (
    <CPressable
      onPress={onPress}
      accessibilityLabel={`${n} ${label}`}
      outer={cPress.flexItem}
      inner={{ width: '100%' }}
      pressedOpacity={0.85}
    >
      {body}
    </CPressable>
  );
}

// ── Buttons ──────────────────────────────────────────────────────
// The reference's action is an outlined gold pill, never a solid fill
// ("Do not fill cards or buttons with solid accent color"). `solid` exists for
// the two places the mockups do fill — a sheet's confirm.
export function CButton({
  label,
  onPress,
  tone = 'outline',
  icon,
  disabled = false,
  full = false,
}: {
  label: string;
  onPress?: () => void;
  tone?: 'outline' | 'solid' | 'quiet';
  icon?: ReactNode;
  disabled?: boolean;
  full?: boolean;
}) {
  const solid = tone === 'solid';
  const quiet = tone === 'quiet';
  return (
    <CPressable
      onPress={onPress}
      disabled={disabled}
      accessibilityLabel={label}
      outer={{ alignSelf: full ? 'stretch' : 'flex-start', opacity: disabled ? 0.45 : 1 }}
      pressedOpacity={0.75}
      inner={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        minHeight: 42,
        paddingHorizontal: 18,
        borderRadius: clRadius.chip,
        borderWidth: quiet ? 0 : HAIRLINE,
        borderColor: solid ? cl.goldDeep : quiet ? 'transparent' : cl.gold55,
        backgroundColor: solid ? cl.goldDeep : quiet ? 'transparent' : 'rgba(255,255,255,0.5)',
      }}
    >
      {icon}
      <CText t="listTitle" color={solid ? '#FFFFFF' : cl.goldDeep}>
        {label}
      </CText>
    </CPressable>
  );
}

// ── Rules ────────────────────────────────────────────────────────
export function CRule({ gold = false, style }: { gold?: boolean; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[{ height: HAIRLINE, backgroundColor: gold ? cl.ruleGold : cl.ruleFaint }, style]} />
  );
}

// The italic serif aside the reference uses between feed items and for empty
// states, flanked by hairlines.
export function CAside({ children }: { children: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 11, paddingHorizontal: 4, paddingVertical: 2 }}>
      <View style={{ flex: 1, height: HAIRLINE, backgroundColor: 'rgba(32,31,29,0.1)' }} />
      <CText t="aside" color={cl.ink45} style={{ textAlign: 'center' }}>
        {children}
      </CText>
      <View style={{ flex: 1, height: HAIRLINE, backgroundColor: 'rgba(32,31,29,0.1)' }} />
    </View>
  );
}

// The centered footnote that closes every scroll in the reference.
export function CFootnote({ children }: { children: string }) {
  return (
    <CText
      t="footnote"
      color={cl.ink36}
      style={{ textAlign: 'center', paddingHorizontal: 40, paddingTop: 10 }}
    >
      {children}
    </CText>
  );
}

// ── Header band ──────────────────────────────────────────────────
// The translucent top band every screen in the reference sits under. Rendered
// in-flow (not absolute) so it can't cover a screen's first row — the reference
// compensates with a large scroll padding-top, which is fragile on RN where the
// safe-area inset varies by device.
export function CHeader({
  children,
  paddingTop,
  hairline = true,
  glass = false,
  surface,
  lift,
}: {
  children: ReactNode;
  paddingTop: number;
  hairline?: boolean;
  /**
   * Opt in to an iOS 26 Liquid Glass header band. Off by default so every
   * existing caller is unchanged. When on, a glass layer renders BEHIND the
   * header content on iOS 26+; on iOS < 26 / Android the header stays exactly
   * transparent as today (the mesh ground flows through), so there is no
   * visual change on unsupported OSes.
   */
  glass?: boolean;
  /**
   * 1 = the glass band at full strength, 0 = fully dissolved so the ground behind the
   * header shows through unbroken. A shared value, so it animates on the UI thread with
   * no re-render.
   *
   * Exists because the People header is a CONSTANT height (see SharedHeader's note on
   * why it must never resize), which on the Circles page leaves a tall tinted band with
   * a hard bottom edge sitting over a warm gradient — a white shelf across the top of
   * the screen. Dissolving the band instead of collapsing it keeps the header's
   * geometry fixed while letting the color underneath bleed all the way up.
   */
  surface?: SharedValue<number>;
  /**
   * 0..1. HOW FAR OPEN THE THING INSIDE THIS BAND IS, and therefore how far the
   * band has traveled from the page's color toward cream.
   *
   * "I am fine with the calendar being the same color as the screen if the tab to
   *  pull it down is clear, and while it is being pulled down it becomes lighter
   *  and lighter and is basically cream when fully down, and becomes darker and
   *  darker when being pushed up till back to the original color."
   *
   * At 0 the band is EXACTLY the page -- nothing is painted, so there is no seam
   * to see between this page and one that has no band. At 1 it is cl.headerOpen.
   * Driven by the month-expansion drag itself rather than by a timer, so the
   * color is wherever the finger is: pull halfway and it is halfway.
   */
  lift?: SharedValue<number>;
}) {
  // Transparent now: the luminous mesh ground flows straight up behind the
  // header instead of a separate gray band, so the title sits on the wash the
  // way the soft-touch references do. `hairline` is kept for callers but no
  // longer draws a divider.
  // `hairline`, `glass` and `surface` are all accepted and all inert. They named
  // three different ways of giving this band a surface of its own, which is the
  // one thing it must not have. Kept so no caller changes, and voided here so it
  // is obvious they do nothing rather than mysterious.
  void hairline;
  void glass;
  void surface;
  // The cream, at whatever fraction the drag has reached. Painted as an opacity
  // on a solid fill rather than as an interpolated color: an opacity animates on
  // the UI thread as a single number, and at 0 it is genuinely not there -- which
  // is the property that matters, because "not there" is what makes this band the
  // same color as every other page.
  const liftStyle = useAnimatedStyle(() => ({
    opacity: lift ? Math.min(1, Math.max(0, lift.value)) : 0,
  }));
  return (
    <View
      style={{
        paddingTop,
        paddingHorizontal: clLayout.gutter,
        paddingBottom: 12,
        backgroundColor: 'transparent',
      }}
    >
      {lift ? (
        <Animated.View
          pointerEvents="none"
          style={[StyleSheet.absoluteFill, { backgroundColor: cl.headerOpen }, liftStyle]}
        />
      ) : null}
      {/* AND NOTHING ELSE IS PAINTED HERE. NOTHING.
          --------------------------------------
          "The color difference between screens is still there... I am fine with
           the calendar being the same color as the screen."

          Four attempts lived in this spot and every one was a version of "make
          the band a surface": 22% white glass, then 14%, then 5%, then a
          zero-tint glass layer kept for its refraction. That last one is why he
          could still see the seam after the tint was already zero -- iOS 26's
          Liquid Glass is a MATERIAL, not a tint. A `clear` glass view with a
          fully transparent tintColor still brightens and blurs what is behind it,
          because brightening is what the material does. Zeroing the tint removed
          the number I could see in the code and left the effect on the screen.

          So the glass is gone, and so is the bottom edge gradient -- a second
          lift (later a second darkening) in the exact place the eye looks for a
          boundary. This View paints nothing at all now: the page's own wash runs
          straight through it, and Today's header, People's header and You's bare
          top are the same color BY CONSTRUCTION rather than by arithmetic.

          What identifies the calendar instead: the calendar, the pull handle
          (deliberately loud now -- see SharedHeader), and the cream it fades to
          as you pull it down.

          scripts/palette-check.mts asserts CHeader contains no GlassView and no
          white overlay, because the last three fixes here were each undone by the
          next reach for a material. */}
      {children}
    </View>
  );
}

// ── Horizontal card rail ─────────────────────────────────────────
export function CRail({ children }: { children: ReactNode }) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{
        gap: clLayout.cardGap - 3,
        paddingHorizontal: clLayout.gutter,
        paddingBottom: 2,
      }}
    >
      {children}
    </ScrollView>
  );
}

// ── Overlapping face row ─────────────────────────────────────────
// The "RL MR +2" cluster on a circle card: 26px faces, -7px overlap, each with
// a light ring so they read as separate discs.
export function CFaceRow({
  names,
  extra,
  size = 26,
}: {
  names: string[];
  extra?: number;
  size?: number;
}) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
      {names.map((n, i) => (
        <View
          key={`${n}-${i}`}
          style={{
            marginRight: -7,
            borderRadius: size / 2,
            borderWidth: 1.5,
            borderColor: '#F7F5F2',
          }}
        >
          <CAvatar name={n} size={size} tone="neutral" />
        </View>
      ))}
      {extra && extra > 0 ? (
        <View
          style={{
            width: size,
            height: size,
            borderRadius: size / 2,
            marginRight: -7,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: '#F1EEEA',
            borderWidth: 1.5,
            borderColor: '#F7F5F2',
          }}
        >
          <RNText
            allowFontScaling={false}
            style={{ fontFamily: 'Newsreader_600SemiBold', fontSize: 10.5, color: cl.ink50 }}
          >
            {`+${extra}`}
          </RNText>
        </View>
      ) : null}
    </View>
  );
}
