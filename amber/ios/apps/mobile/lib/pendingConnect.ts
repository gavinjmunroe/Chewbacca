import { useSyncExternalStore } from 'react';

// A pending "connect with @username" intent, arriving from a shared profile link.
//
// The shape mirrors lib/pendingRecord.ts on purpose: a module-level latch plus
// useSyncExternalStore, so the intent survives screen mounts/unmounts and a fresh
// object on every write lets subscribers detect the change by reference.
//
// WHY A LATCH RATHER THAN A ROUTE PARAM. The link can land in three different states
// and only one of them has a screen ready to receive a param:
//   - app already open and signed in  → the gated bridge consumes it immediately
//   - app cold-started by the link    → the URL arrives before the session is read,
//                                       so nothing authenticated exists yet
//   - app open but signed OUT         → the user has to sign in first, and the intent
//                                       has to outlive that whole detour
// A latch handles all three: whoever is ready first takes it, exactly once.
//
// Deliberately NOT persisted to disk. If the recipient does not have Amber installed,
// the intent is lost across the install, and recovering it would mean deferred deep
// linking (a fingerprint round-trip through a third party). That is a real feature,
// but it is not this one, and pretending otherwise with a half-working cache would be
// worse than the honest gap.

export type PendingConnect = {
  /** The username from the link, already stripped of any leading @. */
  username: string;
  /** Monotonic counter so two back-to-back links are distinct references. */
  nonce: number;
  /** When the link was opened (Date.now()), for the staleness check on consume. */
  at: number;
};

// Far more generous than pendingRecord's 15s, because the detour here is legitimately
// long: a brand-new user may tap a friend's link, sign up, grant contacts access and
// finish onboarding before anything can act on it. Ten minutes honors that whole
// path while still refusing to fire a connect request from a link tapped an hour ago
// in a session the user has long since forgotten about.
export const PENDING_CONNECT_TTL_MS = 10 * 60 * 1000;

let state: PendingConnect | null = null;
let nonce = 0;
let listeners: (() => void)[] = [];

function notify(): void {
  for (const l of listeners) l();
}

/**
 * A shared profile link was opened. Called from the root deep-link bridge, which may
 * well run before there is a session — that is the point.
 */
export function requestConnect(username: string): void {
  const clean = username.trim().replace(/^@+/, '');
  if (!clean) return;
  nonce += 1;
  state = { username: clean, nonce, at: Date.now() };
  notify();
}

/**
 * Take the pending intent and clear it. Clearing on read is what guarantees
 * exactly-once handling — without it, a bridge that remounts (or a second bridge
 * mounting) would fire a duplicate connect request for the same tap.
 */
export function consumeConnect(): PendingConnect | null {
  const current = state;
  if (current) {
    state = null;
    notify();
  }
  return current;
}

function subscribe(listener: () => void): () => void {
  listeners.push(listener);
  return () => {
    listeners = listeners.filter((l) => l !== listener);
  };
}

function getSnapshot(): PendingConnect | null {
  return state;
}

/** Subscribe to the pending intent. Consume it with consumeConnect(). */
export function usePendingConnect(): PendingConnect | null {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
