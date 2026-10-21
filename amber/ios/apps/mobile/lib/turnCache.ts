import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  findTurn,
  parseEntries,
  threadsToEvict,
  upsertTurn,
  type CachedTurn,
} from './turnCacheRules';

/**
 * THE ANSWER, KEPT ON THIS DEVICE, BECAUSE THE SERVER'S COPY CAN BE MISSING.
 *
 * "After I saw the response, closed the chat, closed the app, and reopened the
 *  chat, the entire response disappeared... After a response renders, it needs
 *  to stay there. Even if I check back 10 years later."
 *
 * What happened: the assistant message failed to persist server-side (one
 * warning in the logs, `[chat] persist assistant msg failed`), so reopening the
 * thread read a user message with no reply — and the app, which had the whole
 * answer on screen a minute earlier, had nothing left to show. The server side
 * of that is fixed (it retries, and falls back to saving the prose alone), but
 * "the write worked" can never be the only reason an answer still exists.
 *
 * So the client keeps its own copy of every finished turn. If a reopened thread
 * comes back missing a reply this app has already seen, the local copy fills it
 * in. Belt AND braces, deliberately: this is the guarantee that does not depend
 * on the network, the database, or a deploy.
 *
 * WHAT IS STORED. The prose and the metadata needed to redraw the turn --
 * people, sources, places, sections, chips. Not audio, not signed URLs.
 *
 * SCOPE AND SIZE. One entry per conversation, holding that thread's turns, under
 * a per-account prefix that sign-out sweeps (see lib/auth.ts). Capped at
 * MAX_CONVERSATIONS threads, newest kept, and each entry capped at MAX_TURNS —
 * this is a safety net for the newest answers, not an offline archive.
 *
 * NEVER THE SOURCE OF TRUTH. Server history always wins when it has the turn;
 * this only fills a hole. A cached answer that the server later returns
 * differently (a corrected name, a re-run) must not shadow the real one.
 */

export type { CachedTurn } from './turnCacheRules';

const PREFIX = 'amber.turn.cache.';
const MAX_CONVERSATIONS = 40;

const keyFor = (conversationId: string) => `${PREFIX}${conversationId}`;

/** Remember one finished turn. Best-effort: never throws, never blocks a render. */
export async function cacheTurn(
  conversationId: string,
  turn: Omit<CachedTurn, 'savedAt'>,
): Promise<void> {
  if (!conversationId || !turn?.query || !turn?.answer) return;
  try {
    const merged = upsertTurn(await readThread(conversationId), turn);
    if (merged.length === 0) return;
    await AsyncStorage.setItem(keyFor(conversationId), JSON.stringify(merged));
    void pruneThreads();
  } catch {
    /* a cache that cannot be written is a cache, not an error */
  }
}

/** What this device remembers about a thread, oldest first. */
export async function readThread(conversationId: string): Promise<CachedTurn[]> {
  if (!conversationId) return [];
  try {
    return parseEntries(await AsyncStorage.getItem(keyFor(conversationId)));
  } catch {
    return [];
  }
}

/**
 * The cached answer for one question in one thread, or null.
 *
 * Matched on the question text, because that is what a reopened thread always
 * has: the user message persisted even when the reply did not.
 */
export async function cachedAnswerFor(
  conversationId: string,
  query: string,
): Promise<CachedTurn | null> {
  return findTurn(await readThread(conversationId), query);
}

/** Forget one thread — used when a note is deleted. */
export async function forgetThread(conversationId: string): Promise<void> {
  if (!conversationId) return;
  try {
    await AsyncStorage.removeItem(keyFor(conversationId));
  } catch {
    /* best effort */
  }
}

/**
 * Keep the newest MAX_CONVERSATIONS threads and drop the rest.
 *
 * Newest by the most recent turn IN each thread, not by write order, so a thread
 * that is re-read but not added to does not outrank one that got a new answer.
 */
async function pruneThreads(): Promise<void> {
  try {
    const keys = (await AsyncStorage.getAllKeys()).filter((k) => k.startsWith(PREFIX));
    if (keys.length <= MAX_CONVERSATIONS) return;
    const pairs = await AsyncStorage.multiGet(keys);
    const doomed = threadsToEvict(
      pairs.map(([key, raw]) => ({ key, raw })),
      MAX_CONVERSATIONS,
    );
    if (doomed.length > 0) await AsyncStorage.multiRemove(doomed);
  } catch {
    /* best effort */
  }
}
