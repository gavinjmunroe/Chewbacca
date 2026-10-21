/**
 * WHICH COLUMNS POINT AT A CONTACT.
 *
 * Lives on its own because two things need it and they need each other: merging
 * repoints these columns, and the undo snapshot has to photograph the same set
 * before the merge runs. Leaving it in contact-merge.js made that a cycle.
 *
 * THE LIST IS DISCOVERED, NOT WRITTEN DOWN. Eighteen-odd tables carry a foreign
 * key to contacts (owner_id, id) and more arrive as the app grows. Hardcoding the
 * list means the next table someone adds is silently not moved by a merge and
 * silently not captured by a snapshot, and the failure mode is lost notes.
 */

import { query } from "./sql.js";

/** Read once per process: the schema does not change under a running server. */
let _refCache = null;

export async function referencingColumns() {
  if (_refCache) return _refCache;
  const { rows } = await query(
    `SELECT c.conrelid::regclass::text AS table_name,
            a.attname                  AS column_name
       FROM pg_constraint c
       JOIN unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord) ON TRUE
       JOIN pg_attribute a
         ON a.attrelid = c.conrelid AND a.attnum = k.attnum
      WHERE c.contype = 'f'
        AND c.confrelid = 'contacts'::regclass
        -- The FKs are composite (owner_id, id); owner_id is not the column that
        -- needs repointing and must not be rewritten.
        AND a.attname <> 'owner_id'`,
  );
  // Deduped: a table can reference contacts twice (a "contact_id" and a
  // "related_contact_id"), and both need moving, but not twice each.
  const seen = new Set();
  _refCache = [];
  for (const r of rows) {
    const key = `${r.table_name}.${r.column_name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    _refCache.push({ table: r.table_name, column: r.column_name });
  }
  return _refCache;
}

/** Tests only: forget the cached schema read. */
export function _resetRefCache() {
  _refCache = null;
}
