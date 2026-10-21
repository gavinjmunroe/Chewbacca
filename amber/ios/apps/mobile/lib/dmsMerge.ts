/**
 * MERGING WHAT THE POLL BROUGHT BACK, WITHOUT CHURNING THE THREAD.
 *
 * Split out of lib/dms.ts's useDmConversation so it can be tested without a
 * renderer, and because the rule it enforces is subtle enough to be worth its
 * own file and its own tests.
 *
 * ── WHAT WENT WRONG ─────────────────────────────────────────────────────────
 *
 *   "It seems like it's just a little laggy to send messages... it's just a
 *    little laggy."
 *
 * A DM thread re-reads its newest twenty rows every four seconds. That is a
 * deliberate design -- 20 rows on an indexed (thread_id, id DESC) scan is cheap,
 * and re-reading beats a "since" cursor the server does not offer.
 *
 * The merge behind it did this:
 *
 *     const byId = new Map(prev.map((m) => [m.id, m]));
 *     for (const m of incoming) byId.set(m.id, m);
 *     return [...byId.values()].sort(...);
 *
 * Every poll therefore replaced every message OBJECT with a freshly parsed one
 * carrying identical values, and returned a new ARRAY whether or not a single
 * field had changed. Nothing was wrong on screen. But React compares by
 * identity, so:
 *
 *   - every visible MessageBubble re-rendered every four seconds, forever,
 *     including voice rows that rebuild a waveform and a player;
 *   - memoizing the bubble could not help, because the `message` prop really was
 *     a different object;
 *   - the callbacks that close over `messages` were rebuilt, so the hoisted
 *     renderItem was rebuilt, so FlatList re-rendered anyway;
 *   - and the mark-read effect keyed on `messages` fired a network write on
 *     every tick.
 *
 * A hitch every four seconds while you are typing into the same screen is not a
 * distinct bug from "typing is laggy" -- it is most of it.
 *
 * ── THE RULE ────────────────────────────────────────────────────────────────
 *
 * A merge that changes nothing returns the array it was given, and a message
 * whose contents are unchanged keeps the object it already had. Only rows that
 * genuinely differ are replaced.
 *
 * This is not an optimization laid over correct behavior; identity IS the
 * behavior as far as React is concerned, and a poll that reports "everything
 * changed" twenty times a minute is simply reporting wrongly.
 */
import type { DmMessage } from './dms';

/**
 * Everything about a message that can change after it has been written.
 *
 * Deliberately NOT JSON.stringify(message): that would fold in key order and any
 * field the server starts sending, so an added `updatedAt` or a reordered
 * response would make every row look different again and quietly restore the
 * bug this file exists to fix.
 *
 * The counts object is walked in SORTED key order for the same reason -- two
 * responses carrying the same reactions in a different order are the same
 * reactions, and a hash that says otherwise is a hash that fires on nothing.
 */
export function messageSignature(m: DmMessage): string {
  const counts = m.reactions?.counts ?? {};
  const packed = Object.keys(counts)
    .sort()
    .map((k) => `${k}:${counts[k as keyof typeof counts]}`)
    .join(',');
  return [
    m.body ?? '',
    m.kind,
    m.audioStatus,
    String(m.durationMs),
    // The waveform is written once with the row and never edited, so its LENGTH
    // is enough to notice the transition from "no peaks yet" to "peaks".
    String(m.peaks?.length ?? 0),
    m.pinnedAt ?? '',
    m.pinnedByMe ? '1' : '0',
    m.reactions?.mine ?? '',
    packed,
  ].join('');
}

/**
 * Fold `incoming` into `prev`, newest first.
 *
 * Returns `prev` ITSELF -- the same array reference -- when nothing changed, so
 * a caller doing setState(merge(prev, incoming)) bails out of the render
 * entirely. Rows that are unchanged keep their existing object.
 *
 * Ordering is by numeric id descending. The ids are a bigserial, so this is send
 * order and does not depend on two devices agreeing about the time. Anything
 * that is not a number sorts to the end rather than poisoning the comparator:
 * `Number('x') - Number('y')` is NaN, and a comparator that returns NaN does not
 * misplace one row, it scrambles the list.
 */
export function mergeMessages(prev: DmMessage[], incoming: DmMessage[]): DmMessage[] {
  if (incoming.length === 0) return prev;

  const byId = new Map(prev.map((m) => [m.id, m]));
  let changed = false;

  for (const m of incoming) {
    const existing = byId.get(m.id);
    if (existing && messageSignature(existing) === messageSignature(m)) continue;
    byId.set(m.id, m);
    changed = true;
  }

  if (!changed) return prev;

  return [...byId.values()].sort((a, b) => {
    const na = Number(a.id);
    const nb = Number(b.id);
    if (!Number.isFinite(na) && !Number.isFinite(nb)) return 0;
    if (!Number.isFinite(na)) return 1;
    if (!Number.isFinite(nb)) return -1;
    return nb - na;
  });
}
