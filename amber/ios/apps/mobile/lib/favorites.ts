import { callMedhaId } from './medhaId';

// Amber Network — the people you hand-pick as real relationships. Backed by
// medha-id's owner-scoped /v1/me/favorites routes.

export type Favorite = {
  id: string;
  name: string;
  title?: string | null;
  company?: string | null;
  /**
   * Why this person is a favorite — 'work', 'close', 'sailing'. Lowercased and
   * de-duped server-side. Rendered on the contact card, and available to
   * PeopleRank for questions like "who do I know from work?".
   */
  tags?: string[];
  /**
   * The hand-arranged grid slot. Null for anyone never dragged; the server sorts
   * those after everyone who has been placed, so an untouched list keeps its
   * newest-first order without needing a backfill.
   */
  position?: number | null;
};

/** The 4x4 grid. Mirrored server-side, which is where it is enforced. */
export const MAX_FAVORITES = 16;

export function listFavorites() {
  return callMedhaId<{ favorites: Favorite[] }>({
    path: '/v1/me/favorites',
    method: 'GET',
    requireAuth: true,
    tag: 'GET /v1/me/favorites',
  });
}

// `note` is the (already transcribed) voice memo on how you know them / why they
// matter — the backend writes it straight to the contact's card.
export function addFavorite(contactId: string, note?: string, tags?: string[]) {
  const cleanTags = (tags ?? []).map((t) => t.trim()).filter(Boolean);
  return callMedhaId<{ ok: boolean }>({
    path: '/v1/me/favorites',
    method: 'POST',
    requireAuth: true,
    body: {
      contactId,
      ...(note && note.trim() ? { note: note.trim() } : {}),
      ...(cleanTags.length > 0 ? { tags: cleanTags } : {}),
    },
    tag: 'POST /v1/me/favorites',
  });
}

export function removeFavorite(contactId: string) {
  return callMedhaId<{ ok: boolean }>({
    path: `/v1/me/favorites/${encodeURIComponent(contactId)}`,
    method: 'DELETE',
    requireAuth: true,
    tag: 'DELETE /v1/me/favorites',
  });
}

/**
 * Save the hand-arranged order.
 *
 * Sends the FULL list of ids in their new order rather than a moved-item delta: a
 * delta requires the client and server to agree on the order they started from, and
 * after a drag on a stale list they do not.
 */
export function reorderFavorites(contactIds: string[]) {
  return callMedhaId<{ ok: boolean }>({
    path: '/v1/me/favorites/order',
    method: 'PUT',
    requireAuth: true,
    body: { contactIds },
    tag: 'PUT /v1/me/favorites/order',
  });
}
