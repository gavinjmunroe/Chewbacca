/**
 * The sharing engine. A `share` makes ONE item visible to ONE audience.
 *
 * Audience is a scope, and the three have not changed:
 *   contact  — one specific person (scope_ref = a contact_id in the owner's book)
 *   circle   — everyone in one circle (scope_ref = a circle_id the owner owns)
 *   network  — everyone the owner is connected to (scope_ref = NULL)
 * Sharing to several circles is several `circle` rows.
 *
 * WHAT CHANGED. Three things, and each was a way this file was broken against the
 * new schema rather than merely out of date:
 *
 *   1. `contact_experiences` is gone. An experience is an observation now, so
 *      "share this experience" writes item_type 'observation' and reads the text
 *      out of `observations`. The ROUTE VOCABULARY IS UNCHANGED -- the API still
 *      says "experience", because that is what a user shares; the translation
 *      happens here, in one map, rather than leaking a storage word into a
 *      request body.
 *
 *   2. Ids are uuids. `_toInt` accepted 42 and rejected a uuid, so every call
 *      would have returned null -- a share sheet that silently does nothing.
 *
 *   3. The viewer-reach predicate moved to db/viewer-reach.js. The copy that
 *      lived here had drifted badly: it tested `connections.user_a`,
 *      `connections.user_b` and a `deleted_at` column, none of which exist on the
 *      table any more (it is a_amber_id / b_amber_id / status), so its network leg
 *      matched nothing while the note store's equivalent worked. That is exactly
 *      the asymmetric, silent failure two copies of an authorization rule produce.
 *
 * SECURITY INVARIANTS, unchanged:
 *  - Writes are owner-scoped: you can only share an item you own, to a contact or
 *    circle you own, and a client-supplied target is validated before any write.
 *  - Reads resolve the VIEWER through a real edge only, per share, at read time.
 */

import { query } from "./sql.js";
import { VIEWER_REACH_SQL, SCOPE_TYPES as REACHABLE_SCOPE_TYPES } from "./viewer-reach.js";
import { KEY_TYPE } from "../lib/identity-keys.js";
import { getMembership, getPolicy } from "./org-store.js";
import { audiencePermitted, isClassification } from "../lib/org-scopes.js";

// What a caller may say, and what the column stores. `shares.item_type` has a
// CHECK constraint; anything outside this map cannot be written, which is the
// point -- a typo'd item type is a rejected write, not an unreachable row.
const ITEM_TYPE_TO_COLUMN = Object.freeze({
  experience: "observation",
  post: "post",
  interaction: "interaction",
});
const COLUMN_TO_ITEM_TYPE = Object.freeze({
  observation: "experience",
  post: "post",
  interaction: "interaction",
});
// From viewer-reach, which is the only thing that can actually RESOLVE a scope.
// A local copy drifted once already; see the note beside the export.
const SCOPE_TYPES = new Set(REACHABLE_SCOPE_TYPES);

// The sentinel the partial unique index uses so a NULL scope_ref (network) still
// participates in uniqueness. It must match `shares_unique_live` in migration 004
// exactly; a different constant here means the ON CONFLICT silently stops firing
// and re-sharing to your network inserts a second row every time.
const NIL_UUID = "00000000-0000-0000-0000-000000000000";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const asUuid = (v) =>
  typeof v === "string" && UUID_RE.test(v.trim()) ? v.trim().toLowerCase() : null;

// Does the item belong to the owner? Only observations are content-resolvable
// today; posts and interactions have no table yet, so they are accepted
// structurally and remain owner-scoped at read time regardless.
async function _ownerOwnsItem(ownerId, columnType, itemId) {
  if (columnType !== "observation") return true;
  const { rowCount } = await query(
    `SELECT 1 FROM observations
      WHERE observation_id = $1 AND owner_id = $2 AND deleted_at IS NULL`,
    [itemId, ownerId],
  );
  return rowCount > 0;
}

// Does the audience target belong to the owner? Never trust a client target id.
async function _ownerOwnsScope(ownerId, scopeType, scopeRef, orgId) {
  if (scopeType === "network") return scopeRef == null;
  /*
   * AN ORG AUDIENCE IS NOT OWNED BY A PERSON, it is owned by the company -- so
   * "does the owner own this target" becomes "is the owner in the company this
   * target belongs to". The org_id used here is the owner's OWN live
   * membership, resolved server-side a few lines up, never anything a client
   * sent; there is no request shape that can address another company's group.
   */
  if (scopeType === "org") return Boolean(orgId) && scopeRef == null;
  if (!scopeRef) return false;
  if (scopeType === "group") {
    if (!orgId) return false;
    const { rowCount } = await query(
      `SELECT 1 FROM org_groups
        WHERE id = $1 AND org_id = $2 AND deleted_at IS NULL`,
      [scopeRef, orgId],
    );
    // ANY member may address ANY group in their company, not only the groups
    // they are in. Posting to a team channel you are not on is an ordinary
    // thing to do; requiring membership would make "send this to Legal"
    // impossible for everybody except Legal.
    return rowCount > 0;
  }
  const table =
    scopeType === "contact" ? "contacts"
    : scopeType === "circle" ? "circles"
    : scopeType === "cohort" ? "cohorts"
    : null;
  if (!table) return false;
  const { rowCount } = await query(
    `SELECT 1 FROM ${table} WHERE id = $1 AND owner_id = $2 AND deleted_at IS NULL`,
    [scopeRef, ownerId],
  );
  return rowCount > 0;
}

/**
 * WHICH COMPANY IS THIS PERSON SHARING INSIDE, AND WHAT DOES IT ALLOW.
 *
 * Returns null for a consumer account, which is most of them, and in that case
 * nothing else in this file changes behavior at all.
 *
 * A SUSPENDED MEMBER CANNOT SHARE. Their membership resolves, so the org_id is
 * known, but the policy lookup is skipped and the caller refuses the write --
 * suspension that only stopped reads would let somebody keep publishing into a
 * company that has switched them off.
 */
async function _orgContext(ownerId) {
  const membership = await getMembership(ownerId).catch(() => null);
  if (!membership) return null;
  if (membership.status !== "active") return { orgId: membership.orgId, suspended: true };
  const policy = await getPolicy(membership.orgId).catch(() => null);
  return { orgId: membership.orgId, policy, suspended: false };
}

/**
 * THE CLASSIFICATION AN ORG SHARE CARRIES.
 *
 * Defaulted rather than refused when a client does not send one, and
 * `internal` is the default because it is both the commonest case -- the
 * company's own business -- and the safe middle of the ladder: it cannot leave
 * the building under any policy that does not explicitly allow it to.
 *
 * Refusing instead would be the purer choice and the wrong one: the iOS app
 * does not know this field exists, and an org member sharing from their phone
 * would get a silent failure rather than a sensible default.
 */
function _classificationFor(input) {
  return isClassification(input) ? input : "internal";
}

/**
 * Share an item to one audience. Idempotent per (item, scope target): re-sharing
 * revives a soft-deleted row rather than accumulating a second one. Returns
 * { id } or null.
 */
export async function createShare(ownerId, { itemType, itemId, scopeType, scopeRef = null, classification = null } = {}) {
  const owner = asUuid(ownerId);
  const item = asUuid(itemId);
  const column = ITEM_TYPE_TO_COLUMN[itemType];
  if (!owner || !column || !item || !SCOPE_TYPES.has(scopeType)) return null;
  // 'org' addresses the whole company and therefore has no target id, exactly
  // as 'network' addresses everyone you know and has none.
  const refless = scopeType === "network" || scopeType === "org";
  const ref = refless ? null : asUuid(scopeRef);
  if (!refless && !ref) return null;
  try {
    if (!(await _ownerOwnsItem(owner, column, item))) return null;

    /*
     * THE COMPANY IS STAMPED ON EVERY SHARE A MEMBER MAKES, whatever the
     * audience. A note shared with one outside contact is still something done
     * inside the company instance with the company's data, and a row that does
     * not say so cannot be audited, cannot be filtered out of a consumer
     * warehouse, and cannot be governed by the company's ceiling.
     */
    const org = await _orgContext(owner);
    if (org?.suspended) return null;
    const orgId = org?.orgId ?? null;
    const label = orgId ? _classificationFor(classification) : null;

    if (!(await _ownerOwnsScope(owner, scopeType, ref, orgId))) return null;

    /*
     * THE CEILING, AT WRITE TIME. The predicate checks it again on every read,
     * and that second check is the one that cannot be bypassed -- but refusing
     * here is what lets the person find out NOW, instead of sharing something
     * that silently reaches nobody and discovering it when a colleague says
     * they never saw it.
     *
     * An org scope without a company never reaches this line; _ownerOwnsScope
     * refused it above.
     */
    if (orgId && !audiencePermitted(org.policy, label, scopeType)) return null;

    const { rows } = await query(
      `INSERT INTO shares (owner_id, item_type, item_id, scope_type, scope_ref, org_id, classification)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (owner_id, item_type, item_id, scope_type,
                    COALESCE(scope_ref, '${NIL_UUID}'::uuid))
         WHERE deleted_at IS NULL
       DO UPDATE SET deleted_at = NULL,
                     org_id = EXCLUDED.org_id,
                     classification = EXCLUDED.classification
       RETURNING id`,
      [owner, column, item, scopeType, ref, orgId, label],
    );
    return rows[0] ? { id: String(rows[0].id) } : null;
  } catch (e) {
    console.error(`CREATE_SHARE_ERR ${e?.stack || e?.message || e}`);
    return null;
  }
}

/** Remove a share (owner-scoped soft delete). Returns rows removed. */
export async function deleteShare(ownerId, shareId) {
  const owner = asUuid(ownerId);
  const id = asUuid(shareId);
  if (!owner || !id) return 0;
  try {
    const { rowCount } = await query(
      `UPDATE shares SET deleted_at = now()
        WHERE id = $1 AND owner_id = $2 AND deleted_at IS NULL`,
      [id, owner],
    );
    return rowCount ?? 0;
  } catch (e) {
    console.error(`DELETE_SHARE_ERR ${e?.stack || e?.message || e}`);
    return 0;
  }
}

/**
 * Remove a share by its audience target, so a UI toggle can un-share "this
 * experience from that circle" without knowing the share id.
 */
export async function deleteShareByTarget(
  ownerId,
  { itemType, itemId, scopeType, scopeRef = null } = {},
) {
  const owner = asUuid(ownerId);
  const item = asUuid(itemId);
  const column = ITEM_TYPE_TO_COLUMN[itemType];
  if (!owner || !column || !item || !SCOPE_TYPES.has(scopeType)) return 0;
  const ref = scopeType === "network" ? null : asUuid(scopeRef);
  try {
    const { rowCount } = await query(
      `UPDATE shares SET deleted_at = now()
        WHERE owner_id = $1 AND item_type = $2 AND item_id = $3
          AND scope_type = $4
          AND COALESCE(scope_ref, '${NIL_UUID}'::uuid)
            = COALESCE($5::uuid, '${NIL_UUID}'::uuid)
          AND deleted_at IS NULL`,
      [owner, column, item, scopeType, ref],
    );
    return rowCount ?? 0;
  } catch (e) {
    console.error(`DELETE_SHARE_TARGET_ERR ${e?.stack || e?.message || e}`);
    return 0;
  }
}

/**
 * The audiences one item is currently shared to, so the share sheet can show and
 * toggle current state. Returns [{ id, scopeType, scopeRef }].
 */
export async function listSharesForItem(ownerId, itemType, itemId) {
  const owner = asUuid(ownerId);
  const item = asUuid(itemId);
  const column = ITEM_TYPE_TO_COLUMN[itemType];
  if (!owner || !column || !item) return [];
  try {
    const { rows } = await query(
      `SELECT id, scope_type, scope_ref
         FROM shares
        WHERE owner_id = $1 AND item_type = $2 AND item_id = $3 AND deleted_at IS NULL
        ORDER BY created_at ASC`,
      [owner, column, item],
    );
    return rows.map((r) => ({
      id: String(r.id),
      scopeType: r.scope_type,
      scopeRef: r.scope_ref != null ? String(r.scope_ref) : null,
    }));
  } catch (e) {
    console.error(`LIST_SHARES_ERR ${e?.stack || e?.message || e}`);
    return [];
  }
}

/**
 * Resolve the Amber user behind a contact-scoped share's target, so a one-to-one
 * share can notify the recipient. Owner-scoped: the contact must belong to the
 * sharer. Returns an amber_id or null.
 *
 * THE FALLBACK IS AN INDEX LOOKUP NOW. It used to be
 *
 *   JOIN users u ON right(regexp_replace(u.phone, '\\D', '', 'g'), 10) = k.key_value
 *
 * -- a regex over the whole users table, per share, and impossible now that the
 * key is stored hashed. discovery_keys already maps a hashed key to the account
 * that proved it owns it, which is the same question asked in one probe.
 */
export async function resolveContactRecipient(ownerId, contactId) {
  const owner = asUuid(ownerId);
  const cid = asUuid(contactId);
  if (!owner || !cid) return null;
  try {
    const { rows } = await query(
      `SELECT u.amber_id
         FROM contacts c
         JOIN users u ON u.amber_id = c.linked_amber_id AND u.deleted_at IS NULL
        WHERE c.id = $1 AND c.owner_id = $2 AND c.deleted_at IS NULL
        LIMIT 1`,
      [cid, owner],
    );
    if (rows[0]?.amber_id) return String(rows[0].amber_id);

    const { rows: viaKey } = await query(
      `SELECT u.amber_id
         FROM contact_identity_keys k
         JOIN discovery_keys d ON d.key_hash = k.key_hash AND d.key_type = k.key_type
         JOIN users u ON u.amber_id = d.amber_id AND u.deleted_at IS NULL
        WHERE k.owner_id = $2 AND k.contact_id = $1 AND k.key_type = ${KEY_TYPE.PHONE}
        LIMIT 1`,
      [cid, owner],
    );
    return viaKey[0]?.amber_id ? String(viaKey[0].amber_id) : null;
  } catch (e) {
    console.error(`RESOLVE_RECIPIENT_ERR ${e?.stack || e?.message || e}`);
    return null;
  }
}

/**
 * Everything shared WITH this viewer, newest first, resolved by real edges.
 *
 * viewerPhone is accepted and ignored -- the reach predicate resolves a viewer's
 * phone identity through discovery_keys rather than through a number a caller
 * hands it. The parameter stays so no route has to change.
 */
export async function getSharedWithViewer(viewerAmberId, viewerPhone, { limit = 100 } = {}) {
  const viewer = asUuid(viewerAmberId);
  if (!viewer) return [];
  const lim = Math.min(Math.max(Number(limit) || 100, 1), 200);
  try {
    const { rows } = await query(
      `SELECT
         s.id AS share_id, s.item_type, s.item_id, s.scope_type, s.scope_ref, s.created_at,
         s.owner_id,
         ou.full_name AS owner_name, ou.username AS owner_username, ou.avatar_url AS owner_avatar,
         o.body AS experience_text, o.observed_at AS occurred_at, o.place_text AS location
       FROM shares s
       LEFT JOIN users ou ON ou.amber_id = s.owner_id
       LEFT JOIN observations o
         ON s.item_type = 'observation' AND o.observation_id = s.item_id
        AND o.deleted_at IS NULL
       WHERE s.deleted_at IS NULL
         AND s.owner_id <> $1
         AND ${VIEWER_REACH_SQL}
       ORDER BY s.created_at DESC
       LIMIT $2`,
      [viewer, lim],
    );
    return rows
      .map((r) => {
        const content =
          r.item_type === "observation"
            ? {
                text: r.experience_text ?? null,
                occurredAt: r.occurred_at ?? null,
                location: r.location ?? null,
              }
            : null;
        // A share whose item has been deleted resolves to nothing and is dropped,
        // so a deleted experience never surfaces even if its share row lingers.
        if (r.item_type === "observation" && !content?.text) return null;
        return {
          shareId: String(r.share_id),
          itemType: COLUMN_TO_ITEM_TYPE[r.item_type] ?? r.item_type,
          itemId: String(r.item_id),
          scopeType: r.scope_type,
          scopeRef: r.scope_ref != null ? String(r.scope_ref) : null,
          sharedAt: r.created_at ?? null,
          sharedBy: {
            amberId: String(r.owner_id),
            name: r.owner_name ?? null,
            username: r.owner_username ?? null,
            avatarUrl: r.owner_avatar ?? null,
          },
          content,
        };
      })
      .filter(Boolean);
  } catch (e) {
    console.error(`SHARED_WITH_VIEWER_ERR ${e?.stack || e?.message || e}`);
    return [];
  }
}
