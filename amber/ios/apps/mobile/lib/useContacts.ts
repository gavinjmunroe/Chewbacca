import { useEffect, useRef, useState } from 'react';
import { medhaIdErrorCopy } from './medhaId';
import { listAllIdentities, type NetworkIdentity } from './network';

export type ContactsState = {
  items: NetworkIdentity[];
  status: 'loading' | 'done' | 'error';
  errorMsg?: string;
};

export function useContacts() {
  const [state, setState] = useState<ContactsState>({ items: [], status: 'loading' });

  const load = useRef(async () => {
    // ONLY SHOW THE SKELETON WHEN THERE IS NOTHING TO SHOW. This fired on every
    // load, including a pull-to-refresh and a background contacts sync finishing —
    // and ContactsList early-returns a skeleton on status:'loading', so 968 rows were
    // replaced by seven gray bars, the FlatList unmounted, and the scroll position
    // was lost. A refresh should leave what you are reading on screen.
    setState((s) => (s.items.length === 0 ? { ...s, status: 'loading' } : s));
    const res = await listAllIdentities();
    if (res.ok) {
      setState({ items: dedupeIdentities(res.data), status: 'done' });
    } else {
      // KEEP WHAT IS ALREADY ON SCREEN. This set items to [] on any failure, so a
      // dropped request mid-scroll wiped 968 rows and left an error card — the same
      // mistake the loading branch above was fixed for, in the other direction.
      // Stale contacts are strictly better than none: they are still accurate, and
      // the user was reading them. The error is only allowed to take over the screen
      // when there is nothing to take over.
      setState((s) => ({
        items: s.items,
        status: s.items.length > 0 ? 'done' : 'error',
        errorMsg: medhaIdErrorCopy(res, 'Amber'),
      }));
    }
  }).current;

  useEffect(() => {
    void load();
  }, [load]);

  return { ...state, reload: load };
}

export function dedupeIdentities(items: NetworkIdentity[]): NetworkIdentity[] {
  const seenIds = new Set<string>();
  const seenKeys = new Set<string>();
  const out: NetworkIdentity[] = [];
  for (const p of items) {
    if (p.id && seenIds.has(p.id)) continue;
    const name = (p.name ?? '').trim().toLowerCase();
    const handle = (p.handle ?? p.email ?? '').trim().toLowerCase();
    const key = name && handle ? `${name}|${handle}` : '';
    if (key && seenKeys.has(key)) continue;
    if (p.id) seenIds.add(p.id);
    if (key) seenKeys.add(key);
    out.push(p);
  }
  return out;
}

export function firstLetter(name: string): string {
  const c = name.trim().charAt(0).toUpperCase();
  return /[A-Z]/.test(c) ? c : '#';
}
