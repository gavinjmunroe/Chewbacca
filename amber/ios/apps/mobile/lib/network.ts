import { contactName } from './contactName';
import { callMedhaId, type MedhaIdResult } from './medhaId';

// UnifyNetwork client. For Monday launch this talks to the LIVE medha-id
// user-JWT surface (GET /v1/me/contacts), NOT the un-deployed medha-platform
// /v1/network/* engine. medha-id scopes every /v1/me/* route by the
// authenticated session (Privy DID or medha-id person_id), so a user only ever
// sees their own synced address book. Search and pagination are done
// client-side over the returned list because there is no live server-side
// semantic-search endpoint for OTP/person_id users yet (deferred to Wave 6).

export type NetworkMatch = {
  id?: string;
  name: string;
  source?: string;
  snippet?: string;
  score?: number;
};

export type NetworkIdentity = {
  id: string;
  name: string;
  platform?: string;
  source?: string;
  relationship_type?: string;
  handle?: string;
  email?: string;
  avatarUrl?: string;
  /**
   * THE AMBER ACCOUNT THIS CARD IS, when the server has resolved it
   * (contacts.linked_amber_id). Null on an ordinary address-book contact.
   *
   * Both of these together are the test for "this is a real person on Amber":
   * the app shows their identity and routes to their profile only when it has
   * an id to route with, so a half-resolved card can never render as a dead
   * link.
   */
  amberId?: string;
  username?: string;
};

export type NetworkCheck = {
  in_network: boolean;
  platform?: string;
  relationship_type?: string;
};

export type Page<T> = {
  items: T[];
  nextCursor?: string;
  hasMore: boolean;
};

// Shape of one row from GET /v1/me/contacts (db/user-store.js listContacts).
type MedhaContact = {
  id: string;
  name?: string;
  firstName?: string;
  lastName?: string;
  phoneNumbers?: string[];
  emails?: string[];
  company?: string;
  source?: string;
  sourceHandle?: string;
  amberId?: string | null;
  username?: string | null;
  avatarUrl?: string | null;
};

const PAGE_SIZE = 25;

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

function asContacts(value: unknown): MedhaContact[] {
  // listContacts returns a bare array; tolerate {contacts}/{data} wrappers too.
  if (Array.isArray(value)) return value as MedhaContact[];
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    for (const key of ['contacts', 'data', 'items']) {
      if (Array.isArray(obj[key])) return obj[key] as MedhaContact[];
    }
  }
  return [];
}

function subtitleFor(c: MedhaContact): string | undefined {
  return str(c.company) ?? str(c.emails?.[0]) ?? str(c.phoneNumbers?.[0]);
}

function toIdentity(c: MedhaContact): NetworkIdentity {
  return {
    id: c.id,
    name: contactName(c),
    platform: str(c.source) ?? 'apple',
    source: str(c.source) ?? 'apple',
    // Account identifiers remain routing metadata, never display names.
    email: str(c.emails?.[0]),
    avatarUrl: str(c.avatarUrl ?? undefined),
    amberId: str(c.amberId ?? undefined),
    username: str(c.username ?? undefined),
  };
}

// Short-lived in-process cache of the parsed contact list. listIdentities,
// listAllIdentities, searchNetwork, and checkNetwork all need the same address
// book; without this, four screen interactions in quick succession would each
// refetch the whole list. The transport dedups truly-concurrent calls, but this
// also reuses across the few seconds between sequential calls. Pull-to-refresh
// busts it via bustContactsCache().
const CONTACTS_TTL_MS = 5 * 60_000;
let contactsCache: { data: MedhaContact[]; at: number } | null = null;

export function bustContactsCache(): void {
  contactsCache = null;
}

// One fetch of the full contact list, memoized for CONTACTS_TTL_MS. medha-id
// returns the whole address book in one shot, so we page client-side from a
// cursor that is just a stringified offset.
async function fetchAllContacts(): Promise<MedhaIdResult<MedhaContact[]>> {
  if (contactsCache && Date.now() - contactsCache.at < CONTACTS_TTL_MS) {
    return { ok: true, status: 200, data: contactsCache.data };
  }
  const res = await callMedhaId<unknown>({
    path: '/v1/me/contacts',
    method: 'GET',
    requireAuth: true,
  });
  if (!res.ok) return res;
  const data = asContacts(res.data);
  contactsCache = { data, at: Date.now() };
  return { ok: true, status: res.status, data };
}

export async function listIdentities(
  cursor?: string,
): Promise<MedhaIdResult<Page<NetworkIdentity>>> {
  const res = await fetchAllContacts();
  if (!res.ok) return res;
  const all = res.data
    .filter((c) => str(c.name) || str(c.firstName) || str(c.lastName))
    .map(toIdentity)
    .sort((a, b) => a.name.localeCompare(b.name));
  const offset = Number(cursor) || 0;
  const slice = all.slice(offset, offset + PAGE_SIZE);
  const nextOffset = offset + PAGE_SIZE;
  const hasMore = nextOffset < all.length;
  return {
    ok: true,
    status: res.status,
    data: {
      items: slice,
      nextCursor: hasMore ? String(nextOffset) : undefined,
      hasMore,
    },
  };
}

// The caller's full network in one call, sorted A-Z. For views that render the
// whole list at once (FlatList virtualizes, so thousands of rows are fine)
// without the client-side cursor paging listIdentities does.
export async function listAllIdentities(): Promise<MedhaIdResult<NetworkIdentity[]>> {
  const res = await fetchAllContacts();
  if (!res.ok) return res;
  const all = res.data
    .filter((c) => str(c.name) || str(c.firstName) || str(c.lastName))
    .map(toIdentity)
    .sort((a, b) => a.name.localeCompare(b.name));
  return { ok: true, status: res.status, data: all };
}

// Client-side substring match across name, company, email, phone, and handle.
export async function searchNetwork(
  query: string,
  topK = 20,
): Promise<MedhaIdResult<NetworkMatch[]>> {
  const res = await fetchAllContacts();
  if (!res.ok) return res;
  const needle = query.trim().toLowerCase();
  const haystack = (c: MedhaContact) =>
    [
      c.name,
      c.firstName,
      c.lastName,
      c.company,
      c.sourceHandle,
      ...(c.emails ?? []),
      ...(c.phoneNumbers ?? []),
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();

  const matches = res.data
    .filter((c) => str(c.name) || str(c.firstName) || str(c.lastName))
    .filter((c) => (needle ? haystack(c).includes(needle) : true))
    .slice(0, topK)
    .map((c) => {
      const id = toIdentity(c);
      return {
        id: id.id,
        name: id.name,
        source: id.source,
        snippet: subtitleFor(c),
      } satisfies NetworkMatch;
    });
  return { ok: true, status: res.status, data: matches };
}

// "Is this person already in my network?" — resolved client-side against the
// synced contacts by email or handle. No dedicated live endpoint yet.
export async function checkNetwork(params: {
  email?: string;
  handle?: string;
}): Promise<MedhaIdResult<NetworkCheck>> {
  const res = await fetchAllContacts();
  if (!res.ok) return res;
  const email = params.email?.trim().toLowerCase();
  const handle = params.handle?.trim().toLowerCase().replace(/^@/, '');
  const hit = res.data.find((c) => {
    if (email && (c.emails ?? []).some((e) => e.toLowerCase() === email)) return true;
    if (handle && str(c.sourceHandle)?.toLowerCase().replace(/^@/, '') === handle) return true;
    return false;
  });
  return {
    ok: true,
    status: res.status,
    data: {
      in_network: !!hit,
      platform: hit ? (str(hit.source) ?? 'apple') : undefined,
      relationship_type: hit ? 'contact' : undefined,
    },
  };
}
