// The global design tokens. Structure (and every token NAME) is inherited from
// the Airbnb DESIGN.md analysis this app started from — see /apps/mobile/DESIGN.md
// — but the VALUES have been retuned to the "Classical" foundation: warm
// near-white ground, one amber-gold accent, hairline separation, whisper shadows.
//
// This is the layer that makes the shift broad: Text, Button, Card, Hairline,
// TextInput, SearchInput, Skeleton, Badge, IconButton, EmptyState, ErrorState and
// ToastHost all read `colors` rather than lib/theme's LIGHT, so retuning here
// moves every one of them at once. LIGHT stays the palette that screens reach for
// directly; the two are kept in step.

import { LIGHT, amber } from './theme';

export const colors = {
  // Gold is the single accent. Note this is amber 700 (#7D5411), not the
  // resting accent (#B68235): every `colors.primary` consumer either colors TEXT
  // on the light ground or sits UNDER white (a filled button, an active icon
  // button, a badge), and #B68235 clears neither at 3.0:1 / 3.4:1. 700 gives
  // 6.7:1 both ways and still reads unmistakably gold.
  primary: amber[700],
  primaryActive: amber[800],
  primaryDisabled: amber[200],
  // Danger has one value in the system: LIGHT.danger. The previous #c13515 was
  // an orange-red close enough to the old burnt-orange accent to read as a second
  // brand color next to gold; a truer red stays unambiguously "error".
  errorText: LIGHT.danger, // #C0392B
  errorTextHover: '#9C2E22',
  // Airbnb brand leftovers, unreferenced. Kept so the token shape is stable.
  luxe: '#460479',
  plus: '#92174d',
  // Four text tiers on the Classical ground.
  ink: LIGHT.textPrimary, // #201F1D
  body: '#3F3D3B',
  muted: LIGHT.textSecondary, // #605D5D
  mutedSoft: LIGHT.textMuted, // #8A8683
  // Hairlines carry the separation the old system got from fills and shadows.
  hairline: LIGHT.hairline,
  hairlineSoft: 'rgba(32,31,29,0.06)',
  borderStrong: LIGHT.hairlineStrong,
  // Grounds and surfaces. `canvas` is the resting CARD fill (Card, TextInput,
  // ToastHost all use it that way) — so it points at the near-white surface, a
  // step lighter than the page. `ground` is the page itself; Screen defaults to
  // it. Cards lifting off a slightly darker page is the whole Classical effect.
  canvas: LIGHT.surface, // #FFFDFA — card fill
  ground: LIGHT.canvas, // #F3F2F2 — page
  surfaceSoft: '#F7F5F2', // a hair off the card, for nested fills
  surfaceCard: LIGHT.surface, // #FFFDFA
  surfaceStrong: LIGHT.surfaceSoft, // #EAE8E5 — recessed inset / skeleton base
  onPrimary: '#FFFFFF',
  onDark: '#FFFFFF',
  legalLink: amber[700], // gold, not blue — one accent hue only
  starRating: LIGHT.textPrimary,
  scrim: 'rgba(32,31,29,0.5)',
  // Focus ring for keyboard and switch-control navigation. Ink-derived so it
  // reads on the light ground without introducing a second brand voltage.
  focusRing: LIGHT.textPrimary,
  // Success voltage, lifted out of the inline literals that were scattered
  // across Toast and Badge so semantic green lives in one place.
  success: '#1d8a4a',
  successSurface: '#dff4e6',
} as const;

export const radius = {
  none: 0,
  xs: 4,
  sm: 8,
  md: 14,
  lg: 20,
  xl: 32,
  card: 16, // Classical cards sit tighter than the old 22 — see GlassCard.
  full: 9999,
} as const;

export const spacing = {
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  base: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
  section: 64,
} as const;

// TWO FAMILIES, NOT THREE — and the ROLE NAMES BELOW DO NOT CHANGE.
//
// This was Fraunces for display, Lora for reading copy and Hanken Grotesk for
// labels. Three voices is more than a screen this quiet needs, so it is
// Newsreader for everything set in a serif and Outfit for everything set in a
// grotesk.
//
// Only the values moved. `regular`, `medium`, `semibold` and `bold` are read
// directly by a dozen components that never go through `typography`, and
// renaming them to something tidier is how a font swap turns into a crash.
export const fonts = {
  // Newsreader — the serif, and now the ONLY one. Fraunces had too much display
  // personality at 14–16px, which is why a second serif had to exist for reading
  // copy at all; Newsreader was drawn for long text and holds a 28px date and a
  // 15px note in the same voice.
  serif: 'Newsreader_400Regular',
  serifItalic: 'Newsreader_400Regular_Italic',
  serifSemibold: 'Newsreader_600SemiBold',
  serifBold: 'Newsreader_700Bold',
  // Body points at the same family on purpose. The roles stay separate so the
  // two can be pulled apart again without touching thirty call sites.
  body: 'Newsreader_400Regular',
  bodySemibold: 'Newsreader_600SemiBold',
  // Outfit — the grotesk-only roles: buttons, badges, meta, and the tracked
  // small-caps labels (THURSDAY, VOICE NOTE, YOUR NETWORK), where a serif
  // muddies at 8–12px.
  regular: 'Outfit_400Regular',
  medium: 'Outfit_500Medium',
  semibold: 'Outfit_600SemiBold',
  bold: 'Outfit_700Bold',
} as const;

export type TypographyStyle = {
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  letterSpacing?: number;
  // Per-variant defaults. Both are overridable at the call site — `color` by the
  // Text `color` prop or an inline style, `textTransform` by the `uppercase`
  // prop. They exist so a variant can carry its full identity (the gold tracked
  // kicker is a *variant*, not a color the caller has to remember to pass).
  color?: string;
  textTransform?: 'uppercase';
};

export const typography: Record<string, TypographyStyle> = {
  // Display + title variants use the Newsreader serif — the editorial voice.
  // THE SAME WEIGHT PASS AS lib/classical.ts, and it has to happen here too.
  //
  // clType covers the newer surfaces; this table drives components/Text.tsx,
  // which 43 files still use -- the circles grid, the DM rows, every modal. So
  // lightening only clType is precisely why the heavy weight survived "in a lot
  // of places" while the redesigned screens looked right.
  //
  // Same rule: Newsreader regular with a little negative tracking, hierarchy
  // from size and color rather than thickness. serifBold is gone from every
  // display role -- at 21-28px it was the heaviest type in the app.
  displayXl: { fontFamily: fonts.serif, fontSize: 29, lineHeight: 36, letterSpacing: -0.4 },
  displayLg: { fontFamily: fonts.serif, fontSize: 22, lineHeight: 28, letterSpacing: -0.3 },
  displayMd: { fontFamily: fonts.serif, fontSize: 22, lineHeight: 28, letterSpacing: -0.26 },
  displaySm: { fontFamily: fonts.serif, fontSize: 21, lineHeight: 26, letterSpacing: -0.22 },
  titleMd: { fontFamily: fonts.serif, fontSize: 17, lineHeight: 23, letterSpacing: -0.18 },
  titleSm: { fontFamily: fonts.serif, fontSize: 17, lineHeight: 23, letterSpacing: -0.18 },
  ratingDisplay: { fontFamily: fonts.serifBold, fontSize: 64, lineHeight: 70, letterSpacing: -1 },
  // Reading copy in Newsreader. Line heights lift a touch: a serif at these sizes
  // needs more leading than the grotesk it replaces.
  bodyMd: { fontFamily: fonts.body, fontSize: 16, lineHeight: 26 },
  bodySm: { fontFamily: fonts.body, fontSize: 14, lineHeight: 22 },
  caption: { fontFamily: fonts.body, fontSize: 14, lineHeight: 20 },
  captionSm: { fontFamily: fonts.body, fontSize: 13, lineHeight: 18 },
  link: { fontFamily: fonts.body, fontSize: 14, lineHeight: 22 },
  // Grotesk roles.
  badge: { fontFamily: fonts.semibold, fontSize: 11, lineHeight: 13 },
  buttonMd: { fontFamily: fonts.medium, fontSize: 16, lineHeight: 20 },
  buttonSm: { fontFamily: fonts.medium, fontSize: 14, lineHeight: 18 },
  navLink: { fontFamily: fonts.semibold, fontSize: 16, lineHeight: 20 },
  // Small-caps tracked gold kickers — the mockups' "SATURDAY / WHERE YOU HAVE
  // BEEN / CIRCLES / HEALTH NETWORK". Uppercase + ~0.08em tracking + deep gold
  // are all part of the variant, so `<Text variant="microLabel">` is enough.
  microLabel: {
    fontFamily: fonts.semibold,
    fontSize: 12,
    lineHeight: 16,
    letterSpacing: 0.96, // 0.08em at 12px
    color: LIGHT.accentText,
    textTransform: 'uppercase',
  },
  uppercaseTag: {
    fontFamily: fonts.bold,
    fontSize: 8,
    lineHeight: 10,
    letterSpacing: 0.64, // 0.08em at 8px
    color: LIGHT.accentText,
    textTransform: 'uppercase',
  },
  // Semantic aliases for the four-tier scale (display / title / body / caption).
  display: { fontFamily: fonts.serif, fontSize: 22, lineHeight: 28, letterSpacing: -0.26 },
  title: { fontFamily: fonts.serif, fontSize: 17, lineHeight: 23, letterSpacing: -0.18 },
  body: { fontFamily: fonts.body, fontSize: 16, lineHeight: 26 },
};

// Which scale step counts as a heading, for Dynamic Type capping. Headings cap
// tighter than body because they already sit large and blow out rows faster.
export const headingVariants = [
  'displayXl',
  'displayLg',
  'displayMd',
  'displaySm',
  'display',
  'ratingDisplay',
] as const;

// Elevation tiers — "whisper" shadows. The Classical mockups separate surfaces
// with a hairline and the faintest possible lift; a visible drop shadow reads as
// a different design language entirely. So each tier drops to a very low opacity
// and a small blur, tinted with the warm near-black rather than pure black.
// sm for resting cards, md for floated cards and toasts, lg for the few elements
// that lift above everything (the tab bar blur, sheets).
// Matched to lib/classical.ts's clShadow, which converts the reference's CSS
// blurs to UIView shadowRadius (CSS blur ≈ 2× shadowRadius). A card needs
// ENOUGH shadow to lift off the ground — the previous 0.04/0.06 was so faint the
// cards read as flat patches. This is still a whisper, just a visible one.
export const elevation = {
  sm: {
    shadowColor: '#2D2B2B',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  // 0 8px 22px rgba(45,43,43,.08) — the resting card.
  md: {
    shadowColor: '#2D2B2B',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.1,
    shadowRadius: 11,
    elevation: 4,
  },
  // 0 14px 40px rgba(45,43,43,.2) — sheets, the tab pill.
  lg: {
    shadowColor: '#2D2B2B',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.18,
    shadowRadius: 20,
    elevation: 14,
  },
} as const;

// `shadow.card` is kept as an alias of the md tier so existing imports across
// the app (Card, ToastHost) keep working while new code reaches for `elevation`.
export const shadow = {
  card: elevation.md,
} as const;

// Press feedback for tappables. One scale, one duration, used by every primitive
// so a tap feels identical on a button, a card, and a tab.
export const press = {
  scale: 0.97,
  durationIn: 90,
  durationOut: 140,
} as const;

// Dynamic Type guardrails. iOS can scale text far past what these layouts can
// absorb, so primitives cap the multiplier rather than let rows blow out.
export const fontScale = {
  maxBody: 1.4,
  maxHeading: 1.25,
} as const;

// Control sizing for buttons, inputs, and icon buttons. 48 is the resting tap
// target (above the 44 minimum); hitSlop pads the smaller variants up to it.
export const control = {
  height: 48,
  heightSm: 40,
  paddingX: spacing.lg,
  paddingXPill: spacing.base + 4,
  minTapTarget: 44,
  hitSlop: 8,
} as const;
