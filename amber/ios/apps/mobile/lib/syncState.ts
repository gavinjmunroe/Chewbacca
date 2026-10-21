import { useSyncExternalStore } from 'react';

export type SyncStatus = 'idle' | 'syncing' | 'done' | 'error';

export type SyncState = {
  status: SyncStatus;
  synced: number;
  total: number;
  // Which address book is being pulled, already capitalized for display
  // ("Apple", "Google"). Optional because a caller that does not say gets a
  // source-less line ("Syncing contacts…") rather than a wrong attribution.
  source?: string;
};

// Module-level state survives screen mounts/unmounts. A new object is always
// created on write so useSyncExternalStore can detect changes by reference.
let state: SyncState = { status: 'idle', synced: 0, total: 0 };
let listeners: (() => void)[] = [];

function notify(): void {
  for (const l of listeners) l();
}

export function getSyncState(): SyncState {
  return state;
}

export function setSyncState(partial: Partial<SyncState>): void {
  state = { ...state, ...partial };
  notify();
}

export function subscribeSyncState(listener: () => void): () => void {
  listeners = [...listeners, listener];
  return () => {
    listeners = listeners.filter((l) => l !== listener);
  };
}

export function useSyncState(): SyncState {
  return useSyncExternalStore(subscribeSyncState, getSyncState);
}
