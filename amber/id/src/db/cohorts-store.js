/**
 * COHORTS, WRITTEN BY A JOB AND NEVER BY A REQUEST.
 *
 * The derivation lives in src/lib/cohorts.js and is pure. This is the part that
 * touches the database: recompute one owner's cohorts from their contacts, and
 * answer "what audiences does this owner have" for a sharing picker.
 *
 * THERE IS NO addMember. That is the whole design, not an omission. A cohort
 * means "everyone in my book with a stanford.edu address"; the moment somebody
 * can add a member by hand it means "whoever I remembered", which is a circle,
 * and circles already exist a file away. Membership is output.
 *
 * A REFRESH IS A REPLACE, PER COHORT. Somebody whose address changed should
 * fall out, and a diff that only ever adds would leave them able to read things
 * shared to a group they have left -- an authorization leak with a very quiet
 * failure mode. The replacement happens inside one transaction so no reader
 * ever sees a cohort mid-rebuild with half its members missing.
 *
 * A COHORT NOBODY IS IN IS SOFT-DELETED, NOT DROPPED. `shares` rows point at
 * cohort ids; deleting the row would orphan them, and a share whose scope has
 * vanished should stop resolving rather than start resolving to something else.
 * Soft-deleting makes the predicate fail closed, and re-deriving the same
 * cohort later revives the same id, so an old share starts working again
 * exactly when its audience does.
 */

import { query, withTransaction } from "./sql.js";
import { buildCohorts } from "../lib/cohorts.js";
import { listContacts } from "./user-store.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const asUuid = (v) =>
  typeof v === "string" && UUID_RE.test(v.trim()) ? v.trim().toLowerCase() : null;

/**
 * Recompute every cohort for one owner. Returns a small summary.
 *
 * Safe to run again at any time: it is a function of the contacts table and
 * holds no state of its own.
 */
export async function refreshCohorts(ownerId, { contacts = null } = {}) {
  const owner = asUuid(ownerId);
  if (!owner) return { cohorts: 0, members: 0, retired: 0 };

  const rows = contacts ?? (await listContacts(owner));
  const derived = buildCohorts(rows);
  const liveKeys = new Set(derived.map((c) => `${c.kind}:${c.key}`));

  let members = 0;

  await withTransaction(async (tx) => {
    for (const cohort of derived) {
      // Revives its own tombstone rather than inserting a second row, so a
      // share written months ago against this cohort keeps resolving.
      const { rows: upserted } = await tx.query(
        `INSERT INTO cohorts (owner_id, kind, key, name, flavor, member_count, computed_at)
         VALUES ($1, $2, $3, $4, $5, $6, now())
         ON CONFLICT (owner_id, kind, key) WHERE deleted_at IS NULL
         DO UPDATE SET member_count = EXCLUDED.member_count,
                       flavor       = EXCLUDED.flavor,
                       computed_at  = now(),
                       updated_at   = now()
         RETURNING id`,
        [owner, cohort.kind, cohort.key, cohort.name, cohort.flavor, cohort.members.length],
      );

      let cohortId = upserted[0]?.id ?? null;
      if (!cohortId) {
        // The partial unique index does not cover tombstoned rows, so the
        // upsert above cannot see one. Revive it by hand.
        const { rows: revived } = await tx.query(
          `UPDATE cohorts
              SET deleted_at = NULL, name = $4, flavor = $5,
                  member_count = $6, computed_at = now(), updated_at = now()
            WHERE owner_id = $1 AND kind = $2 AND key = $3
            RETURNING id`,
          [owner, cohort.kind, cohort.key, cohort.name, cohort.flavor, cohort.members.length],
        );
        cohortId = revived[0]?.id ?? null;
      }
      if (!cohortId) continue;

      // Replace, do not merge. See the header.
      await tx.query(`DELETE FROM cohort_members WHERE owner_id = $1 AND cohort_id = $2`, [
        owner,
        cohortId,
      ]);
      for (const m of cohort.members) {
        await tx.query(
          `INSERT INTO cohort_members (owner_id, cohort_id, contact_id, evidence)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (owner_id, cohort_id, contact_id) DO NOTHING`,
          [owner, cohortId, m.contactId, m.evidence ?? null],
        );
        members += 1;
      }
    }

    // Anything that used to be a cohort and no longer derives.
    const { rows: existing } = await tx.query(
      `SELECT id, kind, key FROM cohorts WHERE owner_id = $1 AND deleted_at IS NULL`,
      [owner],
    );
    for (const row of existing) {
      if (liveKeys.has(`${row.kind}:${row.key}`)) continue;
      await tx.query(
        `UPDATE cohorts SET deleted_at = now(), member_count = 0, updated_at = now()
          WHERE id = $1 AND owner_id = $2`,
        [row.id, owner],
      );
      await tx.query(`DELETE FROM cohort_members WHERE owner_id = $1 AND cohort_id = $2`, [
        owner,
        row.id,
      ]);
    }
  });

  const retired = await query(
    `SELECT count(*)::int AS n FROM cohorts
      WHERE owner_id = $1 AND deleted_at IS NOT NULL`,
    [owner],
  )
    .then((r) => r.rows[0]?.n ?? 0)
    .catch(() => 0);

  return { cohorts: derived.length, members, retired };
}

/** The owner's audiences, biggest first, for a sharing picker. */
export async function listCohorts(ownerId) {
  const owner = asUuid(ownerId);
  if (!owner) return [];
  const { rows } = await query(
    `SELECT id, kind, key, name, flavor, member_count, computed_at
       FROM cohorts
      WHERE owner_id = $1 AND deleted_at IS NULL
      ORDER BY member_count DESC, name ASC`,
    [owner],
  );
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    key: r.key,
    name: r.name,
    flavor: r.flavor,
    memberCount: Number(r.member_count ?? 0),
    computedAt: r.computed_at ?? null,
  }));
}

/**
 * Who is in one cohort, and the address that put them there.
 *
 * The evidence is returned rather than kept internal because "why is this
 * person in my Stanford group" has to be answerable before anybody will trust
 * sharing to it.
 */
export async function listCohortMembers(ownerId, cohortId) {
  const owner = asUuid(ownerId);
  const cohort = asUuid(cohortId);
  if (!owner || !cohort) return [];
  const { rows } = await query(
    `SELECT cm.contact_id, cm.evidence, c.full_name
       FROM cohort_members cm
       JOIN contacts c ON c.owner_id = cm.owner_id AND c.id = cm.contact_id
                      AND c.deleted_at IS NULL
      WHERE cm.owner_id = $1 AND cm.cohort_id = $2
      ORDER BY c.full_name ASC`,
    [owner, cohort],
  );
  return rows.map((r) => ({
    contactId: r.contact_id,
    name: r.full_name ?? null,
    evidence: r.evidence ?? null,
  }));
}
