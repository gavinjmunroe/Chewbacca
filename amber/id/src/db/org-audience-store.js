/**
 * WHO CAN SEE THIS.
 *
 * One module owns the audience of a file, a page and a post, because the
 * alternative -- each of the three read paths writing its own version of the
 * same predicate -- is how a permission model ends up enforced in two places
 * out of three. Everything that decides visibility is here: the SQL fragment
 * the listings embed, the writer that sets an audience, and the reader that
 * renders one back for the share sheet.
 *
 * THE MODEL, in full:
 *
 *   visibility = 'org'         everybody in the company can read it
 *   visibility = 'restricted'  only the author, the named people, and the
 *                              members of the named groups
 *
 * Audience rows exist for BOTH, because they carry two jobs at once: on a
 * restricted item they say who may read it, and on either kind they say where
 * it is FILED -- which is what makes a group's Files tab possible. A file can
 * be addressed to the whole company and still be filed under the founding
 * team; those are different sentences and the schema lets you say both.
 *
 * THE AUTHOR IS ALWAYS IN THE AUDIENCE, and never stored as a row. Somebody
 * who cannot see the thing they just uploaded will file a bug, and they will
 * be right.
 *
 * THERE IS NO ADMIN OVERRIDE. An owner sees what is addressed to them and what
 * is addressed to everybody. A role that silently reads every private share is
 * not a permission model, it is the absence of one.
 */

import { query } from "./sql.js";
import { withTransaction } from "./sql.js";

export const ITEM_TYPES = new Set(["file", "page", "post"]);

/** Which column on each item table holds the person who made it. */
const AUTHOR_COLUMN = {
  file: "uploaded_by",
  page: "created_by",
  post: "author_id",
};

const ITEM_TABLE = {
  file: "org_page_attachments",
  page: "org_pages",
  post: "org_posts",
};

/**
 * THE READ PREDICATE, as a SQL fragment the listings paste into their WHERE.
 *
 * It is a string builder rather than a view or a function because every
 * listing it serves already has its own filters, its own joins and its own
 * positional parameters, and wrapping each of them in a view would cost a
 * scan of the full table before the org filter ran.
 *
 * `itemType` is interpolated, NOT parameterized -- it is one of three literals
 * from the frozen set above and is never caller-supplied text. `viewer` is the
 * parameter placeholder ("$3") the caller has reserved; it is never a value.
 *
 * FAIL CLOSED. With no viewer -- an internal count, a background job -- only
 * company-wide items match. A missing viewer that opened everything would make
 * forgetting to pass one indistinguishable from having permission.
 */
export function visibleClause({ alias, itemType, viewer }) {
  if (!ITEM_TYPES.has(itemType)) throw new Error(`bad item type: ${itemType}`);
  const author = AUTHOR_COLUMN[itemType];
  return `(
    ${alias}.visibility = 'org'
    OR (
      ${viewer}::uuid IS NOT NULL
      AND (
        ${alias}.${author} = ${viewer}::uuid
        OR EXISTS (
          SELECT 1 FROM org_audiences aud
           WHERE aud.org_id = ${alias}.org_id
             AND aud.item_type = '${itemType}'
             AND aud.item_id = ${alias}.id
             AND (
               (aud.kind = 'person' AND aud.ref = ${viewer}::uuid)
               OR (aud.kind = 'group' AND EXISTS (
                     SELECT 1 FROM org_group_members gm
                      WHERE gm.org_id = aud.org_id
                        AND gm.group_id = aud.ref
                        AND gm.amber_id = ${viewer}::uuid))
             )
        )
      )
    )
  )`;
}

/**
 * "Is this item filed under group $n" -- the group tab's filter.
 *
 * Separate from visibleClause on purpose. Being filed somewhere and being
 * readable are independent, and a listing applies both: a restricted file
 * filed under the founding team does not appear on that tab for somebody who
 * is not in the audience.
 */
export function filedUnderClause({ alias, itemType, group }) {
  if (!ITEM_TYPES.has(itemType)) throw new Error(`bad item type: ${itemType}`);
  /*
   * THE COLUMN COUNTS AS WELL AS THE AUDIENCE ROW.
   *
   * This looked only in org_audiences, which made group_id decorative: a post
   * written with group_id set and no audience row was filed under nothing.
   * The group chat did exactly that, so a message appeared in the company
   * feed, appeared as the group's "last message" in the list -- which reads
   * group_id -- and was then invisible inside the group it was addressed to.
   * Somebody sent a message, watched it land, opened the channel, and found
   * "nothing said here yet".
   *
   * Both are now accepted, and that is the honest model rather than a
   * patch: group_id is where a post was FILED, org_audiences is who it was
   * ADDRESSED to, and most posts set the first without needing the second.
   * The audience row stays authoritative for restricted work, because this
   * clause decides which tab a post shows under and never who may read it --
   * visibleClause is the one that answers that, and it is untouched.
   */
  return `(
    ${group}::uuid IS NULL
    OR ${alias}.group_id = ${group}::uuid
    OR EXISTS (
      SELECT 1 FROM org_audiences f
       WHERE f.org_id = ${alias}.org_id
         AND f.item_type = '${itemType}'
         AND f.item_id = ${alias}.id
         AND f.kind = 'group'
         AND f.ref = ${group}::uuid
    )
  )`;
}

/* ------------------------------------------------------------------ write */

function cleanIds(list) {
  const out = [];
  const seen = new Set();
  for (const raw of Array.isArray(list) ? list : []) {
    const id = String(raw ?? "").trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/**
 * Normalize whatever the client sent into the two facts the schema stores.
 *
 * `everyone` defaults to TRUE when the caller says nothing, because the
 * failure mode of the other default is a company whose first week of uploads
 * are each visible to one person.
 */
export function normalizeAudience(input) {
  const raw = input && typeof input === "object" ? input : {};
  const groups = cleanIds(raw.groups);
  const people = cleanIds(raw.people);
  const everyone = raw.everyone === undefined ? true : Boolean(raw.everyone);
  if (!everyone && groups.length === 0 && people.length === 0) {
    return { ok: false, reason: "empty_audience" };
  }
  return { ok: true, everyone, groups, people };
}

/**
 * Replace an item's audience.
 *
 * ONE TRANSACTION, and it has to be: the column and the rows are a single
 * fact, and the window between them is a window in which the item is either
 * readable by people it was just taken away from or invisible to people it
 * was just given to.
 *
 * THIS FUNCTION IS THE ONLY DOOR. normalizeAudience refusing an empty audience
 * is the whole enforcement of that rule -- there is deliberately no database
 * constraint behind it, for the reason migration 074 sets out at length.
 */
export async function setAudience({
  orgId,
  itemType,
  itemId,
  audience,
  actorId = null,
} = {}) {
  if (!orgId || !itemId || !ITEM_TYPES.has(itemType)) {
    return { ok: false, reason: "bad_input" };
  }
  const want = normalizeAudience(audience);
  if (!want.ok) return want;

  const table = ITEM_TABLE[itemType];

  return withTransaction(async (tx) => {
    const { rowCount } = await tx.query(
      `UPDATE ${table} SET visibility = $3 WHERE org_id = $1 AND id = $2`,
      [orgId, itemId, want.everyone ? "org" : "restricted"],
    );
    if (rowCount === 0) return { ok: false, reason: "not_found" };

    await tx.query(
      `DELETE FROM org_audiences
        WHERE org_id = $1 AND item_type = $2 AND item_id = $3`,
      [orgId, itemType, itemId],
    );

    // One statement for both kinds. unnest with a parallel kind array keeps
    // this a single round trip no matter how many names were picked.
    const refs = [...want.groups, ...want.people];
    if (refs.length > 0) {
      const kinds = [
        ...want.groups.map(() => "group"),
        ...want.people.map(() => "person"),
      ];
      await tx.query(
        `INSERT INTO org_audiences (org_id, item_type, item_id, kind, ref, created_by)
         SELECT $1, $2, $3, k, r::uuid, $6
           FROM unnest($4::text[], $5::text[]) AS t(k, r)
         ON CONFLICT DO NOTHING`,
        [orgId, itemType, itemId, kinds, refs, actorId],
      );
    }
    return { ok: true, everyone: want.everyone, groups: want.groups, people: want.people };
  });
}

/* ------------------------------------------------------------------- read */

/**
 * The audience of one item, with names, for the share sheet.
 *
 * Names come from a join rather than from the client's cached group list so a
 * renamed group is not still showing its old name on the one screen whose
 * whole job is telling somebody who can read this.
 */
export async function getAudience({ orgId, itemType, itemId } = {}) {
  if (!orgId || !itemId || !ITEM_TYPES.has(itemType)) return null;
  const table = ITEM_TABLE[itemType];
  const { rows: item } = await query(
    `SELECT visibility FROM ${table} WHERE org_id = $1 AND id = $2`,
    [orgId, itemId],
  );
  if (item.length === 0) return null;

  const { rows } = await query(
    `SELECT a.kind, a.ref,
            COALESCE(g.name, u.full_name, 'Removed') AS name
       FROM org_audiences a
       LEFT JOIN org_groups g
         ON a.kind = 'group' AND g.org_id = a.org_id AND g.id = a.ref AND g.deleted_at IS NULL
       LEFT JOIN users u
         ON a.kind = 'person' AND u.amber_id = a.ref
      WHERE a.org_id = $1 AND a.item_type = $2 AND a.item_id = $3
      ORDER BY a.kind, name`,
    [orgId, itemType, itemId],
  );

  return {
    everyone: item[0].visibility === "org",
    groups: rows.filter((r) => r.kind === "group").map((r) => ({ id: r.ref, name: r.name })),
    people: rows.filter((r) => r.kind === "person").map((r) => ({ id: r.ref, name: r.name })),
  };
}

/**
 * WHO, BY NAME, WOULD ACTUALLY SEE THIS — resolved through live membership.
 *
 * THE BUG CLASS THIS EXISTS TO KILL: "it works on mine". The author is always
 * in the audience and is never stored as a row, so the person who uploads a
 * file is the one person guaranteed to see it. They set an audience, look at
 * their own screen, see the file, and conclude it worked. Their team opens the
 * same drive and it is not there. Nothing errors. Nobody finds out until
 * somebody says "what file?" in a meeting.
 *
 * So the answer is computed from the roster and the groups rather than
 * inferred from what the person doing the sharing can see, and it is shown to
 * them at the moment they choose — not after a colleague complains.
 *
 * IT LEAKS NOTHING. The caller already holds this item; this only tells them
 * the consequence of a decision they are making about it. Names come from the
 * org roster, which every member can already read.
 */
export async function audienceReach({ orgId, itemType, itemId } = {}) {
  if (!orgId || !itemId || !ITEM_TYPES.has(itemType)) return null;
  const table = ITEM_TABLE[itemType];
  const author = AUTHOR_COLUMN[itemType];

  const { rows } = await query(
    `WITH item AS (
       SELECT visibility, ${author} AS author_id
         FROM ${table} WHERE org_id = $1 AND id = $2
     ),
     roster AS (
       SELECT m.amber_id, COALESCE(u.full_name, 'Unnamed') AS name
         FROM org_members m
         LEFT JOIN users u ON u.amber_id = m.amber_id
        WHERE m.org_id = $1 AND m.status = 'active'
     )
     SELECT r.amber_id, r.name,
            (
              (SELECT visibility FROM item) = 'org'
              OR r.amber_id = (SELECT author_id FROM item)
              OR EXISTS (
                SELECT 1 FROM org_audiences a
                 WHERE a.org_id = $1 AND a.item_type = $3 AND a.item_id = $2
                   AND (
                     (a.kind = 'person' AND a.ref = r.amber_id)
                     OR (a.kind = 'group' AND EXISTS (
                           SELECT 1 FROM org_group_members gm
                            WHERE gm.org_id = $1 AND gm.group_id = a.ref
                              AND gm.amber_id = r.amber_id))
                   )
              )
            ) AS can_see
       FROM roster r
      ORDER BY r.name`,
    [orgId, itemId, itemType],
  );

  const can = rows.filter((r) => r.can_see);
  return {
    total: rows.length,
    count: can.length,
    // Capped: the share sheet shows a sentence, not a directory. The counts
    // are the fact; the names are there so it reads as people rather than
    // arithmetic.
    names: can.slice(0, 8).map((r) => r.name),
    excluded: rows.filter((r) => !r.can_see).slice(0, 8).map((r) => r.name),
  };
}

/**
 * Audiences for a whole listing, in one query.
 *
 * The listings need this to render "Founding team +2" on every row, and doing
 * it per row is one query per file.
 */
export async function audiencesFor({ orgId, itemType, itemIds } = {}) {
  const ids = cleanIds(itemIds);
  if (!orgId || !ITEM_TYPES.has(itemType) || ids.length === 0) return new Map();
  const { rows } = await query(
    `SELECT a.item_id, a.kind, a.ref,
            COALESCE(g.name, u.full_name, 'Removed') AS name
       FROM org_audiences a
       LEFT JOIN org_groups g
         ON a.kind = 'group' AND g.org_id = a.org_id AND g.id = a.ref AND g.deleted_at IS NULL
       LEFT JOIN users u
         ON a.kind = 'person' AND u.amber_id = a.ref
      WHERE a.org_id = $1 AND a.item_type = $2 AND a.item_id = ANY($3::uuid[])
      ORDER BY a.kind, name`,
    [orgId, itemType, ids],
  );
  const out = new Map();
  for (const r of rows) {
    if (!out.has(r.item_id)) out.set(r.item_id, { groups: [], people: [] });
    const entry = out.get(r.item_id);
    (r.kind === "group" ? entry.groups : entry.people).push({ id: r.ref, name: r.name });
  }
  return out;
}

/**
 * WHAT EACH PERSON IN THE COMPANY CAN ACTUALLY SEE, as counts.
 *
 * The second half of killing "it works on mine". The reach preview answers
 * the question one item at a time, at the moment of sharing; this answers it
 * standing back, for everybody, after the fact — which is the only way to
 * catch the share that was fine on its own and the twelfth one that quietly
 * left the new hire with an empty drive.
 *
 * A row reading "Maya — 0 of 41 files" is the entire bug report, visible
 * before Maya has to write it.
 *
 * COUNTS ONLY, AND THAT IS NOT A HEDGE. An admin can already read the roster;
 * knowing how many things somebody can see tells them nothing about what any
 * of them are, so this is safe to show without becoming the admin override
 * the model deliberately does not have.
 */
export async function companyReach({ orgId } = {}) {
  if (!orgId) return [];

  /*
   * One pass per item type, unioned, rather than three round trips. The
   * predicate is written out once per type because the author column differs
   * -- the alternative is three near-identical functions, which is how the
   * post one ends up subtly wrong and nobody notices.
   */
  const parts = [...ITEM_TYPES].map((t) => {
    const table = ITEM_TABLE[t];
    const author = AUTHOR_COLUMN[t];
    const alive = t === "page" ? "x.archived_at IS NULL" : "x.deleted_at IS NULL";
    const extra = t === "file" ? "AND x.status = 'ready'" : t === "post" ? "AND x.parent_id IS NULL" : "";
    return `
      SELECT r.amber_id, '${t}'::text AS kind,
             count(*) FILTER (WHERE
               x.visibility = 'org'
               OR x.${author} = r.amber_id
               OR EXISTS (
                 SELECT 1 FROM org_audiences a
                  WHERE a.org_id = x.org_id AND a.item_type = '${t}' AND a.item_id = x.id
                    AND (
                      (a.kind = 'person' AND a.ref = r.amber_id)
                      OR (a.kind = 'group' AND EXISTS (
                            SELECT 1 FROM org_group_members gm
                             WHERE gm.org_id = a.org_id AND gm.group_id = a.ref
                               AND gm.amber_id = r.amber_id))
                    )
               ))::int AS visible,
             count(*)::int AS total
        FROM roster r
        CROSS JOIN ${table} x
       WHERE x.org_id = $1 AND ${alive} ${extra}
       GROUP BY r.amber_id`;
  });

  const { rows } = await query(
    `WITH roster AS (
       SELECT m.amber_id, COALESCE(u.full_name, 'Unnamed') AS name, m.role
         FROM org_members m
         LEFT JOIN users u ON u.amber_id = m.amber_id
        WHERE m.org_id = $1 AND m.status = 'active'
     ),
     counted AS (${parts.join(" UNION ALL ")})
     SELECT r.amber_id, r.name, r.role,
            COALESCE(max(c.visible) FILTER (WHERE c.kind = 'file'), 0)  AS files_visible,
            COALESCE(max(c.total)   FILTER (WHERE c.kind = 'file'), 0)  AS files_total,
            COALESCE(max(c.visible) FILTER (WHERE c.kind = 'page'), 0)  AS pages_visible,
            COALESCE(max(c.total)   FILTER (WHERE c.kind = 'page'), 0)  AS pages_total,
            COALESCE(max(c.visible) FILTER (WHERE c.kind = 'post'), 0)  AS posts_visible,
            COALESCE(max(c.total)   FILTER (WHERE c.kind = 'post'), 0)  AS posts_total
       FROM roster r
       LEFT JOIN counted c ON c.amber_id = r.amber_id
      GROUP BY r.amber_id, r.name, r.role
      ORDER BY r.name`,
    [orgId],
  );
  return rows;
}

/**
 * Attach audience summaries to rows a listing already fetched.
 *
 * `visibility` comes back on the row itself, so this only has to supply the
 * names -- and a company-wide item with no filing gets `{everyone:true}` with
 * two empty lists rather than a missing key the frontend has to guard.
 */
export async function decorateAudiences({ orgId, itemType, rows } = {}) {
  const list = Array.isArray(rows) ? rows : [];
  if (list.length === 0) return list;
  const map = await audiencesFor({
    orgId,
    itemType,
    itemIds: list.map((r) => r.id),
  });
  for (const row of list) {
    const found = map.get(row.id) ?? { groups: [], people: [] };
    row.audience = {
      everyone: row.visibility !== "restricted",
      groups: found.groups,
      people: found.people,
    };
  }
  return list;
}
