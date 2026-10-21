/**
 * DELETE ONE CONTACT, AND EVERYTHING DERIVED FROM THEM.
 *
 * A contact is not one row. Observations, dimension state, scores, interaction
 * stats, name memories, the pgvector embedding, identity keys, provenance,
 * favorites, circle memberships, intro requests, media and share targets all
 * hang off the same id, and a Pinecone vector hangs off it outside Postgres
 * entirely. Deleting only `contacts` leaves every one of those behind, and
 * because search reads observations directly, the "deleted" person keeps coming
 * back in results. A half-delete is worse than none: the user believes the
 * record is gone and it answers questions about them.
 *
 * THIS FILE USED TO DELETE NOTHING AT ALL, and the reason is worth keeping.
 *
 * It enumerated eighteen child tables and ran, inside one transaction,
 * `DELETE FROM <t> WHERE owner_id = $1 AND contact_id = $2` for each, with a
 * per-statement try/catch so that a table this deployment did not have would be
 * "recorded as a skip rather than thrown".
 *
 * THAT IS NOT HOW POSTGRES WORKS. The first statement in the list was against
 * observation_dimensions, which is keyed on (observation_id, dimension_id) and
 * has neither owner_id nor contact_id. It raised 42703. Catching the error in
 * JavaScript does not un-abort the transaction: every subsequent statement then
 * failed with 25P02 "current transaction is aborted", each one swallowed by the
 * same catch, until the final `DELETE FROM contacts` -- which was outside the
 * try -- raised 25P02 and rolled the whole thing back. Deleting a contact threw
 * a 500 and removed nothing. A try/catch inside a transaction needs a SAVEPOINT
 * to mean anything, and there was none.
 *
 * THE LOOP IS ALSO OBSOLETE, which is the better half of the fix. Migration 018
 * put a composite foreign key on every child --
 * (owner_id, contact_id) REFERENCES contacts(owner_id, id) ON DELETE CASCADE --
 * and the observation children cascade from observations. So one statement,
 * `DELETE FROM contacts WHERE owner_id = $1 AND id = $2`, removes all of it
 * atomically, and it CANNOT drift from the schema the way a hand-maintained list
 * of table names silently did. The database already guarantees this; the loop was
 * a second, worse implementation of a guarantee we already had.
 *
 * WHAT STILL NEEDS SAYING OUT LOUD: `shares` has no foreign key to contacts,
 * because scope_ref is a uuid that means a contact id or a circle id depending on
 * scope_type, and NULL for 'network'. It cannot reference one table, so nothing
 * cascades it and it is deleted explicitly, filtered on scope_type.
 *
 * SCOPED BY BOTH KEYS, ALWAYS. Every statement filters on owner_id AND
 * contact_id. There is no statement in this file keyed on contact_id alone.
 *
 * IN ONE TRANSACTION, so the contact row and its children fall together. Pinecone
 * is outside the transaction and therefore best-effort AFTER the commit: a vector
 * left behind is a stale search hit we can clean up, whereas a vector deleted
 * before a rolled-back transaction is unrecoverable.
 */

import { query, withTransaction } from "./sql.js";

/**
 * Counted for the caller's log, NOT deleted by name -- the cascade does the
 * deleting. If this list drifts from the schema the log gets less informative and
 * the delete stays exactly as correct, which is the right way round. The previous
 * version had it the other way round and deleted nothing.
 *
 * Counted in ONE round trip as scalar subqueries: a user-facing delete should not
 * pay seventeen of them for a log line.
 */
const COUNTED_CHILDREN = [
  "observations",
  "observation_participants",
  "contact_dimension_state",
  "contact_scores",
  "contact_interaction_stats",
  "contact_name_memory",
  "contact_embedding",
  "contact_sources",
  "contact_identity_keys",
  "contact_review_candidates",
  "contact_favorites",
  "circle_members",
  "intro_requests",
  "voice_vocabulary",
  "people_rank_feedback",
  "media_assets",
  "events",
];

/**
 * @param {string} ownerId  amber_id
 * @param {string} contactId
 * @returns {Promise<{ ok: boolean, reason?: string, name?: string|null,
 *                     deleted: Record<string, number>, total: number }>}
 */
export async function deleteContactCascade(ownerId, contactId) {
  if (!ownerId || contactId == null) {
    return { ok: false, reason: "missing_args", deleted: {}, total: 0 };
  }

  // Confirm it exists AND belongs to the caller before deleting anything, so a
  // wrong id is a clean 404 rather than a silent no-op that reports success.
  const { rows: found } = await query(
    `SELECT id, full_name FROM contacts
      WHERE owner_id = $1::uuid AND id = $2 AND deleted_at IS NULL
      LIMIT 1`,
    [ownerId, contactId],
  );
  if (found.length === 0) return { ok: false, reason: "not_found", deleted: {}, total: 0 };
  const name = found[0].full_name ?? null;

  const deleted = {};
  await withTransaction(async (client) => {
    // One round trip for every child count. Purely for the caller's log.
    const counts = await client.query(
      `SELECT ${COUNTED_CHILDREN.map(
        (t, i) =>
          `(SELECT count(*)::int FROM ${t} WHERE owner_id = $1::uuid AND contact_id = $2) AS c${i}`,
      ).join(", ")}`,
      [ownerId, contactId],
    );
    COUNTED_CHILDREN.forEach((t, i) => {
      const n = counts.rows[0][`c${i}`];
      if (n > 0) deleted[t] = n;
    });

    // Shares TARGETED at this contact. scope_ref is a uuid holding either a
    // contact id or a circle id depending on scope_type, so the scope_type filter
    // is what keeps a circle share with a colliding id from being deleted. No
    // foreign key covers this table, which is why it is the one explicit delete
    // left after the cascade.
    const sh = await client.query(
      `DELETE FROM shares
        WHERE owner_id = $1::uuid AND scope_type = 'contact' AND scope_ref = $2::uuid`,
      [ownerId, String(contactId)],
    );
    if (sh.rowCount > 0) deleted.shares = sh.rowCount;

    // The contact, and by cascade everything that references it.
    const res = await client.query(
      `DELETE FROM contacts WHERE owner_id = $1::uuid AND id = $2`,
      [ownerId, contactId],
    );
    deleted.contacts = res.rowCount;
  });

  const total = Object.values(deleted).reduce((a, b) => a + b, 0);
  return { ok: true, name, deleted, total };
}
