/**
 * THE ONE PLACE contacts.linked_amber_id IS WRITTEN.
 *
 * WHAT THAT COLUMN IS FOR. A circle member, a shared note's audience and a DM
 * participant are all rows in somebody's `contacts` table. For any of it to
 * reach the actual person, some query has to be able to say "this contact card
 * IS that account", and `linked_amber_id` is that sentence. Every social feature
 * in the app resolves through it.
 *
 * WHY THIS FILE EXISTS. There were three separate attempts at writing it and all
 * three were partial:
 *
 *   1. store.js `linkContactsToAmberUserByPhone` — correct, but reachable only
 *      from ONE place: the moment a brand-new account is inserted. It links the
 *      cards that exist at that instant and never runs again, so a contact
 *      synced the day after someone signs up is never linked to them. Most
 *      cards arrive after most signups.
 *   2. circles-store `linkCircleMemberToAccount` — ran at the right moment (a
 *      member being added) but looked in the wrong place: it re-derived phone
 *      hashes from the `phone_primary` / `phones_all` TEXT COLUMNS instead of
 *      reading `contact_identity_keys`, the table whose entire job is to hold
 *      those hashes. A card whose keys were claimed correctly but whose text
 *      columns were empty or differently formatted matched nothing, while the
 *      keys table had the right hash sitting in it the whole time.
 *   3. discovery-store `linkContactsToNewAccount` — the correct join, phone AND
 *      email, cross-owner. Zero callers.
 *
 * The measurable result: a `backfill-discovery-keys` dry run reported all ten
 * accounts holding keys, nothing to claim, no conflicts — and twenty-six contact
 * cards that "now resolve to an account through a key without being linked yet."
 * The keys were right. The matching worked. Nothing performed the update.
 *
 * So: one primitive, joining the two tables that are meant to be joined, callable
 * scoped by owner, by account, or by single contact — so the same code serves
 * signup, connection-accept, contact sync, adding a circle member, and a
 * backfill, and there is no second implementation to drift.
 */

import { query } from "./sql.js";

/**
 * A card that resolves to TWO accounts is not linked to either.
 *
 * It happens: a card carrying a work email that belongs to one account and a
 * phone that belongs to another (a shared family handset, a recycled number, a
 * stale card merged from two sources). Picking one would silently hand that
 * card's circles and shared notes to whichever account the query happened to
 * return first, and the failure would be invisible.
 *
 * `HAVING count(DISTINCT amber_id) = 1` is what refuses. Ambiguous cards come
 * back separately so the caller can ask the owner which person it is — see
 * `ambiguousContactLinks`.
 */
const LINK_SQL = `
WITH pairs AS (
  SELECT DISTINCT c.owner_id, c.id AS contact_id, d.amber_id
    FROM contacts c
    JOIN contact_identity_keys k
      ON k.owner_id = c.owner_id AND k.contact_id = c.id
    JOIN discovery_keys d
      ON d.key_hash = k.key_hash
   WHERE c.deleted_at IS NULL
     -- Never point somebody's card at their own account: a contact card for
     -- yourself is a duplicate of you, not a link to you.
     AND c.owner_id <> d.amber_id
     AND ($1::uuid IS NULL OR c.owner_id = $1::uuid)
     AND ($2::uuid IS NULL OR d.amber_id = $2::uuid)
     AND ($3::uuid IS NULL OR c.id = $3::uuid)
),
resolved AS (
  SELECT owner_id, contact_id, min(amber_id::text)::uuid AS amber_id
    FROM pairs
   GROUP BY owner_id, contact_id
  HAVING count(DISTINCT amber_id) = 1
)
UPDATE contacts c
   SET linked_amber_id = r.amber_id, updated_at = now()
  FROM resolved r
 WHERE c.owner_id = r.owner_id
   AND c.id = r.contact_id
   AND c.linked_amber_id IS DISTINCT FROM r.amber_id
RETURNING c.owner_id, c.id AS contact_id, c.linked_amber_id AS amber_id
`;

/**
 * Link every contact card that provably belongs to a registered account.
 *
 * Scope it as narrowly as the caller can:
 *   { ownerId }              — one person's address book (after a contact sync)
 *   { amberId }              — one account, across every address book (signup)
 *   { ownerId, amberId }     — one card-to-account pair (connection accept)
 *   { ownerId, contactId }   — one card (adding a circle member)
 *   {}                       — everything (the backfill, and only the backfill)
 *
 * Returns { linked, pairs: [{ ownerId, contactId, amberId }] }. `pairs` is the
 * list of links that were NEWLY written, which is exactly the set of people who
 * can suddenly see what was already shared with them — a caller that wants to
 * notify them has the list.
 *
 * Never throws: linking is an improvement to state, not a precondition for the
 * operation that triggered it. Failing to stamp a link must not fail an
 * accepted connection or block a member being added to a circle.
 */
export async function linkResolvableContacts({
  ownerId = null,
  amberId = null,
  contactId = null,
} = {}) {
  try {
    const { rows } = await query(LINK_SQL, [ownerId, amberId, contactId]);
    return {
      linked: rows.length,
      pairs: rows.map((r) => ({
        ownerId: String(r.owner_id),
        contactId: String(r.contact_id),
        amberId: String(r.amber_id),
      })),
    };
  } catch (e) {
    console.error(`LINK_CONTACTS_ERR ${e?.stack || e?.message || e}`);
    return { linked: 0, pairs: [] };
  }
}

/**
 * Cards in this owner's book that resolve to more than one account, so the owner
 * can be asked which person they are. Read-only.
 */
export async function ambiguousContactLinks(ownerId) {
  if (!ownerId) return [];
  try {
    // THE CANDIDATES ARE PEOPLE, SO THEY COME BACK AS PEOPLE.
    //
    // This used to return bare amber_ids, and a question phrased "which of these
    // two accounts is Sagar?" over two uuids cannot be answered by anybody --
    // which is most of why the endpoint existed for a while with no screen
    // behind it. The account's name, username and avatar are what makes the
    // question answerable in one tap, and they are one join away.
    //
    // jsonb_agg over a subquery rather than array_agg of ids: the alternative is
    // the caller fetching N profiles per ambiguous card, which for the case this
    // is FOR -- a shared family email across several cards -- is a request per
    // person per card.
    // The grouping happens first, in `amb`, and the profiles are looked up
    // against its result. Reaching into the outer aggregate from a sublink in the
    // same SELECT list would read as clever and is one Postgres version away from
    // an argument about whether it is legal; this is plainly two steps.
    const { rows } = await query(
      `WITH amb AS (
         SELECT c.id AS contact_id,
                COALESCE(c.full_name,
                  NULLIF(TRIM(CONCAT_WS(' ', c.first_name, c.last_name)), '')) AS name,
                array_agg(DISTINCT d.amber_id) AS amber_ids
           FROM contacts c
           JOIN contact_identity_keys k
             ON k.owner_id = c.owner_id AND k.contact_id = c.id
           JOIN discovery_keys d
             ON d.key_hash = k.key_hash
          WHERE c.owner_id = $1
            AND c.deleted_at IS NULL
            AND c.owner_id <> d.amber_id
          GROUP BY c.id, name
         HAVING count(DISTINCT d.amber_id) > 1
       )
       SELECT a.contact_id, a.name, a.amber_ids,
              (SELECT jsonb_agg(jsonb_build_object(
                        'amberId',   u.amber_id::text,
                        'name',      u.full_name,
                        'username',  u.username,
                        'avatarUrl', u.avatar_url)
                      ORDER BY u.full_name NULLS LAST)
                 FROM users u
                WHERE u.amber_id = ANY (a.amber_ids)
                  AND u.deleted_at IS NULL) AS accounts
         FROM amb a
        ORDER BY a.name ASC NULLS LAST`,
      [ownerId],
    );
    return rows.map((r) => ({
      contactId: String(r.contact_id),
      name: r.name ?? null,
      // Kept for anything already reading it, and because it is the authoritative
      // list: an account deleted since the key was written has no `accounts` row
      // but is still what made this card ambiguous.
      amberIds: (r.amber_ids || []).map(String),
      accounts: Array.isArray(r.accounts)
        ? r.accounts
            .filter((a) => a && a.amberId)
            .map((a) => ({
              amberId: String(a.amberId),
              name: a.name ?? null,
              username: a.username ?? null,
              avatarUrl: a.avatarUrl ?? null,
            }))
        : [],
    }));
  } catch (e) {
    console.error(`AMBIGUOUS_LINKS_ERR ${e?.message || e}`);
    return [];
  }
}

/**
 * "I FOUND ANOTHER SAGAR TIWARI IN YOUR CONTACTS. IS THAT THIS ONE?"
 *
 * The case this answers: you connect with someone on Amber and no key matches
 * any card in your book — they signed up with an email you do not have, or with
 * a phone you do not have, or you only ever saved the other one. There is
 * nothing to prove the card is them, so nothing may be linked automatically.
 *
 * Rather than leaving them permanently unresolved, offer the owner the cards
 * that plausibly are them and let one tap settle it. Suggestions are ranked:
 *
 *   1. exact match on the full name, normalized
 *   2. same last name and a first name that starts the same way ("Sagar T")
 *   3. the account's username appearing in the card's name
 *
 * Already-linked cards are excluded, and so is any card linked to a DIFFERENT
 * account — that card's identity is already settled and this is not the place to
 * overturn it.
 *
 * NOTHING HERE WRITES. It returns candidates; POST /v1/me/contacts/:id/link is
 * where a human decision becomes a link.
 */
export async function suggestContactsForAccount(ownerId, amberId, { limit = 5 } = {}) {
  if (!ownerId || !amberId) return [];
  try {
    const { rows } = await query(
      `WITH acct AS (
         SELECT COALESCE(full_name, username, '') AS name,
                lower(COALESCE(username, '')) AS username
           FROM users
          WHERE amber_id = $2 AND deleted_at IS NULL
       ),
       norm AS (
         SELECT regexp_replace(lower(name), '[^a-z ]', '', 'g') AS full_norm,
                split_part(regexp_replace(lower(name), '[^a-z ]', '', 'g'), ' ', 1) AS first_norm,
                username
           FROM acct
       )
       SELECT c.id AS contact_id,
              COALESCE(c.full_name,
                NULLIF(TRIM(CONCAT_WS(' ', c.first_name, c.last_name)), '')) AS name,
              c.phone_primary,
              c.emails,
              CASE
                WHEN regexp_replace(lower(COALESCE(c.full_name, '')), '[^a-z ]', '', 'g')
                     = n.full_norm THEN 1
                WHEN lower(COALESCE(c.last_name, '')) <> ''
                 AND lower(COALESCE(c.last_name, ''))
                     = split_part(n.full_norm, ' ', 2)
                 AND lower(COALESCE(c.first_name, '')) LIKE left(n.first_norm, 2) || '%' THEN 2
                ELSE 3
              END AS rank
         FROM contacts c
         CROSS JOIN norm n
        WHERE c.owner_id = $1
          AND c.deleted_at IS NULL
          AND c.linked_amber_id IS NULL
          AND n.full_norm <> ''
          AND (
            regexp_replace(lower(COALESCE(c.full_name, '')), '[^a-z ]', '', 'g') = n.full_norm
            OR (
              lower(COALESCE(c.last_name, '')) <> ''
              AND lower(COALESCE(c.last_name, '')) = split_part(n.full_norm, ' ', 2)
              AND lower(COALESCE(c.first_name, '')) LIKE left(n.first_norm, 2) || '%'
            )
            OR (
              n.username <> ''
              AND regexp_replace(lower(COALESCE(c.full_name, '')), '[^a-z]', '', 'g')
                  LIKE '%' || n.username || '%'
            )
          )
        ORDER BY rank ASC, name ASC NULLS LAST
        LIMIT $3`,
      [ownerId, amberId, Math.min(Math.max(Number(limit) || 5, 1), 20)],
    );
    return rows.map((r) => ({
      contactId: String(r.contact_id),
      name: r.name ?? null,
      phone: r.phone_primary ?? null,
      email: (r.emails || "").split(",")[0]?.trim() || null,
      confidence: r.rank === 1 ? "exact_name" : r.rank === 2 ? "partial_name" : "username",
    }));
  } catch (e) {
    console.error(`SUGGEST_CONTACT_LINKS_ERR ${e?.message || e}`);
    return [];
  }
}

/**
 * A HUMAN SAID SO. Link one card to one account on the owner's explicit
 * confirmation, which is the only way an unprovable link may ever be written.
 *
 * Guarded, because "the user asked for it" is not the same as "anything goes":
 *   * the card must belong to the caller,
 *   * the account must exist and not be the caller's own,
 *   * a card already linked to a DIFFERENT account is refused rather than
 *     repointed — silently moving an existing link would move that person's
 *     circles and shared notes with it. Unlink first, deliberately.
 *
 * Returns "linked" | "already" | "not_found" | "conflict" | "self" | "error".
 */
export async function linkContactByConfirmation(ownerId, contactId, amberId) {
  if (!ownerId || !contactId || !amberId) return "not_found";
  if (String(ownerId) === String(amberId)) return "self";
  try {
    const { rows: acct } = await query(
      `SELECT 1 FROM users WHERE amber_id = $1 AND deleted_at IS NULL`,
      [amberId],
    );
    if (acct.length === 0) return "not_found";

    const { rows: card } = await query(
      `SELECT linked_amber_id FROM contacts
        WHERE id = $1 AND owner_id = $2 AND deleted_at IS NULL`,
      [contactId, ownerId],
    );
    if (card.length === 0) return "not_found";
    const current = card[0].linked_amber_id;
    if (current && String(current) === String(amberId)) return "already";
    if (current) return "conflict";

    await query(
      `UPDATE contacts SET linked_amber_id = $1, updated_at = now()
        WHERE id = $2 AND owner_id = $3 AND linked_amber_id IS NULL`,
      [amberId, contactId, ownerId],
    );
    return "linked";
  } catch (e) {
    console.error(`LINK_CONTACT_CONFIRM_ERR ${e?.message || e}`);
    return "error";
  }
}

/** Undo a link. The owner's card, their decision. */
export async function unlinkContact(ownerId, contactId) {
  if (!ownerId || !contactId) return false;
  try {
    const { rowCount } = await query(
      `UPDATE contacts SET linked_amber_id = NULL, updated_at = now()
        WHERE id = $1 AND owner_id = $2 AND linked_amber_id IS NOT NULL`,
      [contactId, ownerId],
    );
    return (rowCount ?? 0) > 0;
  } catch (e) {
    console.error(`UNLINK_CONTACT_ERR ${e?.message || e}`);
    return false;
  }
}
