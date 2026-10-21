import { callMedhaId, type MedhaIdResult } from './medhaId';

/**
 * WHICH CARD IN YOUR BOOK IS THIS ACCOUNT?
 *
 * contacts.linked_amber_id is what makes a card and an Amber account the same
 * person, and it is written in exactly one place server-side, only ever from a
 * key the account PROVED it owns (a phone or an email it verified). That is the
 * right rule and it leaves a gap: connect with somebody who signed up with an
 * email you do not have, and nothing links. Their card in your book then knows
 * nothing about their account — circle membership does not resolve to them,
 * shared notes never reach them, and their notifications have no recipient.
 *
 * So for that gap, and only that gap, a human answer counts as proof: Amber
 * offers the cards that plausibly are them and one tap settles it. Asked once,
 * at the moment you connect, which is the moment you know the answer.
 */
export type LinkSuggestion = {
  contactId: string;
  name: string | null;
  /** Why it is a candidate: 'name' | 'partial' | 'username'. */
  reason?: string;
  phone?: string | null;
  email?: string | null;
};

/** Cards that plausibly belong to one account. Ranked, and it writes nothing. */
export function getLinkSuggestions(
  amberId: string,
): Promise<MedhaIdResult<{ suggestions: LinkSuggestion[] }>> {
  return callMedhaId<{ suggestions: LinkSuggestion[] }>({
    path: `/v1/me/contacts/link-suggestions?amberId=${encodeURIComponent(amberId)}`,
    method: 'GET',
    requireAuth: true,
    tag: 'GET link suggestions',
  });
}

/**
 * "Yes, that is them." The one path where a link comes from a confirmation
 * rather than from proof. The server still refuses to repoint a card that is
 * already linked to somebody else — that would move their circles and shared
 * notes with it.
 */
export function linkContactToAccount(
  contactId: string,
  amberId: string,
): Promise<MedhaIdResult<{ linked: boolean; outcome: string }>> {
  return callMedhaId<{ linked: boolean; outcome: string }>({
    path: `/v1/me/contacts/${encodeURIComponent(contactId)}/link`,
    method: 'POST',
    body: { amberId },
    requireAuth: true,
    retries: 0,
    tag: 'POST contact link',
  });
}

/** Undo one. */
export function unlinkContactFromAccount(
  contactId: string,
): Promise<MedhaIdResult<{ unlinked: boolean }>> {
  return callMedhaId<{ unlinked: boolean }>({
    path: `/v1/me/contacts/${encodeURIComponent(contactId)}/link`,
    method: 'DELETE',
    requireAuth: true,
    retries: 0,
    tag: 'DELETE contact link',
  });
}

/**
 * Cards whose keys resolve to MORE THAN ONE account — a shared family email, a
 * recycled work number. The linker refuses these rather than picking one, so
 * they wait for a human.
 */
export type AmbiguousLink = {
  contactId: string;
  name: string | null;
  /**
   * The accounts this card's keys resolve to. Authoritative -- an account
   * deleted since the key was written has no `accounts` entry but is still part
   * of what made this card ambiguous.
   */
  amberIds: string[];
  /**
   * The same accounts as PEOPLE, which is what makes the question answerable.
   * "Which of these two accounts is Sagar?" over two uuids cannot be answered by
   * anybody, which is why this endpoint had no screen behind it for a while.
   */
  accounts: {
    amberId: string;
    name: string | null;
    username: string | null;
    avatarUrl: string | null;
  }[];
};

export function getAmbiguousLinks(): Promise<MedhaIdResult<{ ambiguous: AmbiguousLink[] }>> {
  return callMedhaId<{ ambiguous: AmbiguousLink[] }>({
    path: '/v1/me/contacts/ambiguous',
    method: 'GET',
    requireAuth: true,
    tag: 'GET ambiguous links',
  });
}
