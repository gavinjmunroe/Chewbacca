/**
 * THE MESSAGES PANEL, MINUS THE PIXELS.
 *
 * The panel that slides out from the top-left of Home is four questions, and
 * every one of them can be wrong in a way you would not notice by looking:
 *
 *   1. WHICH FIVE conversations are the recent ones, and how many are hidden
 *   2. WHAT TIME IT SAYS next to each of them
 *   3. WHICH LETTER each contact files under, and in what order the letters go
 *   4. WHICH CIRCLE's name sits under a contact's name
 *
 * All four are here, pure, and all four are tested. What is left in the
 * component is layout.
 *
 * NOTHING IN THIS FILE FETCHES ANYTHING. The panel is built out of the channels
 * that already exist -- lib/dms for the threads, lib/useContacts for the address
 * book, lib/circles for the memberships -- and this module only decides what to
 * do with what they returned. That is the whole reason it can be tested.
 */

import type { DmThread } from './dms';
import type { CircleMember } from './circles';
import type { NetworkIdentity } from './network';
import { firstLetter } from './useContacts';

/**
 * How many conversations the panel shows before it asks.
 *
 * "You are only able to see 5 DMs, and it's the 5 most recent conversations."
 *
 * A named constant rather than a 5 in the component, because the count appears
 * three times -- the slice, the "See N more" label, and the test below -- and
 * three loose fives are how a list of five ends up offering to show you four
 * more out of eight.
 */
export const RECENT_DM_COUNT = 5;

// ── 1. WHICH FIVE ───────────────────────────────────────────────────────────

/**
 * The most recent conversations first, and how many are left over.
 *
 * SORTED HERE RATHER THAN TRUSTED. The server returns threads in its own order
 * and has never promised this one; a list that is nearly-sorted is the worst
 * case, because it looks right until the day somebody replies to an old thread
 * and their message appears third.
 *
 * A thread with an unparseable timestamp sorts LAST rather than first. Treating
 * a bad date as 0 would be equally deterministic and would bury a real
 * conversation; treating it as now would promote a broken row to the top of the
 * inbox, which is the more expensive mistake.
 */
export function recentThreads(
  threads: readonly DmThread[] | null | undefined,
  expanded = false,
): { shown: DmThread[]; hiddenCount: number } {
  const all = (threads ?? []).filter(Boolean);
  const at = (t: DmThread) => {
    const n = new Date(t?.last?.createdAt ?? '').getTime();
    return Number.isFinite(n) ? n : Number.NEGATIVE_INFINITY;
  };
  const sorted = [...all].sort((a, b) => at(b) - at(a));
  if (expanded) return { shown: sorted, hiddenCount: 0 };
  return {
    shown: sorted.slice(0, RECENT_DM_COUNT),
    hiddenCount: Math.max(0, sorted.length - RECENT_DM_COUNT),
  };
}

// ── 2. WHAT TIME IT SAYS ────────────────────────────────────────────────────

const DAY_MS = 86_400_000;

/** Midnight local time on the day `ms` falls in. Calendar days, not 24h blocks. */
function startOfDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/**
 * The stamp beside a conversation: "9:41 AM", "Yesterday", "Tue", "Mar 4".
 *
 * CALENDAR DAYS, NOT ELAPSED HOURS, and that is the whole point of the two
 * startOfDay calls. A message sent at 11:50pm is "Yesterday" at 12:10am -- ten
 * minutes later -- because that is what a person means by yesterday. An
 * hours-since subtraction would call it "23h" until nearly midnight the
 * following night, which is how a chat list ends up disagreeing with the phone's
 * own notification center.
 *
 * Weekday names stop at six days back, not seven: at exactly seven "Tue" means
 * either this week or last, and a stamp that is ambiguous is worse than a date.
 */
export function messageStamp(iso: string | null | undefined, now: number = Date.now()): string {
  const then = new Date(iso ?? '').getTime();
  if (!Number.isFinite(then)) return '';
  const today = startOfDay(now);
  const day = startOfDay(then);
  // A clock skew or a clip stamped from a device set to next week: show the
  // time rather than "in 3 days", which no messaging app has ever said.
  if (day >= today) {
    return new Date(then).toLocaleTimeString(undefined, {
      hour: 'numeric',
      minute: '2-digit',
    });
  }
  const daysBack = Math.round((today - day) / DAY_MS);
  if (daysBack === 1) return 'Yesterday';
  if (daysBack < 7) {
    return new Date(then).toLocaleDateString(undefined, { weekday: 'short' });
  }
  return new Date(then).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** The preview line: a voice memo reads as its transcript, never as "Voice message". */
export function threadPreview(thread: DmThread | null | undefined): string {
  const last = thread?.last;
  if (!last) return '';
  const body = (last.body ?? '').trim();
  if (body) return last.mine ? `You: ${body}` : body;
  if (last.kind === 'voice') {
    const s = Math.max(0, Math.round((last.durationMs || 0) / 1000));
    const clip = `Voice message · ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    return last.mine ? `You: ${clip}` : clip;
  }
  return '';
}

// ── 3. WHICH LETTER ─────────────────────────────────────────────────────────

/**
 * THE FIELD IS `data` AND NOT `people`, and that is not a naming preference.
 *
 * React Native's SectionList reads each section's rows from a key literally
 * called `data`. It was `people` here first, which reads better in this file and
 * meant the panel rendered every letter heading with nothing underneath -- no
 * error, no warning, just an address book of empty sections. Renaming it in the
 * component instead would have put a map() over a thousand rows in a render
 * path to avoid one word.
 */
export type AlphaSection = { letter: string; data: NetworkIdentity[] };

/**
 * The address book under A, B, C..., with everything unalphabetical under '#'.
 *
 * '#' GOES LAST. firstLetter already folds digits, emoji, accents the platform
 * does not fold, and empty names into one bucket -- and a plain sort() puts '#'
 * (0x23) before 'A', so an address book that starts with a row of numbered
 * company entries opens on them instead of on the As.
 *
 * The rows inside a letter are sorted by name too. They arrive in whatever order
 * the sync produced, which is close enough to alphabetical to look like a bug
 * rather than an ordering when it is wrong.
 */
export function alphaSections(
  people: readonly NetworkIdentity[] | null | undefined,
): AlphaSection[] {
  const byLetter = new Map<string, NetworkIdentity[]>();
  for (const p of people ?? []) {
    if (!p) continue;
    const letter = firstLetter(p.name ?? '');
    const list = byLetter.get(letter);
    if (list) list.push(p);
    else byLetter.set(letter, [p]);
  }
  const letters = [...byLetter.keys()].sort((a, b) => {
    if (a === '#') return 1;
    if (b === '#') return -1;
    return a < b ? -1 : a > b ? 1 : 0;
  });
  return letters.map((letter) => ({
    letter,
    data: byLetter
      .get(letter)!
      .slice()
      .sort((a, b) => (a.name ?? '').localeCompare(b.name ?? '')),
  }));
}

/**
 * The keyword filter over the address book.
 *
 * Matches name, handle and email, because those are the three things a person
 * can remember about somebody they cannot find -- and a filter that only reads
 * `name` makes searching an email address return nothing, which reads as "that
 * person is not in here".
 */
export function filterPeople(
  people: readonly NetworkIdentity[] | null | undefined,
  query: string,
): NetworkIdentity[] {
  const q = (query ?? '').trim().toLowerCase();
  const all = (people ?? []).filter(Boolean);
  if (!q) return [...all];
  return all.filter((p) => {
    const hay = `${p.name ?? ''} ${p.handle ?? ''} ${p.email ?? ''} ${p.username ?? ''}`;
    return hay.toLowerCase().includes(q);
  });
}

// ── 4. WHICH CIRCLE ─────────────────────────────────────────────────────────

/**
 * One label per contact: the name of the circle they are in.
 *
 * WHY THE SMALLEST CIRCLE WINS. Most people are in several -- Family and
 * Everyone, Work and Alumni -- and the row has space for one word. Picking the
 * first one returned would make the caption depend on the order the server
 * happened to answer in, which is the kind of thing that changes under you when
 * someone adds an index. The smallest circle is the most specific thing anybody
 * has said about that person, which is also the most useful caption: "Family"
 * tells you more than "Everyone".
 *
 * Ties break on the circle's name so the answer is stable across reloads.
 *
 * Returns a Map rather than a lookup function so the component computes it once
 * per data change instead of once per row -- an address book of a thousand rows
 * against a hundred circles is a hundred thousand comparisons if you get this
 * wrong, and it would happen inside a FlatList's renderItem.
 */
export function circleLabels(
  membersByCircle: Map<string, CircleMember[]> | null | undefined,
  circleNames: Map<string, string> | null | undefined,
): Map<string, string> {
  const best = new Map<string, { size: number; name: string }>();
  for (const [circleId, members] of membersByCircle ?? new Map()) {
    const name = circleNames?.get(circleId);
    if (!name) continue;
    const size = members.length;
    for (const m of members) {
      if (!m?.contactId) continue;
      const cur = best.get(m.contactId);
      if (!cur || size < cur.size || (size === cur.size && name < cur.name)) {
        best.set(m.contactId, { size, name });
      }
    }
  }
  const out = new Map<string, string>();
  for (const [contactId, hit] of best) out.set(contactId, hit.name);
  return out;
}
