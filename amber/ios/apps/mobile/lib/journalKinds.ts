/**
 * THE THREE KINDS OF THING IN NOTES & JOURNAL, AND WHAT COLOR EACH ONE IS.
 *
 * Extracted from HomePage.tsx, unchanged in behavior, for two reasons. Node's
 * type-stripping cannot load a .tsx, so a rule that lives in a component is a
 * rule no test can reach -- and the You tab and the day view now both need this
 * classification, so a second copy was about to exist.
 *
 * THE THREE KINDS, and the words are the user's:
 *
 *   NETWORK NOTE   something you said about somebody else. Burnt orange.
 *   JOURNAL        something you said about yourself. Green.
 *   REMINDER       something you asked to be reminded of. Purple.
 *
 * A REMINDER IS IN THIS LIST ONLY IF IT IS NOT ON THE CALENDAR. "Remind me to
 * eventually start studying for the LSAT" has no time and belongs here; "pick
 * up the prescription at four" has one and belongs on the day. The distinction
 * is the reminder's own due time and it has been in the data all along -- the
 * column is nullable -- so nothing has to be guessed. See `isScheduled`.
 */

export type JournalKind = 'network' | 'journal' | 'reminder';

/**
 * A note is a NETWORK NOTE when it is filed to somebody, and a JOURNAL entry
 * when it is not.
 *
 * "Filed to somebody" means a resolved contact, not a name Amber heard. A note
 * that mentions a Marcus it could not place is still about the person's own
 * day as far as this list is concerned, and calling it a network note would put
 * an orange card on screen with nobody to open.
 */
export function kindOfNote(note: { people?: ({ contactId?: string | null } | null)[] | null }): JournalKind {
  const filed = (note?.people ?? []).some((p) => p && p.contactId != null);
  return filed ? 'network' : 'journal';
}

/**
 * Does this reminder belong on the day rather than in the list?
 *
 * A time is the whole test. Not "is it soon", not "did somebody attach a place"
 * -- a reminder with an instant is a commitment and goes on the calendar, one
 * without is a note to self.
 */
export function isScheduled(reminder: { dueAt?: string | null; remindAt?: string | null } | null | undefined): boolean {
  const raw = reminder?.dueAt ?? reminder?.remindAt ?? null;
  if (typeof raw !== 'string' || raw.trim() === '') return false;
  return !Number.isNaN(new Date(raw).getTime());
}

/**
 * The label and the color for each kind.
 *
 * ONE TABLE rather than conditionals scattered through the card, so "make
 * journals quieter" is a one-line change here. The tints are the card's
 * background and the dots; the ink is the kicker. Every pair was checked
 * against the cream ground for contrast rather than picked for looking right in
 * isolation -- see scripts/palette-check.mts, which fails the build on a
 * kicker that cannot be read.
 */
export const JOURNAL_KIND: Record<
  JournalKind,
  { label: string; ink: string; tint: string; dot: string }
> = {
  // THE TINTS ARE OPAQUE NOW, and that is the change the white page forced.
  //
  // They were translucent -- a ten-percent wash of each hue -- which is exactly
  // right over a warm gradient, because a translucent tint takes the ground's
  // own color wherever it lands and the three cards stay in the same family as
  // the page. Over white there is no ground to take, so a ten-percent wash
  // resolves to three nearly-white rectangles and the color stops carrying its
  // meaning.
  //
  // The values below are the renderings', sampled: a peach, a pale green and a
  // lavender, each a real surface. The DOT is the rendering's exactly. The INK
  // is one shade deeper than the rendering on two of the three, because the
  // label is 10pt letter-spaced small caps and owes 4.5:1 on its own card --
  // scripts/palette-check.mts fails the build on a kicker that cannot be read,
  // and it caught both of them.
  //
  // Burnt orange. Something you said about somebody else.
  network: {
    label: 'NETWORK NOTE',
    ink: '#A45925',
    tint: '#FBF1E7',
    dot: '#D98A3D',
  },
  // Green. Something you said about yourself.
  journal: {
    label: 'JOURNAL',
    ink: '#427952',
    tint: '#EDF4EE',
    dot: '#5F9E6F',
  },
  // Purple. Something you asked to be reminded of.
  reminder: {
    label: 'REMINDER',
    ink: '#6C5FC0',
    tint: '#F1EFF9',
    dot: '#8B7FD1',
  },
};

/** Every kind, in the order the list groups them. */
export const JOURNAL_KINDS: JournalKind[] = ['network', 'journal', 'reminder'];

/**
 * Prominence, then recency, exactly as the home page has always ranked it.
 *
 * A note that tags somebody is louder than a note to self, which is louder than
 * a reminder. That order is the spec, and it only reads right because
 * everything in this list is from the same day -- a week-old note above this
 * morning's reminder would be absurd, and the day filter is what stops it.
 */
const RANK: Record<JournalKind, number> = { network: 0, journal: 1, reminder: 2 };

export function byProminence<T extends { kind: JournalKind; at: number }>(a: T, b: T): number {
  const r = RANK[a.kind] - RANK[b.kind];
  return r !== 0 ? r : b.at - a.at;
}
