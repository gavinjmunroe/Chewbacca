import { QueryClient, focusManager, onlineManager } from '@tanstack/react-query';
import { AppState, type AppStateStatus } from 'react-native';
import { create } from 'zustand';
import { networkConfig } from './config';
import { addTransportListener, callMedhaId, flushQueue } from './medhaId';
import { api, fetchConnections } from './api';
import { listAllIdentities } from './network';

// Transport already retries idempotent calls with backoff and returns a typed
// {ok:false} envelope instead of throwing, so React Query's own retry would be
// redundant for those. We keep retry:1 as a thin safety net for any queryFn that
// genuinely throws, and refetchOnReconnect so caches refresh when we come back
// online. We do NOT refetch on focus by default: tabs opt in explicitly via
// prefetch so switching tabs never triggers a refetch storm on a large network.
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      gcTime: 5 * 60_000,
      retry: 1,
      refetchOnWindowFocus: false,
      refetchOnReconnect: true,
    },
  },
});

// ---------------------------------------------------------------------------
// Query keys + per-resource cache tuning (item 137)
// ---------------------------------------------------------------------------
// One place to declare how fresh each resource needs to be. Identity barely
// changes within a session; connections flip the moment an OAuth flow returns;
// PeopleRank answers are query-specific and never reused across prompts.
export const queryKeys = {
  me: ['me'] as const,
  connections: ['connections'] as const,
  contacts: ['contacts'] as const,
  peopleRank: (query: string) => ['peopleRank', query] as const,
  person: (id: string) => ['person', id] as const,
};

export const resourceOptions = {
  me: { staleTime: 5 * 60_000, gcTime: 30 * 60_000 },
  connections: { staleTime: 30_000, gcTime: 5 * 60_000 },
  contacts: { staleTime: 5 * 60_000, gcTime: 30 * 60_000 },
  peopleRank: { staleTime: 0, gcTime: 5 * 60_000 },
  person: { staleTime: 10 * 60_000, gcTime: 30 * 60_000 },
} as const;

// ---------------------------------------------------------------------------
// Warm-start prefetch (item 140)
// ---------------------------------------------------------------------------
// Pull the data the first interaction needs (identity + the full contact list)
// into the cache while the splash is still up, so the Amber and Profile tabs
// paint from cache instead of a spinner. Best-effort: failures are swallowed,
// the screens still fetch on mount.
export async function prefetchWarmStart(): Promise<void> {
  await Promise.allSettled([
    queryClient.prefetchQuery({
      queryKey: queryKeys.me,
      queryFn: () => api.me(),
      ...resourceOptions.me,
    }),
    queryClient.prefetchQuery({
      queryKey: queryKeys.contacts,
      queryFn: () => listAllIdentities(),
      ...resourceOptions.contacts,
    }),
    queryClient.prefetchQuery({
      queryKey: queryKeys.connections,
      queryFn: () => fetchConnections(),
      ...resourceOptions.connections,
    }),
  ]);
}

// ---------------------------------------------------------------------------
// Connectivity (item 148) + online/focus managers
// ---------------------------------------------------------------------------
// React Native has no built-in navigator.onLine, and we deliberately avoid a
// native NetInfo dependency. Instead we infer connectivity from the transport:
// every request reports whether the server was reachable. A run of failures
// flips us offline and starts a cheap reachability poll; the first reachable
// response flips us back and React Query refetches stale queries.

export type ConnectivityStatus = 'online' | 'offline' | 'reconnecting';

type ConnectivityState = {
  online: boolean;
  status: ConnectivityStatus;
};

export const useConnectivity = create<ConnectivityState>(() => ({
  online: true,
  status: 'online',
}));

let consecutiveFailures = 0;
let reachabilityTimer: ReturnType<typeof setTimeout> | null = null;

function setConnectivity(online: boolean, status: ConnectivityStatus): void {
  const prev = useConnectivity.getState();
  if (prev.online === online && prev.status === status) return;
  useConnectivity.setState({ online, status });
  onlineManager.setOnline(online);
}

function goOnline(): void {
  consecutiveFailures = 0;
  if (reachabilityTimer) {
    clearTimeout(reachabilityTimer);
    reachabilityTimer = null;
  }
  const wasOffline = !useConnectivity.getState().online;
  setConnectivity(true, 'online');
  // Drain anything that piled up while we were offline.
  if (wasOffline) void flushQueue();
}

function scheduleReachabilityPoll(): void {
  if (reachabilityTimer) return;
  reachabilityTimer = setTimeout(async () => {
    reachabilityTimer = null;
    useConnectivity.setState({ status: 'reconnecting' });
    // Any HTTP response (even 401) proves the network is back; the transport
    // listener below will call goOnline(). retries:0 keeps the probe cheap.
    await callMedhaId({ path: '/v1/me', retries: 0, tag: 'reachability' });
    if (!useConnectivity.getState().online) {
      useConnectivity.setState({ status: 'offline' });
      scheduleReachabilityPoll();
    }
  }, networkConfig.reachabilityPollMs);
}

function onTransportEvent(reachable: boolean): void {
  if (reachable) {
    goOnline();
    return;
  }
  consecutiveFailures += 1;
  if (
    consecutiveFailures >= networkConfig.offlineAfterFailures &&
    useConnectivity.getState().online
  ) {
    setConnectivity(false, 'offline');
    scheduleReachabilityPoll();
  }
}

// ---------------------------------------------------------------------------
// One-time wiring, deferred off the first frame (item 147)
// ---------------------------------------------------------------------------
let initialized = false;

export function initNetworking(): void {
  if (initialized) return;
  initialized = true;

  onlineManager.setOnline(true);

  addTransportListener((event) => onTransportEvent(event.reachable));

  // RN focus: when the app returns to the foreground, mark focused so stale
  // active queries refetch, and replay any queued writes.
  focusManager.setEventListener((handleFocus) => {
    const sub = AppState.addEventListener('change', (state: AppStateStatus) => {
      const active = state === 'active';
      handleFocus(active);
      if (active) void flushQueue();
    });
    return () => sub.remove();
  });

  // Attempt an initial drain in case a prior session left writes queued.
  void flushQueue();
}

// Defer init so importing this module (which _layout does) never blocks the
// first paint. A 0ms timeout runs after the current frame commits.
setTimeout(initNetworking, 0);
