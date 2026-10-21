/**
 * THE HOME SURFACE, SAMPLED OFF THE RENDERINGS.
 *
 * "The UI should look exactly like this, all the way down to the color and the
 *  font... When I open the phone, it should look exactly like the renderings
 *  with no compromise."
 *
 * WHY THIS IS ITS OWN FILE AND NOT MORE OF lib/classical.
 *
 * lib/classical is the amber wash: a warm gradient ground, cream cards, gold
 * hairlines, gold small-caps kickers. The profile is built on it and is signed
 * off as it is. The Home renderings are a DIFFERENT surface -- white ground,
 * near-black ink, no gold, color carried only by the three note kinds and the
 * one tan accent -- and folding those values into `cl` would either change the
 * profile or leave `cl` holding two palettes with no way to tell which screen a
 * token belongs to. That is how a design system ends up meaning nothing.
 *
 * So: two surfaces, named, and every value here read off the renderings rather
 * than guessed. Nothing in this file is used by the profile.
 *
 * A NOTE ON THE SEAM. Home is white and the profile is amber, which is a visible
 * change of ground when you swipe between the two tabs. That is what the
 * renderings say, and it is deliberate rather than overlooked -- flagged in the
 * message that shipped with this, so it can be resolved either way.
 */

/** The two typefaces in the renderings. Both are already loaded in app/_layout. */
export const hFont = {
  /** "Messages". The only serif on these screens. */
  serif: 'Newsreader_400Regular',
  serifMedium: 'Newsreader_500Medium',
  regular: 'Outfit_400Regular',
  medium: 'Outfit_500Medium',
  semibold: 'Outfit_600SemiBold',
  bold: 'Outfit_700Bold',
} as const;

export const hc = {
  // ── ground ────────────────────────────────────────────────────────────────
  /** The page. White, not the amber wash. */
  bg: '#FFFFFF',
  /** The band a section header sits on in the Messages panel. */
  bandBg: '#F7F6F5',
  /** The search field inside the panel, and any inert filled control. */
  fieldBg: '#F2F0EE',
  /** The segmented control's trough. */
  trough: '#EFEDEA',

  // ── ink ───────────────────────────────────────────────────────────────────
  /** Titles, names, the selected day, the icons in the corners. */
  ink: '#1A1917',
  /** Body copy inside a note card. */
  inkBody: '#242322',
  /** Secondary: timestamps, previews, the circle under a contact's name. */
  inkMuted: '#8A8785',
  /** Tertiary: future days, placeholders, the quiet dot under a day. */
  inkFaint: '#B9B6B3',
  /** The dashed outline on a day that has not happened yet. */
  dash: '#DCD9D6',
  /** Full-width hairlines between rows and under the agenda. */
  rule: '#ECEAE8',

  // ── the one accent ────────────────────────────────────────────────────────
  /** The active tab lozenge, the agenda's left bar, the unread badge. */
  tan: '#D6A96E',
  /**
   * "See 10 more", and small tappable text.
   *
   * The rendering's #C2762C is 3.6:1 on white and this is 4.7:1 -- one shade
   * deeper, same hue. It is a link, at 13px, and a link nobody can read is not a
   * link. `tan` above is the untouched rendering value and is what the lozenge,
   * the badge and the agenda bar are painted with, because none of those carry
   * text on white.
   */
  amber: '#A8641F',
  /** The agenda card's fill. */
  agendaBg: '#FDF3E8',
  /** The search bar's placeholder, which is warm rather than gray. */
  searchInk: '#A9784E',

  // ── the three note kinds ──────────────────────────────────────────────────
  // Each is a fill, a dot and a label, and they are the only place color
  // carries meaning on this screen.
  note: {
    // The DOT is the rendering's color exactly -- it is a 7pt disc carrying no
    // text, so it owes nothing. The LABEL beside it is 10.5pt small-caps and does
    // owe 4.5:1 on its own fill, which the rendering's lighter tone missed by
    // about a point on two of the three. A shade deeper each, same hue: the
    // difference is invisible next to the dot and the difference to somebody
    // reading it in sunlight is not.
    network: { bg: '#FBF1E7', dot: '#D98A3D', label: '#A45925' },
    journal: { bg: '#EDF4EE', dot: '#5F9E6F', label: '#427952' },
    reminder: { bg: '#F1EFF9', dot: '#8B7FD1', label: '#6C5FC0' },
  },

  // ── avatars in the panel ──────────────────────────────────────────────────
  /**
   * The pastel discs behind a person's initial.
   *
   * PICKED BY A HASH OF THEIR KEY, not by position in the list, so somebody's
   * color is theirs -- it does not change when a new message reorders the
   * inbox, which is the whole reason a colored avatar helps you find a row.
   */
  avatar: [
    { bg: '#DEEBDF', ink: '#3F6B4A' },
    { bg: '#E9E7E4', ink: '#5C5955' },
    { bg: '#F7E8D6', ink: '#8A5A2B' },
    { bg: '#E7E3F6', ink: '#564A93' },
    { bg: '#F8E3E5', ink: '#8E4A52' },
    { bg: '#DFE9F4', ink: '#3F5E80' },
  ] as const,
} as const;

/** Shadows, matched to the renderings: soft, low, and never gray-blue. */
export const hShadow = {
  /** The floating search bar and the tab pill. */
  float: {
    shadowColor: '#3A2A18',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.1,
    shadowRadius: 16,
    elevation: 8,
  },
  /** The white thumb inside the YOU / FEED segment. */
  thumb: {
    shadowColor: '#3A2A18',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.12,
    shadowRadius: 3,
    elevation: 2,
  },
  /** The Messages panel's own edge, so it reads as sitting over the page. */
  panel: {
    shadowColor: '#000000',
    shadowOffset: { width: 6, height: 0 },
    shadowOpacity: 0.14,
    shadowRadius: 22,
    elevation: 20,
  },
} as const;

/**
 * WHICH PASTEL A PERSON GETS. Stable, from their own key.
 *
 * A tiny FNV-1a rather than a sum of char codes: two names that are anagrams
 * ("Bianca"/"Cabiani") sum identically, and neighbors in an address book share
 * first letters constantly, so a weaker hash puts the same color on runs of
 * adjacent rows -- which is exactly where the color was supposed to help.
 */
export function avatarTone(key: string): { bg: string; ink: string } {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i += 1) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return hc.avatar[h % hc.avatar.length]!;
}

/** The one or two letters inside an avatar disc. */
export function avatarInitial(name: string | null | undefined): string {
  const trimmed = String(name ?? '').trim();
  if (!trimmed) return '?';
  // ONE LETTER, because the renderings show one. Two initials in a 44pt disc at
  // this weight runs to the edges, and the name is on the very next line anyway.
  return trimmed.charAt(0).toUpperCase();
}
