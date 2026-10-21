import { callMedhaId, type MedhaIdResult } from './medhaId';

// Pinned circles — the nine on your profile, in the order you dragged them.
//
// Deliberately the same shape as lib/favorites.ts (pinned CONTACTS), because
// the two are one feature pointed at different rows and the profile uses one
// drag grid for both. If these two files ever disagree about their conventions,
// that grid grows a branch for each.

export type PinnedCircle = {
  id: string;
  name: string;
  /** A key into NAMED_COLORS, not a hex value. See lib/circleColors. */
  color: string | null;
  /** The kind, as the user set it. See CirclePreview.kindTag. */
  kindTag: string | null;
  /** Superseded by kindTag; still returned by the server. */
  classifiedKind: 'interest' | 'experience' | 'affiliation' | 'other' | null;
  memberCount: number;
  /**
   * Up to eight members, names only. The tile draws the circle's chord mark and
   * that mark plots members on a ring, so a count alone left every pinned tile
   * with nothing to draw. Names only on purpose -- the tile renders dots, so an
   * avatar url would be fetched for every pinned circle and used by nothing.
   */
  preview: { id: string; name: string }[];
  /** Where the user placed it, or null if they never have. */
  position: number | null;
};

/**
 * THE CAP, and it must match MAX_PINNED_CIRCLES on the server.
 *
 * Nine because the grid is three by three: a grid that scrolls is not a set of
 * pins any more, it is the circles list, which sits directly below it. The
 * server rejects a tenth with a 409, and a client that thought the limit was
 * something else would be showing the user a different rule from the one being
 * enforced.
 */
export const MAX_PINNED_CIRCLES = 9;

export function listPinnedCircles(): Promise<MedhaIdResult<{ circles: PinnedCircle[] }>> {
  return callMedhaId<{ circles: PinnedCircle[] }>({
    path: '/v1/me/circle-favorites',
    method: 'GET',
    requireAuth: true,
  });
}

export function pinCircle(circleId: string): Promise<MedhaIdResult<{ ok: boolean }>> {
  return callMedhaId<{ ok: boolean }>({
    path: '/v1/me/circle-favorites',
    method: 'POST',
    body: { circleId },
    requireAuth: true,
    retries: 0,
  });
}

export function unpinCircle(circleId: string): Promise<MedhaIdResult<{ ok: boolean }>> {
  return callMedhaId<{ ok: boolean }>({
    path: `/v1/me/circle-favorites/${encodeURIComponent(circleId)}`,
    method: 'DELETE',
    requireAuth: true,
    retries: 0,
  });
}

export function reorderPinnedCircles(circleIds: string[]): Promise<MedhaIdResult<{ ok: boolean }>> {
  return callMedhaId<{ ok: boolean }>({
    path: '/v1/me/circle-favorites/order',
    method: 'PUT',
    body: { circleIds },
    requireAuth: true,
    retries: 0,
  });
}
