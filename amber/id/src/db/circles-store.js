/**
 * Cloud SQL store for the circles feature.
 *
 * THE SCHEMA, AS IT ACTUALLY IS. This block used to describe bigint ids, and it
 * was not merely out of date -- it was the reason the whole file was wrong. Every
 * id in here is a uuid:
 *
 *   circles            (id uuid PK, owner_id uuid, name, color, description,
 *                       classified_kind, classified_fact, classified_at,
 *                       created_at, updated_at, deleted_at)
 *   circle_members     (circle_id uuid, contact_id uuid, owner_id uuid, added_at)
 *   circle_member_seen (viewer_amber_id uuid, circle_id uuid, seen_at)
 *
 * Verify rather than trust this comment:
 *   node scripts/column-drift-audit.mjs --by-file
 *
 * "connected" is derived: a member is connected when contacts.linked_amber_id IS NOT NULL.
 * Member display name = COALESCE(full_name, NULLIF(TRIM(CONCAT_WS(' ', first_name, last_name)), '')).
 *
 * SECURITY INVARIANT: every function is scoped by owner_id (uuid = amber_id).
 * No function may read or write rows across owners.
 */

import { query } from "./sql.js";
import { queryWithOptionalColumn } from "./optional-column.js";
import { linkResolvableContacts } from "./identity-link.js";
import { revokeCircleFacts } from "./circle-enrichment.js";
import { scheduleCircleFactSync } from "./circle-fact-sync.js";
import { KEY_TYPE, phoneHash } from "../lib/identity-keys.js";

// Guard: a uuid, canonicalised, or null.
//
// THIS WAS _toInt AND IT REJECTED EVERY REAL ID. circles.id and contacts.id are
// both uuid; coercing them with Number() gave NaN, _toInt returned null, and
// every function here took its early-return path -- null, [] or 0 depending on
// the signature. Combined with routes/circles.js validating the same ids as
// positive integers, circles did not fail loudly, they were simply never
// reachable.
const _UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function _asUuid(v) {
  return typeof v === "string" && _UUID_RE.test(v.trim())
    ? v.trim().toLowerCase()
    : null;
}


// THE INBOUND MEMBERSHIP PREDICATE. "Is this viewer a member of someone else's
// circle?" -- an authorization question, asked from three places in this file.
//
// IT WAS BOTH BROKEN AND UNSAFE, and the two are related.
//
// BROKEN: it read `k.key_type = 'phone' AND k.key_value = $2`.
// contact_identity_keys has had no key_value column since migration 003, and
// key_type has been a smallint since then too. So all three queries below threw
// `column k.key_value does not exist` -- and because every function here catches
// and returns [] / null / 0, the failure surfaced as CIRCLES SIMPLY BEING EMPTY.
// No error, no log, nothing to notice. The schema-drift audit did not catch it
// because it checks table names and not column names.
//
// UNSAFE: it took the viewer's phone as a bind parameter, which is only safe
// while every caller passes the viewer's OWN verified number. Today they do
// (request.privyUser.phone), and nothing in the predicate could tell if one day
// they did not -- at which point knowing a member's phone number would hand you
// that circle. Exactly the hole removed from note-shares in viewer-reach.js.
//
// It also compared the LAST TEN DIGITS of a raw phone string, so +33612345678
// and +13612345678 -- both real, allocatable numbers -- resolved to the same
// person. That was a confirmed finding in the August audit and it was load-
// bearing for access, not just for dedup.
//
// NOW: the same shape as VIEWER_REACH_SQL, and for the same reasons. The
// viewer's keys are LOOKED UP from discovery_keys -- the table recording which
// hashed keys an account has proven it owns, written at signup and never by a
// request -- so identity comes from the database rather than from the caller, and
// the parameter that could be wrong no longer exists. Full-value hashes, so no
// collision.
//
// THE DUPLICATE-CONTACT LEG, and why it is not a hole. The old third leg
// compared the phone on the contact row directly, and its comment says it is
// "the one that actually made the reported bug go away": contact_identity_keys
// is deduped per (owner, key_type, key_hash), so when an owner holds two rows
// for the same person only one carries the key, and a circle containing the
// other row matched nothing. That bug is real and dropping the leg outright
// would bring it back. So it is kept, but between two rows of the SAME OWNER
// rather than against anything a caller supplied: if the key resolves to one of
// your contacts, another of your contacts with the identical normalized number
// is the same person. No caller input, no truncation, nothing spoofable.
//
// $1 = viewer amber_id. THAT IS THE ONLY PARAMETER. `c` is the member's contact
// row and `cm` the circle_members row; both must be in scope where this is used.
const _INBOUND_MATCH = `(
  c.linked_amber_id = $1
  OR EXISTS (
    SELECT 1
      FROM contact_identity_keys k
      JOIN contacts kc ON kc.owner_id = k.owner_id AND kc.id = k.contact_id
     WHERE k.owner_id = cm.owner_id
       AND k.key_type = ${KEY_TYPE.PHONE}
       AND k.key_hash IN (SELECT d.key_hash FROM discovery_keys d
                           WHERE d.amber_id = $1 AND d.key_type = ${KEY_TYPE.PHONE})
       AND (
         k.contact_id = cm.contact_id
         OR (kc.phone_primary_normalized IS NOT NULL
             AND kc.phone_primary_normalized = c.phone_primary_normalized)
       )
  )
)`;

/**
 * Circles other owners have added this viewer to. Returns the SAME preview shape
 * as listCirclesWithPreview, plus `owner` (who created it) and `seen` (whether
 * the viewer has opened it before). Never includes the viewer's own circles.
 */
/**
 * NOTE ON `viewerPhone`: ACCEPTED AND IGNORED. The predicate no longer takes a
 * phone -- it looks the viewer's keys up in discovery_keys. The parameter stays
 * in the signature only so src/routes/circles.js does not have to change in the
 * same commit as an authorization fix; it should come out the next time that
 * route file is touched deliberately.
 */
export async function getInboundCirclesForViewer(viewerAmberId, viewerPhone) {
  if (!viewerAmberId) return [];
  try {
    // Query A: the inbound circles + owner identity, one row per circle.
    const { rows: circleRows } = await query(
      `SELECT DISTINCT
         ci.id, ci.name, ci.color, ci.description, ci.created_at, ci.updated_at,
         ci.owner_id,
         ou.full_name AS owner_name, ou.username AS owner_username, ou.avatar_url AS owner_avatar
       FROM circles ci
       JOIN circle_members cm ON cm.circle_id = ci.id
       JOIN contacts c        ON c.id = cm.contact_id AND c.deleted_at IS NULL
       LEFT JOIN users ou      ON ou.amber_id = ci.owner_id
       WHERE ci.deleted_at IS NULL
         AND ci.owner_id <> $1
         AND ${_INBOUND_MATCH}
       ORDER BY ci.created_at ASC`,
      [viewerAmberId],
    );
    if (circleRows.length === 0) return [];

    const circleIds = circleRows.map((r) => r.id).filter(Boolean);

    // Query B: every member of those circles, for counts + a 4-person preview.
    const { rows: memberRows } = await query(
      `SELECT
         cm.circle_id,
         c.id AS contact_id,
         COALESCE(c.full_name,
           NULLIF(TRIM(CONCAT_WS(' ', c.first_name, c.last_name)), '')) AS name,
         c.avatar_url,
         -- Same as the owner-circles query above: the ID, not just the boolean.
         -- The member mapping below reads amber_id, so a query that selects
         -- only the boolean would make every inbound member read as not on
         -- Amber.
         c.linked_amber_id AS amber_id,
         u.username AS username
       FROM circle_members cm
       JOIN contacts c ON c.id = cm.contact_id AND c.deleted_at IS NULL
       LEFT JOIN users u ON u.amber_id = c.linked_amber_id AND u.deleted_at IS NULL
       WHERE cm.circle_id = ANY($1::uuid[])
       ORDER BY cm.circle_id ASC, c.id ASC`,
      [circleIds],
    );
    const membersByCircle = new Map();
    for (const m of memberRows) {
      const key = String(m.circle_id);
      if (!membersByCircle.has(key)) membersByCircle.set(key, []);
      membersByCircle.get(key).push({
        contactId: String(m.contact_id),
        name: m.name ?? null,
        avatarUrl: m.avatar_url ?? null,
        connected: !!m.amber_id,
        // Declared by the client type since it was written, never sent until
        // now. See the note on the query above.
        amberId: m.amber_id ? String(m.amber_id) : null,
        username: m.username ?? null,
      });
    }

    // Seen flags for the banner / "new" marker. Degrades to unseen on any error.
    let seenIds = new Set();
    try {
      const { rows: seenRows } = await query(
        `SELECT circle_id FROM circle_member_seen
          WHERE viewer_amber_id = $1 AND circle_id = ANY($2::uuid[])`,
        [viewerAmberId, circleIds],
      );
      seenIds = new Set(seenRows.map((r) => String(r.circle_id)));
    } catch {
      seenIds = new Set();
    }

    return circleRows.map((ci) => {
      const allMembers = membersByCircle.get(String(ci.id)) ?? [];
      const connectedCount = allMembers.filter((m) => m.connected).length;
      return {
        id: String(ci.id),
        name: ci.name,
        color: ci.color ?? null,
        description: ci.description ?? null,
        memberCount: allMembers.length,
        connectedCount,
        // FOUR -> THIRTY. "Circle limit should be at 30, not small."
        //
        // The emblem plots its members as dots on a ring, so this cap is how
        // many of them the mark can actually show -- and at four, a circle of
        // twenty drew four dots and a number. Names and ids only (no avatars,
        // see the query), so thirty is a few hundred bytes per circle.
        preview: allMembers.slice(0, 30),
        createdAt: ci.created_at ?? null,
        updatedAt: ci.updated_at ?? null,
        origin: "inbound",
        seen: seenIds.has(String(ci.id)),
        owner: {
          amberId: String(ci.owner_id),
          name: ci.owner_name ?? null,
          username: ci.owner_username ?? null,
          avatarUrl: ci.owner_avatar ?? null,
        },
      };
    });
  } catch (e) {
    // LOGGED, not swallowed. This used to `return []`, which made every possible
    // failure — a missing column, a bad cast, a dropped connection — completely
    // indistinguishable from "you are not in any circles". The bug that a member
    // could not see a circle they were in was invisible for exactly this reason.
    console.error(`INBOUND_CIRCLES_ERR ${e?.stack || e?.message || e}`);
    return [];
  }
}

/**
 * Members of an inbound circle, for a viewer who is a MEMBER (not the owner).
 * Returns null when the viewer is not actually a member of that circle (callers
 * translate null to 404), otherwise the full member list in the same shape as
 * getCircleMembers. Read-only: membership does not grant editing.
 */
/**
 * NOTE ON `viewerPhone`: ACCEPTED AND IGNORED. The predicate no longer takes a
 * phone -- it looks the viewer's keys up in discovery_keys. The parameter stays
 * in the signature only so src/routes/circles.js does not have to change in the
 * same commit as an authorization fix; it should come out the next time that
 * route file is touched deliberately.
 */
export async function getInboundCircleMembers(viewerAmberId, viewerPhone, circleId) {
  const id = _asUuid(circleId);
  if (!viewerAmberId || !id) return null;
  try {
    // Gate: the viewer must resolve to a member of this non-owned, active circle.
    const { rows: gate } = await query(
      `SELECT 1
         FROM circle_members cm
         JOIN contacts c  ON c.id = cm.contact_id AND c.deleted_at IS NULL
         JOIN circles ci  ON ci.id = cm.circle_id AND ci.deleted_at IS NULL
        WHERE cm.circle_id = $2
          AND ci.owner_id <> $1
          AND ${_INBOUND_MATCH}
        LIMIT 1`,
      [viewerAmberId, id],
    );
    if (gate.length === 0) return null;

    // Same projection as the owned path, and it has to be: this is the SAME
    // circle seen from the other side, and two shapes for one screen is how the
    // inbound view ends up quietly missing a feature the owned view has.
    //
    // Note whose card these rows are: the OWNER's. A member looking at an
    // inbound circle sees the owner's names for everyone, which is the only
    // thing there is to show -- they may have no card of their own for most of
    // them. The linked account's name and avatar override it wherever the owner
    // has resolved the person, so the more the graph resolves, the more everyone
    // converges on what people actually call themselves.
    const { rows } = await query(
      `SELECT
         c.id AS contact_id,
         COALESCE(NULLIF(TRIM(u.full_name), ''),
                  c.full_name,
                  NULLIF(TRIM(CONCAT_WS(' ', c.first_name, c.last_name)), '')) AS name,
         COALESCE(u.avatar_url, c.avatar_url) AS avatar_url,
         c.linked_amber_id AS amber_id,
         u.username,
         (c.linked_amber_id IS NOT NULL) AS connected
       FROM circle_members cm
       JOIN contacts c ON c.id = cm.contact_id AND c.deleted_at IS NULL
       LEFT JOIN users u
         ON u.amber_id = c.linked_amber_id AND u.deleted_at IS NULL
       WHERE cm.circle_id = $1
       ORDER BY name ASC NULLS LAST, c.id ASC`,
      [id],
    );
    return rows.map((r) => ({
      contactId: String(r.contact_id),
      name: r.name ?? null,
      avatarUrl: r.avatar_url ?? null,
      connected: !!r.connected,
      amberId: r.amber_id ? String(r.amber_id) : null,
      username: r.username ?? null,
    }));
  } catch {
    return null;
  }
}

/**
 * Mark an inbound circle as opened by this viewer, so its banner / new marker
 * stops showing. Idempotent. Returns true on success.
 */
export async function markInboundCircleSeen(viewerAmberId, circleId) {
  const id = _asUuid(circleId);
  if (!viewerAmberId || !id) return false;
  try {
    await query(
      `INSERT INTO circle_member_seen (viewer_amber_id, circle_id)
       VALUES ($1, $2)
       ON CONFLICT (viewer_amber_id, circle_id) DO NOTHING`,
      [viewerAmberId, id],
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * A member leaving an inbound circle: removes the circle_members rows for the
 * contact(s) that resolve to this viewer. Only touches a circle the viewer does
 * NOT own (owners delete, they do not leave). Returns the number of rows removed.
 */
/**
 * NOTE ON `viewerPhone`: ACCEPTED AND IGNORED. The predicate no longer takes a
 * phone -- it looks the viewer's keys up in discovery_keys. The parameter stays
 * in the signature only so src/routes/circles.js does not have to change in the
 * same commit as an authorization fix; it should come out the next time that
 * route file is touched deliberately.
 */
export async function leaveInboundCircle(viewerAmberId, viewerPhone, circleId) {
  const id = _asUuid(circleId);
  if (!viewerAmberId || !id) return 0;
  try {
    const { rowCount } = await query(
      `DELETE FROM circle_members cm
        USING contacts c, circles ci
        WHERE cm.circle_id = $2
          AND ci.id = cm.circle_id
          AND ci.owner_id <> $1
          AND c.id = cm.contact_id
          AND ${_INBOUND_MATCH}`,
      [viewerAmberId, id],
    );
    return rowCount ?? 0;
  } catch {
    return 0;
  }
}

/**
 * Create a new circle for the owner.
 * Returns the inserted row or null on error.
 */
export async function createCircle(
  ownerId,
  { name, color = null, description = null, kindTag = null } = {},
  deps = {},
) {
  if (!ownerId || !name) return null;
  try {
    // kind_tag arrived in migration 034 and is optional by design. Naming it
    // unconditionally is what stopped circles from being CREATED at all on a
    // deploy that had shipped ahead of its migration -- see db/optional-column.
    const { rows } = await queryWithOptionalColumn(
      "circles.kind_tag",
      (has) =>
        has
          ? `INSERT INTO circles (owner_id, name, color, description, kind_tag)
             VALUES ($1, $2, $3, $4, $5)
             RETURNING id, owner_id, name, color, description, kind_tag, created_at, updated_at`
          : `INSERT INTO circles (owner_id, name, color, description)
             VALUES ($1, $2, $3, $4)
             RETURNING id, owner_id, name, color, description, NULL::text AS kind_tag,
                       created_at, updated_at`,
      [ownerId, name.trim(), color ?? null, description ?? null, kindTag ?? null],
      deps,
    );
    const row = rows[0] ?? null;
    // SCHEDULED, NOT AWAITED. Nothing on screen reads the member facts and
    // nobody is waiting to see them, so they have no business being inside the
    // request that creates the circle. See circle-fact-sync.js for the whole
    // arithmetic of why this mattered.
    //
    // An injected query (tests) skips it too: this function's contract is the
    // INSERT and what it returns.
    if (row && !deps.queryImpl) {
      scheduleCircleFactSync(ownerId, row.id);
    }
    return row;
  } catch (err) {
    // NOT A BARE CATCH ANY MORE. This swallowed the exact failure that stopped
    // circles from being created -- a parameter-count mismatch in the fallback
    // statement -- and turned it into a 500 with no cause anywhere. The write
    // still fails softly, because a route that cannot create a circle should
    // say so rather than crash, but it no longer fails silently.
    console.error(
      `CREATE_CIRCLE_ERR owner=${ownerId} ${err?.code ? `${err.code} ` : ""}${err?.message || err}`,
    );
    return null;
  }
}

/**
 * Partial-update a circle. Only fields explicitly present in the patch object
 * are written; omitted fields are left unchanged.
 * Returns the updated row, or null when the circle is not found / not owned.
 */
export async function updateCircle(ownerId, circleId, patch = {}, deps = {}) {
  const id = _asUuid(circleId);
  if (!ownerId || !id) return null;

  const sets = [];
  const params = [id, ownerId];

  if (patch.name !== undefined) {
    params.push(patch.name.trim());
    sets.push(`name = $${params.length}`);
  }
  if (patch.color !== undefined) {
    params.push(patch.color ?? null);
    sets.push(`color = $${params.length}`);
  }
  if (patch.description !== undefined) {
    params.push(patch.description ?? null);
    sets.push(`description = $${params.length}`);
  }
  if (patch.kindTag !== undefined) {
    // Empty string clears it, so a circle can go back to untagged. `?? null`
    // alone would store '' and the web would render an empty pill.
    const tag = typeof patch.kindTag === "string" ? patch.kindTag.trim() : "";
    params.push(tag.length > 0 ? tag : null);
    sets.push(`kind_tag = $${params.length}`);
  }
  if (sets.length === 0) return null; // caller sent an empty patch

  // Clear the cached FACT when the circle's identity changes, so the next
  // syncCircleFacts regenerates the sentence written onto each member's card.
  //
  // classified_kind is deliberately NOT cleared any more. It is no longer read
  // for anything -- the kind is kind_tag, which the user set and which nothing
  // here is entitled to blank -- and clearing it would destroy the provenance
  // of migration 034's backfill.
  const nameOrDescChanged = patch.name !== undefined || patch.description !== undefined;
  if (nameOrDescChanged) {
    sets.push("classified_fact = NULL", "classified_at = NULL");
  }

  sets.push("updated_at = now()");

  try {
    const { rows } = await queryWithOptionalColumn(
      "circles.kind_tag",
      (has) => `UPDATE circles
       SET ${has ? sets.join(", ") : sets.filter((x) => !x.startsWith("kind_tag =")).join(", ")}
       WHERE id = $1 AND owner_id = $2 AND deleted_at IS NULL
       RETURNING id, owner_id, name, color, description,
                 ${has ? "kind_tag" : "NULL::text AS kind_tag"}, created_at, updated_at`,
      params,
      deps,
    );
    const row = rows[0] ?? null;
    if (row && nameOrDescChanged && !deps.queryImpl) {
      scheduleCircleFactSync(ownerId, row.id);
    }
    return row;
  } catch (err) {
    // Same reason as createCircle: renaming a circle failed for the same
    // parameter-count reason and reported nothing.
    console.error(
      `UPDATE_CIRCLE_ERR owner=${ownerId} circle=${id} ` +
        `${err?.code ? `${err.code} ` : ""}${err?.message || err}`,
    );
    return null;
  }
}

/**
 * Soft-delete a circle. Members rows are left intact (they are filtered by
 * the circle's deleted_at in reads). Returns the number of rows affected.
 */
export async function softDeleteCircle(ownerId, circleId) {
  const id = _asUuid(circleId);
  if (!ownerId || !id) return 0;
  try {
    const { rowCount } = await query(
      `UPDATE circles
       SET deleted_at = now()
       WHERE id = $1 AND owner_id = $2 AND deleted_at IS NULL`,
      [id, ownerId],
    );
    const count = rowCount ?? 0;
    if (count > 0) {
      await revokeCircleFacts(ownerId, id).catch(() => {});
    }
    return count;
  } catch {
    return 0;
  }
}

/**
 * List all active circles for the owner, each enriched with aggregate counts and
 * a preview of up to 4 members. Uses exactly two queries (no N+1):
 *   Query A — circles + counts via LEFT JOIN + GROUP BY.
 *   Query B — all member rows for all active circles, joined to contacts.
 * JS assembles the previews from Query B results.
 *
 * Returns [{ id, name, color, memberCount, connectedCount, preview, createdAt, updatedAt }].
 * Only members whose contact row is not soft-deleted are counted / shown.
 */
export async function listCirclesWithPreview(ownerId) {
  if (!ownerId) return [];
  try {
    // Query A: circles with aggregate member + connected counts.
    const { rows: circleRows } = await queryWithOptionalColumn(
      "circles.kind_tag",
      (has) => `SELECT
         ci.id,
         ci.name,
         ci.color,
         ci.description,
         ci.classified_kind,
         ${has ? "ci.kind_tag," : "NULL::text AS kind_tag,"}
         ci.created_at,
         ci.updated_at,
         COUNT(DISTINCT CASE WHEN c.deleted_at IS NULL THEN cm.contact_id END)::int            AS member_count,
         COUNT(DISTINCT CASE WHEN c.deleted_at IS NULL AND c.linked_amber_id IS NOT NULL
                              THEN cm.contact_id END)::int                                       AS connected_count
       FROM circles ci
       LEFT JOIN circle_members cm ON cm.circle_id = ci.id
       LEFT JOIN contacts c        ON c.id = cm.contact_id AND c.deleted_at IS NULL
       WHERE ci.owner_id = $1 AND ci.deleted_at IS NULL
       GROUP BY ci.id, ci.name, ci.color, ci.description, ci.classified_kind,
                ${has ? "ci.kind_tag," : ""} ci.created_at, ci.updated_at
       ORDER BY ci.created_at ASC`,
      [ownerId],
    );
    if (circleRows.length === 0) return [];

    // Query B: member detail rows for all of this owner's active circles.
    const { rows: memberRows } = await query(
      `SELECT
         cm.circle_id,
         c.id                                                                                   AS contact_id,
         COALESCE(c.full_name,
           NULLIF(TRIM(CONCAT_WS(' ', c.first_name, c.last_name)), ''))                        AS name,
         c.avatar_url,
         -- WHO THIS MEMBER IS ON AMBER, not merely THAT they are.
         --
         -- This selected only the boolean. lib/circles.ts has declared
         -- amberId (string or null) on a member for as long as it has existed --
         -- "the Amber account this member IS, once the server has resolved
         -- their contact card to one" -- and the server has never sent it, so
         -- it was undefined on every member of every circle.
         --
         -- The profile web matches your connections to your circles through
         -- exactly that field. With it undefined, no connection ever belonged
         -- to any circle, so pressing the Amber pill answered "nobody from that
         -- circle is on Amber yet" about the only three people who were, and
         -- every other pill counted only the faint invite nodes. The links were
         -- all correctly stamped; nothing was reading them out.
         c.linked_amber_id                                                                      AS amber_id,
         u.username                                                                             AS username
       FROM circle_members cm
       JOIN contacts c ON c.id = cm.contact_id AND c.deleted_at IS NULL
       LEFT JOIN users u ON u.amber_id = c.linked_amber_id AND u.deleted_at IS NULL
       WHERE cm.owner_id = $1
       ORDER BY cm.circle_id ASC, c.id ASC`,
      [ownerId],
    );

    // Group member rows by circle_id for O(1) preview assembly below.
    const membersByCircle = new Map();
    for (const m of memberRows) {
      const key = String(m.circle_id);
      if (!membersByCircle.has(key)) membersByCircle.set(key, []);
      membersByCircle.get(key).push({
        contactId: String(m.contact_id),
        name: m.name ?? null,
        avatarUrl: m.avatar_url ?? null,
        connected: !!m.amber_id,
        // Declared by the client type since it was written, never sent until
        // now. See the note on the query above.
        amberId: m.amber_id ? String(m.amber_id) : null,
        username: m.username ?? null,
      });
    }

    return circleRows.map((ci) => {
      const allMembers = membersByCircle.get(String(ci.id)) ?? [];
      return {
        id: String(ci.id),
        name: ci.name,
        color: ci.color ?? null,
        description: ci.description ?? null,
        // THE KIND, AS THE USER SET IT. Free text: Work, Friends, Family,
        // School are offered in the picker and anything can be typed. The
        // profile web groups its sectors by this and puts it on each node's
        // flag, so it is the one field on a circle that is read on every render
        // of that screen.
        kindTag: ci.kind_tag ?? null,
        // The old model-assigned kind (interest | experience | affiliation |
        // other). Still returned so nothing that reads it breaks mid-rollout,
        // but it is no longer written and nothing should arrange itself around
        // it -- see migration 034 for why it stopped being trustworthy.
        classifiedKind: ci.classified_kind ?? null,
        memberCount: ci.member_count ?? 0,
        connectedCount: ci.connected_count ?? 0,
        // FOUR -> THIRTY. "Circle limit should be at 30, not small."
        //
        // The emblem plots its members as dots on a ring, so this cap is how
        // many of them the mark can actually show -- and at four, a circle of
        // twenty drew four dots and a number. Names and ids only (no avatars,
        // see the query), so thirty is a few hundred bytes per circle.
        preview: allMembers.slice(0, 30),
        createdAt: ci.created_at ?? null,
        updatedAt: ci.updated_at ?? null,
      };
    });
  } catch (e) {
    // LOGGED, not swallowed. This used to `return []`, which made every possible
    // failure — a missing column, a bad cast, a dropped connection — completely
    // indistinguishable from "you are not in any circles". The bug that a member
    // could not see a circle they were in was invisible for exactly this reason.
    console.error(`LIST_CIRCLES_ERR ${e?.stack || e?.message || e}`);
    return [];
  }
}

/**
 * Return all members of a single circle, joined to contacts (soft-deleted contacts
 * are excluded). Returns null when the circle is not found or not owned by ownerId —
 * callers should translate null to 404. Returns [] for a circle with no members.
 */
export async function getCircleMembers(ownerId, circleId) {
  const id = _asUuid(circleId);
  if (!ownerId || !id) return null;
  try {
    // Verify the circle is owned and active before reading members.
    const { rows: circleCheck } = await query(
      `SELECT id FROM circles WHERE id = $1 AND owner_id = $2 AND deleted_at IS NULL`,
      [id, ownerId],
    );
    if (circleCheck.length === 0) return null;

    // A LINKED MEMBER IS A PERSON, NOT A CARD.
    //
    // This returned the contact row and a bare `connected` boolean, so the app
    // had no choice but to render the card: the name as typed in the address
    // book and whichever raw field was to hand underneath it -- "Apple",
    // "sagart851@gmail.com". A member who has an Amber account, a username and
    // an avatar was displayed as an email address, and there was nothing to tap
    // because there was no account id to tap through to.
    //
    // The account's own name and avatar WIN when the link exists: they are what
    // that person chose to be called and they keep themselves up to date, while
    // a contact card is a snapshot of whatever was in someone's phone. The
    // card's name survives as a fallback for the unlinked, and for a linked
    // account that has not set a display name.
    const { rows } = await query(
      `SELECT
         c.id                                                                    AS contact_id,
         COALESCE(NULLIF(TRIM(u.full_name), ''),
                  c.full_name,
                  NULLIF(TRIM(CONCAT_WS(' ', c.first_name, c.last_name)), ''))   AS name,
         COALESCE(u.avatar_url, c.avatar_url)                                    AS avatar_url,
         c.linked_amber_id                                                       AS amber_id,
         u.username,
         (c.linked_amber_id IS NOT NULL)                                         AS connected
       FROM circle_members cm
       JOIN contacts c ON c.id = cm.contact_id AND c.deleted_at IS NULL
       LEFT JOIN users u
         ON u.amber_id = c.linked_amber_id AND u.deleted_at IS NULL
       WHERE cm.circle_id = $1 AND cm.owner_id = $2
       ORDER BY name ASC NULLS LAST, c.id ASC`,
      [id, ownerId],
    );
    return rows.map((r) => ({
      contactId: String(r.contact_id),
      name: r.name ?? null,
      avatarUrl: r.avatar_url ?? null,
      connected: !!r.connected,
      // Null unless the card is linked. The app shows the Amber identity and a
      // route to the profile only when both of these are present, so a
      // half-resolved member can never render as a dead link.
      amberId: r.amber_id ? String(r.amber_id) : null,
      username: r.username ?? null,
    }));
  } catch {
    return null;
  }
}

/**
 * EVERY MEMBER OF EVERY CIRCLE, IN ONE QUERY.
 *
 * "The tags should be accurate to how many people are in each circle, and every
 *  single person represented in every single circle should be shown on the web."
 *
 * WHY THIS EXISTS RATHER THAN CALLING getCircleMembers PER CIRCLE. The web draws
 * one ring from all of them at once and the filter pills count all of them at
 * once, so the page needs the whole set before it can draw anything. Somebody
 * with fourteen circles would otherwise open Home and fire fourteen requests,
 * and the ring would assemble itself circle by circle in front of them.
 *
 * THE PREVIEW WAS NOT ENOUGH, and that is the bug this fixes. listCirclesWithPreview
 * caps at 30 members per circle for the pinned grid, and the web was built from
 * those previews plus a handful of suggestion slots -- so a circle's pill counted
 * the people who happened to be DRAWN, not the people in the circle. Family
 * showed 0 because nobody in it is on Amber; NYC Badger House showed 1 because
 * one of its members won a suggestion slot. Neither number was the answer to
 * "how many people are in this circle".
 *
 * The same row shape as getCircleMembers, plus circleId, so the client has one
 * kind of member to think about.
 */
export async function getAllCircleMembers(ownerId) {
  if (!ownerId) return null;
  try {
    const { rows } = await query(
      `SELECT
         cm.circle_id                                                            AS circle_id,
         c.id                                                                    AS contact_id,
         COALESCE(NULLIF(TRIM(u.full_name), ''),
                  c.full_name,
                  NULLIF(TRIM(CONCAT_WS(' ', c.first_name, c.last_name)), ''))   AS name,
         COALESCE(u.avatar_url, c.avatar_url)                                    AS avatar_url,
         c.linked_amber_id                                                       AS amber_id,
         u.username,
         (c.linked_amber_id IS NOT NULL)                                         AS connected
       FROM circle_members cm
       JOIN circles ci
         ON ci.id = cm.circle_id AND ci.owner_id = $1 AND ci.deleted_at IS NULL
       JOIN contacts c
         ON c.id = cm.contact_id AND c.deleted_at IS NULL
       LEFT JOIN users u
         ON u.amber_id = c.linked_amber_id AND u.deleted_at IS NULL
       WHERE cm.owner_id = $1
       ORDER BY name ASC NULLS LAST, c.id ASC`,
      [ownerId],
    );
    return rows.map((r) => ({
      circleId: String(r.circle_id),
      contactId: String(r.contact_id),
      name: r.name ?? null,
      avatarUrl: r.avatar_url ?? null,
      connected: !!r.connected,
      amberId: r.amber_id ? String(r.amber_id) : null,
      username: r.username ?? null,
    }));
  } catch (e) {
    // null, not [] -- an empty list is a real answer ("you have no circles")
    // and a failed read must not be mistaken for one, or the web silently
    // draws an empty ring and the pills all read zero.
    console.error(`GET_ALL_CIRCLE_MEMBERS_ERR ${e?.message || e}`);
    return null;
  }
}

/**
 * Add a contact to a circle. Both the circle and the contact must belong to ownerId.
 * Uses ON CONFLICT DO NOTHING so re-adding is idempotent.
 *
 * Returns { status: "added" | "already_present" | "not_found" | "invalid" | "error" }.
 * "not_found" means the circle or contact does not exist or belongs to a different owner.
 */
export async function addCircleMember(ownerId, circleId, contactId) {
  const cid = _asUuid(circleId);
  const ctid = _asUuid(contactId);
  if (!ownerId || !cid || !ctid) return { status: "invalid" };
  try {
    // Verify circle belongs to this owner and is active.
    const { rows: circleCheck } = await query(
      `SELECT id FROM circles WHERE id = $1 AND owner_id = $2 AND deleted_at IS NULL`,
      [cid, ownerId],
    );
    if (circleCheck.length === 0) return { status: "not_found" };

    // Verify contact belongs to this owner and is active.
    const { rows: contactCheck } = await query(
      `SELECT id FROM contacts WHERE id = $1 AND owner_id = $2 AND deleted_at IS NULL`,
      [ctid, ownerId],
    );
    if (contactCheck.length === 0) return { status: "not_found" };

    const { rows } = await query(
      `INSERT INTO circle_members (circle_id, contact_id, owner_id)
       VALUES ($1, $2, $3)
       ON CONFLICT (circle_id, contact_id) DO NOTHING
       RETURNING contact_id`,
      [cid, ctid, ownerId],
    );
    const result = rows.length > 0 ? { status: "added" } : { status: "already_present" };
    // LINK THE MEMBER TO THEIR OWN ACCOUNT, NOW.
    //
    // A circle member is a row in the OWNER's contacts table and nothing else. For
    // that person to see the circle, some query has to be able to say "this contact
    // row is that account", and until this call existed nothing ever wrote that
    // link — which is the whole reason a new circle's members saw nothing. Doing it
    // here means it is true from the moment they are added, for anyone who already
    // has an Amber account; anyone who signs up later gets it from the backfill in
    // resolveAmberIdByPhone.
    //
    // Best-effort: the predicate has other legs, and failing to add someone to a
    // circle because a link could not be stamped would be the worse outcome.
    await linkCircleMemberToAccount(ownerId, ctid).catch(() => {});
    scheduleCircleFactSync(ownerId, cid);
    return result;
  } catch (e) {
    console.error(`ADD_CIRCLE_MEMBER_ERR ${e?.message || e}`);
    return { status: "error" };
  }
}

/**
 * Stamp contacts.linked_amber_id for one contact, if it provably belongs to a
 * registered account.
 *
 * THIS USED TO RE-DERIVE THE HASHES ITSELF, and that was the bug. It read
 * `phone_primary` and `phones_all` off the contact row, hashed them here, and
 * looked the result up in discovery_keys -- bypassing contact_identity_keys,
 * the table whose entire job is to hold exactly those hashes. So a card whose
 * keys had been claimed correctly, but whose text columns were empty, held the
 * number in a format phoneKey normalizes differently, or kept it only in
 * `phone_primary_normalized`, matched nothing at all. Meanwhile the right hash
 * was sitting in the keys table.
 *
 * Measured: a backfill-discovery-keys dry run found all ten accounts holding
 * keys, nothing to claim, no conflicts -- and twenty-six contact cards that
 * resolved to an account through a key without being linked. This function had
 * run on several of them and found nothing.
 *
 * It delegates to db/identity-link now, which is the only place that column is
 * written, and it also picks up email keys for free -- an email-only card can
 * link to an account that registered that address, which the phone-column
 * version could never do.
 */
async function linkCircleMemberToAccount(ownerId, contactId) {
  await linkResolvableContacts({ ownerId, contactId });
}

/**
 * SET A CIRCLE'S MEMBERSHIP TO EXACTLY THIS LIST, IN ONE REQUEST.
 *
 * "I've been sitting here for 10 minutes trying to make one change to one circle
 *  and then create another one."
 *
 * The editor computes a membership delta and then applied it one contact per
 * HTTP request, sequentially -- and each of those requests did a full fact
 * reconcile of the whole circle. Twenty members was twenty round trips over
 * quadratic work. This is the primitive that shape was missing: the editor knows
 * the final list, so it sends the final list.
 *
 * IDEMPOTENT BY CONSTRUCTION. It is a SET, not a delta, so a retry after a
 * dropped response cannot double-add or half-apply; and the caller does not have
 * to know what the server currently thinks the membership is.
 *
 * WHAT IT RETURNS is the delta it actually applied -- added and removed ids,
 * plus any ids that are not this owner's contacts (`unknown`). The route
 * reports those rather than failing the whole write: one stale id in a list of
 * twenty must not lose the other nineteen, and the old per-member loop reported
 * exactly that as "2 member changes didn't stick" with nothing to act on.
 *
 * @param {string[]} contactIds the complete desired membership
 */
export async function setCircleMembers(ownerId, circleId, contactIds, deps = {}) {
  const run = deps.queryImpl || query;
  const cid = _asUuid(circleId);
  if (!ownerId || !cid) return { status: "invalid" };
  const wanted = [
    ...new Set((Array.isArray(contactIds) ? contactIds : []).map(_asUuid).filter(Boolean)),
  ];
  try {
    const { rows: circleCheck } = await run(
      `SELECT id FROM circles WHERE id = $1 AND owner_id = $2 AND deleted_at IS NULL`,
      [cid, ownerId],
    );
    if (circleCheck.length === 0) return { status: "not_found" };

    // WHICH OF THESE ARE ACTUALLY HIS CONTACTS -- one statement for the whole
    // list, where the old path spent a round trip per id. An id that is not his
    // is dropped and reported, never silently added.
    const { rows: ownRows } = await run(
      `SELECT id FROM contacts
        WHERE owner_id = $1 AND id = ANY($2::uuid[]) AND deleted_at IS NULL`,
      [ownerId, wanted],
    );
    const own = new Set(ownRows.map((r) => String(r.id)));
    const unknown = wanted.filter((id) => !own.has(id));
    const target = wanted.filter((id) => own.has(id));

    // The two writes. ON CONFLICT DO NOTHING makes the insert a no-op for
    // members already there, and RETURNING tells us which ones were genuinely
    // new -- which is what decides who gets told about it.
    const { rows: addedRows } = await run(
      `INSERT INTO circle_members (circle_id, contact_id, owner_id)
       SELECT $1, x, $3 FROM unnest($2::uuid[]) AS x
       ON CONFLICT (circle_id, contact_id) DO NOTHING
       RETURNING contact_id`,
      [cid, target, ownerId],
    );
    const { rows: removedRows } = await run(
      `DELETE FROM circle_members
        WHERE circle_id = $1 AND owner_id = $3
          AND NOT (contact_id = ANY($2::uuid[]))
       RETURNING contact_id`,
      [cid, target, ownerId],
    );

    const added = addedRows.map((r) => String(r.contact_id));
    const removed = removedRows.map((r) => String(r.contact_id));

    // The account links for the new members, so the circle resolves for anyone
    // who already has Amber. Batched with bounded concurrency rather than a
    // serial loop, and best-effort: failing to stamp a link must not fail the
    // membership write. Anyone who signs up later is linked by the backfill in
    // resolveAmberIdByPhone.
    if (!deps.queryImpl && added.length > 0) {
      for (let i = 0; i < added.length; i += 8) {
        await Promise.all(
          added.slice(i, i + 8).map((ctid) => linkCircleMemberToAccount(ownerId, ctid).catch(() => {})),
        );
      }
    }
    // ONE scheduled reconcile for the whole change, not one per member.
    if (!deps.queryImpl && (added.length > 0 || removed.length > 0)) {
      scheduleCircleFactSync(ownerId, cid);
    }
    return { status: "ok", added, removed, unknown, total: target.length };
  } catch (e) {
    console.error(
      `SET_CIRCLE_MEMBERS_ERR owner=${ownerId} circle=${cid} ` +
        `${e?.code ? `${e.code} ` : ""}${e?.message || e}`,
    );
    return { status: "error" };
  }
}

/**
 * Return the circles a contact belongs to (for the given owner). Useful for
 * rendering circle badges on a contact profile. Returns [] on error or when
 * the contact belongs to no circles.
 *
 * Only non-deleted circles are returned; deleted contacts are not filtered here
 * (caller already owns the contact record).
 */
export async function getCirclesForContact(ownerId, contactId) {
  const ctid = _asUuid(contactId);
  if (!ownerId || !ctid) return [];
  try {
    const { rows } = await query(
      `SELECT ci.id, ci.name, ci.color, ci.description
       FROM circle_members cm
       JOIN circles ci ON ci.id = cm.circle_id AND ci.deleted_at IS NULL
       WHERE cm.owner_id = $1 AND cm.contact_id = $2
       ORDER BY ci.name ASC NULLS LAST, ci.id ASC`,
      [ownerId, ctid],
    );
    return rows.map((r) => ({
      id: String(r.id),
      name: r.name,
      color: r.color ?? null,
      description: r.description ?? null,
    }));
  } catch (e) {
    // LOGGED, not swallowed. This used to `return []`, which made every possible
    // failure — a missing column, a bad cast, a dropped connection — completely
    // indistinguishable from "you are not in any circles". The bug that a member
    // could not see a circle they were in was invisible for exactly this reason.
    console.error(`CIRCLES_FOR_CONTACT_ERR ${e?.stack || e?.message || e}`);
    return [];
  }
}

/**
 * Remove a contact from a circle. owner_id in the WHERE clause prevents cross-owner
 * deletion. Returns the number of rows deleted (0 if the membership did not exist).
 */
export async function removeCircleMember(ownerId, circleId, contactId) {
  const cid = _asUuid(circleId);
  const ctid = _asUuid(contactId);
  if (!ownerId || !cid || !ctid) return 0;
  try {
    const { rowCount } = await query(
      `DELETE FROM circle_members
       WHERE circle_id = $1 AND contact_id = $2 AND owner_id = $3`,
      [cid, ctid, ownerId],
    );
    scheduleCircleFactSync(ownerId, cid);
    return rowCount ?? 0;
  } catch {
    return 0;
  }
}
