// Shared warm "amber" dark theme.
//
// Promoted out of amber.tsx so the home, person-detail, and profile screens all
// render one consistent palette instead of drifting copies. Kept separate from
// lib/tokens.ts — those are the global LIGHT design tokens (typography/spacing/
// radius still come from there); this is only the dark color layer, used until
// the whole app moves dark and these graduate into tokens.ts.
//
// Design intent: near-black warm canvas, warm grays for most text and chrome,
// amber as the single accent used sparingly (active states, the sparkle, key
// emphasis). Surfaces are separated by tone + hairline, never by shadow.
export const DARK = {
  canvas: '#0F0D0B', // near-black, faintly warm
  surface: '#1C1815', // warm step-up for pills/rows
  surfaceSoft: '#161310', // a hair above the canvas
  hairline: 'rgba(255,240,225,0.09)', // default divider/border
  hairlineStrong: 'rgba(255,240,225,0.16)', // emphasis border (selected rows)
  textPrimary: '#F5EFE8', // warm off-white
  textSecondary: '#A89D92', // warm gray
  textMuted: '#7A7068', // faint warm gray
  accent: '#E8954A', // amber — the single accent
  accentBright: '#F5A962', // lifted amber for fills/glyphs on dark
  chipBg: 'rgba(232,149,74,0.16)', // amber tint for chips/selection fills
  chipText: '#F0A862', // amber, legible on dark
  danger: '#E8765A', // restrained warm red for destructive copy
  // Flat-gray redesign tokens (additive — existing warm-canvas tokens remain
  // until all DARK references in amber.tsx are migrated).
  canvasGray: '#141414', // flat neutral gray, new screen background
  canvasGraySoft: '#1A1A1A', // slightly lifted panels on gray
  ringDark: 'rgba(0,0,0,0.55)', // dark concentric rings on the gray canvas
  ringDarkSoft: 'rgba(0,0,0,0.35)', // softer ring layer
  shimmer: 'rgba(232,149,74,0.55)', // amber shimmer highlight (travels the ring)
  shimmerSoft: 'rgba(232,149,74,0.0)', // transparent end for shimmer gradient
} as const;

// ── Amber ramp ───────────────────────────────────────────────────
// The single accent hue, as a full ramp so tints, borders, pressed states, and
// text all draw from one family instead of one-off rgba() literals. The resting
// accent (#B68235) sits between 400 and 500. 700 is the lightest step that clears
// WCAG AA both as text on the Classical ground and as a fill under white, which
// is why it — not the resting accent — is what `accentText`, `chipText`, and the
// primary button fill point at.
export const amber = {
  100: '#FFF3E4',
  200: '#FFE3BF',
  300: '#FACB8D',
  400: '#E1AD66',
  500: '#C28D41',
  600: '#A06F24',
  700: '#7D5411',
  800: '#5A3B0A',
  900: '#3A270D',
} as const;

// ── Light theme — "Classical" ────────────────────────────────────
// Warm near-white ground, one amber-gold accent, separation by hairline and
// whisper shadow rather than by heavy fills. Token NAMES are unchanged from the
// previous terracotta pass so every screen inherits the new values without an
// edit; only the values moved.
//
// Note on `accent` vs `accentText`: #B68235 is the accent for non-text use
// (borders, rings, chip tints, small glyphs). As 14px text on #F3F2F2 it only
// reaches 3.0:1, so anything that COLORS TEXT must use `accentText` (#7D5411,
// 6.7:1). Screens still passing `accent` to a Text color are listed in the
// foundation-pass notes and move over in the per-screen refinement.
export const LIGHT = {
  // THE SECOND PALETTE, AND IT HAS TO MOVE WITH THE FIRST.
  //
  // `cl` in lib/classical.ts holds the design language; this holds the older
  // screen tokens, and ten screens paint LIGHT.canvas as their base with no
  // ClassicalGround over it (person, circle, intros, the public profile). Leave
  // this gray while the mesh goes warm and those screens stay gray — the app
  // would change temperature depending on which page you were on.
  //
  // Kept in step with cl.ground / cl.card / cl.cardRecessed by hand. They are
  // separate files because they have separate histories, not because they are
  // allowed to disagree.
  // BRIGHTER AND MORE VIBRANT, with cl.ground. scripts/palette-check.mts now
  // asserts these two are identical rather than trusting the comment below,
  // because a dozen screens paint THIS as their base and a drift between the two
  // palettes means the app changes temperature depending on which page you are on
  // -- which is a version of the seam that has been reported three times.
  canvas: '#FFFFFF',                    // the warm ground -- WHITE now, tracks cl.ground
  // Cards sit a step LIGHTER than the ground and lift with a hairline + whisper
  // shadow. This was #EAE9E9 — DARKER than the canvas — which is what made every
  // screen read as drab: a card can't glow off a page it is dimmer than.
  // #FFFDF7 is the warm-white the mockups sample at; #FFFDFA read faintly blue
  // once the ground went gold.
  // A CARD ON WHITE PAPER LIFTS BY ITS EDGE, NOT BY ITS FILL. The note above is
  // about a card being lighter than the page, which stops being available the
  // moment the page is white; the renderings bound a card with a light gray
  // hairline (or tint it) instead. `hairline` below carries that now.
  surface: '#FFFFFF',                   // white card on white paper
  surfaceSoft: '#F5F3F1',               // recessed inset / pill -- a step UNDER the page
  // Sleeker lines. Both dropped a step: a divider tuned against a near-gray page
  // reads as a drawn outline against gold.
  hairline: 'rgba(26,25,23,0.08)',      // default divider/border
  hairlineStrong: 'rgba(26,25,23,0.14)',// emphasis border
  textPrimary: '#1A1917',               // near-black
  textSecondary: '#5C5955',             // mid gray
  textMuted: '#8A8785',                 // light gray
  accent: '#D6A96E',                    // the tan — the single accent
  accentBright: '#E0A45C',              // a lit fill
  accentText: '#A8641F',                // accent TEXT, 4.7:1 on white
  chipBg: 'rgba(182,130,53,0.12)',      // gold tint for chips/selection fills
  chipText: amber[700],                 // deep gold on chipBg
  ring: 'rgba(182,130,53,0.25)',        // gold ring on the ground
  ringDim: 'rgba(182,130,53,0.13)',     // dimmer outer ring
  shimmer: 'rgba(182,130,53,0.45)',     // gold shimmer arc
  shimmerSoft: 'rgba(182,130,53,0.0)',
  danger: '#C0392B',                    // restrained warm red
  // The ramp, flattened onto LIGHT so screens can reach a specific step
  // (tints, pressed fills, borders) without a second import.
  accent100: amber[100],
  accent200: amber[200],
  accent300: amber[300],
  accent400: amber[400],
  accent500: amber[500],
  accent600: amber[600],
  accent700: amber[700],
  accent800: amber[800],
  accent900: amber[900],
  // ── Legacy ─────────────────────────────────────────────────────
  // The previous terracotta accent. Retained so nothing that specifically wants
  // it breaks, but it is NO LONGER the default accent — do not reach for these
  // in new work.
  terracotta: '#B5491F',
  terracottaBright: '#C2410C',
  accentGold: '#C68A00',
} as const;

// Semantic trend colors, dark-tuned so they read on the warm canvas.
export const TREND_UP = '#5BD08A';
export const TREND_DOWN = '#E8765A';
