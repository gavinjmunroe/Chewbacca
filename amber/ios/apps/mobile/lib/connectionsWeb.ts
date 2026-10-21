import type { CirclePreview } from './circles';
import type { Connection } from './connect';

/**
 * THE WEB IS THE PEOPLE YOU ARE ACTUALLY CONNECTED TO ON AMBER.
 *
 * WHAT IT DREW BEFORE. Your circles: one node per circle, your monogram in the
 * middle. That is a picture of how you have FILED people, and you already have a
 * better view of that -- the pinned grid directly underneath, which is a list of
 * circles that can say their names and counts without being decoded off a ring.
 * The drawing was spending the most expensive real estate on the screen to say
 * something the row below it said better.
 *
 * A web should draw the thing that is actually a web. Circles do not connect to
 * each other; people do. So the nodes are people now, and the circles became the
 * filter along the bottom -- which is what a grouping is FOR in a drawing like
 * this: not a thing to look at, a way to look at fewer things.
 *
 * THE HARD PART IS THE FIRST DAY, and it is the reason this module exists rather
 * than the component just mapping over listConnections(). Amber connections need
 * both people signed up AND connected, so a new user has none and a two-week-old
 * user has three. Drawing only connections would give the whole early user base
 * an empty screen where the richest thing on the profile used to be, and it
 * would break the standing rule that a brand-new user and a ten-year user are
 * looking at the same app -- one of them would be looking at nothing.
 *
 * So there are two kinds of node and one rule:
 *
 *   CONNECTION  someone who is ON AMBER. Solid. Tapping opens them. Note what
 *               this is NOT keyed on: being connected to you. A card in one of
 *               your circles that resolves to an Amber account is a person on
 *               Amber whether or not the two of you have connected, and drawing
 *               them faint would offer to text an invitation to somebody who is
 *               already using the app. `connected` carries the finer answer.
 *   SUGGESTION  someone in your life who is not on Amber. Dotted. Tapping opens
 *               Messages with an invite, which they send themselves.
 *
 *   EVERY PERSON IN EVERY CIRCLE IS DRAWN, whichever kind they are, deduped
 *   across circles. Suggestions used to be capped at eight and to disappear
 *   once you had five connections -- both are gone, because the filter pills
 *   are counted off this ring and a capped ring made them count the drawing
 *   rather than the circle. See the long note in buildWeb.
 *
 * WHERE SUGGESTIONS COME FROM IS A SEAM, ON PURPOSE. The onboarding flow that
 * will eventually pick them -- the one where you choose people and say what they
 * mean to you -- does not exist yet. Rather than ship a dead code path that
 * nothing can test, `suggestionsFrom` defaults to the best answer available
 * today: people already in your circles who are not on Amber. When onboarding
 * lands it replaces that one function and nothing else here changes.
 *
 * EVERYTHING IN THIS FILE IS PURE. No hooks, no fetching, no React. The
 * component decides when to load; this decides what the drawing is. That is what
 * makes the boundary cases below testable at all, and the boundary cases are the
 * whole risk: zero connections, exactly five, one person filed in six circles.
 */

/**
 * KEPT, AND NO LONGER USED BY buildWeb.
 *
 * It was the point at which the invite nodes disappeared. They do not disappear
 * any more -- see the long note in buildWeb -- but the onboarding flow still has
 * a use for "how many real connections counts as having a web", so the number
 * stays here rather than being deleted and re-invented somewhere else.
 */
export const SUGGESTION_CUTOFF = 5;

/**
 * The most nodes the ring will ever draw. See the note in buildWeb: a ceiling
 * against a pathological address book, not a design choice about how many
 * people belong on the screen.
 */
export const MAX_WEB_NODES = 300;

/**
 * Up to this many nodes share one ring; past it a second, inner ring opens.
 *
 * RAISED FROM EIGHT. With the ring stretched vertically and labels sized to the
 * room beside them, twelve fit on one ring comfortably, and one ring with spokes
 * to the middle reads as a web in a way two interleaved rings never quite do.
 * Eleven people were landing on two rings and looking like a crowd.
 */
export const SINGLE_ORBIT_MAX = 12;

export type WebPersonKind = 'connection' | 'suggestion';

export type WebPerson = {
  /** Stable across renders and across filter changes. See `sortPeople`. */
  key: string;
  kind: WebPersonKind;
  /** Set for a connection: the Amber account to open. */
  amberId: string | null;
  /**
   * The address-book card. For a SUGGESTION it is who to text; for a CONNECTION
   * it is the card to open, and may be null when they are only an account.
   */
  contactId: string | null;
  name: string;
  initials: string;
  avatarUrl: string | null;
  username: string | null;
  /**
   * IS THIS AN ACTIVE AMBER CONNECTION OF MINE, as opposed to merely somebody
   * with an account?
   *
   * `kind` answers "are they on Amber", because that is what the drawing is
   * about: "if they're on Amber, obviously fill it in, and if they're not, have
   * the dotted UI." Somebody whose card is linked to an account but who you have
   * never connected with is on Amber and draws solid -- inviting them by text to
   * an app they already use is the exact wrongness this file has a whole
   * paragraph about elsewhere.
   *
   * This is the finer distinction, kept because the summary line counts
   * connections and because a future "Connect" affordance needs to know.
   */
  connected: boolean;
  /** Every circle this person belongs to. Empty is normal and not an error. */
  circleIds: string[];
};

/**
 * Two letters, from a name that may be anything.
 *
 * ONE WORD GIVES TWO LETTERS, not one. "Prince" as "P" next to "Maya Kumar" as
 * "MK" reads as a rendering fault rather than a mononym. A name that is only
 * punctuation or only emoji has no letters to take, and "?" is the honest
 * answer -- better than an empty disc that looks like a loading failure.
 */
export function initialsOf(name: string): string {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) {
    const one = parts[0]!.replace(/[^\p{L}\p{N}]/gu, '');
    return one.length > 0 ? one.slice(0, 2).toUpperCase() : '?';
  }
  const first = parts[0]!.replace(/[^\p{L}\p{N}]/gu, '').charAt(0);
  const last = parts[parts.length - 1]!.replace(/[^\p{L}\p{N}]/gu, '').charAt(0);
  const both = `${first}${last}`;
  return both.length > 0 ? both.toUpperCase() : '?';
}

/**
 * A STABLE ORDER, so filtering does not shuffle the ring.
 *
 * Position on the ring carries no meaning, but it has to be the SAME
 * meaninglessness every time: if pressing Work and pressing All again put Mina
 * somewhere new, the drawing looks like it is reshuffling at random and nobody
 * trusts it. Sorting by name and breaking ties on the key means any subset of
 * the same people always lays out in the same relative order, so a filter reads
 * as people leaving the ring rather than the ring being rebuilt.
 *
 * Connections come before suggestions so the real people hold the top of the
 * ring, which is where the eye starts.
 */
export function sortPeople(people: WebPerson[]): WebPerson[] {
  return [...people].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'connection' ? -1 : 1;
    return a.name.localeCompare(b.name) || a.key.localeCompare(b.key);
  });
}

/**
 * Which circles each Amber account appears in.
 *
 * A circle's `preview` is a PREVIEW -- the server sends the first few members,
 * not all of them -- so a connection can be in a circle this map does not know
 * about. That is a visible-but-acceptable gap for the drawing (the filter may
 * omit someone the full member list would include) and it is NOT acceptable
 * silently, so callers that need completeness pass `members` from
 * getCircleMembers. Both are handled: whatever member arrays are supplied get
 * indexed, and nothing is inferred from their absence.
 */
function circlesByAmberId(circles: CirclePreview[], extra: Map<string, { amberId: string | null }[]>): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const add = (amberId: string | null | undefined, circleId: string) => {
    if (!amberId) return;
    const list = out.get(amberId);
    if (list) {
      if (!list.includes(circleId)) list.push(circleId);
    } else {
      out.set(amberId, [circleId]);
    }
  };
  for (const c of circles) {
    for (const m of c.preview ?? []) add(m.amberId, c.id);
    for (const m of extra.get(c.id) ?? []) add(m.amberId, c.id);
  }
  return out;
}

/**
 * MY CARD FOR EACH ACCOUNT, read off circle membership.
 *
 * A BELT FOR THE SERVER'S BRACES. The connections payload now carries
 * `contactId` -- the caller's own card for that account -- and that is the
 * authoritative answer. But the app and the server ship separately, and a phone
 * running the new app against an older server would get null for every one and
 * quietly go back to opening bare Amber profiles.
 *
 * A circle member already carries both ids side by side, so anybody filed in a
 * circle can be resolved without the server field at all. Used only where the
 * payload left a gap.
 */
function contactIdByAmberId(
  circles: CirclePreview[],
  extra: Map<string, { contactId: string; amberId: string | null }[]>,
): Map<string, string> {
  const out = new Map<string, string>();
  const add = (m: { contactId?: string | null; amberId?: string | null }) => {
    if (!m?.amberId || !m?.contactId) return;
    if (!out.has(m.amberId)) out.set(m.amberId, m.contactId);
  };
  for (const c of circles) {
    for (const m of c.preview ?? []) add(m);
    for (const m of extra.get(c.id) ?? []) add(m);
  }
  return out;
}

export type SuggestionSeed = {
  contactId: string;
  name: string;
  avatarUrl: string | null;
  /** Their account, when the card has been resolved to one. */
  amberId: string | null;
  username: string | null;
  circleIds: string[];
};

/**
 * WHO TO OFFER AN INVITE TO, until onboarding picks them properly.
 *
 * People already in your circles who have no Amber account. They are the
 * strongest available signal that you care about someone: you went to the
 * trouble of filing them. Deduped by contact, because being in three circles
 * makes someone one suggestion in three circles, not three suggestions.
 *
 * Ordered by how many circles they are in, then by name -- someone in your Work
 * AND Friends circles is a better invite than someone in one, and the tie-break
 * is alphabetical rather than payload order so the ring does not reshuffle when
 * the server returns circles in a different sequence.
 */
export function suggestionsFromCircles(
  circles: CirclePreview[],
  extra: Map<string, { contactId: string; name: string; avatarUrl: string | null; amberId: string | null }[]> = new Map(),
): SuggestionSeed[] {
  const byContact = new Map<string, SuggestionSeed>();
  const consider = (
    m: {
      contactId: string;
      name: string;
      avatarUrl: string | null;
      amberId: string | null;
      username?: string | null;
    },
    circleId: string,
  ) => {
    /**
     * ON AMBER IS NOT A REASON TO LEAVE SOMEBODY OFF, and it used to be.
     *
     * This skipped any member whose card resolved to an account, on the
     * reasoning that they were "a connection or a stranger, never a
     * suggestion". The first half is only true if you have actually connected
     * with them -- and a card in your circle linked to an account you have never
     * connected to is neither: it is somebody in your life, on Amber, who was
     * drawn nowhere at all. They are on the ring now, solid, because that is
     * what they are.
     */
    if (!m.contactId) return;
    const seen = byContact.get(m.contactId);
    if (seen) {
      if (!seen.circleIds.includes(circleId)) seen.circleIds.push(circleId);
      // A duplicate row for one card may be the one that carries the link.
      if (!seen.amberId && m.amberId) {
        seen.amberId = m.amberId;
        seen.username = m.username ?? null;
      }
      return;
    }
    byContact.set(m.contactId, {
      contactId: m.contactId,
      name: m.name ?? '',
      avatarUrl: m.avatarUrl ?? null,
      amberId: m.amberId ?? null,
      username: m.username ?? null,
      circleIds: [circleId],
    });
  };
  for (const c of circles) {
    for (const m of c.preview ?? []) consider(m, c.id);
    for (const m of extra.get(c.id) ?? []) consider(m, c.id);
  }
  return [...byContact.values()].sort(
    (a, b) => b.circleIds.length - a.circleIds.length || a.name.localeCompare(b.name),
  );
}

export type BuildWebInput = {
  connections: Connection[];
  circles: CirclePreview[];
  /**
   * Full member lists, keyed by circle id, for circles whose members have been
   * loaded. Optional: `preview` is used for the rest. See circlesByAmberId.
   */
  members?: Map<string, { contactId: string; name: string; avatarUrl: string | null; amberId: string | null }[]>;
  /**
   * THE SEAM. Replaced by the onboarding picker when it exists. Defaults to
   * people in your circles who are not on Amber.
   */
  suggestionsFrom?: (input: {
    circles: CirclePreview[];
    members: Map<string, { contactId: string; name: string; avatarUrl: string | null; amberId: string | null }[]>;
  }) => SuggestionSeed[];
  /** How many suggestions to draw at most, so an empty web is not a wall. */
  maxSuggestions?: number;
};

/**
 * The nodes the web draws, connections first.
 *
 * A CONNECTION IS NEVER ALSO A SUGGESTION. Both lists can contain the same human
 * -- they are connected to you AND their old contact card is in a circle -- and
 * drawing them twice is the bug this ordering exists to prevent. Connections are
 * built first and their contact ids are held aside; a suggestion for a contact
 * already spoken for is dropped.
 */
export function buildWeb(input: BuildWebInput): WebPerson[] {
  const { connections, circles } = input;
  const members = input.members ?? new Map();
  /**
   * A CEILING, NOT A DESIGN CHOICE. Everybody in your circles is drawn; this
   * only stops a pathological address book -- somebody who filed two thousand
   * contacts into a circle -- from putting two thousand labeled discs on one
   * screen and taking the frame rate with them. Nobody with a normal book will
   * ever reach it, and the pills still report the true count when they do, so
   * the number on screen never disagrees with the number on the pill.
   */
  const maxSuggestions = input.maxSuggestions ?? MAX_WEB_NODES;

  const circleIdsFor = circlesByAmberId(circles, members);
  const cardFor = contactIdByAmberId(circles, members);

  /**
   * ONE NODE PER ACCOUNT, even if the payload says otherwise.
   *
   * Two connection rows for one amberId is a real shape -- a retry, or a merge
   * that left both halves -- and mapping straight over the array gives two nodes
   * with the SAME react key. React keeps one and warns, so the ring quietly
   * holds a person who cannot be tapped while the count above it says otherwise.
   * The key is the account, so the dedupe is on the account.
   */
  const seenAmberIds = new Set<string>();
  const people: WebPerson[] = [];
  for (const c of connections) {
    if (!c.user?.amberId || seenAmberIds.has(c.user.amberId)) continue;
    seenAmberIds.add(c.user.amberId);
    const name = (c.user.fullName ?? c.user.username ?? '').trim();
    people.push({
      key: `c:${c.user.amberId}`,
      kind: 'connection',
      amberId: c.user.amberId,
      // The caller's OWN card for this account, when the server found one. It
      // is what makes tapping a connection open the person you know rather than
      // a bare Amber profile.
      contactId: c.user.contactId ?? cardFor.get(c.user.amberId) ?? null,
      name,
      initials: initialsOf(name),
      avatarUrl: c.user.avatarUrl,
      username: c.user.username,
      connected: true,
      circleIds: circleIdsFor.get(c.user.amberId) ?? [],
    });
  }

  /**
   * THE CUTOFF IS GONE, AND SO IS THE CAP.
   *
   * This used to return here once somebody had five connections -- the idea
   * being that the faint invite nodes were scaffolding that should come down
   * once the web stood on its own -- and before that it drew at most eight of
   * them.
   *
   * Both were wrong, and the pills were the proof: "if I see something like
   * Family, obviously there are zero people in Amber, but then I see NYC Badger
   * House and it shows one. That person is not on Amber but it still shows one.
   * It should be consistent."
   *
   * It was consistent, with the wrong thing. The ring held connections plus up
   * to eight invite slots, so a circle's pill counted whoever happened to have
   * WON a slot. Family got none and read 0; NYC Badger House got one and read 1.
   * Neither number answered "how many people are in this circle".
   *
   * "Every single person represented in every single circle should be shown on
   *  the web. Obviously, no duplicates if people are in multiple circles."
   *
   * So everybody is drawn. On Amber, solid; not on Amber, dotted -- which the
   * ring already knew how to do, it was simply never given more than eight of
   * them. Deduping across circles is what suggestionsFromCircles has always done
   * (keyed by contact, collecting circleIds), so somebody in three circles is
   * one node that three pills count.
   */
  /**
   * CONTACT IDS THAT ARE ALREADY A CONNECTION ON THIS RING.
   *
   * The subtle case, and the reason this is not just a name comparison. A
   * suggestion is by definition a member row with NO amberId, so it can never
   * match a connection directly. But the same human can hold TWO member rows --
   * one card the server resolved to their Amber account and one unresolved
   * duplicate -- and the unresolved one is a perfectly good suggestion seed
   * pointing at somebody already drawn a few degrees away. Sofia would appear
   * once solid and once faint, and the faint one would offer to invite her to an
   * app she is already on.
   *
   * So: collect every contact id that appears ANYWHERE alongside an amberId
   * belonging to a connection, and refuse those as seeds.
   */
  const connectedAmberIds = new Set(people.map((p) => p.amberId).filter(Boolean) as string[]);
  const spokenFor = new Set<string>();
  for (const c of circles) {
    for (const m of [...(c.preview ?? []), ...(members.get(c.id) ?? [])]) {
      if (m.contactId && m.amberId && connectedAmberIds.has(m.amberId)) spokenFor.add(m.contactId);
    }
  }

  /**
   * AND THE SAME PERSON BY NAME, because the id link is often simply not there.
   *
   * The check above only fires when the SERVER has already resolved that contact
   * card to that Amber account. On a real book it frequently has not: the card
   * carries an old number, or an email the account never registered, so the link
   * is null and the card looks like a stranger. The result was on screen in the
   * first build -- Sagar Tiwari drawn solid as a connection, and Sagar Tiwari
   * drawn faint a few degrees away offering to text him an invitation to the app
   * he is already using. That is worse than a missing feature; it says Amber
   * does not know who its own users are.
   *
   * THE TRADE, SAID OUT LOUD: two genuinely different people who share a name --
   * one connected, one not -- lose the invite node for the second. That is rare,
   * costs an invite that can still be sent from the contact card, and is a much
   * smaller error than the duplicate it prevents.
   */
  const connectedNames = new Set(people.map((p) => normalizeName(p.name)).filter((n) => n.length > 0));

  const seeds = (input.suggestionsFrom ?? (({ circles: cs, members: ms }) => suggestionsFromCircles(cs, ms)))({
    circles,
    members,
  });

  let added = 0;
  for (const s of seeds) {
    if (added >= maxSuggestions) break;
    if (spokenFor.has(s.contactId)) continue;
    // Their account is already on the ring as a connection.
    if (s.amberId && connectedAmberIds.has(s.amberId)) continue;
    if (connectedNames.has(normalizeName(s.name))) continue;
    added += 1;
    people.push({
      key: `s:${s.contactId}`,
      // SOLID IF THEY ARE ON AMBER, dotted if they are not. Not "solid if I have
      // connected with them" -- see the note on WebPerson.connected.
      kind: s.amberId ? 'connection' : 'suggestion',
      amberId: s.amberId,
      contactId: s.contactId,
      name: s.name,
      initials: initialsOf(s.name),
      avatarUrl: s.avatarUrl,
      username: s.username,
      connected: false,
      circleIds: s.circleIds,
    });
  }

  return people;
}

/** All, or one circle. A filter matching nobody yields an empty ring, not an error. */
export function filterByCircle(people: WebPerson[], circleId: string | null): WebPerson[] {
  if (!circleId) return people;
  return people.filter((p) => p.circleIds.includes(circleId));
}

/**
 * The filter row: every circle, with HOW MANY PEOPLE ARE IN IT.
 *
 * "Is it the number showing people that are not on Amber, hence the zero, or is
 *  it showing the number of people in that group? In my opinion, it should show
 *  the number of people in that group, regardless of whether they're on Amber."
 *
 * THE COUNT COMES FROM THE CIRCLE, NOT FROM THE RING. It used to be the number
 * of people on the ring who belonged to the circle, which was a different
 * number for two reasons at once -- the ring was capped, and it drew at most
 * eight non-Amber people. Family read 0 and NYC Badger House read 1, and
 * neither was the size of the circle.
 *
 * `memberCount` is the server's `COUNT(DISTINCT contact_id)` for that circle. It
 * is the answer whatever the ring is doing, it does not move when a filter is
 * applied, and it cannot disagree with the ring now that the ring draws
 * everybody. The drawn count is kept only as a fallback for a payload with no
 * memberCount on it -- an older server -- where the ring is the only number
 * available.
 *
 * A PILL THAT LEADS NOWHERE IS STILL SHOWN, because the count on it is the
 * warning: an empty circle says 0 BEFORE it is pressed, pressing the lit pill
 * turns it off, and the ring explains itself rather than going blank.
 */
export function filterPills(
  people: WebPerson[],
  circles: CirclePreview[],
  pinnedIds: string[] = [],
): { id: string; name: string; color: string | null; count: number }[] {
  const drawn = new Map<string, number>();
  for (const p of people) {
    for (const id of p.circleIds) drawn.set(id, (drawn.get(id) ?? 0) + 1);
  }
  const counts = new Map<string, number>();
  for (const c of circles) {
    const server = Number(c.memberCount);
    counts.set(c.id, Number.isFinite(server) && server >= 0 ? server : (drawn.get(c.id) ?? 0));
  }

  /**
   * EVERY CIRCLE GETS A PILL, IN THE ORDER OF THE PINNED GRID.
   *
   * This used to offer only circles somebody on the ring belonged to, and sort
   * them by headcount. The reasoning was that a pill leading to an empty ring is
   * a dead end -- press it, everything vanishes, and the only way back is to
   * notice All.
   *
   * That was solving the wrong problem, and it cost the thing the row is FOR.
   * These are the person's own circles: a row that silently omits half of them
   * is a row they cannot trust, and the order it did use (by count) had nothing
   * to do with any order they had ever chosen. They pinned circles into an
   * arrangement on the same screen; that is the order.
   *
   * The dead end is handled where it actually belongs -- the count rides on the
   * pill, so an empty circle says so BEFORE it is pressed, pressing the lit pill
   * turns it off, and the ring says "nobody from that circle is on Amber yet"
   * rather than going quietly blank.
   *
   * Pinned first, in pin order; everything else after, alphabetically, so the
   * tail is at least predictable.
   */
  const rank = new Map(pinnedIds.map((id, i) => [id, i]));
  return [...circles]
    .map((c) => ({ id: c.id, name: c.name, color: c.color, count: counts.get(c.id) ?? 0 }))
    .sort((a, b) => {
      const ra = rank.get(a.id);
      const rb = rank.get(b.id);
      if (ra !== undefined && rb !== undefined) return ra - rb;
      if (ra !== undefined) return -1;
      if (rb !== undefined) return 1;
      return a.name.localeCompare(b.name);
    });
}

/**
 * A name, folded so two spellings of one person compare equal.
 *
 * Diacritics stripped after NFD, case folded, punctuation dropped and runs of
 * space collapsed, so "José  Ramírez" and "jose ramirez" are the same name.
 */
export function normalizeName(name: string): string {
  return String(name || '')
    .normalize('NFD')
    .toLowerCase()
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * A STABLE 0..1 FROM A STRING, so "a bit different for each person" is a
 * PROPERTY OF THE PERSON rather than a roll of the dice.
 *
 * Everything that varies per node below -- how far out they sit, which way their
 * line bows and by how much -- is derived from their key. That is the whole
 * difference between a drawing with character and a drawing that is jittering:
 * Caleb is always exactly where Caleb is, at every render, through a filter and
 * back, on a cold start, on a new phone. Math.random() here would make the web
 * twitch on every keystroke that re-renders the page, which is much worse than
 * the tabular look it was trying to fix.
 */
export function hash01(key: string): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i += 1) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  /**
   * THE FINALIZER, AND IT IS NOT OPTIONAL HERE.
   *
   * Plain FNV-1a mixes its LOW bits well and its high bits poorly, and dividing
   * by 2^32 reads the high ones. On keys that differ only in a trailing digit --
   * which is exactly what a list of node keys looks like -- 200 values collided
   * 41 times at four decimal places instead of the two you would expect by
   * chance. The visible consequence is the bug this whole change exists to fix:
   * a clustered hash gives clustered strays and bows, so the nodes drift into
   * the same handful of offsets and the ring goes back to looking stamped out.
   *
   * murmur3's avalanche step, which is what it is for.
   */
  h ^= h >>> 16;
  h = Math.imul(h, 2246822507);
  h ^= h >>> 13;
  h = Math.imul(h, 3266489909);
  h ^= h >>> 16;
  // >>> 0 for an unsigned 32-bit value; the division puts it in [0, 1).
  return (h >>> 0) / 4294967296;
}

/** A stable -1..1, for anything that varies in two directions. */
function signed(key: string): number {
  return hash01(key) * 2 - 1;
}

/**
 * HOW FAR A NODE STRAYS FROM THE PERFECT RING, and how far a line bows.
 *
 * Small on purpose. The complaint was that the ring read as tabular, not that it
 * read as tidy: past about a tenth the drawing stops being a system somebody is
 * at the middle of and starts being a scatter. These numbers are the largest
 * that still leave the ring legible as a ring.
 */
const RADIUS_JITTER = 0.05;
/** Connections pulled in, suggestions pushed out. This one MEANS something. */
/**
 * How far in a connection is pulled, and how far out an invite is pushed, as a
 * fraction of the ring's radius.
 *
 * RAISED FROM 0.06, which was a wobble rather than a statement -- six percent
 * of a ring is a few points on a phone and read as noise beside the jitter. At
 * fourteen the ring visibly has an inside and an outside, which is the thing
 * the drawing is for.
 */
const KIND_PULL = 0.14;
const MAX_STRAY = RADIUS_JITTER + KIND_PULL;
/**
 * HOW MUCH THE WEB TWISTS: TURNS OF THE RING PER UNIT OF NORMALIZED RADIUS.
 *
 * "They can be crisscrossing and going all over the place, not crisscrossing
 *  per se in terms of the lines, but curving around and going all over the
 *  place. They can be creatively all over the place, as long as the icons don't
 *  overlap and the lines don't cross."
 *
 * Straight rays satisfied the no-crossing half and threw away the drawing; the
 * per-person bow before them did the opposite. This is the shape that gets both,
 * and it is a proof rather than a tuning.
 *
 * EVERY POINT IN THE WEB IS (radius, arc position). `radius` is a fraction of
 * the board; `arc position` is a fraction of the way round the ring, measured
 * along the PERIMETER -- see unitEllipseAt. That pair is a coordinate system:
 * the unit ellipse is star-shaped about the middle, so a direction picks out
 * exactly one arc position and the distance then picks out exactly one radius.
 * (r, s) and the point on the board are the same information.
 *
 * A node sits at (f, s). Its line is the locus
 *
 *   s(r) = s - S x (f - r)      for r from where the line starts out to f
 *
 * which is the SAME spiral for every node, shifted along s by that node's own
 * phase p = s - S x f. So two curves share a point only if BOTH
 *
 *   1. their phases are equal, and
 *   2. their radius intervals overlap
 *
 * and it takes only one of those to fail. The layout breaks a different one on
 * each side of the problem, which is why neither has to be tuned:
 *
 *   TWO NODES ON ONE RING break (1). Their arc positions are exactly 1/m apart
 *   and the lean is capped so it can never close half of that -- see
 *   leanCapForPhases.
 *
 *   TWO NODES ON DIFFERENT RINGS break (2). A line from an outer ring is a stub
 *   that starts outside the whole reach of the ring inside it -- see withSpokes
 *   -- so the inner ring's lines and the outer ring's lines live in annuli that
 *   do not touch, whatever their phases happen to be.
 *
 * ringOffsets rotates the rings to keep near-equal phases apart anyway. That is
 * ABOUT THE PICTURE, NOT THE PROOF: two lines with nearly equal phases at
 * different radii never meet, but they are parallel, and a web of parallel lines
 * looks like a comb. It is stated as aesthetics there rather than dressed up as
 * a third guarantee.
 *
 * WHY ARC LENGTH AND NOT ANGLE, WHICH IS WHAT THIS USED TO BE. The identical
 * argument works on the parametric angle, and it looked fine on paper and wrong
 * on the phone. Adding a constant to an ellipse's parametric angle is not a
 * rotation: it slides points along the curve, and because arc length is not
 * linear in the parameter it destroys equal spacing. Measured on a twelve-person
 * ring: gaps of 71-76pt without the twist, 52-98pt with it. Shifting an
 * arc-length coordinate cannot do that, because equal spacing in s IS equal
 * spacing on the curve, at any stretch, before the shift and after it.
 *
 * 0.18 of a turn over the full radius is about 65 degrees of sweep from the
 * middle to the rim -- enough that the web reads as turning rather than as a
 * wheel, and short of the point where a line spends so long going sideways that
 * you cannot tell which node it belongs to.
 */
export const SPIRAL_S = 0.18;
/**
 * How many segments approximate one spiral.
 *
 * Higher than it looks like it needs to be because spiralPath TRIMS the far end
 * back to the disc's edge a whole sample at a time, so a short stub can lose a
 * third of its points to the trim and still need to read as a curve.
 */
const SPIRAL_STEPS = 22;

/**
 * THE LINES ARE STRAIGHT NOW. MAX_BOW is 0 and stays exported.
 *
 * "Nothing should be overlaying. Not even lines should be crossing."
 *
 * Every spoke is a ray from one point, so two of them can only ever cross if
 * something bends them -- and something did. Each line carried a bow derived
 * from the person's key, on the argument that "eleven perfectly straight radial
 * spokes read as a diagram of a wheel", and it worked: neighbors curved away
 * from each other and the drawing had a hand. It also means two adjacent lines
 * bowing toward each other MUST intersect, which is exactly what he is looking
 * at.
 *
 * Straight radial rays from a common center cannot cross. That is the whole
 * argument, and it beats the one for character.
 *
 * KEPT AS A ZERO CONSTANT rather than deleted: components/ConnectionsWeb still
 * reads it to size the curve's control point, the arithmetic degrades to a
 * straight line at zero, and this is the one place the decision is written down.
 */
export const MAX_BOW = 0;
/** A suggestion's disc, against a connection's. */
const SUGGESTION_SCALE = 0.78;

export type Placed = {
  person: WebPerson;
  x: number;
  y: number;
  d: number;
  /**
   * THE NAME TO DRAW, ALREADY DECIDED. Empty when this node lost its label to a
   * collision -- see resolveLabels, which is the only thing that sets it.
   *
   * Decided in the layout rather than in the component because it is a question
   * about the WHOLE web: whether this name fits depends on where every other
   * node and every other name ended up. A component rendering one node cannot
   * know that, which is why the old per-node width estimate let names overlap.
   */
  label: string;
  /** The node's own footprint: the disc, or the label if the label is wider. */
  labelWidth: number;
  /** Whether the name is drawn above the disc rather than below it. */
  labelAbove: boolean;
  /**
   * WHICH RING THIS NODE IS ON: 0 is the outer one, 1 the inner.
   *
   * Carried explicitly because it CANNOT be inferred from the distance to the
   * middle. On a stretched ring the radius varies continuously between rx and
   * ry, so an outer node at the side sits closer to the center than an inner
   * node at the top -- and code (or a test) that groups nodes by radius gets
   * nonsense. That inference was wrong in the first version of both.
   */
  ring: number;
  /**
   * THIS NODE'S LINE, as points in the same space as x and y.
   *
   * A SPIRAL, and it is precomputed here rather than drawn from a formula in the
   * component for one reason: the no-crossing property is a property of these
   * points, so the test has to be able to read the actual geometry rather than
   * re-deriving it and testing its own arithmetic.
   */
  path: { x: number; y: number }[];
  /**
   * WHERE THIS NODE SITS AROUND ITS RING, as a fraction of the perimeter.
   *
   * The layout's native coordinate, carried rather than recovered. x and y are
   * derived FROM this (see unitEllipseAt) and inverting them back is both lossy
   * and pointless -- and it is what the previous version did, which meant the
   * curve and the node it ends at were computed two different ways and could
   * disagree. These two numbers are the single source for both.
   */
  arcS: number;
  /** And how far out, as a fraction of the board. The other half of the pair. */
  radiusF: number;
  /**
   * WHERE THIS NODE'S LINE STARTS, as a distance from the middle.
   *
   * Not always the hub's edge. A spoke drawn from the hub to an outer ring
   * crosses every ring inside it, and on a four-ring web that is a line through
   * a dozen names -- "not even lines should be crossing". A node on an outer
   * ring gets a SHORT radial stub instead: the same visual length as an inner
   * node's full spoke, pointing at the middle, stopping before it reaches the
   * traffic.
   */
  spokeFrom: number;
};

/** Any real number brought into [0, 1), so an arc position can be shifted freely. */
export function wrap01(v: number): number {
  return ((v % 1) + 1) % 1;
}

/** Distance between two arc positions the short way round the ring. */
export function circDist(a: number, b: number): number {
  const raw = Math.abs(wrap01(a) - wrap01(b));
  return Math.min(raw, 1 - raw);
}

/**
 * THE UNIT ELLIPSE, PARAMETERIZED BY ARC LENGTH.
 *
 * `at(s)` is the point a fraction s of the way around an ellipse of width 1 and
 * half height `ratio`, measured along the PERIMETER rather than by angle.
 *
 * WHY THE WHOLE LAYOUT MOVED INTO THIS SPACE. The twist (see SPIRAL_S) adds a
 * constant to each node's position so that every line is the same spiral
 * rotated. Adding a constant to an ellipse's PARAMETRIC angle is not a rotation
 * -- it slides points along the curve, and since arc length is not linear in the
 * parameter, it destroys equal spacing. Measured: a twelve-person ring went from
 * gaps of 71-76pt to gaps of 52-98pt, which is most of "these are still very
 * jumbled".
 *
 * Shifting an ARC-LENGTH coordinate cannot do that. Equal spacing in s is equal
 * spacing on the curve, before the twist and after it, at any ratio.
 *
 * MEMOIZED BY RATIO because every ring of a given web is a scaled copy of one
 * ellipse, so the 720-sample walk happens once per web rather than once per
 * ring. Rounded to three places so floating-point noise cannot miss the cache.
 */
const arcTables = new Map<string, (s: number) => { x: number; y: number }>();

export function unitEllipseAt(ratio: number): (s: number) => { x: number; y: number } {
  const key = ratio.toFixed(3);
  const hit = arcTables.get(key);
  if (hit) return hit;

  const SAMPLES = 1440;
  const at = (t: number) => ({ x: Math.sin(t), y: -ratio * Math.cos(t) });
  const cum: number[] = [0];
  let prev = at(0);
  for (let i = 1; i <= SAMPLES; i += 1) {
    const q = at((i / SAMPLES) * 2 * Math.PI);
    cum.push(cum[i - 1]! + Math.hypot(q.x - prev.x, q.y - prev.y));
    prev = q;
  }
  const total = cum[SAMPLES]! || 1;

  const fn = (sRaw: number) => {
    // Wrapped, so a twist can carry a node past the top without a discontinuity.
    const s = ((sRaw % 1) + 1) % 1;
    const target = s * total;
    // Binary search rather than the old forward scan: callers no longer arrive
    // in increasing order once the twist is applied, so a cursor would walk the
    // table from the start on most lookups.
    let lo = 0;
    let hi = SAMPLES;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cum[mid + 1]! < target) lo = mid + 1;
      else hi = mid;
    }
    const span = cum[lo + 1]! - cum[lo]!;
    const frac = span > 0 ? (target - cum[lo]!) / span : 0;
    return at(((lo + frac) / SAMPLES) * 2 * Math.PI);
  };
  arcTables.set(key, fn);
  return fn;
}

/**
 * Where each person sits, and how big they are.
 *
 * THE COUNT CHANGES THE DRAWING, which is what makes a filter feel like it did
 * something. Three people get large discs on one orbit and look deliberate;
 * twelve get smaller discs on two interleaved orbits. Pressing Work on a
 * twenty-person web does not just hide seventeen nodes, it re-forms the
 * remaining three into their own arrangement at their own size.
 *
 * Starting at `-90deg` puts the first node at the top, so a two-person web is
 * top and bottom rather than left and right: a horizontal pair reads as a
 * comparison, and these people are not being compared.
 */
/**
 * THE PEOPLE YOU ARE ACTUALLY CONNECTED TO HOLD THE WHOLE RING.
 *
 * sortPeople puts connections first so the real people take the top of the ring,
 * and the layout then hands out slots in order -- so three connections and eight
 * suggestions put all three connections in consecutive slots and the web became
 * a corner of real people with a long tail of gray ones. The two things it is
 * supposed to say, "here are your people" and "here is who you could add", were
 * being said by two separate halves of a circle.
 *
 * Connections are dealt to evenly-spaced slots first and the suggestions fill in
 * around them. Three connections on an eleven-slot ring sit at roughly twelve,
 * four and eight o'clock, so the ring is anchored by real people wherever the
 * eye lands, and the invites read as the gaps between them -- which is what they
 * are.
 *
 * Order within each kind is preserved, so this stays a pure rearrangement of
 * sortPeople's stable order and the ring does not reshuffle between renders.
 */
export function arrangeAroundRing(people: WebPerson[]): WebPerson[] {
  const conns = people.filter((p) => p.kind === 'connection');
  const suggs = people.filter((p) => p.kind !== 'connection');
  const n = people.length;
  // Nothing to interleave: one kind only.
  if (conns.length === 0 || suggs.length === 0) return [...people];

  const slots: (WebPerson | null)[] = new Array(n).fill(null);
  for (let i = 0; i < conns.length; i += 1) {
    let at = Math.round((i * n) / conns.length) % n;
    // round() can land twice on the same slot when the counts are close. Walk
    // forward rather than dropping somebody on the floor.
    let guard = 0;
    while (slots[at] !== null && guard < n) {
      at = (at + 1) % n;
      guard += 1;
    }
    slots[at] = conns[i]!;
  }
  let si = 0;
  for (let i = 0; i < n; i += 1) if (slots[i] === null) slots[i] = suggs[si++]!;
  return slots as WebPerson[];
}

/**
 * HOW MANY RINGS, AND HOW MANY PEOPLE ON EACH.
 *
 * "The web needs to be spaced out much better. Everything is scrunched up. Make
 *  it a visually appealing spatial web."
 *
 * The old answer was one ring up to twelve and TWO rings after that, whatever
 * the number -- which was fine when the ring held at most twenty and is
 * hopeless now that it holds everybody in every circle. Forty people on two
 * rings is twenty per ring, and twenty labeled discs on one ellipse on a phone
 * is a smear.
 *
 * SO THE RINGS ARE DERIVED FROM THE ROOM. Each ring has a perimeter; a node
 * needs its disc plus a gap of arc; the ring holds as many as fit and the rest
 * go inward. Nothing is hardcoded about how many rings there are -- a person
 * with nine connections gets one, a person with ninety gets four, and neither
 * is a special case anybody wrote.
 *
 * OUTSIDE IN, because the outer ring is the longest and the eye reads it first:
 * filling it first puts the most people where there is the most room.
 *
 * RAMANUJAN'S APPROXIMATION for the ellipse perimeter. The exact figure is an
 * elliptic integral, this is within a hundredth of a percent for anything less
 * eccentric than a needle, and being slightly conservative about how much room
 * a ring has is the safe direction to be wrong in.
 */
export function ellipsePerimeter(a: number, b: number): number {
  if (!(a > 0) || !(b > 0)) return 0;
  return Math.PI * (3 * (a + b) - Math.sqrt((3 * a + b) * (a + 3 * b)));
}

/**
 * YOUR OWN DISC IN THE MIDDLE.
 *
 * IT LIVES HERE, NOT IN THE COMPONENT, because the innermost ring's position is
 * computed from it -- see minRingFactor. While the formula sat in Board and the
 * ring floor was the constant 0.34 below, the two could disagree, and they did:
 * on the profile card the hub came out 92pt across (radius 46) and the inner
 * ring landed at 40pt, so the first ring of people was drawn INSIDE your own
 * face. That is the node sitting on top of the K in his screenshot.
 *
 * 0.66 -> 0.42 as well. Two thirds of the ring radius makes you the largest
 * object in the drawing by a wide margin, which crowds the ring before anything
 * else has been placed and is the wrong claim anyway: the web is about the
 * people in it.
 */
export function hubDiameter(rx: number, ry: number): number {
  const shorter = Math.min(rx, ry);
  if (!(shorter > 0)) return 56;
  return Math.round(Math.max(56, Math.min(shorter * 0.42, 108)));
}

/**
 * THE INNERMOST A RING MAY SIT, and it is derived rather than guessed.
 *
 * A ring closer in than your own disc plus half a node plus a gap draws people
 * on top of you. The old constant 0.34 was a guess at that clearance made when
 * the hub was a different size, and it was wrong by six points on the card.
 *
 * Clamped at the top so a huge hub on a tiny board cannot push the floor past
 * the outer ring and leave nowhere at all to put anybody.
 */
export function minRingFactor(bx: number, by: number, d: number, hubRadius: number): number {
  const shorter = Math.min(bx, by);
  if (!(shorter > 0)) return 0.34;
  const clearance = hubRadius + d / 2 + RING_GAP;
  return Math.min(0.8, Math.max(0.2, clearance / shorter));
}

/** Air between your disc and the nearest node, and between one ring and the next. */
const RING_GAP = 14;
/**
 * How much wider the ring step is than the bare minimum, so the STRAY has room.
 *
 * A step of exactly one disc plus a gap separates two rings only if every node
 * sits exactly on its ring, and none of them do -- each one is nudged in or out
 * by the kind pull and the jitter. Two adjacent rings both straying toward each
 * other close that gap from both sides, which is how "Sugg 17 and Conn 1
 * overlap by 9.2pt" happens on a web with no crowding at all.
 *
 * The headroom is what the stray is then clamped to fit inside; see strayPtsFor.
 * 1.45 is a step-and-a-half in round numbers -- enough that a node can lean
 * without leaving its lane.
 */
const RING_STEP_HEADROOM = 1.45;

/**
 * How far, IN POINTS, a node on this ring may stray from it.
 *
 * Half the slack the step leaves after a disc and a gap are accounted for, so
 * two neighboring rings straying fully toward each other still clear. Zero when
 * there is no slack, which is the honest answer on a board too small to lean in.
 */
export function strayPtsFor(stepPts: number, d: number): number {
  return Math.max(0, (stepPts - d - RING_GAP) / 2);
}
/**
 * How much room one node wants along its ring, in disc-widths.
 *
 * 1.85 -> 2.7, and the number is now about the LABEL rather than the disc. A
 * disc is 30-40pt and a full name is 70-90; at 1.85 each node got about 74pt of
 * arc, so two names side by side overlapped more often than not and the
 * collision resolver answered by deleting one of them. Thirty-three people came
 * out with thirteen names.
 *
 * More arc per node is the honest fix -- "they should be spaced out well" -- and
 * it costs nothing but canvas, which boardForCount already grows and the overlay
 * already pans.
 */
export const ARC_PER_NODE = 2.7;
/**
 * AND HOW MUCH IT WANTS WHEN NOBODY'S NAME IS DRAWN.
 *
 * The number above is about the label, and on the profile card there are no
 * labels -- "names off on the card and on in the overlay". So the card was
 * reserving 2.7 disc-widths of arc per node to hold a name it does not draw,
 * which is not conservative, it is just wrong: it made the card think it had
 * room for a third of the people it can actually fit, and since ringPlan hands
 * the overflow to the outer ring anyway (see the note at its end), the result
 * was thirty-three faces jammed onto one ring with 7.8pt of overlap.
 *
 * A bare disc needs its own width plus air. 1.45 is a disc and just under half
 * a disc between neighbors -- clearly separated at a glance, and it roughly
 * doubles what the card holds.
 */
export const ARC_PER_NODE_BARE = 1.45;

export function ringPlan(
  n: number,
  bx: number,
  by: number,
  d: number,
  /**
   * How close the innermost ring may come, as a fraction of the board. Defaults
   * to the old constant so a caller that has no hub (a test, a future surface
   * with nothing in the middle) behaves as before.
   */
  minFactor = 0.34,
  /** Disc-widths of arc each node needs. See ARC_PER_NODE / _BARE. */
  arcPerNode = ARC_PER_NODE,
): { factor: number; count: number }[] {
  if (n <= 0) return [];

  /**
   * STEP ONE: HOW MANY RINGS. Add one at a time, shrinking inward, until they
   * can hold everybody between them.
   */
  const rings: { factor: number; capacity: number }[] = [];
  let capacity = 0;
  let factor = 1;
  while (factor >= minFactor && rings.length < 6) {
    const room = ellipsePerimeter(bx * factor, by * factor);
    const fits = Math.max(1, Math.floor(room / (d * arcPerNode)));
    rings.push({ factor, capacity: fits });
    capacity += fits;
    if (capacity >= n) break;
    /**
     * THE STEP INWARD IS A DISC PLUS A GAP, NOT A CONSTANT 0.24.
     *
     * A fraction of the board is a different number of POINTS on every board,
     * and on a small one 0.24 came out at 37pt -- less than the 40pt disc it had
     * to separate. Eighteen people produced four overlapping pairs, which is the
     * "on top of each other" in the screenshot, and no test saw it because the
     * only overlap check looked at a single ring.
     *
     * Derived, the two rings are always a disc and a gap apart whatever the
     * board. The floor stops a huge disc on a tiny board from stepping straight
     * past the middle and leaving one ring holding everybody.
     */
    factor -= Math.max(0.16, RING_STEP_HEADROOM * ((d + RING_GAP) / Math.max(1, Math.min(bx, by))));
  }

  /**
   * STEP TWO: SPREAD THEM ACROSS THOSE RINGS IN PROPORTION TO THE ROOM, rather
   * than filling the outer one to capacity and leaving the inner one sparse.
   *
   * The first version did the greedy thing and it looked wrong on screen:
   * eighteen people came out as fourteen crammed on the outside and four
   * rattling around the inside, which is a "scrunched" outer ring AND a
   * pointless inner one. Proportional gives eleven and seven -- both rings
   * comfortable, and the drawing reads as deliberate.
   *
   * Largest-remainder, so the rounding does not lose or invent a person: the
   * counts sum to exactly n.
   */
  const shares = rings.map((r) => (n * r.capacity) / Math.max(1, capacity));
  const plan = rings.map((r, i) => ({ factor: r.factor, count: Math.floor(shares[i]!) }));
  let placed = plan.reduce((sum, r) => sum + r.count, 0);
  const byRemainder = shares
    .map((sh, i) => ({ i, rem: sh - Math.floor(sh) }))
    .sort((a, b) => b.rem - a.rem);
  let k = 0;
  while (placed < n && byRemainder.length > 0) {
    plan[byRemainder[k % byRemainder.length]!.i]!.count += 1;
    placed += 1;
    k += 1;
  }

  /**
   * AND IF THE RINGS RAN OUT -- six of them, on a board that did not grow --
   * whatever is left goes on the outermost one. Crowding it is better than
   * dropping somebody the pill has already counted, and boardForCount is what
   * stops this happening in the app.
   */
  if (placed < n && plan.length > 0) plan[0]!.count += n - placed;
  return plan.filter((r) => r.count > 0);
}

/**
 * HOW BIG THE BOARD HAS TO BE to hold this many people without crowding.
 *
 * THE PHONE IS NOT BIG ENOUGH, AND THAT IS THE POINT. A hundred people at a
 * tappable disc size need roughly 5,500 points of arc; a 150x210 board offers
 * about 2,600 across every ring it can fit. Something has to give, and the three
 * candidates are: draw them smaller (a test forbids it -- below 30pt a disc is
 * not reliably tappable), draw them on top of each other (which is the
 * "scrunched" complaint), or make the board bigger and let the web be panned.
 *
 * The third is the only honest one, and it is also what somebody means by a
 * spatial web: a large drawing you move around in rather than a small one that
 * has been compressed until it fits.
 *
 * So this returns the size the drawing WANTS. A caller with a fixed frame (the
 * small card on the profile) can ignore it and show a subset; the expanded
 * overlay uses it and scrolls.
 *
 * Grows with the square root of the count, because area grows with the square
 * of the radius -- doubling the people needs about 1.4x the radius, not 2x.
 */
export function boardForCount(
  n: number,
  screen: { rx: number; ry: number },
): { rx: number; ry: number } {
  if (n <= SINGLE_ORBIT_MAX) return screen;
  /**
   * GROWN AGAINST THE LABEL, NOT THE DISC.
   *
   * sqrt(n / 12) was sized for bare discs. With names on, each node needs about
   * a hundred points of arc rather than seventy, so the same crowd needs
   * meaningfully more canvas -- and the alternative, which the collision
   * resolver reached for on its own, is deleting two thirds of the names.
   * Dividing by 7 rather than 12 is that difference, and the ceiling comes up
   * with it. It costs canvas; the overlay pans.
   */
  const scale = Math.min(4, Math.sqrt(n / 7));
  return { rx: Math.round(screen.rx * scale), ry: Math.round(screen.ry * scale) };
}

/**
 * THE MOST PEOPLE A BOARD CAN HOLD WITHOUT ANYBODY TOUCHING.
 *
 * "Nothing should be touching other circles."
 *
 * ringPlan, by design, puts the overflow on the outer ring when the rings run
 * out -- "crowding it is better than dropping somebody the pill has already
 * counted, and boardForCount is what stops this happening in the app". That is
 * true of the OVERLAY, whose board grows and pans. It is not true of the profile
 * card, which is a fixed square: thirty-three people on a 330pt card came out as
 * one ring with 7.8pt of overlap, and forty-eight as 14.7pt. The crowding note
 * was right about the mechanism and wrong that there was only one caller.
 *
 * So a fixed-size surface asks first. Same planner, same disc floor, same arc
 * requirement -- the answer is whatever ringPlan would actually fit, which is
 * the only number that cannot disagree with the layout that follows.
 *
 * THE FLOOR DISC, because that is the honest maximum: nodes shrink as the web
 * fills and stop at 30pt, so 30 is the size at which the most of them fit.
 */
export function webCapacity(rx: number, ry: number, opts: { labels?: boolean } = {}): number {
  if (![rx, ry].every((r) => Number.isFinite(r) && r > 0)) return 0;
  const bx = rx / (1 + MAX_STRAY);
  const by = ry / (1 + MAX_STRAY);
  const d = 30;
  const arcPerNode = opts.labels === false ? ARC_PER_NODE_BARE : ARC_PER_NODE;
  const minFactor = minRingFactor(bx, by, d, hubDiameter(rx, ry) / 2);

  // The same walk ringPlan does, summing capacity instead of dealing people.
  let total = 0;
  let factor = 1;
  let rings = 0;
  while (factor >= minFactor && rings < 6) {
    const room = ellipsePerimeter(bx * factor, by * factor);
    total += Math.max(1, Math.floor(room / (d * arcPerNode)));
    rings += 1;
    factor -= Math.max(0.16, RING_STEP_HEADROOM * ((d + RING_GAP) / Math.max(1, Math.min(bx, by))));
  }
  return total;
}

export function layoutWeb(
  inputPeople: WebPerson[],
  rx: number,
  ry: number = rx,
  /**
   * WHETHER NAMES ARE DRAWN, because it changes how much room a node needs.
   *
   * Defaulted to true, which is the labeled overlay and the conservative answer
   * -- a caller that forgets reserves too MUCH space rather than too little.
   */
  opts: { labels?: boolean } = {},
): Placed[] {
  const n = inputPeople.length;
  if (n === 0) return [];
  if (![rx, ry].every((r) => Number.isFinite(r) && r > 0)) return [];
  const arcPerNode = opts.labels === false ? ARC_PER_NODE_BARE : ARC_PER_NODE;

  const people = arrangeAroundRing(inputPeople);

  // The base ring is shrunk by the furthest anybody strays outward, so a node
  // pushed out still lands inside the board it was given.
  const bx = rx / (1 + MAX_STRAY);
  const by = ry / (1 + MAX_STRAY);

  /**
   * DISC SIZE COMES OFF THE FULL BOARD, NOT THE SHRUNK BASE RING.
   *
   * Sizing it off `bx`/`by` made every disc 10% smaller the moment the stray was
   * introduced, and since a suggestion's disc is a fraction of a connection's it
   * hit the 30pt tap floor and the two kinds ended up 34 and 30 -- a distinction
   * nobody could see. The ring being pulled in does not make the screen smaller.
   */
  const shorter = Math.min(rx, ry);
  /**
   * DISC SIZE FALLS AWAY AS THE RING FILLS, and it now has steps past twenty.
   *
   * It used to stop at "more than twelve", which was every crowded web -- so
   * forty people were drawn at the same size as thirteen and overlapped.
   *
   * THE FLOOR STAYS AT 30, and a test enforces it: below that the disc is not
   * reliably tappable, and the honest way to fit more people is more RINGS, not
   * smaller targets. ringPlan does that -- a smaller disc simply lets each ring
   * hold more before the next one opens.
   */
  const big =
    n <= 2 ? 0.46
    : n <= 5 ? 0.36
    : n <= SINGLE_ORBIT_MAX ? 0.30
    : n <= 20 ? 0.23
    : n <= 32 ? 0.19
    : n <= 50 ? 0.16
    : 0.13;
  /**
   * AND CAPPED IN ABSOLUTE POINTS ONCE THE WEB IS CROWDED.
   *
   * `big` is a FRACTION of the board, which is right while the board is the
   * screen -- two friends should be drawn large. It stops being right the moment
   * boardForCount grows the board for a crowd: a bigger board then produced
   * bigger discs, the extra room was spent on the faces rather than on the gaps
   * between them, and a hundred people overlapped on a canvas three times the
   * size of the phone. Which is the same "scrunched", just further out.
   *
   * So past a single orbit the disc has a ceiling as well as a floor, and every
   * point the board grows by goes into space between people.
   */
  const cap = n <= SINGLE_ORBIT_MAX ? Number.POSITIVE_INFINITY : 40;
  const d = Math.max(30, Math.min(cap, Math.round(shorter * big)));

  /**
   * A LABEL MAY NOT BE WIDER THAN THE ROOM TO ITS NEIGHBOR.
   *
   * This is the other half of the jumble: names were a flat 92pt wide whatever
   * the spacing, so on a crowded ring "Anish Ravindra" ran straight through
   * "Beau La Du".
   *
   * MEASURED AS A STRAIGHT-LINE DISTANCE, NOT AS THE ARC STEP. The first attempt
   * used the arc step, which is uniform by construction and therefore looks like
   * the right number -- but two labels collide across the CHORD between their
   * nodes, and on a stretched ring the chord is meaningfully shorter than the arc
   * wherever the curve is tightest. Sizing labels by the arc overruns the tight
   * spots by the exact amount the curve bends, which is where the names were
   * touching in the first place.
   */
  /**
   * THE RATIO THE WHOLE WEB IS LAID OUT ON. One ellipse; every ring is a scaled
   * copy of it, which is why one arc-length table serves all of them.
   */
  const ratio = bx > 0 ? by / bx : 1;
  const arcAt = unitEllipseAt(ratio);
  /** A node's own phase: the arc position its spiral would have at radius 0. */
  const phaseOf = (s: number, f: number) => wrap01(s - SPIRAL_S * f);

  const leanOf = (() => {
    /**
     * EACH PERSON A LITTLE OFF THE PERFECT RING, and the offset means something.
     *
     * Every node at an identical radius is what made this read as tabular -- a
     * pie chart of people rather than a web. The stray is two parts, and only
     * one of them is decoration:
     *
     *   KIND_PULL     a connection sits nearer you and a suggestion further out.
     *                 That is the drawing saying the true thing: these are the
     *                 people you have, those are the people you could have.
     *   RADIUS_JITTER a stable wobble from the person's own key, so no two sit
     *                 at quite the same distance and the ring stops looking
     *                 stamped out.
     *
     * SCALED ALONG THE RAY, not offset in x and y independently, so the node
     * stays on its own spoke's line. Moving it sideways would make the line
     * point somewhere the person is not, which is the one thing a web must not
     * do.
     */
    /**
     * THE PEOPLE YOU ACTUALLY HAVE SIT NEARER YOU.
     *
     * "Make the people you're actually connected with on Amber come closer to
     *  you on the web, as opposed to the ones you're not connected with."
     *
     * Keyed on `connected`, NOT on `kind`. Since solid now means "on Amber",
     * pulling on `kind` would put somebody whose card merely resolved to an
     * account as close as a real connection -- which is the distinction the
     * drawing exists to make. Three distances, not two:
     *
     *   connected      pulled IN.  You have them.
     *   on Amber       neutral.    You could have them, easily.
     *   not on Amber   pushed OUT. They are not here yet.
     */
    const pullFor = (person: WebPerson) =>
      person.connected ? -KIND_PULL : person.amberId ? 0 : KIND_PULL;
    /**
     * AND IT IS RELATIVE, WHICH IS THE PART THE FIRST VERSION GOT WRONG.
     *
     * Pulling every connection inward by a flat fraction shrinks a web made
     * ENTIRELY of connections -- which is the web of anybody the app is working
     * for. Measured: eighteen connections all landed between 0.54 and 0.76 of
     * the board, the whole drawing sitting in the middle with the outer third
     * empty. "Nearer you" is a comparison, so it has to be measured against the
     * other people on the ring rather than against the ring itself.
     *
     * Subtracting the ring's mean pull keeps its average radius where the plan
     * put it. A ring of all connections fills its ring; a mixed ring separates
     * into an inside and an outside; a ring of all invites fills it too, and
     * sits further out only because of which ring the planner gave it.
     */
    /**
     * HOW FAR OUT EACH PERSON ON A RING ACTUALLY SITS, as a fraction of the
     * board. Radius only -- no arc position, no coordinates.
     *
     * SPLIT OUT FROM THE PLACEMENT because the two now depend on each other in
     * the other direction: a node's curve-phase is (arc position - S x radius),
     * and keeping those phases apart between rings is done by ROTATING a whole
     * ring (see ringOffsets), which needs every radius on every ring in hand
     * before the first arc position is chosen. Radii first, then offsets, then
     * points.
     */
    const shorterLocal = Math.min(bx, by) || 1;
    return (list: WebPerson[], factor: number, strayPts: number): number[] => {
      const mean = list.reduce((sum, p) => sum + pullFor(p), 0) / Math.max(1, list.length);
      return list.map((person) => {
        const want = (pullFor(person) - mean) + signed(`${person.key}:r`) * RADIUS_JITTER;
        const leanPts = Math.max(-strayPts, Math.min(strayPts, want * factor * shorterLocal));
        return Math.max(0, factor + leanPts / shorterLocal);
      });
    };
  })();

  /**
   * A RING'S NODES, AT EVEN ARC POSITIONS, ROTATED BY THAT RING'S OFFSET.
   *
   * Two things are true here that were not true before, and between them they
   * are the fix for "these are still just very jumbled":
   *
   *   * THE NODES ARE EXACTLY EVENLY SPACED. i/m, in arc length, full stop. No
   *     twist is applied to a node's position at all -- the twist lives in the
   *     LINE, which sweeps back from the node as it runs inward. So the ring is
   *     perfectly regular and the drawing still turns.
   *   * THE CURVE IS DERIVED FROM THE NODE, not alongside it. arcS and radiusF
   *     are carried on Placed and spiralPath reads them, so the line provably
   *     ends on the face it points at.
   */
  const place = (
    fs: number[],
    offset: number,
    list: WebPerson[],
    ring: number,
  ): Placed[] => {
    const m = list.length;
    const moved = fs.map((f, i) => {
      const s = wrap01(i / m + offset);
      const u = arcAt(s);
      return { s, f, x: bx * f * u.x, y: bx * f * u.y };
    });

    return moved.map((p, i) => {
      const person = list[i]!;
      const prev = moved[(i - 1 + moved.length) % moved.length]!;
      const next = moved[(i + 1) % moved.length]!;
      // MEASURED AFTER THE STRAY, so the label still cannot reach its neighbor.
      // Sizing labels off the tidy ring and then moving the nodes would put two
      // names back on top of each other, which is the bug this replaced.
      const nearest =
        moved.length < 2
          ? Number.POSITIVE_INFINITY
          : Math.min(Math.hypot(p.x - prev.x, p.y - prev.y), Math.hypot(p.x - next.x, p.y - next.y));
      // A suggestion's disc is smaller, so the people you actually have carry
      // more of the drawing. Floored, because a node has to stay tappable.
      const size = person.kind === 'connection' ? d : Math.max(30, Math.round(d * SUGGESTION_SCALE));
      return {
        person,
        x: p.x,
        y: p.y,
        d: size,
        ring,
        // Filled in by resolveLabels once the whole board is placed; a single
        // node cannot answer this. `nearest` is still the starting cap, so a
        // name never gets wider than the room its own neighbor leaves.
        label: '',
        labelAbove: false,
        path: [],
        arcS: p.s,
        radiusF: p.f,
        labelWidth: Math.max(size, Math.min(112, Math.floor(nearest * 0.94))),
        spokeFrom: 0,
      };
    });
  };

  /**
   * THE MOST A RING MAY LEAN BEFORE ITS OWN LINES START TOUCHING EACH OTHER.
   *
   * Two nodes on one ring are 1/m apart in arc position, so their curve-phases
   * (s - S x f) are 1/m apart MINUS whatever the lean did to their radii. Let
   * that difference close all the way and two neighbors' lines become the same
   * spiral -- they would run together for their whole length.
   *
   * Peak-to-peak the lean moves a radius by 2 x lean / shorter, so requiring
   * that to eat no more than half a slot gives lean <= shorter / (4 x S x m).
   * A fourth ceiling on the lean, alongside the two rings either side and the
   * tangential gap, and the only one of the four that is about the LINES rather
   * than the discs.
   *
   * IT IS A BOUND, NOT A FIX, and that is worth being straight about. Logging
   * all four ceilings across every count from one person to a hundred and fifty,
   * this one wins exactly once -- the outer ring of a 150-person web, at 19.2pt
   * against the next ring's 21.7pt -- and deleting it changes the closest
   * approach between any two lines by nothing measurable. The tangential ceiling
   * does NOT imply it in general, though (it allows a lean of P/2m, and this
   * needs shorter/1.4m, and P is about 6x shorter on a round ring), so the two
   * cannot be collapsed. It stays as the thing that makes the same-ring half of
   * the no-crossing argument true by construction rather than by luck.
   *
   * NO TEST IN THE SUITE CAN TELL WHETHER THIS LINE IS HERE. Deleting it leaves
   * every assertion green, and that was checked rather than assumed. Keeping it
   * anyway is a deliberate choice: without it, distinct phases on a ring hold
   * only because some OTHER ceiling happens to bind, which is the kind of
   * accidental correctness that survives until the day somebody widens a ring.
   */
  const leanCapForPhases = (m: number) => {
    const shorterL = Math.min(bx, by) || 1;
    if (m < 2) return Number.POSITIVE_INFINITY;
    return shorterL / (4 * SPIRAL_S * m);
  };

  /**
   * ROTATE EACH RING SO ITS LINES ARE NOT PARALLEL TO THE RINGS INSIDE IT.
   *
   * THIS IS AESTHETICS AND NOT THE NO-CROSSING GUARANTEE. Lines on different
   * rings already cannot meet, because withSpokes keeps their radius intervals
   * disjoint -- see SPIRAL_S for the whole argument. What they CAN do is run at
   * the same phase, and two spirals at the same phase are the same curve seen at
   * two radii: continue one and it becomes the other. A web full of that reads as
   * a comb rather than as a system, which is a milder version of the complaint
   * that started this.
   *
   * ROTATING A WHOLE RING IS FREE, which is what makes it worth doing at all:
   * shifting every arc position on a ring by the same amount moves every phase
   * on it by the same amount and changes NOTHING about the spacing, because the
   * spacing is 1/m either way. So each ring is offered a few rotations within one
   * slot and takes whichever sits furthest from the phases already accepted.
   *
   * THE TARGET IS IN POINTS, not in arc fraction. Two curves a constant delta
   * apart in arc position are delta x perimeter apart on the board, and the
   * perimeter is smallest at the smallest radius any line reaches -- so that is
   * where the requirement is set, and it converts to a fraction from there
   * instead of being a number somebody picked. Best effort: on a five-ring web
   * there are more lines than there is room to separate, and since the guarantee
   * does not live here, falling short only costs a little regularity.
   */
  const ringOffsets = (
    rings: { fs: number[]; natural: number }[],
    innerMostRadius: number,
  ): number[] => {
    const tightest = ellipsePerimeter(bx * innerMostRadius, by * innerMostRadius);
    // Two 1.25pt strokes and a point of air between them.
    const wantSep = tightest > 0 ? Math.min(0.2, LINE_CLEAR / tightest) : 0;
    const accepted: number[] = [];
    return rings.map(({ fs, natural }) => {
      const m = fs.length;
      if (m === 0) return natural;
      const TRIES = 16;
      let best = natural;
      let bestSep = -1;
      for (let k = 0; k < TRIES; k += 1) {
        // Within ONE SLOT, so the ring never rotates far enough to change which
        // part of the drawing it occupies.
        const off = wrap01(natural + k / (TRIES * m));
        let worst = 1;
        for (let i = 0; i < m; i += 1) {
          const p = phaseOf(wrap01(i / m + off), fs[i]!);
          for (const q of accepted) worst = Math.min(worst, circDist(p, q));
        }
        if (worst > bestSep) {
          bestSep = worst;
          best = off;
        }
        if (bestSep >= wantSep) break;
      }
      for (let i = 0; i < m; i += 1) accepted.push(phaseOf(wrap01(i / m + best), fs[i]!));
      return best;
    });
  };

  if (n <= SINGLE_ORBIT_MAX) {
    /**
     * ONE RING, and it is the same machinery as a crowded web rather than a
     * special case -- so a web that grows from eight people to thirteen does not
     * change character at the moment it opens a second ring.
     *
     * The lean is capped against the hub on one side and the board's edge on the
     * other, which is what keeps anybody off your own disc. Nothing is inside
     * this ring but you, so there is no other ring to rotate away from and the
     * offset is simply zero: the first node sits at twelve o'clock.
     */
    const hubR = hubDiameter(rx, ry) / 2;
    const shorterOne = Math.min(bx, by) || 1;
    /**
     * FOUR CEILINGS, and only the first two were ever obvious.
     *
     * A lean is radial, so on a ring with fixed spacing it shortens the CHORD
     * between two neighbors -- two people leaning toward each other by L lose
     * about 2L of the gap between them. Twelve people came out overlapping by
     * 0.4pt with only the first two, which is exactly the "nothing should be
     * touching other circles" complaint at its smallest.
     *
     *   MAX_STRAY       what the board reserved for the lean in the first place
     *   the hub         nothing may reach your own disc
     *   the neighbors   whatever room is left between two people after their
     *                   two discs, halved because both of them move
     *   the lines       see leanCapForPhases -- two neighbors' curves converge
     *                   as their radii diverge, and at the limit they merge
     */
    const arcPer = ellipsePerimeter(bx, by) / Math.max(1, n);
    const oneLean = Math.max(
      0,
      Math.min(
        MAX_STRAY * shorterOne,
        shorterOne - hubR - d / 2 - RING_GAP,
        (arcPer - d) / 2,
        leanCapForPhases(n),
      ),
    );
    return resolveLabels(
      withSpokes(place(leanOf(people, 1, oneLean), 0, people, 0), hubR, bx, by, [
        { factor: 1, count: n },
      ]),
    );
  }

  // THE PLAN KNOWS WHERE YOUR DISC ENDS. Without this the innermost ring is a
  // constant fraction of the board and lands under the hub on a small one.
  const plan = ringPlan(
    n,
    bx,
    by,
    d,
    minRingFactor(bx, by, d, hubDiameter(rx, ry) / 2),
    arcPerNode,
  );
  const buckets: WebPerson[][] = plan.map(() => []);
  /**
   * CONNECTIONS TAKE THE INNER RINGS.
   *
   * The per-node pull above says "nearer" within a ring; on a web with several
   * rings the stronger statement is WHICH RING. Filling from the inside with
   * the people you actually have, then everybody else outward, means the
   * drawing reads at a glance: the middle is your life, the outside is the rest
   * of your address book.
   *
   * PACKED, NOT DEALT, and the previous version did the opposite of its own
   * comment. It stepped one ring outward after EVERY person, round-robin, on the
   * argument that a run of similar names should not stack. With three
   * connections and three rings that deals exactly one connection to each --
   * including the outermost -- so "connections take the inner rings" put one of
   * them as far from the middle as the drawing goes. On screen: Caleb and
   * Shirley beside the K, Sagar out at the rim with the address book.
   *
   * Round-robin was solving a problem the ring already solves. Nodes on one ring
   * are spread by ARC, so alphabetical neighbors are not adjacent in any way a
   * viewer can see; the only thing the deal achieved was scattering the people
   * who are supposed to be closest.
   *
   * So each ring is filled to capacity from the inside out, connections first.
   * The people you actually have land nearest, in order, and everybody else gets
   * the room that is left.
   *
   * plan[0] is the OUTERMOST ring (ringPlan starts at factor 1 and steps in), so
   * "outward" is a decreasing index. That inversion is why the original loop
   * reads as though it moved inward.
   */
  const inner = plan.length - 1;
  /**
   * NO TEST CAN TELL THIS SPLIT FROM `...people`, and it stays anyway.
   *
   * arrangeAroundRing has already run sortPeople, which orders by `kind`, so by
   * the time the list arrives here the connections are in front and deleting
   * this line changes nothing measurable. It is kept because the two orderings
   * are keyed on DIFFERENT fields: sortPeople reads `kind` ("is on Amber") and
   * this reads `connected` ("you two have actually connected"). buildWeb sets
   * them together today, which is the only reason they agree; the day they stop,
   * this line is the one that decides who sits near the middle, and the drawing
   * should follow the finer answer.
   */
  const order = [
    ...people.filter((p) => p.connected),
    ...people.filter((p) => !p.connected),
  ];
  let ring = inner;
  for (const person of order) {
    while (ring > 0 && buckets[ring]!.length >= plan[ring]!.count) ring -= 1;
    // Every ring full: the planner sized for n, so this is overflow rather than
    // a normal state. The outermost ring takes the remainder rather than
    // dropping anybody, because a missing person is worse than a tight rim.
    buckets[ring]!.push(person);
  }

  const hubR = hubDiameter(rx, ry) / 2;
  const shorterB = Math.min(bx, by);
  /** The clearance the innermost ring owes the hub, as a fraction of the board. */
  const hubEdge = (hubR + d / 2 + RING_GAP) / Math.max(1, shorterB);

  /**
   * HOW FAR EACH RING'S NODES MAY LEAN, IN POINTS, inward and outward
   * separately -- because what is inside a ring is not what is outside it.
   *
   * Outward: the next ring out, or the board's own edge.
   * Inward: the next ring in, or YOUR OWN DISC.
   *
   * That last one is the fix for "nothing should be touching the center circle".
   * The planner already puts the innermost ring clear of the hub, and then the
   * lean was allowed to eat that clearance -- which is Shirley, Caleb and Sagar
   * sitting on top of the K. A ring leaning toward another ring gets half the
   * slack, because both of them move; a ring leaning toward the hub gets all of
   * it, because the hub does not.
   *
   * Plus the two ceilings that are not about the rings at all: the room between
   * neighbors ON this ring (a radial lean shortens the chord between them), and
   * the room between their two LINES (see leanCapForPhases).
   */
  const leans = plan.map((ring, r) => {
    const list = buckets[r]!;
    if (list.length === 0) return 0;
    const outerF = r === 0 ? 1 + MAX_STRAY : plan[r - 1]!.factor;
    const innerF = r === plan.length - 1 ? hubEdge : plan[r + 1]!.factor;
    const outSlack = ((outerF - ring.factor) * shorterB - d - RING_GAP) / (r === 0 ? 1 : 2);
    const inSlack =
      ((ring.factor - innerF) * shorterB - (r === plan.length - 1 ? 0 : d + RING_GAP)) /
      (r === plan.length - 1 ? 1 : 2);
    const arcPer = ellipsePerimeter(bx * ring.factor, by * ring.factor) / list.length;
    return Math.max(
      0,
      Math.min(outSlack, inSlack, (arcPer - d) / 2, leanCapForPhases(list.length)),
    );
  });

  /**
   * RADII FIRST, THEN THE ROTATIONS, THEN THE POINTS.
   *
   * THE HALF-STEP ON ALTERNATE RINGS IS GONE, and it is worth saying why rather
   * than just deleting it. It was `r % 2 === 1 ? 0.5 / m : 0`, on the argument
   * that "a node never sits directly outside another one, which is what used to
   * put two names on the same vertical". Measured across every count from one to
   * a hundred and fifty, the closest radial alignment between two nodes on
   * adjacent rings is 0.00 degrees WITH the half-step and 0.00 degrees WITHOUT
   * it -- because adjacent rings hold different numbers of people, so shifting
   * one of them by half of its OWN slot cannot systematically de-align it from a
   * ring divided into a different number of slots. Some pair lands aligned
   * either way. It was a plausible-sounding constant that did nothing, and
   * whatever it was worth, resolveLabels is what actually keeps two names apart.
   *
   * So every ring starts at zero and ringOffsets does the only rotating. That
   * one is measured too: worst-case phase separation goes from 0.00-0.04% of the
   * ring without it to 0.03-0.84% with it, about twenty times better.
   */
  const radii = plan.map((ring, r) => leanOf(buckets[r]!, ring.factor, leans[r]!));
  const offsets = ringOffsets(
    plan.map((_ring, r) => ({ fs: radii[r]!, natural: 0 })),
    hubEdge,
  );

  const placed: Placed[][] = plan.map((_ring, r) => {
    const list = buckets[r]!;
    if (list.length === 0) return [];
    return place(radii[r]!, offsets[r]!, list, r);
  });

  const byKey = new Map<string, Placed>();
  for (const list of placed) {
    for (const item of list) byKey.set(item.person.key, item);
  }
  const out: Placed[] = [];
  for (const person of people) {
    const hit = byKey.get(person.key);
    if (hit) out.push(hit);
  }
  return resolveLabels(withSpokes(out, hubDiameter(rx, ry) / 2, bx, by, plan));
}

/**
 * WHERE EACH LINE STARTS.
 *
 * The innermost ring's spokes reach the hub, because those people ARE attached
 * to you and the drawing should say so. Everything further out gets a stub of
 * the same visual length, pointing inward and stopping short -- so an outer node
 * still reads as radial without dragging a line across three rings of names.
 *
 * A SINGLE ORBIT IS THE EASY CASE and is left alone: with one ring there is
 * nothing between it and the middle, so every line runs the whole way and the
 * web looks like a web.
 */
function withSpokes(
  items: Placed[],
  hubRadius: number,
  bx: number,
  by: number,
  plan: { factor: number; count: number }[],
): Placed[] {
  const innerMost = plan.length - 1;

  /**
   * THE STUB STOPS BEFORE THE RING INSIDE IT, and that is measured rather than
   * assumed.
   *
   * The previous rule was "one ring step, inward" -- which sounds like it stays
   * inside its own lane and does not: the node is a disc, the next ring in is a
   * disc, and a stub one full step long ends up half a disc PAST the outer edge
   * of the ring below. Then it is a line running through somebody's face, which
   * is the complaint.
   *
   * So each ring asks how far out the ring inside it actually reaches -- the
   * furthest node on it, plus its own radius -- and starts one gap outside that.
   * It is the real extent including the lean, so no clearance argument has to
   * assume the lean was small.
   *
   * The plan guarantees a step of at least 1.45 x (disc + gap), so what is left
   * for the stub is about 0.45 x disc + 6pt and never nothing. Clamped anyway.
   */
  const reach: number[] = [];
  for (const p of items) {
    const r = Math.hypot(p.x, p.y) + p.d / 2;
    reach[p.ring] = Math.max(reach[p.ring] ?? 0, r);
  }

  return items.map((p) => {
    const own = Math.hypot(p.x, p.y) - p.d / 2;
    const floor = hubRadius + 3;
    const from =
      p.ring >= innerMost ? floor : Math.max(floor, (reach[p.ring + 1] ?? 0) + RING_GAP);
    // Always leave a line, even if a pathological board left no room for one.
    const spokeFrom = Math.min(from, Math.max(floor, own - MIN_SPOKE));
    return { ...p, spokeFrom, path: spiralPath(p, spokeFrom, bx, by) };
  });
}

/** The shortest line that still reads as a line rather than as a tick. */
const MIN_SPOKE = 10;
/** The clearance two lines owe each other, in points. Two strokes and some air. */
const LINE_CLEAR = 3.5;

/**
 * ONE NODE'S LINE, as a polyline from where it starts to the edge of its disc.
 *
 * BUILT FROM arcS AND radiusF, THE SAME TWO NUMBERS THE NODE WAS BUILT FROM. It
 * used to invert x and y to recover them, which worked and was a mistake of
 * kind: two derivations of one fact can drift, and this one did every time the
 * placement changed. Carried on Placed instead, so a line that ends anywhere but
 * on its own node is not a bug that can exist.
 *
 *   s(r) = arcS - S x (radiusF - r)
 *
 * At r = radiusF that is arcS exactly, which is the node. Walked in normalized
 * radius and scaled at the end, so the ellipse is applied once and the curve
 * lives in the same space the layout reasoned in.
 *
 * THE FAR END IS TRIMMED BY MEASUREMENT, not by subtracting the disc's radius
 * from the ring's. Those are different lengths once the curve is turning -- the
 * line approaches the node at an angle, so stepping back d/2 in RADIUS leaves it
 * well under the face. So the walk runs all the way to the node and then backs
 * off, sample by sample, until it is genuinely clear of the disc.
 */
function spiralPath(
  p: Placed,
  spokeFrom: number,
  bx: number,
  by: number,
): { x: number; y: number }[] {
  const shorter = Math.min(bx, by) || 1;
  const f = p.radiusF;
  if (!(f > 0) || !(bx > 0)) return [];
  const rStart = Math.min(f, Math.max(0, spokeFrom / shorter));

  /**
   * A NODE ALWAYS GETS A LINE. THIS FUNCTION USED TO RETURN [].
   *
   * "There are still connections missing with me and the people I'm actually
   *  connected to on Amber. There's no line between the central node and them."
   *
   * Three separate returns here handed back an empty array, and the component
   * draws nothing for a path shorter than two points -- silently, with no error
   * anywhere. The one that actually fired is the trim at the bottom: it walks
   * back a whole sample at a time until it is clear of the node's own disc, and
   * a node close to the middle has a short spiral to spend. A CONNECTION's disc
   * is full size while a suggestion's is 0.78 of it, and connections sit on the
   * innermost ring -- so the biggest discs on the shortest spirals lost their
   * lines first. Exactly the people whose ties are real.
   *
   * The fallback is a straight radial segment, which is not a compromise: it is
   * what MAX_BOW=0 already established as the safe shape. Straight rays from a
   * common center cannot cross each other, so a web full of them keeps the
   * no-crossing guarantee the spiral was built to preserve.
   */
  const straight = (): { x: number; y: number }[] => {
    const len = Math.hypot(p.x, p.y);
    if (!(len > 0)) return [];
    const ux = p.x / len;
    const uy = p.y / len;
    const from = Math.min(spokeFrom, Math.max(0, len - p.d / 2));
    const to = Math.max(from, len - p.d / 2);
    // A stub shorter than a point is not a line; better nothing than a speck.
    // Also untestable against `< 0`: the geometry never produces a gap inside
    // (0, 1), so the floor is a statement of intent rather than a live branch.
    if (to - from < 1) return [];
    return [
      { x: ux * from, y: uy * from },
      { x: ux * to, y: uy * to },
    ];
  };

  if (!(f > rStart)) return straight();

  const at = unitEllipseAt(by / bx);
  const pts: { x: number; y: number }[] = [];
  for (let i = 0; i <= SPIRAL_STEPS; i += 1) {
    const rr = rStart + ((f - rStart) * i) / SPIRAL_STEPS;
    const u = at(p.arcS - SPIRAL_S * (f - rr));
    pts.push({ x: bx * rr * u.x, y: bx * rr * u.y });
  }

  // pts[last] IS the node. Walk back to the first sample outside its disc.
  const node = pts[SPIRAL_STEPS]!;
  let cut = SPIRAL_STEPS;
  while (cut > 0 && Math.hypot(pts[cut]!.x - node.x, pts[cut]!.y - node.y) < p.d / 2) cut -= 1;
  // The trim ate the whole curve. See `straight` above: this is the case that
  // was losing the lines to the people closest to the middle.
  if (cut < 1) return straight();
  return pts.slice(0, cut + 1);
}

/** How wide one character of a label is, at 11pt in this face. Measured. */
export const LABEL_CHAR_PT = 5.9;
/** The label's own line box, and the air between the disc and it. */
export const LABEL_LINE_H = 14;
export const LABEL_GAP_Y = 5;

/**
 * NOBODY'S NAME MAY TOUCH ANYTHING. NOT A DISC, NOT ANOTHER NAME.
 *
 * "You notice how a lot of the parts of the web are on top of each other, and
 *  it looks messy and gross... nothing should be overlaying."
 *
 * WHY IT WAS OVERLAPPING, and it was not for want of a rule. Each label was
 * already capped at the distance to its NEAREST NEIGHBOR -- which sounds like
 * the right constraint and is the wrong one twice over:
 *
 *   * the nearest node is often RADIAL (the ring inside or outside), so the cap
 *     came from a neighbor whose label was never going to collide, while the
 *     node that actually sits beside you got no say at all
 *   * a label is centered under its node, so two labels of width w collide
 *     unless the nodes are w apart -- and the cap allowed w = 0.94 x distance
 *     against ONE neighbor, leaving every other pair unconstrained
 *
 * "Sagar Tiwari" over "Rocky Pula", "Sister" over "Justin Yau", "Josh Berman"
 * over "Rahul Reddy": every one of those is two nodes that were not each
 * other's nearest neighbor.
 *
 * SO IT IS RESOLVED, NOT ESTIMATED. Every label is a real box -- centered under
 * its disc, as wide as the text it holds -- and boxes are accepted one at a time
 * in priority order, each taking the widest form (full name, then first name,
 * then nothing) that hits NOTHING already on the board: no accepted label box,
 * and no disc anywhere on the web.
 *
 * PRIORITY IS WHO YOU ACTUALLY KNOW. Connections first, then inner rings, then
 * a stable key order. Somebody has to lose their name when a web gets crowded,
 * and it should be the twelfth invite on the outer ring rather than one of the
 * three people you talk to. Ties break on the key so the same person loses it
 * on every render, rather than labels flickering between neighbors.
 */
export function resolveLabels(placed: Placed[]): Placed[] {
  const widthOf = (text: string) => text.length * LABEL_CHAR_PT;
  const forms = (name: string): string[] => {
    const full = String(name || '').trim();
    if (!full) return [];
    const first = full.split(/\s+/)[0]!;
    return first && first !== full ? [full, first] : [full];
  };

  // The discs are fixed -- a name may never cover a face -- so they are the
  // board every label is tested against.
  const discs = placed.map((p) => ({ x: p.x, y: p.y, r: p.d / 2 }));

  /**
   * AND SO ARE THE LINES. This has now been the miss TWICE, differently.
   *
   * "The lines for the connections go through their names."
   *
   * FIRST TIME: the resolver did not consider the lines at all. Clearing every
   * disc and every other label still let a name sit across a spoke, and on a web
   * where the inner ring is mixed, a connection's line to its own disc runs
   * straight through the label of the person beside it.
   *
   * SECOND TIME -- this one: it considered them, and rebuilt them itself. It
   * took each node, normalized the vector to it, and made ONE STRAIGHT SEGMENT
   * from `spokeFrom` to the disc's edge. That was a faithful copy of the line
   * while lines were rays. They are spirals now, and the straight chord between
   * a spiral's endpoints can be forty points away from the spiral in the middle
   * -- so the resolver was clearing names off a line nobody draws while letting
   * them sit on the one that is actually there. Exactly the same class of bug as
   * the component drawing `M .. L ..` past the curve it was handed, found the
   * same afternoon, in the same file.
   *
   * `p.path` is the line. Every segment of it, flattened, because a polyline is
   * just more segments and segmentHitsBox does not care how many.
   */
  const spokes = placed.flatMap((p) =>
    p.path.slice(0, -1).map((a, i) => ({
      key: p.person.key,
      x1: a.x,
      y1: a.y,
      x2: p.path[i + 1]!.x,
      y2: p.path[i + 1]!.y,
    })),
  );

  /** Does a segment pass through an axis-aligned box? Liang-Barsky slab clip. */
  const segmentHitsBox = (
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    b: { left: number; right: number; top: number; bottom: number },
  ): boolean => {
    let t0 = 0;
    let t1 = 1;
    const dx = x2 - x1;
    const dy = y2 - y1;
    const edges: [number, number][] = [
      [-dx, x1 - b.left],
      [dx, b.right - x1],
      [-dy, y1 - b.top],
      [dy, b.bottom - y1],
    ];
    for (const [pp, qq] of edges) {
      if (pp === 0) {
        if (qq < 0) return false;
        continue;
      }
      const r = qq / pp;
      if (pp < 0) {
        if (r > t1) return false;
        if (r > t0) t0 = r;
      } else {
        if (r < t0) return false;
        if (r < t1) t1 = r;
      }
    }
    return true;
  };

  const order = placed
    .map((p, i) => ({ p, i }))
    .sort((a, b) => {
      if (a.p.person.connected !== b.p.person.connected) return a.p.person.connected ? -1 : 1;
      if (a.p.ring !== b.p.ring) return b.p.ring - a.p.ring; // higher index = further in
      return a.p.person.key < b.p.person.key ? -1 : 1;
    });

  const taken: { left: number; right: number; top: number; bottom: number }[] = [];
  const out = placed.slice();

  for (const { p, i } of order) {
    /**
     * THE NAME SITS ON THE OUTSIDE OF THE RING, not always underneath.
     *
     * A label always drawn below its node is a label pushed toward the middle
     * for everybody in the top half of the web -- into the next ring in, into
     * that ring's names, and across the spokes, which all run radially inward.
     * That is where most of the collisions were, and the resolver was answering
     * them by deleting names.
     *
     * Above for a node above the hub, below for one below it. Every label then
     * leans away from the traffic, and the ones that still collide are genuine
     * neighbors rather than victims of the geometry.
     */
    const above = p.y < 0;
    const top = above
      ? p.y - p.d / 2 - LABEL_GAP_Y - LABEL_LINE_H
      : p.y + p.d / 2 + LABEL_GAP_Y;
    const bottom = top + LABEL_LINE_H;
    let chosen = '';
    let chosenW = 0;
    for (const text of forms(p.person.name)) {
      const w = widthOf(text);
      const box = { left: p.x - w / 2, right: p.x + w / 2, top, bottom };
      const hitsLabel = taken.some(
        (t) => box.left < t.right && box.right > t.left && box.top < t.bottom && box.bottom > t.top,
      );
      if (hitsLabel) continue;
      // A disc is a circle and the label is a box, so closest-point-on-box is
      // the exact test. It is three lines, which is no reason to approximate it
      // with a bounding square -- that would reject names clearing a face by a
      // corner, and this web is mostly corners.
      const hitsDisc = discs.some((c, j) => {
        if (j === i) return false;
        const nx = Math.max(box.left, Math.min(c.x, box.right));
        const ny = Math.max(box.top, Math.min(c.y, box.bottom));
        return Math.hypot(c.x - nx, c.y - ny) < c.r + 1;
      });
      if (hitsDisc) continue;
      const hitsSpoke = spokes.some(
        (sp) => sp.key !== p.person.key && segmentHitsBox(sp.x1, sp.y1, sp.x2, sp.y2, box),
      );
      if (hitsSpoke) continue;
      chosen = text;
      chosenW = w;
      break;
    }
    if (chosen) taken.push({ left: p.x - chosenW / 2, right: p.x + chosenW / 2, top, bottom });
    out[i] = { ...p, label: chosen, labelAbove: above, labelWidth: Math.max(p.d, chosenW) };
  }
  return out;
}

/**
 * The line under the title. Says what is on screen, in words, including when
 * what is on screen is nothing.
 */
export function webSummary(people: WebPerson[]): string {
  /**
   * CONNECTIONS ARE THE ONES YOU HAVE ACTUALLY CONNECTED WITH, which is
   * `connected` and not `kind`. Since somebody on Amber that you have not
   * connected to now draws solid, counting `kind` here would report them as a
   * connection -- a number the Connections screen would then contradict.
   *
   * And "to invite" means people who are genuinely not on Amber. Offering to
   * invite somebody who already has an account is the mistake this file guards
   * against everywhere else; it must not reappear in the caption.
   */
  const conn = people.filter((p) => p.connected).length;
  const sugg = people.filter((p) => !p.amberId).length;
  if (people.length === 0) return 'Nobody here yet';
  const a = `${conn} ${conn === 1 ? 'connection' : 'connections'}`;
  return sugg > 0 ? `${a} · ${sugg} to invite` : a;
}
