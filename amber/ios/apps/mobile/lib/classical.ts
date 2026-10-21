// Classical — the app's visual language, transcribed from design-reference/.
//
// Every number here comes from design-reference/Amber.dc.html (the design as
// code) or classical-styles.css, cross-checked against mockup-1/2/3.png. When a
// screen needs a value, it takes it from this file rather than inventing one, so
// the whole app moves together.
//
// Two translations were unavoidable going from CSS to React Native:
//
//  1. The reference cards are translucent (`rgba(255,255,255,.8)` +
//     `backdrop-filter: blur(22px)`) floating over a warm gradient ground. RN has
//     no backdrop-filter, and stacking real BlurViews per card is expensive and
//     renders inconsistently on Fabric. So cards are OPAQUE at the color the
//     reference's translucency resolves to over the ground: #FFFDFA, the same
//     near-white the reference itself hard-codes for its "today" chip and active
//     segment. Cards therefore sit a step LIGHTER than the #F3F2F2 ground, which
//     is what makes them lift.
//  2. CSS blur radius is about twice UIView's shadowRadius, so a CSS
//     `0 8px 22px` becomes offset {0,6} / radius 11. The shadows below are
//     already converted — use them, don't re-derive.
import { Platform } from 'react-native';

// ── Ground and surfaces ──────────────────────────────────────────
export const cl = {
  // ── THE PAGE IS WHITE NOW ────────────────────────────────────────────
  //
  // "Make everything a white background. No more need for this orange and
  //  yellow and burnt color theme. Make everything the exact same color scheme
  //  that you see in the renderings."
  //
  // Eighty lines of notes used to sit here: the history of one long argument
  // with a warm gradient -- three radials, then a vertical wash, then a lighter
  // one, then a more saturated one, each fixing the last one's seam. The whole
  // argument is settled by deleting the wash, so the notes went with it. The
  // renderings are white paper with near-black ink, one tan accent, and color
  // only where it means something (the three note kinds).
  //
  // THE THREE STOPS STAY AS THREE STOPS rather than collapsing to one constant,
  // and that is deliberate: ClassicalGround, CHeader's open state, the recorder
  // sheet and the web overlay all read them separately, and scripts/palette-
  // check.mts holds the relationships between them. Keeping the shape means the
  // check still has something to check, and a future warm surface (a dark mode,
  // a seasonal ground) is a value change rather than a refactor.
  //
  // ALL THREE ARE THE SAME WHITE, and the first attempt at this was not.
  //
  // I gave the foot a half-point of warmth (#FDFCFB) on the theory that a full
  // screen of pure white reads blue against near-black ink. Maybe it does, but
  // it also made the BOTTOM of the page the darkest part of it -- and "the page
  // never darkens upward" is the one invariant that survived every version of
  // this palette, because a page whose far end is dimmer than its near end reads
  // as a shadow rather than as paper. The check caught it immediately.
  //
  // The renderings are white. Not warm-white, not off-white: white, with the
  // warmth carried entirely by the tan accent and the three note tints.
  groundTop: '#FFFFFF',
  groundMid: '#FFFFFF',
  groundFoot: '#FFFFFF',
  // The flat fallback, for anything painting a solid background rather than the
  // gradient (a modal ground, a native view behind a screen). Sits between the
  // wash's middle and its foot so a solid patch never looks like a hole.
  ground: '#FFFFFF',
  // Kept: the cream used by the recorder sheet and the expanded web, both of
  // which want a single flat bright surface rather than the page's wash.
  groundCream: '#FFFFFF',
  groundGold: '#FAF8F6',
  // Kept for callers that still read them; retuned to the warm field.
  groundWashTop: 'rgba(26,25,23,0.03)',
  groundWashBottom: 'rgba(26,25,23,0.02)',
  groundWashCenter: 'rgba(255,255,255,0.9)',

  // Cards: near-white, and now warm-white — #FFFDFA read faintly blue against a
  // gold field. Sampled at #FFFDF7.
  // A CARD ON A WHITE PAGE NEEDS AN EDGE, and it did not before.
  //
  // White cards separated from the amber wash on tone alone, which is why the
  // hairline below was dropped to 4.5%. On white paper that is a white rectangle
  // on white and the card disappears. The renderings solve it the same way: a
  // card is either TINTED (the three note kinds, the agenda) or bounded by a
  // light gray hairline. So the card stays white and the hairline comes back.
  card: '#FFFFFF',
  cardEdge: 'rgba(26,25,23,0.06)',

  // SLEEKER LINES. This was 0.07 — a hairline tuned to hold its own against a
  // near-gray ground. Against gold, a white card separates on tone alone and the
  // border stopped being structure and became an outline; the mockup has none at
  // all. Dropped rather than deleted, because a white-on-white case (a card on
  // the search bar, a sheet over a sheet) still needs the faintest definition.
  cardHairline: 'rgba(26,25,23,0.08)',

  // THE RECESSED ROW — the second half of the prominence ladder.
  //
  // A note that tagged someone gets the white card; a reminder or a note to self
  // gets this instead: a translucent ink tint that sits INTO the ground rather
  // than lifting off it. Sampled at #E5DCC6 over the ground, which is a 7% ink
  // overlay. Being translucent is the point — it takes the ground's own color
  // wherever it lands, so it reads as recessed on every part of the page.
  cardRecessed: 'rgba(26,25,23,0.04)',
  cardRecessedHairline: 'rgba(26,25,23,0.06)',

  // The warm "suggested / share" surface. Reference:
  // linear-gradient(165deg, rgba(255,248,238,.86), rgba(253,240,224,.54)).
  // The agenda card and anything else that should read as warm rather than
  // neutral. Sampled off the rendering's "Coffee with Mina" row.
  warm: ['#FDF3E8', '#FBEEDF'] as const,
  warmHairline: 'rgba(214,169,110,0.42)',

  // ── THE CALENDAR BAND HAS NO COLOR OF ITS OWN ────────────────────────
  //
  // "I am fine with the calendar being the same color as the screen if the tab to
  //  pull it down is clear, and while it is being pulled down it becomes lighter
  //  and lighter and is basically cream when fully down, and becomes darker and
  //  darker when being pushed up till back to the original color."
  //
  // Every previous version of this band tried to be a SURFACE -- brighter than
  // the page, then warmer than the page, then five percent white over the page --
  // and every one of them read as a lit shelf laid across the top of the screen,
  // because a rectangle of a different color with a straight bottom edge is a
  // shelf. It is also what he kept seeing as a seam between the tabs: two of the
  // three pages had a band and one did not.
  //
  // So the band is the page. What identifies it is the calendar in it and the
  // pull handle under it, and what it does instead of having a color is CHANGE
  // color as it opens: `headerOpen` is where it arrives when the month is fully
  // pulled down, interpolated by the drag itself (see CHeader's `lift`). Pulling
  // down lightens it to cream, pushing back up returns it to the page exactly.
  //
  // The old two-stop gradient is gone with the surface it painted. Kept as a
  // single value because there is now only one color to name.
  // THE BAND IS THE PAGE, and on a white page that is simply white. The note
  // above is still the reason it has no surface of its own; there is now no
  // color left for it to differ by.
  header: ['#FFFFFF', '#FFFFFF'] as const,
  /** Where the band lands when the month is fully open. A shade of gray, so the
   *  pull still reads as something opening rather than as nothing happening. */
  headerOpen: '#F7F6F5',
  headerHairline: 'rgba(26,25,23,0.07)',

  // ── Ink ────────────────────────────────────────────────────────
  ink: '#1A1917',
  ink70: 'rgba(26,25,23,0.70)',
  ink62: 'rgba(26,25,23,0.62)',
  ink55: 'rgba(26,25,23,0.55)',
  ink50: 'rgba(26,25,23,0.50)',
  ink48: 'rgba(26,25,23,0.48)',
  ink45: 'rgba(26,25,23,0.45)',
  ink42: 'rgba(26,25,23,0.42)',
  ink38: 'rgba(26,25,23,0.38)',
  ink36: 'rgba(26,25,23,0.36)',
  ink32: 'rgba(26,25,23,0.32)',
  ink30: 'rgba(26,25,23,0.30)',

  // ── The one accent ─────────────────────────────────────────────
  //
  // KEPT UNDER THE NAME `gold` ON PURPOSE. Two hundred files read these tokens;
  // renaming them to `tan` would be a rename commit touching everything and
  // teaching nobody anything. What changed is the VALUES: the burnt-gold family
  // is now the renderings' single tan accent, and the two members that carry
  // TEXT are deeper than the rest so they clear 4.5:1 on white paper.
  //
  //   gold        the tan itself -- the active tab lozenge, the agenda's left
  //               bar, the unread badge. Fills, never text.
  //   goldBright  a lit fill, for a small element that should glow rather than
  //               print.
  //   goldKicker  every small-caps section label in the app. GRAY, not gold:
  //               "NOTES & JOURNAL", "DIRECT MESSAGES", "ALL CONTACTS" are all
  //               quiet gray in the renderings. 4.7:1 on white.
  //   goldDeep    small tappable text -- "See 10 more" and its kin. 4.7:1.
  //   goldTab     the label on the active segment. 7.4:1.
  gold: '#D6A96E',
  goldBright: '#E0A45C',
  goldKicker: '#767370',
  goldDeep: '#A8641F',
  goldTab: '#7A4A22',
  // The rgba ramp is the tan, for fills and pressed states. Rules do NOT use it
  // any more -- see the Rules block below, which went neutral with the page.
  gold55: 'rgba(214,169,110,0.55)',
  gold40: 'rgba(214,169,110,0.40)',
  gold35: 'rgba(214,169,110,0.35)',
  gold32: 'rgba(214,169,110,0.32)',
  gold22: 'rgba(214,169,110,0.22)',
  gold18: 'rgba(214,169,110,0.18)',
  gold12: 'rgba(214,169,110,0.16)',

  // Warm tints for chips and avatars.
  tint100: '#F7E8D6',
  tint200: '#F1DCC2',

  // ── Rules ──────────────────────────────────────────────────────
  //
  // EVERY RULE IS NEUTRAL NOW. A gold hairline on an amber page was structure;
  // on white paper it is a stray warm line, and the renderings draw every
  // divider -- between contacts, under the agenda, beside a section label -- as
  // the same light gray. `ruleGold` keeps its name and stops being gold, so the
  // thirty section headers that ask for it get the rendering's line without
  // thirty edits.
  rule: 'rgba(26,25,23,0.07)', // row separators inside a card
  ruleSoft: 'rgba(26,25,23,0.06)',
  ruleFaint: 'rgba(26,25,23,0.08)', // the neutral section rule
  ruleGold: 'rgba(26,25,23,0.08)',
} as const;

// ── Avatars ──────────────────────────────────────────────────────
// Reference: gold face is a 150deg gradient #fff3e4→#f0d9b4 with a
// rgba(182,130,53,.4) edge and #7d5411 initials. The neutral face (used for the
// lower-ranked rows in mockup-3) is #fbf9f7→#e6e2dd with #605d5d initials.
export const avatarFace = {
  gold: {
    gradient: [cl.tint100, cl.tint200] as const,
    border: cl.gold40,
    ink: cl.goldDeep,
  },
  neutral: {
    gradient: ['#FBF9F7', '#E6E2DD'] as const,
    border: 'rgba(26,25,23,0.14)',
    ink: '#605D5D',
  },
} as const;

// ── Radii ────────────────────────────────────────────────────────
export const clRadius = {
  card: 16,
  cardLg: 18,
  tile: 14,
  dayBox: 11,
  iconSq: 9,
  iconSqLg: 10,
  chip: 16,
  search: 21,
  pill: 999,
} as const;

// ── Elevation ────────────────────────────────────────────────────
// CSS blur → shadowRadius is halved (see the note at the top of this file).
export const clShadow = {
  // 0 8px 22px rgba(45,43,43,.08) — the resting card.
  card: {
    shadowColor: '#2D2B2B',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.1,
    shadowRadius: 11,
    elevation: 4,
  },
  // 0 10px 26px rgba(45,43,43,.09) — the wide list/feature card.
  cardLg: {
    shadowColor: '#2D2B2B',
    shadowOffset: { width: 0, height: 7 },
    shadowOpacity: 0.11,
    shadowRadius: 13,
    elevation: 5,
  },
  // 0 8px 22px rgba(122,79,15,.08) — the warm card, shadow tinted gold.
  warm: {
    shadowColor: '#7A4F0F',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.12,
    shadowRadius: 11,
    elevation: 4,
  },
  // 0 1px 3px rgba(45,43,43,.09) — the selected day box / active chip.
  chip: {
    shadowColor: '#2D2B2B',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  // 0 14px 40px rgba(45,43,43,.2) — the floating tab pill.
  tabBar: {
    shadowColor: '#2D2B2B',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.18,
    shadowRadius: 20,
    elevation: 14,
  },
  // The active tab's inner highlight: 0 2px 6px rgba(45,43,43,.13).
  tabActive: {
    shadowColor: '#2D2B2B',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.13,
    shadowRadius: 3,
    elevation: 3,
  },
} as const;

// ── Layout ───────────────────────────────────────────────────────
// The reference gutters: cards inset 14px from the screen edge, section headers
// and body copy inset 18px (so a kicker sits slightly proud of the card below
// it — that offset is deliberate, keep it).
export const clLayout = {
  gutter: 14,
  textGutter: 18,
  // Card padding. The reference's 14/15 is right for a dense row card, but the
  // mockups' content cards breathe more than that once real copy is in them.
  cardPadX: 18,
  cardPadY: 18,
  // A list row inside a grouped card.
  rowPadY: 17,
  // ── Rhythm ─────────────────────────────────────────────────────
  // The gaps that were making the build read scrunched. Measured off the
  // mockups: the PNGs render a 402pt-wide device at 820px, so image pixels ÷
  // 2.04 give device points.
  //
  //   header → first card          ≈ 38px  → 18pt
  //   card → sibling card          ≈ 35px  → 17pt
  //   card → next section's kicker ≈ 62px  → 30pt
  //   kicker → the card under it   ≈ 32px  → 15pt
  //
  /** Between two cards in the same section. */
  cardGap: 20,
  /** Between major sections (a kicker + its content, to the next kicker). */
  sectionGap: 40,
  /** A section kicker to the content beneath it. */
  kickerGap: 16,
  /** The first card below a screen header. */
  headerGap: 24,
  // Room for the floating tab pill AND the mic FAB that floats above it. The FAB
  // sits at (bottomInset + 8 + 72 + 14) with a 44pt body, so content must clear
  // ~60pt more than the pill alone or the FAB covers the last row.
  tabBarClearance: 132,
  /** Clearance for a scroll view that also sits under the mic FAB. */
  fabClearance: 196,
  // ── The two bars at the bottom of every screen ─────────────────
  // They are separate components and they have to agree about width, so the
  // numbers live here rather than in either of them. lib/peopleBar re-exports
  // barSide as PEOPLE_BAR_SIDE; TabBar reads both. Neither file imports the
  // other, which is the point -- peopleBar already imports TAB_BAR_HEIGHT, so a
  // constant owned by either one of them would close a cycle.
  /** The search bar's inset from each screen edge. */
  barSide: 16,
  /**
   * The tab pill's width as a fraction of the SEARCH BAR's width.
   *
   * The pill used to be `left:0 right:0` with 13pt of padding, i.e. six points
   * WIDER than the bar above it -- so the primary control of the app was the
   * narrower of the two, and the two full-width rounded rectangles read as one
   * stacked block. It is deliberately the shorter one now.
   *
   * 0.7 -> 0.56 WITH THE THIRD TAB'S REMOVAL. The fraction was set when the pill
   * held three items; dividing the same width between two makes each slot half
   * again as wide, and the active lozenge is as wide as its slot -- so keeping
   * 0.7 would have put a 100pt tan capsule under a 21pt mark. Narrowing the pill
   * rather than the lozenge keeps the lozenge filling its slot, which is what
   * makes the sliding highlight land exactly on a tab instead of near one.
   */
  tabPillFraction: 0.56,
} as const;

// ── Type ─────────────────────────────────────────────────────────
// The reference sets headings in Cormorant Garamond; this app ships Fraunces,
// which the brief specifies as the display face. Sizes/leading/tracking are the
// reference's. `tnum` is on for every figure — the reference sets
// font-variant-numeric: tabular-nums on all of them.
const TNUM = { fontVariant: ['tabular-nums' as const] };

export const clType = {
  // Display — Fraunces at the light cut, as the reference does for big numerals
  // and screen titles ("the bigger the text the lighter it sets").
  screenTitle: {
    fontFamily: 'Newsreader_400Regular',
    fontSize: 32,
    lineHeight: 34,
    letterSpacing: -0.48,
  },
  headerDate: {
    fontFamily: 'Newsreader_400Regular',
    fontSize: 31,
    lineHeight: 32,
    letterSpacing: -0.47,
    ...TNUM,
  },
  heroName: {
    fontFamily: 'Newsreader_400Regular',
    fontSize: 30,
    lineHeight: 32,
  },
  daySection: {
    fontFamily: 'Newsreader_400Regular',
    fontSize: 26,
    lineHeight: 27,
    letterSpacing: -0.26,
  },
  statNumeral: {
    fontFamily: 'Newsreader_400Regular',
    fontSize: 28,
    lineHeight: 29,
    ...TNUM,
  },
  bandNumeral: {
    fontFamily: 'Newsreader_400Regular',
    fontSize: 23,
    lineHeight: 24,
    ...TNUM,
  },

  // Titles — REGULAR WEIGHT, and the reason is worth writing down.
  //
  // These were all Newsreader_600SemiBold, and semibold is what made a contact
  // row, a circle name and "Start a conversation" look like a DIFFERENT, older
  // typeface than the surfaces beside them. It is not: it is the same family two
  // weights heavier at half the size, and Newsreader's semibold gets dense and
  // generic in the 16–20px band while its regular stays open and editorial —
  // which is the whole reason the 32px date and the 36px name look the way they
  // do.
  //
  // So the interface ceiling is 400 now, with a touch of negative tracking and a
  // point or two of extra size to hold presence without weight. Hierarchy comes
  // from SIZE and COLOR from here on, not from thickness. The two places that
  // still earn semibold are marked where they are used.
  cardName: {
    fontFamily: 'Newsreader_400Regular',
    fontSize: 21,
    lineHeight: 25,
    letterSpacing: -0.24,
  },
  rowName: {
    fontFamily: 'Newsreader_400Regular',
    fontSize: 20,
    lineHeight: 24,
    letterSpacing: -0.22,
  },
  cardTitle: {
    fontFamily: 'Newsreader_400Regular',
    fontSize: 19,
    lineHeight: 24,
    letterSpacing: -0.2,
  },
  listTitle: {
    fontFamily: 'Newsreader_400Regular',
    fontSize: 18,
    lineHeight: 22,
    letterSpacing: -0.18,
  },
  score: {
    fontFamily: 'Newsreader_400Regular',
    fontSize: 20,
    lineHeight: 20,
    ...TNUM,
  },
  rank: {
    // Kept a shade heavier than the rest: this is a numeral sitting INSIDE a
    // filled swatch at 10–14px, where regular disappears against the fill.
    fontFamily: 'Newsreader_500Medium',
    fontSize: 15,
    lineHeight: 17,
    ...TNUM,
  },

  // Kickers — small-caps, tracked, gold. Tracking is the reference's em value
  // resolved at each size (.16em at 11.5px = 1.84, .12em at 10px = 1.2).
  kicker: {
    fontFamily: 'Newsreader_600SemiBold',
    fontSize: 11.5,
    lineHeight: 14,
    letterSpacing: 1.84,
    textTransform: 'uppercase' as const,
  },
  kickerSm: {
    fontFamily: 'Newsreader_600SemiBold',
    fontSize: 10,
    lineHeight: 13,
    letterSpacing: 1.2,
    textTransform: 'uppercase' as const,
  },
  // The header's day-name kicker: 10.5px / .16em, set in the body face.
  kickerDay: {
    fontFamily: 'Newsreader_400Regular',
    fontSize: 10.5,
    lineHeight: 13,
    letterSpacing: 1.68,
    textTransform: 'uppercase' as const,
  },
  // Neutral tracked labels — section right-hand notes, band labels, tags.
  label: {
    fontFamily: 'Newsreader_400Regular',
    fontSize: 10.5,
    lineHeight: 13,
    letterSpacing: 0.84,
    textTransform: 'uppercase' as const,
    ...TNUM,
  },
  labelSm: {
    fontFamily: 'Newsreader_400Regular',
    fontSize: 9.5,
    lineHeight: 12,
    letterSpacing: 1.05,
    textTransform: 'uppercase' as const,
  },
  labelXs: {
    fontFamily: 'Newsreader_400Regular',
    fontSize: 9,
    lineHeight: 11,
    letterSpacing: 0.99,
    textTransform: 'uppercase' as const,
  },

  // Body — Lora, at the reference's 1.55 leading.
  quote: {
    fontFamily: 'Newsreader_400Regular',
    fontSize: 14.5,
    lineHeight: 22,
  },
  body: {
    fontFamily: 'Newsreader_400Regular',
    fontSize: 13,
    lineHeight: 20,
  },
  meta: {
    fontFamily: 'Newsreader_400Regular',
    fontSize: 12,
    lineHeight: 17,
  },
  metaSm: {
    fontFamily: 'Newsreader_400Regular',
    fontSize: 11.5,
    lineHeight: 16,
  },
  metaXs: {
    fontFamily: 'Newsreader_400Regular',
    fontSize: 11,
    lineHeight: 15,
  },
  reason: {
    fontFamily: 'Newsreader_400Regular',
    fontSize: 12.5,
    lineHeight: 17,
  },
  footnote: {
    fontFamily: 'Newsreader_400Regular',
    fontSize: 11.5,
    lineHeight: 19,
  },
  // The italic serif aside the reference uses for interstitial notes and
  // empty states ("Nobody here by that name.").
  aside: {
    fontFamily: 'Newsreader_400Regular_Italic',
    fontSize: 17,
    lineHeight: 24,
  },
  // Tab-bar label: Cormorant 600 / 9.5px / .07em uppercase.
  tabLabel: {
    fontFamily: 'Newsreader_600SemiBold',
    fontSize: 9.5,
    lineHeight: 12,
    letterSpacing: 0.67,
    textTransform: 'uppercase' as const,
  },
} as const;

// Hairlines want the thinnest line the display can draw. On iOS that is a
// sub-point value; Android rounds up, so keep it at 1 there.
export const HAIRLINE = Platform.OS === 'ios' ? 0.5 : 1;

// ── PARKED: relationship-strength banding ────────────────────────
// PeopleRank score → band, using the reference's thresholds (>=80 strong, 50–79
// steady, <50 fading).
//
// UNUSED ON PURPOSE. The People screen's network card rendered these, but an
// empty-query rank scores everyone 0 — the scorer's proximity/recency signals
// need a query and contact history to bite — so every person came out "fading"
// with a 0 beside them. That is not a weak signal, it is no signal, and showing
// it as one looked broken.
//
// Kept because a real relationship-strength signal is a later feature: when the
// backend returns scores that mean something on an unqueried rank, this is the
// mapping to render them with. Until then nothing should call it.
export type RankBand = 'strong' | 'steady' | 'fading';

export function bandForScore(score: number): RankBand {
  if (score >= 80) return 'strong';
  if (score >= 50) return 'steady';
  return 'fading';
}

export const bandColor: Record<RankBand, string> = {
  strong: cl.gold,
  steady: cl.gold55,
  fading: 'rgba(26,25,23,0.2)',
};
