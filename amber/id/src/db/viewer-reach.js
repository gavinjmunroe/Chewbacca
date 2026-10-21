/**
 * THE VIEWER-REACH PREDICATE. One authorization rule, one file.
 *
 * "May this viewer see this shared thing?" is asked from at least three places --
 * the shares feed, the voice-note feed, and every audio/comment/reaction endpoint
 * on a note. It used to be asked with three copies of the SQL, and the copies had
 * already drifted: shares-store still tested `connections.user_a/user_b` and a
 * `deleted_at` column the table does not have, so its network leg matched nothing
 * at all while note-shares-store's worked.
 *
 * Two copies of an authorization rule drift, and when they drift the failure is
 * asymmetric and quiet -- one surface shows an item whose content another refuses,
 * or worse, one surface is the looser of the two and nobody notices. So the
 * predicate lives here and both stores import it.
 */

import { KEY_TYPE } from "../lib/identity-keys.js";

/**
 * THE VIEWER-REACH PREDICATE, and the only copy of it.
 *
 * The caller binds $1 = viewer amber_id (uuid) and aliases the share row as `s`.
 * That is the ONLY parameter. There is deliberately no phone parameter.
 *
 * EXPORTED because note-media-store.js authorizes audio, reactions and comments
 * against it. Two copies of an authorization rule drift, and when they drift the
 * failure is asymmetric and quiet: the feed shows a note whose audio 403s, or
 * worse, the audio endpoint is the looser of the two.
 *
 * WHY THE VIEWER'S PHONE IS NO LONGER AN ARGUMENT. Most contacts are not linked
 * accounts: someone can be a current member of a circle purely by having
 * registered the number their friend has for them, and they must be able to hear
 * the notes shared to it. The old predicate took that number as a parameter --
 * `$2 <> '' AND k.key_value = $2` -- which is only safe while every caller passes
 * the viewer's OWN verified number. A caller that passed a client-supplied one
 * would hand any member's audience to anyone who knew that member's phone
 * number, and nothing in the predicate could tell the difference. A smoke test
 * confirmed the hole was reachable the moment the value came from the wrong
 * place.
 *
 * So the key is not supplied any more, it is LOOKED UP: `discovery_keys` is the
 * table that records which hashed keys an account has proven it owns, written at
 * signup and never by a request. The predicate joins through it, so the viewer's
 * identity comes from the database rather than from the caller and the parameter
 * that could be wrong no longer exists.
 *
 * That means `discovery_keys` must be populated for phone-resolved membership to
 * work at all -- see db/discovery-store.js and scripts/backfill-discovery-keys.js.
 * An unpopulated table fails CLOSED: unlinked members simply cannot reach the
 * note, which is the safe direction to be wrong in.
 */
const _AUDIENCE = `(
  -- network: the owner and the viewer have a live connection. Canonical ordering
  -- (a < b) means the pair can appear only one way round, but which way round
  -- depends on the uuids, so both are tested.
  (s.scope_type = 'network' AND EXISTS (
     SELECT 1 FROM connections cn
      WHERE cn.status = 'active'
        AND ((cn.a_amber_id = s.owner_id AND cn.b_amber_id = $1)
          OR (cn.a_amber_id = $1 AND cn.b_amber_id = s.owner_id))
  ))
  -- contact: the scoped contact of the owner resolves to this viewer, by linked
  -- account or by a phone key the viewer has registered.
  OR (s.scope_type = 'contact' AND EXISTS (
     SELECT 1 FROM contacts c
       LEFT JOIN contact_identity_keys k
         ON k.owner_id = c.owner_id AND k.contact_id = c.id
        AND k.key_type = ${KEY_TYPE.PHONE}
        AND k.key_hash IN (SELECT d.key_hash FROM discovery_keys d
                            WHERE d.amber_id = $1 AND d.key_type = ${KEY_TYPE.PHONE})
      WHERE c.id = s.scope_ref AND c.owner_id = s.owner_id AND c.deleted_at IS NULL
        AND (c.linked_amber_id = $1 OR k.contact_id IS NOT NULL)
  ))
  -- circle: the viewer owns the circle, or is a current member of it.
  OR (s.scope_type = 'circle' AND EXISTS (
     SELECT 1 FROM circles ci
      WHERE ci.id = s.scope_ref AND ci.deleted_at IS NULL
        AND (
          -- The circle's owner always sees its feed, including posts by members.
          -- They are not a row in circle_members, so this cannot come from the
          -- membership check below.
          ci.owner_id = $1
          OR EXISTS (
            SELECT 1 FROM circle_members cm
              JOIN contacts c
                ON c.id = cm.contact_id AND c.owner_id = ci.owner_id
               AND c.deleted_at IS NULL
              LEFT JOIN contact_identity_keys k
                ON k.owner_id = cm.owner_id AND k.contact_id = cm.contact_id
               AND k.key_type = ${KEY_TYPE.PHONE}
        AND k.key_hash IN (SELECT d.key_hash FROM discovery_keys d
                            WHERE d.amber_id = $1 AND d.key_type = ${KEY_TYPE.PHONE})
             WHERE cm.circle_id = ci.id AND cm.owner_id = ci.owner_id
               AND (c.linked_amber_id = $1 OR k.contact_id IS NOT NULL)
          )
        )
  ))
  -- cohort: the viewer is one of the owner's contacts who is IN a derived
  -- audience -- everyone in their book with a stanford.edu address, say.
  --
  -- Resolved exactly like the circle leg, through linked_amber_id or a phone
  -- key the viewer has registered, and for the same reason: most members of an
  -- audience are not linked accounts, and a member who cannot read what was
  -- shared to them is a share that silently did nothing.
  --
  -- THE COHORT'S OWN deleted_at IS TESTED. A cohort that stopped deriving is
  -- soft-deleted rather than dropped, precisely so shares pointing at it stop
  -- resolving instead of resolving to whatever later takes its id. Omitting
  -- this clause would turn that safety into its opposite.
  OR (s.scope_type = 'cohort' AND EXISTS (
     SELECT 1 FROM cohorts co
       JOIN cohort_members cm ON cm.cohort_id = co.id AND cm.owner_id = co.owner_id
       JOIN contacts c ON c.id = cm.contact_id AND c.owner_id = cm.owner_id
                      AND c.deleted_at IS NULL
       LEFT JOIN contact_identity_keys k
         ON k.owner_id = cm.owner_id AND k.contact_id = cm.contact_id
        AND k.key_type = ${KEY_TYPE.PHONE}
        AND k.key_hash IN (SELECT d.key_hash FROM discovery_keys d
                            WHERE d.amber_id = $1 AND d.key_type = ${KEY_TYPE.PHONE})
      WHERE co.id = s.scope_ref AND co.owner_id = s.owner_id
        AND co.deleted_at IS NULL
        AND (c.linked_amber_id = $1 OR k.contact_id IS NOT NULL)
  ))
  -- org: the viewer is a member in good standing of the SAME company this share
  -- was made in. s.org_id, never the owner's current membership -- a share
  -- belongs to the company it was made in, and an author who later leaves does
  -- not take what they shared with them, nor carry it into their next employer.
  --
  -- Testing m.status = 'active' is what makes suspension mean something: a suspended
  -- member stops being able to read the company's feed on their next request,
  -- not on their next login.
  OR (s.scope_type = 'org' AND EXISTS (
     SELECT 1 FROM org_members m
      WHERE m.org_id = s.org_id AND m.amber_id = $1
        AND m.status = 'active' AND m.deleted_at IS NULL
  ))
  -- group: in that group, in that company, in good standing. The join through
  -- org_members is not redundant with the composite foreign key on
  -- org_group_members -- the FK guarantees the person IS a member, not that the
  -- membership is still active.
  OR (s.scope_type = 'group' AND EXISTS (
     SELECT 1 FROM org_group_members gm
       JOIN org_members m
         ON m.org_id = gm.org_id AND m.amber_id = gm.amber_id
        AND m.status = 'active' AND m.deleted_at IS NULL
      WHERE gm.org_id = s.org_id AND gm.group_id = s.scope_ref AND gm.amber_id = $1
  ))
)`;

/**
 * THE CEILING, APPLIED ON EVERY READ.
 *
 * A personal share (org_id IS NULL) passes this untouched -- the whole consumer
 * product is unaffected by any of it.
 *
 * For a share made inside a company, the audience it was addressed to must rank
 * at or below what that company's policy allows for its classification. Checked
 * HERE, in the predicate, rather than only when the share was written, because
 * a ceiling enforced at write time describes the policy as it was on the day
 * somebody clicked share. An admin who tightens the policy this morning has
 * changed nothing about what was shared last week -- unless the check is on the
 * read, which is where it is.
 *
 * IT FAILS CLOSED THREE WAYS, and every one of them has to, because each is a
 * state where the system does not know how far something may travel:
 *   - no policy row for that classification  -> no cap -> nothing resolves
 *   - a classification the policy never knew -> same
 *   - a scope_type org_scope_rank has not been taught -> rank 99 -> nothing
 *
 * A share that resolves for nobody is a visible bug somebody reports in an
 * hour. A share that resolves for everybody is the other kind.
 */
const _CEILING = `(
  s.org_id IS NULL
  OR org_scope_rank(s.scope_type) <= org_scope_rank(COALESCE(
       (SELECT p.max_scope FROM org_policy p
         WHERE p.org_id = s.org_id AND p.classification = s.classification),
       'self'))
)`;

/**
 * Reachable AND permitted. Both halves, in the one string every read path
 * imports, so there is no way to ask the first question without the second.
 */
export const VIEWER_REACH_SQL = `(${_AUDIENCE} AND ${_CEILING})`;

/** The audience test alone. Exported for the tests that pin the two halves apart. */
export const AUDIENCE_SQL = _AUDIENCE;
export const CEILING_SQL = _CEILING;

/**
 * THE AUDIENCES A SHARE MAY BE ADDRESSED TO, in one place.
 *
 * Exported so `shares-store` validates against the same list the predicate can
 * actually resolve, rather than keeping its own copy. A scope the store accepts
 * and the predicate cannot resolve is a share the owner believes they made and
 * nobody can read; a scope the predicate handles and the store rejects is a
 * feature that silently does not exist. Both have happened in this file's
 * history, which is why it is one constant.
 */
export const SCOPE_TYPES = Object.freeze(["network", "circle", "contact", "cohort", "org", "group"]);
