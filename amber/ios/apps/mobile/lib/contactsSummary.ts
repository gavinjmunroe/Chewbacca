import { useEffect, useSyncExternalStore } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

// The last-known contacts summary, cached on device.
//
// Why this exists rather than leaning on the react-query call alone: the strip
// at the top of the Contacts screen is the first thing on that screen, and
// GET /v1/me/contacts/summary takes a round-trip to answer. Without a cached
// copy the strip renders nothing on every cold launch and then pops in — which
// is exactly the jumpy, is-it-broken feel the strip is supposed to replace. So
// the last good answer is persisted and painted immediately, then overwritten
// by the live one when it lands.
//
// It is a CACHE, never the source of truth: the server's answer always wins.

const KEY = 'amber_contacts_summary_v1';

export type ContactsSummarySnapshot = {
  total: number;
  /** Server-side counts keyed by source ("apple", "google"). */
  bySource: Record<string, number>;
  /**
   * Duplicate contacts collapsed into one. Optional and frequently absent: see
   * the note on ContactSummary in lib/enrichment.ts about which surfaces
   * actually report it. Absent means "unknown", NOT zero — the strip omits the
   * clause entirely rather than claiming nothing was merged.
   */
  merged?: number;
  /** When this snapshot was taken (ms since epoch). */
  at: number;
};

// Same module-store shape as lib/syncState.ts: state outlives screen mounts and
// every write makes a new object so useSyncExternalStore sees the change.
let snapshot: ContactsSummarySnapshot | null = null;
let hydrated = false;
let listeners: (() => void)[] = [];

function notify(): void {
  for (const l of listeners) l();
}

export function getContactsSummarySnapshot(): ContactsSummarySnapshot | null {
  return snapshot;
}

export function subscribeContactsSummary(listener: () => void): () => void {
  listeners = [...listeners, listener];
  return () => {
    listeners = listeners.filter((l) => l !== listener);
  };
}

// Merge-and-persist. Fields are merged over the previous snapshot rather than
// replacing it, for two reasons: a payload that omits `merged` (the common case)
// must not wipe a count an earlier response did carry, and a sync that learns
// only the merge count can record it without having to restate total/bySource.
export async function saveContactsSummary(
  next: Partial<Omit<ContactsSummarySnapshot, 'at'>>,
): Promise<void> {
  const merged = { ...snapshot, ...next };
  // A partial write with no prior snapshot has no total to render, and a strip
  // reading total:0 would claim the user has no contacts. Drop it instead.
  if (typeof merged.total !== 'number') return;
  snapshot = {
    total: merged.total,
    bySource: merged.bySource ?? {},
    merged: merged.merged,
    at: Date.now(),
  };
  notify();
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(snapshot));
  } catch {
    /* a cache that fails to persist is still correct in memory */
  }
}

// Read the cached snapshot once per app launch. Safe to call from several
// screens: after the first call this is a no-op.
export async function hydrateContactsSummary(): Promise<void> {
  if (hydrated) return;
  hydrated = true;
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as Partial<ContactsSummarySnapshot>;
    // Only accept a shape we can actually render. A corrupt or half-written
    // record is dropped rather than painted as zeroes.
    if (typeof parsed.total !== 'number') return;
    snapshot = {
      total: parsed.total,
      bySource:
        parsed.bySource && typeof parsed.bySource === 'object' ? parsed.bySource : {},
      merged: typeof parsed.merged === 'number' ? parsed.merged : undefined,
      at: typeof parsed.at === 'number' ? parsed.at : 0,
    };
    notify();
  } catch {
    /* corrupt cache is not worth blocking the screen on */
  }
}

export function clearContactsSummary(): void {
  snapshot = null;
  notify();
  AsyncStorage.removeItem(KEY).catch(() => {});
}

// Hydrates on first mount and re-renders on every write.
export function useContactsSummaryCache(): ContactsSummarySnapshot | null {
  const value = useSyncExternalStore(subscribeContactsSummary, getContactsSummarySnapshot);
  useEffect(() => {
    void hydrateContactsSummary();
  }, []);
  return value;
}
