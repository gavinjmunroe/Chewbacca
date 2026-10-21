/**
 * WHICH OF AN OWNER'S AUDIENCES DOES THIS VIEWER BELONG TO?
 *
 * There were two authorization systems over one dataset and they did not agree.
 *
 *   src/db/viewer-reach.js   governs notes, feeds, audio, comments. Knows about
 *                            network / circle / contact / cohort and resolves a
 *                            viewer through linked accounts and registered
 *                            phone keys.
 *
 *   src/privacy/field-policy governs profile FIELDS. Knew only
 *                            `connected && users.privacy_tier = 'full_social'`
 *                            and never consulted `shares` at all.
 *
 * viewer-reach's own header explains why it was consolidated into one copy:
 * "Two copies of an authorization rule drift, and when they drift the failure
 * is asymmetric and quiet." That consolidation never reached field-policy, so
 * the drift it warns about was sitting one directory away -- a viewer could be
 * a member of a circle the owner shares their whole life to and still be told
 * nothing about their profile, or the reverse, and no single file said which
 * was intended.
 *
 * THIS IS THE SHARED DEFINITION. One question -- what is this viewer to this
 * owner -- answered once, in the vocabulary both sides already use. field-policy
 * stays pure and now takes the answer instead of a bare boolean; viewer-reach
 * stays SQL because it has to run inside a feed query, and a test asserts the
 * two agree about the audiences that exist.
 *
 * FAIL CLOSED. Every error path returns the empty audience, which grants
 * nothing. An authorization check that cannot decide must say no.
 */

import { query } from "../db/sql.js";
import { areConnected } from "../db/connections-store.js";
import { getUserProfileByAmberId } from "../db/store.js";
import { KEY_TYPE } from "../lib/identity-keys.js";
import { getMembership, getPolicy } from "../db/org-store.js";
import { audiencePermitted } from "../lib/org-scopes.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const asUuid = (v) =>
  typeof v === "string" && UUID_RE.test(v.trim()) ? v.trim().toLowerCase() : null;

/** What a viewer can be to an owner. Grants nothing on its own. */
export function emptyAudience() {
  return Object.freeze({
    self: false,
    connected: false,
    ownerSharesBaseline: false,
    contactIds: [],
    circleIds: [],
    cohortIds: [],
    // The company BOTH of them are active members of, or null. Never just the
    // viewer's: a viewer in company A is nothing to an owner in company B, and
    // storing the viewer's own org here would make "is this person in the org
    // this share was made in" answerable with the wrong org.
    orgId: null,
    groupIds: [],
    // That company's ceiling, carried so audienceReaches can apply it without
    // another round trip. Null for everybody else.
    policy: null,
  });
}

/**
 * Resolve every audience of `ownerId` that `viewerId` is currently in.
 *
 * The viewer's identity comes from the database, never from the caller: the
 * phone keys are looked up in `discovery_keys`, which records what an account
 * has PROVEN it owns. An earlier version of the reach predicate took the phone
 * as a parameter and a smoke test showed that handing any member's audience to
 * anyone who knew their number was reachable. There is deliberately no phone
 * argument here either.
 */
export async function resolveAudience(viewerId, ownerId) {
  const viewer = asUuid(viewerId);
  const owner = asUuid(ownerId);
  if (!viewer || !owner) return emptyAudience();
  if (viewer === owner) return { ...emptyAudience(), self: true, connected: true };

  const connected = await areConnected(viewer, owner).catch(() => false);

  let ownerSharesBaseline = false;
  try {
    const profile = await getUserProfileByAmberId(owner);
    ownerSharesBaseline = profile?.privacyTier === "full_social";
  } catch {
    ownerSharesBaseline = false;
  }

  // The owner's contacts that resolve to THIS viewer -- by linked account, or
  // by a phone key the viewer has proven. Everything else hangs off these.
  let contactIds = [];
  try {
    const { rows } = await query(
      `SELECT DISTINCT c.id
         FROM contacts c
         LEFT JOIN contact_identity_keys k
           ON k.owner_id = c.owner_id AND k.contact_id = c.id
          AND k.key_type = $3
          AND k.key_hash IN (SELECT d.key_hash FROM discovery_keys d
                              WHERE d.amber_id = $1 AND d.key_type = $3)
        WHERE c.owner_id = $2 AND c.deleted_at IS NULL
          AND (c.linked_amber_id = $1 OR k.contact_id IS NOT NULL)`,
      [viewer, owner, KEY_TYPE.PHONE],
    );
    contactIds = rows.map((r) => String(r.id));
  } catch {
    return { ...emptyAudience(), connected, ownerSharesBaseline };
  }

  if (contactIds.length === 0) {
    return { ...emptyAudience(), connected, ownerSharesBaseline };
  }

  let circleIds = [];
  let cohortIds = [];
  try {
    const { rows } = await query(
      `SELECT ci.id
         FROM circles ci
         JOIN circle_members cm ON cm.circle_id = ci.id AND cm.owner_id = ci.owner_id
        WHERE ci.owner_id = $1 AND ci.deleted_at IS NULL
          AND cm.contact_id = ANY($2::uuid[])`,
      [owner, contactIds],
    );
    circleIds = rows.map((r) => String(r.id));
  } catch {
    circleIds = [];
  }
  try {
    const { rows } = await query(
      `SELECT co.id
         FROM cohorts co
         JOIN cohort_members cm ON cm.cohort_id = co.id AND cm.owner_id = co.owner_id
        WHERE co.owner_id = $1 AND co.deleted_at IS NULL
          AND cm.contact_id = ANY($2::uuid[])`,
      [owner, contactIds],
    );
    cohortIds = rows.map((r) => String(r.id));
  } catch {
    cohortIds = [];
  }

  const org = await resolveSharedOrg(viewer, owner);

  return {
    self: false,
    connected,
    ownerSharesBaseline,
    contactIds,
    circleIds,
    cohortIds,
    ...org,
  };
}

/**
 * THE COMPANY THESE TWO SHARE, if any.
 *
 * Both memberships are read and both must be ACTIVE and for the SAME company.
 * Reading only the viewer's would answer "which company is this person in",
 * which is a different question and the wrong one: it would let a member of one
 * company satisfy the org leg for a share made in another.
 *
 * Suspension cuts both ways on purpose. A suspended viewer reaches nothing, and
 * a suspended owner's org-scoped shares stop resolving -- which is what an
 * admin means when they switch somebody off while something is investigated.
 */
async function resolveSharedOrg(viewer, owner) {
  const none = { orgId: null, groupIds: [], policy: null };
  const [v, o] = await Promise.all([
    getMembership(viewer).catch(() => null),
    getMembership(owner).catch(() => null),
  ]);
  if (!v || !o) return none;
  if (v.orgId !== o.orgId) return none;
  if (v.status !== "active" || o.status !== "active") return none;

  const [groups, policy] = await Promise.all([
    listViewerGroups(v.orgId, viewer),
    getPolicy(v.orgId).catch(() => null),
  ]);
  return { orgId: v.orgId, groupIds: groups, policy };
}

async function listViewerGroups(orgId, viewer) {
  try {
    const { rows } = await query(
      `SELECT gm.group_id
         FROM org_group_members gm
         JOIN org_groups g ON g.org_id = gm.org_id AND g.id = gm.group_id
                          AND g.deleted_at IS NULL
        WHERE gm.org_id = $1::uuid AND gm.amber_id = $2::uuid`,
      [orgId, viewer],
    );
    return rows.map((r) => String(r.group_id));
  } catch {
    return [];
  }
}

/**
 * Does this audience reach a share with the given scope?
 *
 * The JavaScript twin of the SQL in viewer-reach.js. Both exist because one has
 * to run inside a feed query and the other has to run over an already-loaded
 * object, and a test asserts they recognize the same scope vocabulary.
 */
export function audienceReaches(audience, { scopeType, scopeRef = null, orgId = null, classification = null } = {}) {
  const a = audience ?? emptyAudience();
  if (a.self) return true;
  if (!inAudience(a, scopeType, scopeRef)) return false;
  return ceilingPermits(a, { scopeType, orgId, classification });
}

/** Is the viewer in the audience this share was addressed to? */
function inAudience(a, scopeType, scopeRef) {
  switch (scopeType) {
    case "network":
      return Boolean(a.connected);
    case "contact":
      return a.contactIds.includes(String(scopeRef));
    case "circle":
      return a.circleIds.includes(String(scopeRef));
    case "cohort":
      return a.cohortIds.includes(String(scopeRef));
    case "org":
      // Membership of the same company is the whole test; an org share has no
      // target id, exactly as a network share has none.
      return Boolean(a.orgId);
    case "group":
      return a.groupIds.includes(String(scopeRef));
    default:
      // An unknown scope is not a permissive one.
      return false;
  }
}

/**
 * THE CEILING, ON THIS SIDE TOO.
 *
 * The SQL predicate applies it to every share carrying an org_id, and this is
 * the file whose own header explains what happens when two copies of an
 * authorization rule disagree. A ceiling enforced on the feed but not on
 * profile fields would be a ceiling with a door in it.
 *
 * A share with no company passes untouched -- the consumer product is not
 * governed by anybody's policy.
 */
function ceilingPermits(a, { scopeType, orgId, classification }) {
  if (!orgId) return true;
  // Made in a company this viewer is not an active member of.
  if (a.orgId !== orgId) return false;
  return audiencePermitted(a.policy, classification, scopeType);
}
