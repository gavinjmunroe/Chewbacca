/**
 * LINKS BETWEEN PEOPLE, AS OPPOSED TO LINKS FROM YOU TO THEM.
 *
 * The star graph says how warm each relationship is. This says how the people
 * in it are connected to each other -- who introduced whom, who was in the
 * room. It is deliberately small: two ids, a kind, a sentence, and who said
 * so. Everything derivable from data the graph already holds (two people at
 * the same firm) is NOT stored here, because the firm column already answers
 * that and pressing the pill already groups them.
 */

import { query } from "./sql.js";

const KINDS = new Set(["introduced", "knows", "met_at", "worked_with"]);

/** Every live link in this org, with both names, ready to draw. */
export async function listLinks({ orgId } = {}) {
  if (!orgId) return [];
  const { rows } = await query(
    `SELECT l.id, l.from_person, l.to_person, l.kind, l.note, l.source,
            l.accepted_at, l.created_at,
            a.display_name AS from_name,
            b.display_name AS to_name
       FROM org_person_links l
       JOIN org_people a ON a.org_id = l.org_id AND a.id = l.from_person
       JOIN org_people b ON b.org_id = l.org_id AND b.id = l.to_person
      WHERE l.org_id = $1::uuid
        AND l.deleted_at IS NULL
        /* A link to somebody who has been merged away points at a node that
           is no longer drawn, so it would be a line to nowhere. */
        AND a.deleted_at IS NULL AND a.merged_into IS NULL
        AND b.deleted_at IS NULL AND b.merged_into IS NULL
      ORDER BY l.created_at DESC
      LIMIT 2000`,
    [orgId],
  );
  return rows;
}

/**
 * Claim that two people are connected.
 *
 * Idempotent on (pair, kind): saying the same thing twice is the same claim.
 * A second attempt updates the note rather than failing, because the second
 * telling is usually the better-worded one.
 */
export async function addLink({
  orgId,
  fromPerson,
  toPerson,
  kind = "knows",
  note = null,
  source = "human",
  byAmberId = null,
} = {}) {
  if (!orgId || !fromPerson || !toPerson) return { ok: false, reason: "bad_input" };
  if (String(fromPerson) === String(toPerson)) return { ok: false, reason: "same_person" };
  const k = KINDS.has(kind) ? kind : "knows";
  const src = source === "inferred" ? "inferred" : "human";

  const { rows } = await query(
    `INSERT INTO org_person_links
       (org_id, from_person, to_person, kind, note, source, created_by, accepted_at)
     VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7::uuid,
             CASE WHEN $6 = 'human' THEN now() ELSE NULL END)
     ON CONFLICT (org_id, from_person, to_person, kind) WHERE deleted_at IS NULL
     DO UPDATE SET
       note = COALESCE(EXCLUDED.note, org_person_links.note),
       /*
        * A HUMAN CLAIM OUTRANKS AN INFERRED ONE and is never downgraded by a
        * model proposing the same thing later. Same rule as a name somebody
        * typed, for the same reason.
        */
       source = CASE WHEN org_person_links.source = 'human' THEN 'human' ELSE EXCLUDED.source END,
       accepted_at = COALESCE(org_person_links.accepted_at, EXCLUDED.accepted_at)
     RETURNING id, from_person, to_person, kind, note, source, accepted_at`,
    [orgId, fromPerson, toPerson, k, note, src, byAmberId],
  );
  return { ok: true, link: rows[0] };
}

/** Accept a link a model proposed. */
export async function acceptLink({ orgId, linkId } = {}) {
  if (!orgId || !linkId) return { ok: false, reason: "bad_input" };
  const { rowCount } = await query(
    `UPDATE org_person_links
        SET accepted_at = now(), source = 'human'
      WHERE org_id = $1::uuid AND id = $2::uuid AND deleted_at IS NULL`,
    [orgId, linkId],
  );
  return rowCount > 0 ? { ok: true } : { ok: false, reason: "not_found" };
}

/** Remove one. Soft, so the unique index lets it be drawn again. */
export async function removeLink({ orgId, linkId } = {}) {
  if (!orgId || !linkId) return { ok: false, reason: "bad_input" };
  const { rowCount } = await query(
    `UPDATE org_person_links SET deleted_at = now()
      WHERE org_id = $1::uuid AND id = $2::uuid AND deleted_at IS NULL`,
    [orgId, linkId],
  );
  return rowCount > 0 ? { ok: true } : { ok: false, reason: "not_found" };
}
