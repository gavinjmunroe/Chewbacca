/**
 * THE RULES OF THE LOCAL ANSWER CACHE, with no storage attached.
 *
 * lib/turnCache.ts is the AsyncStorage adapter; everything that can actually be
 * wrong lives here, so it can be tested without a native module. The split is
 * not ceremony: the failure this cache exists to prevent -- an answer that
 * rendered and then vanished -- is a failure of the MATCHING and CAPPING rules,
 * not of key/value storage.
 */

export type CachedTurn = {
  /** conversation_messages id of the USER message that started the turn, when known. */
  messageId?: string | null;
  query: string;
  answer: string;
  /** Redraw payload: the same shape the assistant message's metadata carries. */
  metadata?: Record<string, unknown> | null;
  savedAt: number;
};

/** One entry per conversation holds at most this many turns. */
export const MAX_TURNS = 30;
/** Anything longer than this is not an answer worth keeping whole. */
export const MAX_ANSWER_CHARS = 24000;

/** The comparison key for a question. Whitespace and case are not differences. */
export function normalizeQuery(q: string): string {
  return String(q ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

/** Is this worth storing at all? A turn with no question or no answer is not. */
export function isStorable(turn: { query?: string; answer?: string } | null): boolean {
  return !!turn && !!normalizeQuery(turn.query ?? '') && !!String(turn.answer ?? '').trim();
}

/**
 * Fold one finished turn into a thread's entries.
 *
 * REPLACES the entry for the same question rather than appending: a retried turn
 * is the same turn, and appending would grow the thread every time an answer was
 * asked for twice. Newest last, capped at MAX_TURNS.
 */
export function upsertTurn(
  existing: CachedTurn[],
  turn: Omit<CachedTurn, 'savedAt'>,
  now = Date.now(),
): CachedTurn[] {
  if (!isStorable(turn)) return existing;
  const entry: CachedTurn = {
    messageId: turn.messageId ?? null,
    query: turn.query,
    answer: String(turn.answer).slice(0, MAX_ANSWER_CHARS),
    metadata: turn.metadata ?? null,
    savedAt: now,
  };
  const key = normalizeQuery(entry.query);
  return [...existing.filter((t) => normalizeQuery(t.query) !== key), entry].slice(-MAX_TURNS);
}

/**
 * The cached answer for one question, or null.
 *
 * Matched on the question text, because that is what a reopened thread always
 * has: the user message persists even when the reply does not. Newest match
 * wins -- if the same question was asked twice, the later answer is the one the
 * user just had on screen.
 */
export function findTurn(entries: CachedTurn[], query: string): CachedTurn | null {
  const want = normalizeQuery(query);
  if (!want) return null;
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    if (normalizeQuery(entries[i].query) === want) return entries[i];
  }
  return null;
}

/** Parse stored JSON into entries. Anything unparseable or misshapen reads as empty. */
export function parseEntries(raw: string | null | undefined): CachedTurn[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (t): t is CachedTurn => !!t && typeof t.query === 'string' && typeof t.answer === 'string',
    );
  } catch {
    return [];
  }
}

/**
 * Which thread keys to drop, keeping the `keep` most recently ANSWERED threads.
 *
 * By the newest turn inside each thread rather than by write order, so a thread
 * that was merely re-read does not outrank one that got a new answer.
 */
export function threadsToEvict(
  threads: { key: string; raw: string | null }[],
  keep: number,
): string[] {
  if (threads.length <= keep) return [];
  const scored = threads.map(({ key, raw }) => {
    let newest = 0;
    for (const t of parseEntries(raw)) newest = Math.max(newest, Number(t.savedAt) || 0);
    return { key, newest };
  });
  scored.sort((a, b) => b.newest - a.newest);
  return scored.slice(keep).map((x) => x.key);
}
