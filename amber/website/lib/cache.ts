"use client";

/**
 * SHOW WHAT WE HAD, THEN REFRESH IT.
 *
 * THE BUG THIS EXISTS TO KILL. The console renders its tabs as
 * `{tab === "files" ? <Drive/> : null}`, so clicking a tab UNMOUNTS the
 * previous screen and MOUNTS the next one. Every mount runs its loader from
 * nothing: spinner, round trip to the API, then content. Click back and it
 * happens again. Five tabs meant five full reloads of data that had not
 * changed in the four seconds since you last looked at it, and the whole
 * console felt broken.
 *
 * Caching inside one hook did not touch this, because the slow part was never
 * the roster — it was the feed, the drive and the wiki index, each refetched
 * from scratch on every click.
 *
 * SO: the result of every keyed read is kept at module scope. A remount reads
 * it synchronously and renders immediately, with no spinner and no flash of
 * empty state, while a refresh runs in the background and updates the screen
 * if anything actually changed. That is the whole trick, and it is the
 * difference between a console that feels instant and one that feels broken.
 *
 * WHY MODULE SCOPE AND NOT A CONTEXT. The cache has to outlive the component
 * tree being torn down, which is precisely what a context does not do when
 * the provider's children unmount. A module-level Map survives everything
 * short of a page reload, which is the correct lifetime: a reload is exactly
 * when somebody wants fresh data.
 *
 * STALENESS IS BOUNDED, NOT IGNORED. Anything older than `maxAgeMs` is not
 * served from cache at all — it is loaded with a spinner like the first time,
 * because showing somebody a ten-minute-old feed as though it were live is
 * worse than making them wait.
 */

import { useCallback, useEffect, useRef, useState } from "react";

type Entry<T> = { data: T; at: number };

const store = new Map<string, Entry<unknown>>();
const inFlight = new Map<string, Promise<unknown>>();

/** Default: serve instantly for a minute, always revalidate behind it. */
const DEFAULT_MAX_AGE = 60_000;

/**
 * Throw away a cached read so the next mount fetches fresh.
 *
 * Called after a WRITE. Showing somebody the pre-write list because the cache
 * is thirty seconds young is the one thing worse than a spinner — they did the
 * thing, and the screen says it did not happen. Prefix matching means
 * `drop("feed")` clears every filter and group variant of the feed at once.
 */
export function drop(prefix: string) {
  for (const key of [...store.keys()]) {
    if (key === prefix || key.startsWith(`${prefix}:`)) store.delete(key);
  }
  for (const key of [...inFlight.keys()]) {
    if (key === prefix || key.startsWith(`${prefix}:`)) inFlight.delete(key);
  }
}

/** Everything, on sign-out. One account's data must not outlive its session. */
export function dropAll() {
  store.clear();
  inFlight.clear();
}

export function peek<T>(key: string, maxAgeMs = DEFAULT_MAX_AGE): T | null {
  const hit = store.get(key) as Entry<T> | undefined;
  if (!hit) return null;
  if (Date.now() - hit.at > maxAgeMs) return null;
  return hit.data;
}

/**
 * A cached read.
 *
 * Returns `data` immediately when something usable is cached, with
 * `loading` false — the component renders real content on its first frame.
 * `refreshing` is true while a background revalidate is in flight, for a
 * subtle indicator rather than a blocking spinner.
 */
export function useCached<T>(
  key: string | null,
  fetcher: () => Promise<T>,
  opts: { maxAgeMs?: number } = {},
) {
  const maxAge = opts.maxAgeMs ?? DEFAULT_MAX_AGE;

  const [data, setData] = useState<T | null>(() => (key ? peek<T>(key, maxAge) : null));
  const [loading, setLoading] = useState(() => (key ? peek<T>(key, maxAge) === null : false));
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<unknown>(null);

  /*
   * The fetcher is almost always an inline arrow, so it is a new function on
   * every render. Holding it in a ref keeps it out of the effect's deps —
   * otherwise the effect re-runs every render and we are back to a request
   * per keystroke, which is worse than what this replaces.
   */
  const fn = useRef(fetcher);
  fn.current = fetcher;

  const run = useCallback(
    async (background: boolean) => {
      if (!key) return;
      if (background) setRefreshing(true);
      else setLoading(true);

      try {
        // One in-flight request per key, however many components want it.
        let promise = inFlight.get(key) as Promise<T> | undefined;
        if (!promise) {
          promise = fn.current();
          inFlight.set(key, promise);
          promise.finally(() => inFlight.delete(key));
        }
        const next = await promise;
        store.set(key, { data: next, at: Date.now() });
        setData(next);
        setError(null);
      } catch (e) {
        setError(e);
        // A failed BACKGROUND refresh keeps what is on screen. The data was
        // right a minute ago and blanking it to show an error is a worse
        // answer than slightly stale content.
        if (!background) setData(null);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [key],
  );

  /*
   * A local mutation elsewhere in the tree has to reach this component. The
   * cache is module scope, so writing to it does not re-render anybody by
   * itself -- this is the subscription that makes mutate() visible.
   */
  useEffect(() => {
    if (!key) return;
    return subscribe(key, () => {
      const hit = store.get(key);
      if (hit) setData(hit.data as T);
    });
  }, [key]);

  useEffect(() => {
    if (!key) return;
    const cached = peek<T>(key, maxAge);
    if (cached !== null) {
      setData(cached);
      setLoading(false);
      void run(true); // revalidate behind the content
    } else {
      void run(false);
    }
    // `run` already depends on key; maxAge is a constant per call site.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, run]);

  const refresh = useCallback(() => {
    if (key) store.delete(key);
    return run(false);
  }, [key, run]);

  /** Re-read without a spinner, for after a write on this screen. */
  const revalidate = useCallback(() => {
    if (key) store.delete(key);
    return run(true);
  }, [key, run]);

  return { data, loading, refreshing, error, refresh, revalidate };
}

/**
 * PAY FOR A SCREEN BEFORE SOMEBODY ASKS FOR IT.
 *
 * The cache above makes the SECOND visit to a screen instant and does
 * nothing at all for the first, which is the one people judge the product
 * on: click Knowledge, watch "Loading…", click Files, watch it again. Five
 * tabs meant five first-time waits, and no amount of caching after the fact
 * removes a wait that has already happened.
 *
 * So the console warms every screen's key in the background the moment it
 * knows who you are. By the time anybody has read the overview and moved the
 * mouse, the other four have already answered.
 *
 * WHY THIS IS CHEAP RATHER THAN RECKLESS. These are the same handful of reads
 * the person was about to make anyway -- the whole set is what one visit to
 * each tab costs today, paid once at a moment when nothing is competing for
 * it, rather than five times at the moments somebody is waiting. A key that
 * is already warm is skipped, a request already in flight is joined rather
 * than duplicated, and every failure is swallowed: a prefetch that cannot
 * reach the API must leave the screen to ask properly and report its own
 * error, never surface one for a request nobody made.
 */
export function warm(entries: { key: string; load: () => Promise<unknown> }[]) {
  for (const { key, load } of entries) {
    if (store.has(key) || inFlight.has(key)) continue;
    let p: Promise<unknown>;
    try {
      p = load();
    } catch {
      continue; // a loader that throws synchronously, e.g. no token yet
    }
    inFlight.set(key, p);
    p.then(
      (data) => {
        store.set(key, { data, at: Date.now() });
      },
      () => {
        /* Silent on purpose -- see above. */
      },
    ).finally(() => inFlight.delete(key));
  }
}

/**
 * CHANGE WHAT IS CACHED WITHOUT ASKING THE SERVER AGAIN.
 *
 * THE PROBLEM THIS SOLVES, measured rather than guessed: every request to
 * this API takes between one and one and a half seconds. A write that posts
 * and then refetches to see its own result costs two of those. Sending a
 * message therefore showed "Sending…" for three seconds, a reaction took
 * three seconds to appear, and deleting left the message on screen for three
 * seconds. All of it worked; none of it felt like it did, and "it eventually
 * shows up" is the exact description of a product people stop trusting.
 *
 * The second request is almost always unnecessary. A POST that creates a
 * message RETURNS that message; the client already knows what the list
 * should now contain. So the write updates the cached value directly and the
 * screen is correct on the next frame, with no round trip at all.
 *
 * WHY THIS IS NOT LYING TO THE USER. The server has already accepted the
 * write — this runs after the response, not before it. What is skipped is
 * re-asking for information we were just handed. The background poll still
 * reconciles, so anything the server did that we did not predict (a trigger,
 * another person's edit landing in the same second) arrives within fifteen
 * seconds and overwrites this.
 *
 * `fn` must return a NEW object rather than mutating the old one. React
 * compares by reference to decide whether to re-render, and an in-place edit
 * of the cached array updates the cache invisibly while the screen keeps
 * showing what it already drew.
 */
type Listener = () => void;
const listeners = new Map<string, Set<Listener>>();

export function subscribe(key: string, fn: Listener) {
  if (!listeners.has(key)) listeners.set(key, new Set());
  listeners.get(key)!.add(fn);
  return () => {
    listeners.get(key)?.delete(fn);
  };
}

export function mutate<T>(key: string, fn: (prev: T | null) => T | null) {
  const hit = store.get(key) as Entry<T> | undefined;
  const next = fn(hit ? hit.data : null);
  if (next === null) {
    store.delete(key);
  } else {
    // `at` is left where it was on purpose: a local edit does not make the
    // data fresher than the read it came from, and pretending otherwise
    // would postpone the revalidate that checks our arithmetic.
    store.set(key, { data: next, at: hit?.at ?? Date.now() });
  }
  for (const l of listeners.get(key) ?? []) l();
}
