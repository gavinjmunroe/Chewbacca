import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { callMedhaId, medhaIdErrorCopy, type MedhaIdResult } from './medhaId';

// Circles REST surface on medha-id. Same authed transport + typed {ok}
// envelope as lib/conversations.ts / lib/network.ts — callers branch on
// `res.ok` the same way.

export type CircleMember = {
  contactId: string;
  name: string;
  avatarUrl: string | null;
  connected: boolean;
  /**
   * The Amber account this member IS, once the server has resolved their
   * contact card to one. Null for a member who is only an address-book entry.
   *
   * `connected` has been here all along and it is only a boolean -- enough to
   * know that a member has an account, not enough to show it or open it. So a
   * member with a username and an avatar rendered as a contact card captioned
   * with whichever raw field was to hand. These two are what let the row be the
   * person instead.
   */
  amberId: string | null;
  username: string | null;
};

export type CircleOwner = {
  amberId: string;
  name: string | null;
  username: string | null;
  avatarUrl: string | null;
};

export type CirclePreview = {
  id: string;
  name: string;
  color: string | null;
  description?: string | null;
  /**
   * WHAT KIND OF CIRCLE THIS IS, AS THE USER SAID SO. Free text -- Work,
   * Friends, Family and School are offered in the picker and anything can be
   * typed. The profile web groups its sectors by this and puts it on each
   * node's flag.
   *
   * It replaces `classifiedKind`, which a model produced from the circle's name
   * and description. That vocabulary was the classifier's, not anybody's: a
   * circle for your family came back "other" and a circle for your street came
   * back "affiliation". It also needed a description to work at all, which is
   * what made creating a circle refuse to proceed without one.
   */
  kindTag?: string | null;
  /**
   * The old model-assigned kind. Still sent by the server so nothing breaks
   * mid-rollout; nothing should arrange itself around it. Prefer `kindTag`.
   */
  classifiedKind?: 'interest' | 'experience' | 'affiliation' | 'other' | null;
  memberCount: number;
  connectedCount: number;
  preview: CircleMember[];
  createdAt: string;
  updatedAt: string;
  // Present only on inbound circles (ones someone else added you to).
  origin?: 'inbound';
  seen?: boolean;
  owner?: CircleOwner;
  /**
   * WHETHER THEY HAVE SAID YES TO BEING IN THIS CIRCLE.
   *
   * 'pending' means somebody put them in it and they have not answered -- show
   * the Accept / Decline prompt. Anything else, including the field being
   * absent, means carry on exactly as before: the server sends 'accepted' for
   * every circle that has no invite row, which is everyone who was already in
   * one before this existed.
   *
   * 'declined' never arrives in a list (the server filters those out); it is
   * here because it is a value the respond call returns.
   */
  invite?: 'pending' | 'accepted' | 'declined';
  // Voice-note feed markers (added by the sharing backend). unseenCount is how
  // many shared notes in this circle the user hasn't opened; hasUnseen drives
  // the amber glowing dot on the circles grid. Cleared when the circle feed is
  // opened (the feed GET auto-marks seen), so a refetch drops the dot.
  unseenCount?: number;
  hasUnseen?: boolean;
};

export type ContactCircle = {
  id: string;
  name: string;
  color: string | null;
  description: string | null;
};

export function listCircles(): Promise<MedhaIdResult<{ circles: CirclePreview[] }>> {
  return callMedhaId<{ circles: CirclePreview[] }>({
    path: '/v1/me/circles',
    method: 'GET',
    requireAuth: true,
  });
}

/**
 * EVERY MEMBER OF EVERY CIRCLE, IN ONE REQUEST.
 *
 * The web draws one ring out of all of them and the filter pills count all of
 * them, so the page needs the whole set before it draws anything. The preview on
 * /v1/me/circles is capped at thirty per circle and exists for the pinned grid;
 * this is for the surfaces that need everybody.
 *
 * Keyed by circle id on arrival, which is the shape buildWeb takes.
 */
export type AllCircleMembers = { members: (CircleMember & { circleId: string })[] };

export function listAllCircleMembers(): Promise<MedhaIdResult<AllCircleMembers>> {
  return callMedhaId<AllCircleMembers>({
    path: '/v1/me/circles/members',
    method: 'GET',
    requireAuth: true,
  });
}

/**
 * The same rows, grouped the way buildWeb wants them.
 *
 * A SEPARATE FUNCTION so it can be tested without a network: the grouping is
 * where a wrong key silently produces an empty ring, and "it looked fine" is not
 * a thing anybody can check by eye on a ring of ninety faces.
 */
export function groupMembersByCircle(
  rows: (CircleMember & { circleId: string })[] | null | undefined,
): Map<string, CircleMember[]> {
  const out = new Map<string, CircleMember[]>();
  for (const r of rows ?? []) {
    if (!r?.circleId || !r?.contactId) continue;
    const list = out.get(r.circleId);
    const member: CircleMember = {
      contactId: r.contactId,
      name: r.name,
      avatarUrl: r.avatarUrl ?? null,
      connected: !!r.connected,
      amberId: r.amberId ?? null,
      username: r.username ?? null,
    };
    if (list) list.push(member);
    else out.set(r.circleId, [member]);
  }
  return out;
}

// Circles other people have added you to. Same shape as your own, plus owner +
// seen. Resolved server-side by account link or the phone you registered with.
export function listInboundCircles(): Promise<MedhaIdResult<{ circles: CirclePreview[] }>> {
  return callMedhaId<{ circles: CirclePreview[] }>({
    path: '/v1/me/circles/inbound',
    method: 'GET',
    requireAuth: true,
  });
}

/**
 * ANSWER AN INVITATION TO SOMEBODY ELSE'S CIRCLE.
 *
 * `accept: false` also removes the membership server-side, and records the
 * decline so the owner's next address-book sync does not put the same circle
 * back in front of them.
 */
export function respondToCircleInvite(
  id: string,
  accept: boolean,
): Promise<MedhaIdResult<{ status: 'accepted' | 'declined' }>> {
  return callMedhaId<{ status: 'accepted' | 'declined' }>({
    path: `/v1/me/circles/${encodeURIComponent(id)}/invite`,
    method: 'POST',
    body: { accept },
    requireAuth: true,
  });
}

// Clear the "you were added" banner + new marker for an inbound circle.
export function markCircleSeen(id: string): Promise<MedhaIdResult<{ seen: boolean }>> {
  return callMedhaId<{ seen: boolean }>({
    path: `/v1/me/circles/${encodeURIComponent(id)}/seen`,
    method: 'POST',
    requireAuth: true,
  });
}

// Leave an inbound circle (a circle someone else owns). Owners delete instead.
export function leaveCircle(id: string): Promise<MedhaIdResult<{ left: boolean }>> {
  return callMedhaId<{ left: boolean }>({
    path: `/v1/me/circles/${encodeURIComponent(id)}/membership`,
    method: 'DELETE',
    requireAuth: true,
  });
}

export function getCirclesForContact(
  contactId: string,
): Promise<MedhaIdResult<{ circles: ContactCircle[] }>> {
  return callMedhaId<{ circles: ContactCircle[] }>({
    path: `/v1/me/contacts/${encodeURIComponent(contactId)}/circles`,
    method: 'GET',
    requireAuth: true,
  });
}

export function createCircle(
  name: string,
  color?: string,
  description?: string,
  kindTag?: string,
): Promise<MedhaIdResult<{ circle: CirclePreview }>> {
  return callMedhaId<{ circle: CirclePreview }>({
    path: '/v1/me/circles',
    method: 'POST',
    body: {
      name,
      ...(color !== undefined ? { color } : {}),
      ...(description !== undefined ? { description } : {}),
      ...(kindTag !== undefined ? { kindTag } : {}),
    },
    requireAuth: true,
  });
}

export function updateCircle(
  id: string,
  // kindTag: '' clears it, so a circle can go back to untagged.
  updates: { name?: string; color?: string; description?: string; kindTag?: string },
): Promise<MedhaIdResult<{ circle: CirclePreview }>> {
  return callMedhaId<{ circle: CirclePreview }>({
    path: `/v1/me/circles/${encodeURIComponent(id)}`,
    method: 'PATCH',
    body: updates,
    requireAuth: true,
  });
}

export function deleteCircle(id: string): Promise<MedhaIdResult<{ deleted: boolean }>> {
  return callMedhaId<{ deleted: boolean }>({
    path: `/v1/me/circles/${encodeURIComponent(id)}`,
    method: 'DELETE',
    requireAuth: true,
  });
}

export function getCircleMembers(id: string): Promise<MedhaIdResult<{ members: CircleMember[] }>> {
  return callMedhaId<{ members: CircleMember[] }>({
    path: `/v1/me/circles/${encodeURIComponent(id)}/members`,
    method: 'GET',
    requireAuth: true,
  });
}

export function addCircleMember(
  id: string,
  contactId: string,
): Promise<MedhaIdResult<{ added?: boolean; already_present?: boolean }>> {
  return callMedhaId<{ added?: boolean; already_present?: boolean }>({
    path: `/v1/me/circles/${encodeURIComponent(id)}/members`,
    method: 'POST',
    body: { contactId },
    requireAuth: true,
  });
}

/**
 * REPLACE A CIRCLE'S WHOLE MEMBERSHIP IN ONE REQUEST.
 *
 * `contactIds` is the membership the circle should have when this returns --
 * not a delta. The server diffs it against what is there, inserts and deletes
 * in one statement each, and schedules the fact reconcile once instead of per
 * member.
 *
 * This exists because saving a circle used to be one HTTP request per added or
 * removed member, and each of those requests awaited a full member-fact
 * reconcile for the whole circle plus a push notification. Twenty members was
 * twenty round trips, each doing quadratic work -- which is the ten minutes.
 *
 * `unknown` counts ids that are not this owner's contacts. They are not an
 * error and not a failure to sync: they were never addable. Report them as
 * skipped, never as "N members failed".
 */
export function setCircleMembers(
  id: string,
  contactIds: string[],
): Promise<MedhaIdResult<{ added: number; removed: number; unknown: number; memberCount: number }>> {
  return callMedhaId<{ added: number; removed: number; unknown: number; memberCount: number }>({
    path: `/v1/me/circles/${encodeURIComponent(id)}/members`,
    method: 'PUT',
    body: { contactIds },
    requireAuth: true,
  });
}

export function removeCircleMember(
  id: string,
  contactId: string,
): Promise<MedhaIdResult<{ removed: boolean }>> {
  return callMedhaId<{ removed: boolean }>({
    path: `/v1/me/circles/${encodeURIComponent(id)}/members/${encodeURIComponent(contactId)}`,
    method: 'DELETE',
    requireAuth: true,
  });
}

export type CirclesState = {
  items: CirclePreview[];
  status: 'loading' | 'done' | 'error';
  errorMsg?: string;
};

// Last successfully loaded circles, kept at module scope so a remount (switching
// to the Ask tab, opening the overlay) paints the circles INSTANTLY from cache
// and refetches in the background, instead of flashing empty for a beat.
let circlesCache: CirclePreview[] | null = null;

/**
 * Drop the module-scope cache. MUST be called on sign-out.
 *
 * This cache lives outside React Query, so queryClient.clear() does not touch
 * it. Before this existed, signing out and signing in as someone else painted
 * the PREVIOUS user's circle names, member counts and member avatars with
 * status:'done' on the first frame, until the new user's fetch landed. That is a
 * privacy defect, not a rendering glitch.
 */
export function clearCirclesCache(): void {
  circlesCache = null;
  notifyCircles();
}

// ── THE CACHE IS OBSERVABLE, SO AN EDIT SHOWS UP ON THE SAME FRAME ───────────
//
// "When I edit circles and stuff, it doesn't immediately show the change in the
//  web card. It shows it after a second, so I would like it to be faster."
//
// The second was a round trip. Saving a circle cleared this cache and invalidated
// a query key, and every surface that draws circles -- the web on your profile,
// the grid, the pinned tiles -- waited for GET /v1/me/circles to come back before
// it knew anything had changed. The answer was already in his hand: he had just
// typed the name and picked the members, and the save response echoed them.
//
// So the cache notifies. `patchCircleLocally` writes what we already know into
// it and every mounted useCircles repaints immediately; the refetch still
// happens on focus and remains the authority, it just no longer gates the
// drawing. If the server disagrees, the next load corrects it -- which is the
// right shape for optimism: instant, and self-healing.
let circleListeners: (() => void)[] = [];

function notifyCircles(): void {
  for (const l of circleListeners) l();
}

function subscribeCircles(fn: () => void): () => void {
  circleListeners = [...circleListeners, fn];
  return () => {
    circleListeners = circleListeners.filter((l) => l !== fn);
  };
}

/**
 * Merge known-good fields into one cached circle, or prepend it if it is new.
 *
 * Only pass values the server has confirmed (an update/create response) or that
 * cannot be wrong (the membership the editor just sent). Guessing here would
 * paint something false for a second, which is worse than painting the truth a
 * second late.
 */
export function patchCircleLocally(id: string, patch: Partial<CirclePreview>): void {
  if (!circlesCache) return;
  const at = circlesCache.findIndex((c) => c.id === id);
  if (at < 0) return;
  const next = circlesCache.slice();
  next[at] = { ...next[at], ...patch };
  circlesCache = next;
  notifyCircles();
}

/** A circle that has just been created, so the grid and the web draw it at once. */
export function addCircleLocally(circle: CirclePreview): void {
  if (!circlesCache) return;
  if (circlesCache.some((c) => c.id === circle.id)) {
    patchCircleLocally(circle.id, circle);
    return;
  }
  circlesCache = [circle, ...circlesCache];
  notifyCircles();
}

/** A circle that has just been deleted or left. */
export function removeCircleLocally(id: string): void {
  if (!circlesCache) return;
  circlesCache = circlesCache.filter((c) => c.id !== id);
  notifyCircles();
}

export function useCircles() {
  const [state, setState] = useState<CirclesState>(
    circlesCache
      ? { items: circlesCache, status: 'done' }
      : { items: [], status: 'loading' },
  );

  // Repaint the moment the cache is patched by an edit somewhere else in the
  // app. Not a refetch -- the values written there are ones we already know.
  useEffect(
    () =>
      subscribeCircles(() => {
        if (circlesCache) setState({ items: circlesCache, status: 'done' });
        else setState({ items: [], status: 'loading' });
      }),
    [],
  );

  const load = useRef(async () => {
    // Keep whatever is on screen (cache) while refetching; only flip to a bare
    // loading state if we have nothing yet.
    setState((s) => ({ ...s, status: s.items.length > 0 ? 'done' : 'loading' }));
    // Own circles and inbound circles (ones others added you to) load together;
    // inbound ones carry origin: 'inbound' and a seen flag for the new marker.
    const [own, inbound] = await Promise.all([listCircles(), listInboundCircles()]);
    if (own.ok) {
      const inboundItems = inbound.ok ? inbound.data.circles : [];
      const items = [...own.data.circles, ...inboundItems];
      circlesCache = items;
      setState({ items, status: 'done' });
    } else {
      setState((s) => ({
        items: s.items,
        status: s.items.length > 0 ? 'done' : 'error',
        errorMsg: medhaIdErrorCopy(own, 'Amber'),
      }));
    }
  }).current;

  // Refetch on focus (not just mount) so returning from creating/editing/leaving
  // a circle reflects the change without a manual refresh.
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  return { ...state, reload: load };
}
