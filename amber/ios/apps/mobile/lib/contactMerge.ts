import { callMedhaId, type MedhaIdResult } from './medhaId';

/**
 * TWO CARDS FOR ONE PERSON.
 *
 * Linking a contact to an Amber account resolves who they are; it does not
 * collapse duplicates. So when someone joins, one of the two cards already in
 * the address book gets marked ON AMBER and the other does not — and an
 * invisible duplicate becomes a visible one: two Calebs, one apparently on
 * Amber and one apparently not, built from the same information.
 *
 * The provable case — two cards pointing at the SAME account, from keys that
 * account proved it owns — is collapsed server-side on contact sync without
 * asking, because there is nothing to adjudicate.
 *
 * What reaches this list is the case that cannot be proven: same name, and no
 * key on the second card that resolves anywhere. Almost certainly the same
 * person, and "almost certainly" is not a license to destroy a card — two
 * people really can share a name, and a wrong merge files one person's notes
 * under another with nothing in the app to show it happened. So it is offered.
 */
export type DuplicateCandidate = {
  /** The card that survives: the one linked to the account. */
  keepContactId: string;
  /** The card that would be folded into it. */
  dropContactId: string;
  name: string | null;
  amberId: string;
  /**
   * What the OTHER card knows that this one might not. Shown with the offer,
   * because "the other card has a number this one doesn't" is exactly the
   * difference between merging and leaving it alone.
   */
  otherPhone: string | null;
  otherEmail: string | null;
  /**
   * THE OTHER CARD'S OWN NAME.
   *
   * Often not the same as `name`, and that is the whole reason a person cannot
   * verify one of these. The sheet printed one name and said "two cards", so
   * somebody who went looking for a second "Josh Bernson" found nothing and
   * concluded the feature was inventing pairs -- when the other card was filed
   * as "Josh B" or "Josh work" all along.
   */
  otherName?: string | null;
  /**
   * How sure, and WHY. `provable` is a shared phone, a shared email, or a card
   * linked to an account; `likely` is a name plus something weaker.
   *
   * Both are computed server-side and were being dropped on the floor here,
   * which is what left the sheet asserting the same sentence over every row
   * whether or not it was true of that row.
   */
  tier?: 'provable' | 'likely' | string | null;
  reason?: string | null;
};

export function listDuplicateContacts(): Promise<
  MedhaIdResult<{ duplicates: DuplicateCandidate[] }>
> {
  return callMedhaId<{ duplicates: DuplicateCandidate[] }>({
    path: '/v1/me/contacts/duplicates',
    method: 'GET',
    requireAuth: true,
    tag: 'GET contact duplicates',
  });
}

/**
 * Fold one card into another. Every table that references the dropped card is
 * repointed and the keeper's blank fields are filled from it, in one
 * transaction — a half-merged person is worse than two cards.
 */
export function mergeContacts(
  keepContactId: string,
  dropContactId: string,
): Promise<
  MedhaIdResult<{
    merged: boolean;
    /**
     * WHAT ACTUALLY MOVED, per table. The server has counted this all along --
     * "a merge is auditable rather than a boolean" -- and this type declared a
     * bare boolean, so the app could only say "done" about an operation that
     * had just rewritten rows across a dozen tables. "It says it completed it,
     * but I don't know what it actually did" is the predictable result.
     */
    moved?: Record<string, number>;
    deleted?: Record<string, number>;
  }>
> {
  return callMedhaId<{ merged: boolean }>({
    path: '/v1/me/contacts/merge',
    method: 'POST',
    body: { keepContactId, dropContactId },
    requireAuth: true,
    tag: 'POST merge contacts',
  });
}
