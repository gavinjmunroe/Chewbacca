import { useCallback, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { callMedhaId, medhaIdErrorCopy, type MedhaIdResult } from './medhaId';

// The sharing engine client. A share is one privacy-ledger line: "this item is
// visible to this audience." Items are experiences (now), posts + interactions +
// media (later). Notes and facts are never shareable. Audiences: one contact,
// one circle, or the whole connected network. Sharing to several circles = one
// call per circle.

export type ShareItemType = 'experience' | 'post' | 'interaction';
export type ShareScopeType = 'contact' | 'circle' | 'network';

export type ShareTarget = {
  id: string;
  scopeType: ShareScopeType;
  scopeRef: string | null;
};

export type SharedItemContent = {
  text: string;
  occurredAt: string | null;
  location: string | null;
};

export type SharedItem = {
  shareId: string;
  itemType: ShareItemType;
  itemId: string;
  scopeType: ShareScopeType;
  scopeRef: string | null;
  createdAt: string | null;
  content: SharedItemContent | null;
  owner: {
    amberId: string;
    name: string | null;
    username: string | null;
    avatarUrl: string | null;
  };
};

type ShareArgs = {
  itemType: ShareItemType;
  itemId: string;
  scopeType: ShareScopeType;
  scopeRef?: string | null;
};

export function createShare(args: ShareArgs): Promise<MedhaIdResult<{ share: { id: string } }>> {
  return callMedhaId<{ share: { id: string } }>({
    path: '/v1/me/shares',
    method: 'POST',
    body: {
      itemType: args.itemType,
      itemId: args.itemId,
      scopeType: args.scopeType,
      ...(args.scopeRef != null ? { scopeRef: args.scopeRef } : {}),
    },
    requireAuth: true,
  });
}

export function unshare(args: ShareArgs): Promise<MedhaIdResult<{ unshared: boolean }>> {
  return callMedhaId<{ unshared: boolean }>({
    path: '/v1/me/shares/unshare',
    method: 'POST',
    body: {
      itemType: args.itemType,
      itemId: args.itemId,
      scopeType: args.scopeType,
      ...(args.scopeRef != null ? { scopeRef: args.scopeRef } : {}),
    },
    requireAuth: true,
  });
}

export function listSharesForItem(
  itemType: ShareItemType,
  itemId: string,
): Promise<MedhaIdResult<{ shares: ShareTarget[] }>> {
  const qs = `itemType=${encodeURIComponent(itemType)}&itemId=${encodeURIComponent(itemId)}`;
  return callMedhaId<{ shares: ShareTarget[] }>({
    path: `/v1/me/shares/for-item?${qs}`,
    method: 'GET',
    requireAuth: true,
  });
}

export function listSharedWithMe(): Promise<MedhaIdResult<{ items: SharedItem[] }>> {
  return callMedhaId<{ items: SharedItem[] }>({
    path: '/v1/me/shared-with-me',
    method: 'GET',
    requireAuth: true,
  });
}

export type SharedWithMeState = {
  items: SharedItem[];
  status: 'loading' | 'done' | 'error';
  errorMsg?: string;
};

export function useSharedWithMe() {
  const [state, setState] = useState<SharedWithMeState>({ items: [], status: 'loading' });

  const load = useRef(async () => {
    setState((s) => ({ ...s, status: 'loading' }));
    const res = await listSharedWithMe();
    if (res.ok) {
      setState({ items: res.data.items, status: 'done' });
    } else {
      setState({ items: [], status: 'error', errorMsg: medhaIdErrorCopy(res, 'Amber') });
    }
  }).current;

  // Refetch on focus so newly shared items appear when you return to a screen.
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  return { ...state, reload: load };
}
