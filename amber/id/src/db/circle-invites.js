/**
 * THE ACCEPT STEP FOR BEING PUT IN SOMEBODY ELSE'S CIRCLE.
 *
 * "I'm right now creating a bunch of circles without Amber users... Those should
 *  be resolved the second those people sign up for Amber with their phone number
 *  or email. I have all of their phone numbers registered in their contacts, so
 *  the second they sign up, it should be resolved. Got it? They should be
 *  notified that they are in the circle and be asked to accept if they want to
 *  join the circle."
 *
 * The resolving half already worked and is not here: signup writes the account's
 * phone into discovery_keys and links every contact card holding that key
 * (store.js linkContactsToAmberUserByPhone), after which the inbound-circle
 * predicate in circles-store.js matches. What did not exist is being TOLD and
 * being ASKED -- a circle someone else made, containing people you may not know,
 * simply materialised in your app.
 *
 * This module is the asking. See db/migrations/…_039_circle_invites.sql for why a
 * missing row means accepted (everyone already in a circle has no row, and
 * re-consenting them would be a regression), and why this is not an access
 * control: note-share reach and DM routing still resolve through circle_members
 * and linked_amber_id, untouched.
 */

import { query } from "./sql.js";

const _UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function _asUuid(v) {
  return typeof v === "string" && _UUID_RE.test(v.trim()) ? v.trim().toLowerCase() : null;
}

/**
 * Create the missing invite rows for circles this viewer is already a member of.
 *
 * `circleIds` are circles the INBOUND PREDICATE has already matched for this
 * viewer -- this function does no authorization of its own and must never be
 * handed ids from a request body.
 *
 * A circle the viewer has already opened is seeded 'accepted': someone who has
 * been reading a circle for weeks has answered the question with their feet, and
 * asking them again would be the feature breaking something that worked. A
 * circle they have never opened becomes 'pending', which is what puts Accept and
 * Decline in front of them.
 *
 * Idempotent. Returns the ids that are now pending AND not yet notified, which
 * is exactly the set somebody should be told about.
 */
export async function openCircleInvites(viewerAmberId, circleIds, deps = {}) {
  const run = deps.queryImpl || query;
  const viewer = _asUuid(viewerAmberId);
  const ids = [...new Set((circleIds || []).map(_asUuid).filter(Boolean))];
  if (!viewer || ids.length === 0) return { pending: [] };
  try {
    await run(
      `INSERT INTO circle_invites (circle_id, viewer_amber_id, status, responded_at)
       SELECT x,
              $1,
              CASE WHEN s.circle_id IS NULL THEN 'pending' ELSE 'accepted' END,
              CASE WHEN s.circle_id IS NULL THEN NULL ELSE now() END
         FROM unnest($2::uuid[]) AS x
         LEFT JOIN circle_member_seen s
           ON s.circle_id = x AND s.viewer_amber_id = $1
       ON CONFLICT (circle_id, viewer_amber_id) DO NOTHING`,
      [viewer, ids],
    );
    const { rows } = await run(
      `SELECT circle_id FROM circle_invites
        WHERE viewer_amber_id = $1
          AND circle_id = ANY($2::uuid[])
          AND status = 'pending'
          AND notified_at IS NULL`,
      [viewer, ids],
    );
    return { pending: rows.map((r) => String(r.circle_id)) };
  } catch (e) {
    // Logged, never thrown. An invite row failing to appear costs an accept
    // prompt; failing the read that triggered it would cost the whole tab.
    console.error(
      `CIRCLE_INVITES_OPEN_ERR viewer=${viewer} ${e?.code ? `${e.code} ` : ""}${e?.message || e}`,
    );
    return { pending: [] };
  }
}

/**
 * The viewer's answer for each of these circles.
 *
 * Returns a Map of circleId -> 'pending' | 'accepted' | 'declined'. A circle with
 * no row is ABSENT from the map, and callers must read that as accepted -- see
 * the migration. Returns an empty map on error, which is the grandfathered
 * reading of everything and therefore the safe direction: a failure here shows
 * circles as they are shown today rather than hiding them behind a prompt.
 */
export async function circleInviteStatuses(viewerAmberId, circleIds, deps = {}) {
  const run = deps.queryImpl || query;
  const viewer = _asUuid(viewerAmberId);
  const ids = [...new Set((circleIds || []).map(_asUuid).filter(Boolean))];
  const out = new Map();
  if (!viewer || ids.length === 0) return out;
  try {
    const { rows } = await run(
      `SELECT circle_id, status FROM circle_invites
        WHERE viewer_amber_id = $1 AND circle_id = ANY($2::uuid[])`,
      [viewer, ids],
    );
    for (const r of rows) out.set(String(r.circle_id), String(r.status));
    return out;
  } catch (e) {
    console.error(
      `CIRCLE_INVITES_READ_ERR viewer=${viewer} ${e?.code ? `${e.code} ` : ""}${e?.message || e}`,
    );
    return out;
  }
}

/**
 * Record that the viewer has been told about these circles, so they are not told
 * again. Best-effort: a duplicate push is a smaller problem than a failed one.
 */
export async function markCircleInvitesNotified(viewerAmberId, circleIds, deps = {}) {
  const run = deps.queryImpl || query;
  const viewer = _asUuid(viewerAmberId);
  const ids = [...new Set((circleIds || []).map(_asUuid).filter(Boolean))];
  if (!viewer || ids.length === 0) return 0;
  try {
    const { rowCount } = await run(
      `UPDATE circle_invites SET notified_at = now()
        WHERE viewer_amber_id = $1 AND circle_id = ANY($2::uuid[]) AND notified_at IS NULL`,
      [viewer, ids],
    );
    return rowCount || 0;
  } catch (e) {
    console.error(`CIRCLE_INVITES_NOTIFY_MARK_ERR viewer=${viewer} ${e?.message || e}`);
    return 0;
  }
}

/**
 * The viewer's answer.
 *
 * `accept: true`  — accepted, and the circle stops asking.
 * `accept: false` — declined. The caller ALSO removes the membership (see the
 *                   route); this row is the memory of the answer, so an owner
 *                   re-syncing their address book does not re-offer the same
 *                   circle tomorrow.
 *
 * Writes the row if it is missing, because a grandfathered member accepting or
 * declining is a real answer and there may be nothing there to update.
 *
 * Returns { status } on success, { status: null } if the viewer is not a member
 * of that circle -- the caller checks membership, since only it holds the
 * inbound predicate.
 */
export async function respondToCircleInvite(viewerAmberId, circleId, accept, deps = {}) {
  const run = deps.queryImpl || query;
  const viewer = _asUuid(viewerAmberId);
  const cid = _asUuid(circleId);
  if (!viewer || !cid) return { status: null };
  const status = accept ? "accepted" : "declined";
  try {
    await run(
      `INSERT INTO circle_invites (circle_id, viewer_amber_id, status, responded_at)
       VALUES ($1, $2, $3, now())
       ON CONFLICT (circle_id, viewer_amber_id)
         DO UPDATE SET status = EXCLUDED.status, responded_at = now()`,
      [cid, viewer, status],
    );
    return { status };
  } catch (e) {
    console.error(
      `CIRCLE_INVITE_RESPOND_ERR viewer=${viewer} circle=${cid} ` +
        `${e?.code ? `${e.code} ` : ""}${e?.message || e}`,
    );
    return { status: null };
  }
}
