import { Image } from 'expo-image';
import { callMedhaId, callOrQueue, type MedhaIdResult } from './medhaId';

// Narrow medha-id surface for the three-tab app. Each function returns
// MedhaIdResult<T> so screens handle ok/error uniformly.

export type Me = {
  id: string;
  displayName?: string;
  onboardingCompletedAt?: string | null;
  username?: string | null;
  bio?: string;
  currentCity?: string;
  // Lightweight profile detail fields. The client sends these on save now;
  // medha-id's MUTABLE_FIELDS whitelist must add them server-side to persist
  // (separate backend task — until then the server drops them harmlessly).
  mbti?: string;
  school?: string;
  hometown?: string;
  horoscope?: string;
  occupation?: string;
  avatarUrl?: string;
  phone?: string;
  phoneNumber?: string;
  privacyTier?: 'local_only' | 'limited' | 'public';
  createdAt?: string;
};

export type ConnectionRow = {
  platform: string;
  connected: boolean;
  configured?: boolean;
  missingConfig?: string[];
  scopes?: string[];
  connectedAt?: string;
  lastVerifiedAt?: string | null;
  needsScopeUpgrade?: boolean;
  missingRequiredScopes?: { label: string; scopesNeeded: string[] }[];
  account?: string;
  error?: string;
};

// medha-id returns GET /v1/me/connections as `{ platforms: [...] }` with
// snake_case rows (not a camelCase keyed object). The old client read
// `data.connections` — which is always undefined — so every card rendered as
// disconnected even when the account was connected on the web. Normalize the
// real shape (and tolerate a bare array / legacy keyed object) into a map keyed
// by platform, mirroring medha-frontend's lib/connections.ts buildSnapshot.
type RawConnection = {
  platform?: string;
  connected?: boolean;
  configured?: boolean;
  missing_config?: string[];
  scopes?: string[];
  connected_at?: string | null;
  last_verified_at?: string | null;
  needs_scope_upgrade?: boolean;
  missing_required_scopes?: { label?: string; scopes_needed?: string[] }[];
  account?: string | null;
  error?: string | null;
};

function normalizeConnections(data: unknown): Record<string, ConnectionRow> {
  const wrap = (data ?? {}) as {
    platforms?: RawConnection[];
    connections?: Record<string, RawConnection>;
  };
  const rows: RawConnection[] = Array.isArray(data)
    ? (data as RawConnection[])
    : (wrap.platforms ?? Object.values(wrap.connections ?? {}));

  const map: Record<string, ConnectionRow> = {};
  for (const row of rows) {
    if (!row || typeof row.platform !== 'string') continue;
    map[row.platform] = {
      platform: row.platform,
      connected: !!row.connected,
      configured: row.configured ?? true,
      missingConfig: row.missing_config ?? [],
      scopes: row.scopes,
      connectedAt: row.connected_at ?? undefined,
      lastVerifiedAt: row.last_verified_at ?? null,
      needsScopeUpgrade: row.needs_scope_upgrade ?? false,
      // Guard against null/non-object elements so a malformed entry can't throw
      // at s.label: drop them first, then map the survivors.
      missingRequiredScopes: (row.missing_required_scopes ?? [])
        .filter((s): s is NonNullable<typeof s> => !!s && typeof s === 'object')
        .map((s) => ({
          label: s.label ?? '',
          scopesNeeded: s.scopes_needed ?? [],
        })),
      account: row.account ?? undefined,
      error: row.error ?? undefined,
    };
  }
  return map;
}

export const api = {
  me: () => callMedhaId<{ data: Me } | Me>({ path: '/v1/me', requireAuth: true }),
  // return_to is the app deep link. medha-id's OAuth callbacks honor an
  // app-scheme return_to and redirect there on completion (instead of the web
  // /connect page), so the in-app auth session closes back into the app.
  oauthInit: (platform: string, calendarOnly = false) =>
    callMedhaId<{ authorize_url: string }>({
      // encodeURIComponent on the platform too: it is a plain string parameter,
      // and an unencoded value with a slash or a query character in it calls a
      // different endpoint than the caller asked for. Cheap, and it means every
      // interpolated path segment in the app follows one rule.
      path: `/v1/oauth/${encodeURIComponent(platform)}/init?return_to=${encodeURIComponent('amber://oauth-callback')}${calendarOnly ? '&purpose=calendar' : ''}`,
      requireAuth: true,
    }),
  oauthDisconnect: (platform: string) =>
    callMedhaId<{ ok: boolean }>({
      path: `/v1/oauth/${encodeURIComponent(platform)}`,
      method: 'DELETE',
      requireAuth: true,
    }),
  appleCredentials: (username: string, password: string) =>
    callMedhaId<{ connected: boolean }>({
      path: '/dnc/auth/apple/credentials',
      method: 'POST',
      body: { username, password },
      requireAuth: true,
    }),
  appleDisconnect: () =>
    callMedhaId<{ connected: boolean }>({
      path: '/dnc/auth/apple/credentials',
      method: 'DELETE',
      requireAuth: true,
    }),
};

// Fetch + normalize the caller's live connection status, keyed by platform.
export async function fetchConnections(): Promise<MedhaIdResult<Record<string, ConnectionRow>>> {
  const r = await callMedhaId<unknown>({ path: '/v1/me/connections', requireAuth: true });
  if (!r.ok) return r;
  return { ok: true, status: r.status, data: normalizeConnections(r.data) };
}

export function unwrapSingle<T>(r: MedhaIdResult<unknown>): T | null {
  if (!r.ok || !r.data) return null;
  if (typeof r.data !== 'object') return r.data as T;
  const obj = r.data as Record<string, unknown>;
  const v = obj.data;
  if (v && typeof v === 'object') return v as T;
  return r.data as T;
}

// PeopleRank continuous-training signals (item 139). The backend enum is exactly
// these four (medha-id POST /v1/me/people-rank/feedback). The UI updates
// optimistically; this call is best-effort and, if it fails purely on
// connectivity, is persisted by callOrQueue and replayed on reconnect (item 141)
// so a tap recorded offline still trains the ranker later.
export type FeedbackSignal = 'tap' | 'confirm' | 'dismiss' | 'open';

export function sendFeedbackSignal(
  contactId: string,
  signal: FeedbackSignal,
  weight?: number,
): Promise<MedhaIdResult<{ ok: boolean; recorded: boolean }> & { queued?: boolean }> {
  return callOrQueue<{ ok: boolean; recorded: boolean }>({
    path: '/v1/me/people-rank/feedback',
    method: 'POST',
    requireAuth: true,
    tag: 'POST /v1/me/people-rank/feedback',
    body: { contactId, signal, ...(weight !== undefined ? { weight } : {}) },
  });
}

// Warm the expo-image disk cache for a batch of avatar URLs so a rabbit-hole tap
// paints the face instantly instead of fetching on mount (item 142). Call this
// the moment a PeopleRank answer resolves with the top cards' avatars. Invalid
// or empty URLs are skipped; failures are swallowed (prefetch is an optimization,
// never a requirement).
export async function prefetchAvatars(urls: (string | undefined | null)[]): Promise<void> {
  const valid = urls.filter((u): u is string => typeof u === 'string' && /^https?:\/\//.test(u));
  if (valid.length === 0) return;
  try {
    await Image.prefetch(valid, { cachePolicy: 'disk' });
  } catch {
    // best-effort
  }
}
