import { callMedhaId, type MedhaIdResult } from './medhaId';

/**
 * CORRECTING WHO A NOTE IS ABOUT.
 *
 * The chips under a note ("FILED TO  Drew · Mei") are the authoritative record
 * of who Amber filed it against — the feed and the thread view both merge them
 * over whatever was frozen into the assistant message, specifically so that a
 * correction wins.
 *
 * There was no way to make one. Amber heard "Mee", guessed Mei Lin, asked, was
 * told no, and then the wrong chip simply stayed there. These three calls are
 * the missing half.
 */

/** A name in a note that Amber could not attribute to anyone. */
export type PendingTag = {
  observationId: string;
  rawName: string;
  /** The sentence it came out of, so the choice has context. */
  body: string | null;
};

/**
 * Repoint a chip, or take it off.
 *
 * `toContactId` omitted removes the tag: the sentence was still said, we just
 * stop claiming to know who it was about. The observation is not deleted for
 * that — it goes back to unattributed, which is what it should have been.
 */
export function retagNote(
  conversationId: string,
  fromContactId: string,
  toContactId?: string,
): Promise<MedhaIdResult<{ retagged: boolean }>> {
  return callMedhaId<{ retagged: boolean }>({
    path: `/v1/conversations/${encodeURIComponent(conversationId)}/tags`,
    method: 'PATCH',
    body: toContactId ? { fromContactId, toContactId } : { fromContactId, remove: true },
    requireAuth: true,
    tag: 'PATCH note tags',
  });
}

/**
 * The unanswered "which Maggie?"s in one note.
 *
 * These rows were being written and then surfaced nowhere, so the question got
 * asked once in a chat and was lost the moment it scrolled. Shown on the note
 * itself, which is where the user has the context to answer it.
 */
export function listPendingTags(
  conversationId: string,
): Promise<MedhaIdResult<{ pending: PendingTag[] }>> {
  return callMedhaId<{ pending: PendingTag[] }>({
    path: `/v1/conversations/${encodeURIComponent(conversationId)}/pending-tags`,
    method: 'GET',
    requireAuth: true,
    tag: 'GET pending tags',
  });
}

/** "The Mee in this note is this contact." Settles every mention of that name. */
export function resolvePendingTag(
  conversationId: string,
  rawName: string,
  contactId: string,
): Promise<MedhaIdResult<{ resolved: number }>> {
  return callMedhaId<{ resolved: number }>({
    path: `/v1/conversations/${encodeURIComponent(conversationId)}/pending-tags/resolve`,
    method: 'POST',
    body: { rawName, contactId },
    requireAuth: true,
    tag: 'POST resolve pending tag',
  });
}
