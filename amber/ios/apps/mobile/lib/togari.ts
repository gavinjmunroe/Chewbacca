import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { togariRest } from './config';

// Read-only Togari REST client for the Professional tab. Togari is a CONSUMER
// surface here: we only call documented GET/match endpoints and never mutate.
//
// Credentials are layered. A build-time host/token can be wired through
// config.ts (togariRest), but in practice the app ships with those blank, so a
// user connects a read-only workspace at runtime: the token is held in
// expo-secure-store and the effective creds are (runtime ?? build). Connecting
// flips the tab from "degraded" to "live" without an app restart. When neither
// layer has a host + token, every call short-circuits to `not_configured` so
// the UI renders a polished "Connect your Togari workspace" state instead of an
// error. On 401/403 we report `unauthorized` so the UI can prompt a reconnect.
//
// Endpoints + auth shape are per Karthik's repo:
//   GET  /api/contacts/search?q=&limit=&offset=  -> { contacts[], count, next_offset }  (Auth0 JWT)
//   POST /api/v1/people/match                     -> MatchResult                         (tgi_live_* bearer)
//   GET  /api/deals?limit=&offset=&stage=&owner=  -> { deals[], next_offset }            (Auth0 JWT)

export type TogariContact = {
  id?: string;
  fullName?: string;
  currentTitle?: string;
  currentCompany?: string;
  workEmail?: string;
  linkedinUrl?: string;
};

export type TogariDeal = {
  id?: string;
  name?: string;
  stage?: string;
  amount?: number;
  company?: string;
  owner?: string;
  // Last interaction timestamp (ISO). Drives the "last touch" line and the
  // recency filter. Tolerant of several backend field names on parse.
  lastTouch?: string;
};

export type UnifiedContact = {
  fullName?: string;
  currentTitle?: string;
  currentCompany?: string;
  workEmail?: string;
  linkedinUrl?: string;
};

export type MatchResult = {
  matched: boolean;
  contact?: UnifiedContact;
  confidence?: number;
  matched_on?: string[];
};

export type TogariError =
  | 'not_configured'
  | 'unauthorized'
  | 'network_error'
  | 'timeout'
  | 'bad_response'
  | `http_${number}`;

export type TogariResult<T> = { ok: true; data: T } | { ok: false; error: TogariError };

// ── Credentials (runtime, secure-store) ──────────────────────────

export type TogariCreds = { baseUrl: string; token: string };

const HOST_KEY = 'togari_ws_host_v1';
const TOKEN_KEY = 'togari_ws_token_v1';

// The documented production host. Used as the default when a user connects with
// only a token (the common case) and no build-time host is set.
const DEFAULT_HOST = 'https://togari.bluemodernadvisory.com';

// In-memory snapshot so React components can check configuration synchronously.
// Hydrated from secure-store on first tab mount via hydrateTogariCreds(); writes
// keep it in sync so a connect/disconnect reflects immediately.
let credsCache: TogariCreds | null = null;

function effective(runtime: TogariCreds | null): TogariCreds {
  const baseUrl = (runtime?.baseUrl || togariRest.baseUrl || '').trim();
  const token = (runtime?.token || togariRest.token || '').trim();
  return { baseUrl, token };
}

function currentCreds(): TogariCreds {
  return effective(credsCache);
}

export function isTogariConfigured(): boolean {
  const c = currentCreds();
  return c.baseUrl.length > 0 && c.token.length > 0;
}

// Load persisted creds into the in-memory cache. Call once on tab mount before
// reading isTogariConfigured(). Safe to call repeatedly.
export async function hydrateTogariCreds(): Promise<TogariCreds> {
  try {
    const [host, token] = await Promise.all([
      SecureStore.getItemAsync(HOST_KEY),
      SecureStore.getItemAsync(TOKEN_KEY),
    ]);
    credsCache = { baseUrl: host ?? '', token: token ?? '' };
  } catch {
    credsCache = { baseUrl: '', token: '' };
  }
  return currentCreds();
}

// Validate a host + token by making one real read-only call, and only persist
// if it succeeds. This is what flips the tab to "live". A blank host falls back
// to the documented production host so a user can connect with just a token.
export async function connectTogari(input: {
  token: string;
  host?: string;
}): Promise<TogariResult<TogariCreds>> {
  const token = input.token.trim();
  const baseUrl = (input.host?.trim() || DEFAULT_HOST).replace(/\/$/, '');
  if (!token) return { ok: false, error: 'not_configured' };

  const probe = await rawCall<unknown>(
    { baseUrl, token },
    `/api/deals?${new URLSearchParams({ limit: '1' }).toString()}`,
  );
  if (!probe.ok) return probe;

  try {
    await Promise.all([
      SecureStore.setItemAsync(HOST_KEY, baseUrl),
      SecureStore.setItemAsync(TOKEN_KEY, token),
    ]);
  } catch {
    return { ok: false, error: 'bad_response' };
  }
  credsCache = { baseUrl, token };
  return { ok: true, data: currentCreds() };
}

export async function disconnectTogari(): Promise<void> {
  credsCache = { baseUrl: '', token: '' };
  await Promise.all([
    SecureStore.deleteItemAsync(HOST_KEY).catch(() => undefined),
    SecureStore.deleteItemAsync(TOKEN_KEY).catch(() => undefined),
    AsyncStorage.removeItem(CACHE_KEY).catch(() => undefined),
  ]);
}

// ── Transport ────────────────────────────────────────────────────

const TIMEOUT_MS = 12_000;

async function rawCall<T>(
  creds: TogariCreds,
  path: string,
  init?: RequestInit,
): Promise<TogariResult<T>> {
  if (!creds.baseUrl || !creds.token) return { ok: false, error: 'not_configured' };

  const base = creds.baseUrl.replace(/\/$/, '');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(`${base}${path}`, {
      ...init,
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${creds.token}`,
        ...(init?.body ? { 'content-type': 'application/json' } : {}),
        ...(init?.headers ?? {}),
      },
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (res.status === 401 || res.status === 403) return { ok: false, error: 'unauthorized' };
    if (!res.ok) return { ok: false, error: `http_${res.status}` };

    // Wrap text parsing so a null/empty body can't throw (the class of bug
    // that surfaced elsewhere in the app).
    let text = '';
    try {
      text = await res.text();
    } catch {
      return { ok: false, error: 'bad_response' };
    }
    if (!text) return { ok: true, data: {} as T };
    try {
      return { ok: true, data: JSON.parse(text) as T };
    } catch {
      return { ok: false, error: 'bad_response' };
    }
  } catch (e: unknown) {
    clearTimeout(timeout);
    const aborted = e instanceof Error && e.name === 'AbortError';
    return { ok: false, error: aborted ? 'timeout' : 'network_error' };
  }
}

function call<T>(path: string, init?: RequestInit): Promise<TogariResult<T>> {
  return rawCall<T>(currentCreds(), path, init);
}

// ── Queries ──────────────────────────────────────────────────────

export type DealFilters = {
  stage?: string;
  owner?: string;
};

export type Page = {
  limit?: number;
  offset?: number;
};

export type DealsPage = {
  deals: TogariDeal[];
  nextOffset: number | null;
};

function asNumber(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

function parseDeal(raw: Record<string, unknown>): TogariDeal {
  const s = (k: string): string | undefined => {
    const v = raw[k];
    return typeof v === 'string' && v.length > 0 ? v : undefined;
  };
  return {
    id: s('id') ?? s('deal_id'),
    name: s('name') ?? s('title'),
    stage: s('stage') ?? s('status'),
    amount: asNumber(raw.amount) ?? asNumber(raw.value),
    company: s('company') ?? s('company_name') ?? s('account'),
    owner: s('owner') ?? s('owner_name') ?? s('assignee'),
    lastTouch: s('lastTouch') ?? s('last_touch') ?? s('last_interaction_at') ?? s('updated_at'),
  };
}

function parseContact(raw: Record<string, unknown>): TogariContact {
  const s = (k: string): string | undefined => {
    const v = raw[k];
    return typeof v === 'string' && v.length > 0 ? v : undefined;
  };
  return {
    id: s('id') ?? s('contact_id'),
    fullName: s('fullName') ?? s('full_name') ?? s('name'),
    currentTitle: s('currentTitle') ?? s('current_title') ?? s('title'),
    currentCompany: s('currentCompany') ?? s('current_company') ?? s('company'),
    workEmail: s('workEmail') ?? s('work_email') ?? s('email'),
    linkedinUrl: s('linkedinUrl') ?? s('linkedin_url') ?? s('linkedin'),
  };
}

function nextOffsetFrom(data: Record<string, unknown>, page: Page, returned: number): number | null {
  const explicit = asNumber(data.next_offset) ?? asNumber(data.nextOffset);
  if (explicit !== undefined) return explicit;
  // Infer: if we got a full page back, assume there is another one.
  const limit = page.limit ?? 25;
  if (returned >= limit) return (page.offset ?? 0) + returned;
  return null;
}

export async function listDeals(
  filters: DealFilters = {},
  page: Page = {},
): Promise<TogariResult<DealsPage>> {
  const params = new URLSearchParams();
  params.set('limit', String(page.limit ?? 25));
  if (page.offset) params.set('offset', String(page.offset));
  if (filters.stage) params.set('stage', filters.stage);
  if (filters.owner) params.set('owner', filters.owner);

  const res = await call<unknown>(`/api/deals?${params.toString()}`);
  if (!res.ok) return res;

  const data = res.data;
  const rawList: unknown[] = Array.isArray(data)
    ? data
    : ((data as { deals?: unknown[] })?.deals ?? []);
  const deals = rawList
    .filter((d): d is Record<string, unknown> => !!d && typeof d === 'object')
    .map(parseDeal);
  const wrap = (Array.isArray(data) ? {} : (data as Record<string, unknown>)) ?? {};
  return { ok: true, data: { deals, nextOffset: nextOffsetFrom(wrap, page, deals.length) } };
}

export type ContactsPage = {
  contacts: TogariContact[];
  count: number;
  nextOffset: number | null;
};

export async function searchContacts(q: string, page: Page = {}): Promise<TogariResult<ContactsPage>> {
  const query = q.trim();
  if (query.length < 2) return { ok: true, data: { contacts: [], count: 0, nextOffset: null } };
  const params = new URLSearchParams({ q: query, limit: String(page.limit ?? 25) });
  if (page.offset) params.set('offset', String(page.offset));

  const res = await call<unknown>(`/api/contacts/search?${params.toString()}`);
  if (!res.ok) return res;

  const data = res.data;
  const rawList: unknown[] = Array.isArray(data)
    ? data
    : ((data as { contacts?: unknown[] })?.contacts ?? []);
  const contacts = rawList
    .filter((c): c is Record<string, unknown> => !!c && typeof c === 'object')
    .map(parseContact);
  const wrap = (Array.isArray(data) ? {} : (data as Record<string, unknown>)) ?? {};
  const count = asNumber(wrap.count) ?? contacts.length;
  return {
    ok: true,
    data: { contacts, count, nextOffset: nextOffsetFrom(wrap, page, contacts.length) },
  };
}

export async function matchPerson(input: {
  name?: string;
  email?: string;
  linkedin?: string;
  phone?: string;
}): Promise<TogariResult<MatchResult>> {
  const res = await call<MatchResult>('/api/v1/people/match', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  if (!res.ok) return res;
  return { ok: true, data: { ...res.data, matched: !!res.data.matched } };
}

// ── Persistent cache (AsyncStorage) ──────────────────────────────
//
// Keep the last successful deals payload + sync timestamp on disk so the tab is
// never blank on a cold start over a flaky network: we paint cached data
// immediately, then refresh in the background.

const CACHE_KEY = 'togari_cache_v1';

export type WorkspaceCache = {
  deals: TogariDeal[];
  syncedAt: number;
};

export async function readWorkspaceCache(): Promise<WorkspaceCache | null> {
  try {
    const raw = await AsyncStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<WorkspaceCache>;
    if (!Array.isArray(parsed.deals) || typeof parsed.syncedAt !== 'number') return null;
    return { deals: parsed.deals, syncedAt: parsed.syncedAt };
  } catch {
    return null;
  }
}

export async function writeWorkspaceCache(deals: TogariDeal[], syncedAt: number): Promise<void> {
  try {
    const payload: WorkspaceCache = { deals, syncedAt };
    await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(payload));
  } catch {
    /* cache is best-effort */
  }
}

// Distinct, sorted filter values derived from a loaded deal set. Drives the
// stage/owner filter chips client-side so filtering works even on cached data.
export function deriveStages(deals: TogariDeal[]): string[] {
  return uniqueSorted(deals.map((d) => d.stage));
}

export function deriveOwners(deals: TogariDeal[]): string[] {
  return uniqueSorted(deals.map((d) => d.owner));
}

function uniqueSorted(values: (string | undefined)[]): string[] {
  const set = new Set<string>();
  for (const v of values) {
    if (v && v.trim()) set.add(v.trim());
  }
  return [...set].sort((a, b) => a.localeCompare(b));
}

// Coarse "x ago" for the last-synced line. `now` is passed in so the caller
// owns the clock (keeps this pure and testable).
export function timeAgo(ms: number, now: number): string {
  const diff = Math.max(0, now - ms);
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export function togariErrorCopy(error: TogariError): string {
  switch (error) {
    case 'not_configured':
      return 'Connect your Togari workspace to see your deals and contacts.';
    case 'unauthorized':
      return 'That workspace token is no longer valid. Reconnect to continue.';
    case 'timeout':
      return 'Togari took too long to respond. Try again.';
    case 'network_error':
      return 'Could not reach Togari. Check your connection and try again.';
    default:
      return 'Togari is having a moment. Try again shortly.';
  }
}
