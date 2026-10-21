import { useSyncExternalStore } from 'react';

// A tiny module-level "pending voice capture" signal, shared by every EXTERNAL
// entry point that wants the app to open straight into a live recording (the
// Home Screen quick action today; a Home Screen widget and the Action Button
// later). It is deliberately NOT a route param: the record surface (the home
// pager) is already mounted as the app's main screen, so a param would not
// reliably re-fire when a warm quick action arrives while home is on-screen.
//
// The same module-level + useSyncExternalStore pattern as lib/syncState.ts:
// state survives screen mounts/unmounts, and a fresh object on every write lets
// subscribers detect the change by reference.
//
// Contract:
//   - requestVoiceCapture(source)  — an external entry asks to start recording.
//   - usePendingVoiceCapture()     — the record surface subscribes.
//   - consumeVoiceCapture()        — the record surface takes the request and
//                                    clears it, so it fires EXACTLY once.
// The `at` timestamp lets the consumer drop a stale request (e.g. the user was
// bounced through sign-in / onboarding before home mounted) so nothing ever
// auto-records long after the launch that asked for it.

export type PendingVoiceCapture = {
  /** Where the request came from — 'quick-action' now, 'widget' / 'action-button' later. */
  source: string;
  /** Monotonic counter so two back-to-back requests are distinct references. */
  nonce: number;
  /** When the request was made (Date.now()), for staleness checks on consume. */
  at: number;
};

// How long a pending request stays valid. A normal cold-start into home settles
// in well under a couple of seconds; anything older than this means the user
// took a detour (sign-in, onboarding, biometric unlock) and we must NOT
// surprise them with a recorder that opens itself much later.
export const PENDING_RECORD_TTL_MS = 15_000;

let state: PendingVoiceCapture | null = null;
let nonce = 0;
let listeners: (() => void)[] = [];

function notify(): void {
  for (const l of listeners) l();
}

/** External entry point signal: ask the record surface to start recording. */
export function requestVoiceCapture(source: string): void {
  nonce += 1;
  state = { source, nonce, at: Date.now() };
  notify();
}

/**
 * Take the pending request and clear it. Returns the request (so the caller can
 * read `source` / check `at`), or null if there is nothing pending. Clearing on
 * read is what guarantees exactly-once handling — even if the surface remounts.
 */
export function consumeVoiceCapture(): PendingVoiceCapture | null {
  const current = state;
  if (current) {
    state = null;
    notify();
  }
  return current;
}

export function getPendingVoiceCapture(): PendingVoiceCapture | null {
  return state;
}

export function subscribePendingVoiceCapture(listener: () => void): () => void {
  listeners = [...listeners, listener];
  return () => {
    listeners = listeners.filter((l) => l !== listener);
  };
}

/** Subscribe the record surface to pending requests. */
export function usePendingVoiceCapture(): PendingVoiceCapture | null {
  return useSyncExternalStore(subscribePendingVoiceCapture, getPendingVoiceCapture);
}
