/**
 * REVERSING A MERGE.
 *
 * A merge destroys things on the way in. Both implementations soft-delete the
 * absorbed card and overwrite the survivor's fields; collapseContactGroup also
 * DELETES duplicate rows outright in observation_participants, circle_members,
 * intro_requests and contact_favorites, and mergeContacts deletes any row whose
 * move would violate a unique constraint. None of that comes back on its own.
 *
 * So undo cannot be "point everything back". By the time anyone asks, the rows to
 * point back have been deleted. The only honest way is to photograph every row the
 * merge is about to touch, inside the merge's own transaction, and replay it.
 *
 * ── WHY THIS MATTERS MORE THAN IT SOUNDS ─────────────────────────────────────
 *
 * Without undo, a wrong merge costs the person data they cannot recover, so the
 * matcher has to be timid and every uncertain pair piles up in a queue nobody
 * drains. With undo, a wrong merge costs one tap, the matcher can be braver, and
 * the app stops asking people to adjudicate pairs it could have called itself.
 *
 * A FAKE UNDO IS WORSE THAN NONE. Restoring the two cards but losing the circle
 * membership deleted on the way in leaves the person worse off for having trusted
 * it, and they will not trust the next thing either.
 *
 * ── THE TABLE LIST IS DISCOVERED ─────────────────────────────────────────────
 *
 * referencingColumns() reads pg_constraint for every column pointing at contacts,
 * the same discovery mergeContacts uses. A snapshot that hardcoded its table list
 * would silently stop covering the next table someone adds, and the failure mode
 * is an undo that quietly loses notes -- exactly the thing it exists to prevent.
 * This is also why the snapshot covers BOTH merge paths, including the one in
 * store.js whose own table list is hardcoded and already narrower than reality.
 *
 * ── WHY PRIMARY KEYS ARE PHOTOGRAPHED TOO ────────────────────────────────────
 *
 * Between a merge and its undo, real work happens: a new observation lands on the
 * survivor, someone adds it to a circle. Those rows are not in the photograph and
 * must survive, so undo cannot clear everything pointing at the survivor. Instead
 * it deletes only key tuples the photograph holds, then replays it. Anything
 * created since has a key the photograph does not contain, and stays.
 *
 * ── WHAT IS DELIBERATELY NOT RESTORED ────────────────────────────────────────
 *
 * contact_scores, contact_interaction_stats, contact_dimension_state and
 * contact_embedding derive from observations. Merge drops them so they recompute;
 * undo drops them again for the same reason. Restoring a stale cache would be
 * worse than rebuilding it.
 */

import { query, withTransaction } from "./sql.js";
import { referencingColumns } from "./contact-refs.js";

/** Rebuilt from observations after a restore. Never photographed. */
const DERIVED_TABLES = [
  "contact_scores",
  "contact_interaction_stats",
  "contact_dimension_state",
  "contact_embedding",
];

const SNAPSHOT_VERSION = 1;

// 42P01 undefined_table, 42703 undefined_column. Both mean this deployment does
// not have that shape -- true for the in-memory test double and for a database
// mid-migration. Skipped rather than failing the merge that is already running.
const _missing = (err) => err?.code === "42P01" || err?.code === "42703";

/** Primary key columns for `table`, from the catalog. Empty = not restorable. */
async function _primaryKey(client, table) {
  const { rows } = await client.query(
    `SELECT a.attname
       FROM pg_index i
       JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
      WHERE i.indrelid = $1::regclass AND i.indisprimary
      ORDER BY array_position(i.indkey, a.attnum)`,
    [table],
  );
  return rows.map((r) => r.attname);
}

/**
 * Photograph everything a merge of `contactIds` is about to change.
 *
 * MUST run on the merge's own client, before any mutation. Called afterwards it
 * captures a half-merged world and undo faithfully restores that instead.
 */
export async function captureMergeSnapshot(client, ownerId, survivorId, absorbedIds) {
  const ids = [String(survivorId), ...absorbedIds.map(String)];
  const snap = {
    version: SNAPSHOT_VERSION,
    ownerId: String(ownerId),
    survivorId: String(survivorId),
    absorbedIds: absorbedIds.map(String),
    takenAt: new Date().toISOString(),
    contacts: [],
    tables: {},
    skipped: [],
  };

  const { rows: contactRows } = await client.query(
    `SELECT to_jsonb(c) AS row FROM contacts c
      WHERE c.owner_id = $1 AND c.id = ANY($2::uuid[])`,
    [ownerId, ids],
  );
  snap.contacts = contactRows.map((r) => r.row);

  let refs = [];
  try {
    refs = await referencingColumns();
  } catch (err) {
    if (!_missing(err)) throw err;
  }

  for (const { table, column } of refs) {
    if (DERIVED_TABLES.includes(table)) continue;
    try {
      const pk = await _primaryKey(client, table);
      if (pk.length === 0) {
        // No primary key means no way to delete precisely on restore, so this
        // table would have to be cleared wholesale -- which would take rows
        // created after the merge with it. Recorded and skipped, loudly.
        snap.skipped.push(`${table}:no_pk`);
        continue;
      }
      const { rows } = await client.query(
        `SELECT to_jsonb(t) AS row FROM ${table} t
          WHERE t.owner_id = $1 AND t."${column}" = ANY($2::uuid[])`,
        [ownerId, ids],
      );
      if (rows.length === 0) continue;
      const bucket = (snap.tables[table] ??= { pk, columns: [], rows: [] });
      if (!bucket.columns.includes(column)) bucket.columns.push(column);
      const seen = new Set(bucket.rows.map((r) => pk.map((c) => String(r[c])).join("\u0000")));
      for (const r of rows) {
        const k = pk.map((c) => String(r.row[c])).join("\u0000");
        if (seen.has(k)) continue;
        seen.add(k);
        bucket.rows.push(r.row);
      }
    } catch (err) {
      if (!_missing(err)) throw err;
      snap.skipped.push(`${table}:missing`);
    }
  }

  return snap;
}

/** Write the merge to the log. Returns the row, or null if the table is absent. */
export async function recordMerge(
  client,
  { ownerId, survivorId, absorbedIds, origin = "auto", rule = null, snapshot = null },
) {
  try {
    const { rows } = await client.query(
      `INSERT INTO contact_merges
         (owner_id, survivor_id, absorbed_ids, origin, rule, snapshot)
       VALUES ($1, $2::uuid, $3::uuid[], $4, $5, $6::jsonb)
       RETURNING id, merged_at, undoable_until`,
      [
        ownerId,
        String(survivorId),
        absorbedIds.map(String),
        origin,
        rule,
        snapshot ? JSON.stringify(snapshot) : null,
      ],
    );
    return rows[0] ?? null;
  } catch (err) {
    if (_missing(err)) return null;
    throw err;
  }
}

/** This owner's reversible merges, newest first. */
export async function listUndoableMerges(ownerId, { limit = 25 } = {}) {
  if (!ownerId) return [];
  try {
    const { rows } = await query(
      `SELECT m.id, m.survivor_id, m.absorbed_ids, m.origin, m.rule,
              m.merged_at, m.undoable_until,
              cardinality(m.absorbed_ids) AS absorbed_count,
              c.full_name AS survivor_name
         FROM contact_merges m
         LEFT JOIN contacts c ON c.owner_id = m.owner_id AND c.id = m.survivor_id
        WHERE m.owner_id = $1 AND m.undone_at IS NULL
          AND m.snapshot IS NOT NULL AND m.undoable_until > now()
        ORDER BY m.merged_at DESC
        LIMIT $2`,
      [ownerId, Math.min(Number(limit) || 25, 100)],
    );
    return rows;
  } catch (err) {
    if (_missing(err)) return [];
    throw err;
  }
}

/**
 * Put the world back as it was before merge `mergeId`.
 *
 * Refuses rather than half-restores: expired, pruned or already-undone each come
 * back with a reason the caller can show. Silently doing nothing is how someone
 * comes to believe undo worked when it did not.
 */
export async function undoContactMerge(ownerId, mergeId) {
  if (!ownerId || !mergeId) return { ok: false, reason: "missing_args" };

  try {
    return await withTransaction(async (client) => {
      // FOR UPDATE: two taps on undo must not both replay the same photograph.
      const { rows } = await client.query(
        `SELECT id, survivor_id, absorbed_ids, snapshot, undone_at, undoable_until
           FROM contact_merges WHERE owner_id = $1 AND id = $2 FOR UPDATE`,
        [ownerId, mergeId],
      );
      const merge = rows[0];
      if (!merge) return { ok: false, reason: "not_found" };
      if (merge.undone_at) return { ok: false, reason: "already_undone" };
      if (!merge.snapshot) return { ok: false, reason: "snapshot_pruned" };
      if (new Date(merge.undoable_until) < new Date()) {
        return { ok: false, reason: "window_expired" };
      }

      const snap = merge.snapshot;
      const restored = {};
      const allIds = [snap.survivorId, ...(snap.absorbedIds ?? [])];

      // 1. The cards. UPDATE, never delete-and-reinsert: other tables hold foreign
      //    keys onto contacts and the row must not vanish even momentarily.
      for (const row of snap.contacts ?? []) {
        await client.query(
          `UPDATE contacts c
              SET full_name = t.full_name, first_name = t.first_name,
                  last_name = t.last_name, phone_primary = t.phone_primary,
                  phone_primary_normalized = t.phone_primary_normalized,
                  phones_all = t.phones_all, emails = t.emails,
                  company = t.company, title = t.title, city = t.city,
                  location = t.location, avatar_url = t.avatar_url,
                  linkedin_url = t.linkedin_url, source = t.source,
                  external_id = t.external_id, metadata = t.metadata,
                  deleted_at = t.deleted_at, updated_at = now()
             FROM jsonb_populate_record(null::contacts, $2::jsonb) t
            WHERE c.owner_id = $1 AND c.id = t.id`,
          [ownerId, JSON.stringify(row)],
        );
      }
      restored.contacts = (snap.contacts ?? []).length;

      // 2. Every row that pointed at a card. Delete only the key tuples the
      //    photograph holds, so anything created since the merge stays put.
      for (const [table, entry] of Object.entries(snap.tables ?? {})) {
        const pk = entry?.pk ?? [];
        const rowsJson = entry?.rows ?? [];
        if (rowsJson.length === 0 || pk.length === 0) continue;
        try {
          const cols = pk.map((c) => `"${c}"`).join(", ");
          await client.query(
            `DELETE FROM ${table} WHERE (${cols}) IN (
               SELECT ${cols} FROM jsonb_populate_recordset(null::${table}, $1::jsonb))`,
            [JSON.stringify(rowsJson)],
          );
          const ins = await client.query(
            `INSERT INTO ${table}
             SELECT * FROM jsonb_populate_recordset(null::${table}, $1::jsonb)`,
            [JSON.stringify(rowsJson)],
          );
          restored[table] = ins.rowCount ?? rowsJson.length;
        } catch (err) {
          if (!_missing(err)) throw err;
        }
      }

      // 3. Derived caches: drop, do not restore. They rebuild from observations,
      //    which are now back where they belong.
      for (const table of DERIVED_TABLES) {
        try {
          await client.query(
            `DELETE FROM ${table} WHERE owner_id = $1 AND contact_id = ANY($2::uuid[])`,
            [ownerId, allIds],
          );
        } catch (err) {
          if (!_missing(err)) throw err;
        }
      }

      await client.query(
        `UPDATE contact_merges SET undone_at = now() WHERE owner_id = $1 AND id = $2`,
        [ownerId, mergeId],
      );

      return {
        ok: true,
        mergeId: Number(mergeId),
        survivorId: merge.survivor_id,
        restoredContacts: merge.absorbed_ids,
        restored,
      };
    });
  } catch (err) {
    console.error(
      `CONTACT_MERGE_UNDO_FAILED owner=${ownerId} merge=${mergeId} ` +
        `code=${err?.code || "?"} ${err?.message || err}`,
    );
    return { ok: false, reason: "undo_failed" };
  }
}
