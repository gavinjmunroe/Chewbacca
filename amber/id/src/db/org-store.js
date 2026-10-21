/**
 * org-store — organizations, members, groups and the policy ceiling.
 *
 * Shape and reasoning: db/migrations/20261014_062_org_spine.sql.
 *
 * TWO INVARIANTS THIS FILE EXISTS TO HOLD:
 *
 * 1. An amber_id is in AT MOST ONE organization, for life. The database
 *    enforces it (org_members_one_live_org); this file surfaces the violation
 *    as `{ ok: false, reason: "already_in_org" }` rather than letting a unique
 *    violation reach a route as a 500, because "you are already in a company"
 *    is a sentence a signup screen has to say.
 *
 * 2. The policy is a CEILING. Nothing in here applies it -- see
 *    lib/org-scopes.js for the comparison and the next migration for the
 *    enforcement -- but getPolicy always returns a complete map, with the
 *    defaults filled in for any classification a row is missing. A partial
 *    policy read as "unrestricted where unset" is the one way this feature
 *    fails open, so the gap is closed on read as well as on write.
 */

import { query, withTransaction } from "./sql.js";
import { DEFAULT_POLICY, isClassification, isScope } from "../lib/org-scopes.js";

// ─── shapes ─────────────────────────────────────────────────────────────────

function rowToOrg(row) {
  if (!row) return null;
  return {
    id: String(row.id),
    name: row.name,
    slug: row.slug,
    emailDomain: row.email_domain ?? null,
    restrictDomain: row.restrict_domain === true,
    status: row.status,
    createdBy: row.created_by ? String(row.created_by) : null,
    createdAt: row.created_at ?? null,
    /*
     * The profile, which the assistant reads for grounding and the setup flow
     * writes. Null is a real answer here -- a company that skipped it is not
     * the same as one that has not been asked -- so these are not defaulted
     * to empty strings on the way out.
     */
    description: row.description ?? null,
    website: row.website ?? null,
    linkedinUrl: row.linkedin_url ?? null,
  };
}

function rowToMember(row) {
  if (!row) return null;
  return {
    orgId: String(row.org_id),
    amberId: String(row.amber_id),
    role: row.role,
    status: row.status,
    joinedAt: row.joined_at ?? null,
    // Present only on the joined reads below.
    fullName: row.full_name ?? null,
    email: row.member_email ?? null,
    phone: row.phone ?? null,
    // The three the person writes about themselves. Null on reads that did not
    // join them, which is the same convention fullName already uses.
    title: row.title ?? null,
    location: row.location ?? null,
    bio: row.bio ?? null,
  };
}

/** Slug a company name the same way every time: lowercase, dashes, no edges. */
export function slugify(name) {
  return String(name ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

// ─── organizations ──────────────────────────────────────────────────────────

/**
 * Enrol a company. The creator becomes its first admin and the default policy
 * is written in the same transaction.
 *
 * ALL THREE OR NONE. An org with no admin cannot be administered and an org
 * with no policy rows reads as "no ceiling" on the path that is about to be
 * built. Either failure produces a company somebody has to fix by hand in SQL,
 * so the three writes share one transaction.
 */
export async function createOrganization(opts = {}) {
  const { name, slug, emailDomain = null, restrictDomain = false, createdBy,
          description = null, website = null, linkedinUrl = null } = opts;
  const trimmed = String(name ?? "").trim();
  if (!trimmed) return { ok: false, reason: "name_required" };
  if (!createdBy) return { ok: false, reason: "creator_required" };
  const finalSlug = slugify(slug || trimmed);
  if (!finalSlug) return { ok: false, reason: "slug_required" };
  // "@paychex.com", "paychex.com" and "PAYCHEX.COM" are the same answer to the
  // question the form asked, and only one of them compares equal later.
  const domain = String(emailDomain ?? "").trim().toLowerCase().replace(/^@/, "") || null;

  try {
    /*
     * ONLY A WORK ACCOUNT MAY ENROL A COMPANY, AND THIS IS THE CHECK THAT WAS
     * MISSING.
     *
     * Without it, createOrganization took whatever account was calling and made
     * it the company's -- so somebody signing in with the phone number they use
     * for their own Amber, with their own address book in it, ended up with
     * their personal account BEING the company account. Nothing was copied and
     * nothing leaked; the account simply changed what it was, because of one
     * button.
     *
     * A work account is one created from a work email (signup or invite). A
     * personal account is refused here and told where to go instead, because
     * the answer is never "we will convert yours" -- it is "sign up with your
     * work address and you will have a second, separate workspace".
     */
    const { rows: who } = await query(
      `SELECT workspace_kind FROM users WHERE amber_id = $1::uuid AND deleted_at IS NULL`,
      [createdBy],
    );
    if (!who[0]) return { ok: false, reason: "creator_required" };
    if (who[0].workspace_kind !== "work") return { ok: false, reason: "personal_account" };

    return await withTransaction(async (client) => {
      /*
       * THE COMPANY SETS ITS OWN TENANT BEFORE IT EXISTS.
       *
       * Every org table's policy has a WITH CHECK as well as a USING, so a
       * write has to name the tenant it belongs to -- and this is the one
       * place where the tenant is being created by the very statement that
       * needs it. Enrolling a company with no tenant set would fail the check
       * on the first INSERT, and "nobody can create a company" is a quiet way
       * for a signup page to be broken.
       *
       * So the id is minted here rather than by the DEFAULT, set on the
       * transaction, and then used. It holds for the three writes below and
       * unwinds with the transaction, exactly as a request's scope does.
       */
      const { rows: minted } = await client.query(`SELECT gen_random_uuid() AS id`);
      const orgId = minted[0].id;
      await client.query(`SELECT set_config('amber.org_id', $1, true)`, [String(orgId)]);

      const { rows } = await client.query(
        `INSERT INTO organizations
           (id, name, slug, email_domain, restrict_domain, created_by,
            description, website, linkedin_url)
         VALUES ($1::uuid, $2, $3, $4, $5, $6::uuid, $7, $8, $9)
         RETURNING *`,
        [
          orgId,
          trimmed,
          finalSlug,
          domain,
          // The CHECK refuses a restriction with no domain to restrict
          // against, and a form can always produce that pair.
          domain ? Boolean(restrictDomain) : false,
          createdBy,
          description ? String(description).trim().slice(0, 2000) || null : null,
          website ? String(website).trim().slice(0, 500) || null : null,
          linkedinUrl ? String(linkedinUrl).trim().slice(0, 500) || null : null,
        ],
      );
      const org = rowToOrg(rows[0]);
      await client.query(
        `INSERT INTO org_members (org_id, amber_id, role, status)
         VALUES ($1::uuid, $2::uuid, 'admin', 'active')`,
        [org.id, createdBy],
      );
      for (const [classification, maxScope] of Object.entries(DEFAULT_POLICY)) {
        await client.query(
          `INSERT INTO org_policy (org_id, classification, max_scope, updated_by)
           VALUES ($1::uuid, $2, $3, $4::uuid)
           ON CONFLICT (org_id, classification) DO NOTHING`,
          [org.id, classification, maxScope, createdBy],
        );
      }
      return { ok: true, org };
    });
  } catch (err) {
    return { ok: false, reason: pgReason(err) };
  }
}

/**
 * Which unique index refused the write. A constraint name is the only thing
 * that distinguishes "that company name is taken" from "you are already in a
 * company", and both are sentences a signup screen says.
 */
function pgReason(err) {
  const constraint = err?.constraint ?? "";
  if (constraint === "org_members_one_live_org") return "already_in_org";
  if (constraint === "users_workspace_kind_check") return "personal_account";
  if (constraint === "organizations_slug_live") return "slug_taken";
  if (constraint === "org_groups_name_live") return "group_name_taken";
  if (err?.code === "23505") return "duplicate";
  return "write_failed";
}

export async function getOrganizationById(orgId) {
  if (!orgId) return null;
  const { rows } = await query(
    `SELECT * FROM organizations WHERE id = $1::uuid AND deleted_at IS NULL`,
    [orgId],
  );
  return rowToOrg(rows[0]);
}

/**
 * Change the company's own settings: its name, its domain, and whether that
 * domain is a rule.
 *
 * Only the fields that were sent are touched, so a form that renders one
 * toggle does not have to resend the name to avoid blanking it.
 */
export async function updateOrganization({
  orgId, name, emailDomain, restrictDomain,
  description, website, linkedinUrl,
} = {}) {
  if (!orgId) return { ok: false, reason: "bad_input" };

  const nextName = name === undefined ? undefined : String(name).trim();
  if (nextName !== undefined && !nextName) return { ok: false, reason: "name_required" };

  const nextDomain =
    emailDomain === undefined
      ? undefined
      : String(emailDomain ?? "").trim().toLowerCase().replace(/^@/, "") || null;

  try {
    /*
     * A FLAG PER FIELD, because "not sent" and "cleared" are different
     * intentions and a COALESCE cannot tell them apart. Somebody deleting
     * their description means it, and a patch that silently kept the old one
     * would be the setting that will not turn off.
     */
    const { rows } = await query(
      `UPDATE organizations
          SET name            = CASE WHEN $2::boolean  THEN $3  ELSE name END,
              email_domain    = CASE WHEN $4::boolean  THEN $5  ELSE email_domain END,
              restrict_domain = CASE WHEN $6::boolean  THEN $7  ELSE restrict_domain END,
              description     = CASE WHEN $8::boolean  THEN $9  ELSE description END,
              website         = CASE WHEN $10::boolean THEN $11 ELSE website END,
              linkedin_url    = CASE WHEN $12::boolean THEN $13 ELSE linkedin_url END,
              updated_at      = now()
        WHERE id = $1::uuid AND deleted_at IS NULL
        RETURNING *`,
      [
        orgId,
        nextName !== undefined, nextName ?? null,
        nextDomain !== undefined, nextDomain,
        restrictDomain !== undefined, Boolean(restrictDomain),
        description !== undefined, description === null ? null : String(description).trim().slice(0, 2000) || null,
        website !== undefined, website === null ? null : String(website).trim().slice(0, 500) || null,
        linkedinUrl !== undefined, linkedinUrl === null ? null : String(linkedinUrl).trim().slice(0, 500) || null,
      ],
    );
    if (!rows[0]) return { ok: false, reason: "not_found" };
    return { ok: true, org: rowToOrg(rows[0]) };
  } catch (err) {
    // The CHECK from migration 077: you cannot restrict to a domain you have
    // not set, and the honest message says which half is missing.
    if (err?.constraint === "organizations_restrict_needs_domain") {
      return { ok: false, reason: "domain_required" };
    }
    return { ok: false, reason: "write_failed" };
  }
}

export async function getOrganizationBySlug(slug) {
  if (!slug) return null;
  const { rows } = await query(
    `SELECT * FROM organizations WHERE lower(slug) = lower($1) AND deleted_at IS NULL`,
    [String(slug)],
  );
  return rowToOrg(rows[0]);
}

// ─── membership ─────────────────────────────────────────────────────────────

/**
 * THE QUESTION EVERY ORG ROUTE ASKS FIRST: is this account in a company, and
 * what is it allowed to do there?
 *
 * Returns null for a consumer account, which is not an error -- it is most of
 * the users of this service. A suspended membership is returned WITH its
 * status rather than hidden, so the caller can say "your access is suspended"
 * instead of "no such company".
 */
export async function getMembership(amberId) {
  if (!amberId) return null;
  /*
   * THE ONE READ THAT RUNS OUTSIDE THE TENANT POLICIES.
   *
   * This query has no org_id in it because it is the query that DISCOVERS the
   * org_id -- resolveActor, requireOrgMember and the tenant scope are all
   * waiting on its answer. Under row-level security with no tenant set yet it
   * returns nothing, which means no actor, which means every org request in
   * the product fails at once.
   *
   * amber_membership_bootstrap is SECURITY DEFINER and deliberately tiny: one
   * amber_id in, that person's one live membership out. It cannot be asked
   * about anybody else and cannot list a roster, so running it outside the
   * policies grants nothing the caller's own session is not about to be told.
   * See migration 071 for how it is kept that way.
   */
  const { rows } = await query(
    `SELECT org_id, amber_id, role, status, joined_at, title, location, bio,
            org_name, org_slug, org_status
       FROM amber_membership_bootstrap($1::uuid)`,
    [amberId],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    ...rowToMember(row),
    orgName: row.org_name,
    orgSlug: row.org_slug,
    orgStatus: row.org_status,
  };
}

export async function listMembers(orgId) {
  if (!orgId) return [];
  const { rows } = await query(
    `SELECT m.*, u.full_name, u.phone,
            (SELECT i.email FROM user_identities i
              WHERE i.amber_id = m.amber_id AND i.provider = 'email'
                AND i.deleted_at IS NULL
              ORDER BY i.created_at ASC LIMIT 1) AS member_email
       FROM org_members m
       JOIN users u ON u.amber_id = m.amber_id AND u.deleted_at IS NULL
      WHERE m.org_id = $1::uuid AND m.deleted_at IS NULL
      ORDER BY m.role ASC, m.joined_at ASC`,
    [orgId],
  );
  return rows.map(rowToMember);
}

/**
 * Add somebody who already has an account. The invite path calls this; so does
 * nothing else, deliberately -- there is no route that adds a member without an
 * accepted invite, because that route would be "put this phone number in my
 * company" and the number's owner would never have agreed.
 */
export async function addMember({ orgId, amberId, role = "member", invitedBy = null } = {}) {
  if (!orgId || !amberId) return { ok: false, reason: "missing_ids" };
  if (role !== "admin" && role !== "member") return { ok: false, reason: "bad_role" };
  try {
    const { rows } = await query(
      `INSERT INTO org_members (org_id, amber_id, role, invited_by)
       VALUES ($1::uuid, $2::uuid, $3, $4::uuid)
       RETURNING *`,
      [orgId, amberId, role, invitedBy],
    );
    return { ok: true, member: rowToMember(rows[0]) };
  } catch (err) {
    return { ok: false, reason: pgReason(err) };
  }
}

/**
 * THE LAST ADMIN CANNOT BE DEMOTED OR REMOVED.
 *
 * Checked in the same statement that writes, as a NOT EXISTS over the other
 * live admins, so two concurrent "demote the other one" requests cannot both
 * pass a check and leave the company locked out. A read-then-write here would
 * be correct in every test and wrong under exactly that race.
 */
export async function setMemberRole({ orgId, amberId, role } = {}) {
  if (role !== "admin" && role !== "member") return { ok: false, reason: "bad_role" };
  const { rows } = await query(
    `UPDATE org_members m
        SET role = $3, updated_at = now()
      WHERE m.org_id = $1::uuid AND m.amber_id = $2::uuid AND m.deleted_at IS NULL
        AND ($3 = 'admin' OR EXISTS (
              SELECT 1 FROM org_members o
               WHERE o.org_id = m.org_id AND o.amber_id <> m.amber_id
                 AND o.role = 'admin' AND o.status = 'active' AND o.deleted_at IS NULL))
      RETURNING *`,
    [orgId, amberId, role],
  );
  if (!rows[0]) return { ok: false, reason: "last_admin_or_missing" };
  return { ok: true, member: rowToMember(rows[0]) };
}

export async function setMemberStatus({ orgId, amberId, status } = {}) {
  if (status !== "active" && status !== "suspended") return { ok: false, reason: "bad_status" };
  const { rows } = await query(
    `UPDATE org_members m
        SET status = $3, updated_at = now()
      WHERE m.org_id = $1::uuid AND m.amber_id = $2::uuid AND m.deleted_at IS NULL
        AND ($3 = 'active' OR m.role <> 'admin' OR EXISTS (
              SELECT 1 FROM org_members o
               WHERE o.org_id = m.org_id AND o.amber_id <> m.amber_id
                 AND o.role = 'admin' AND o.status = 'active' AND o.deleted_at IS NULL))
      RETURNING *`,
    [orgId, amberId, status],
  );
  if (!rows[0]) return { ok: false, reason: "last_admin_or_missing" };
  return { ok: true, member: rowToMember(rows[0]) };
}

/**
 * Remove somebody from the company. Their account and everything in it SURVIVES
 * -- this is not account deletion, and conflating the two would mean an admin
 * can destroy an employee's personal data by taking them off the roster.
 */
export async function removeMember({ orgId, amberId } = {}) {
  const { rows } = await query(
    `UPDATE org_members m
        SET deleted_at = now(), updated_at = now()
      WHERE m.org_id = $1::uuid AND m.amber_id = $2::uuid AND m.deleted_at IS NULL
        AND (m.role <> 'admin' OR EXISTS (
              SELECT 1 FROM org_members o
               WHERE o.org_id = m.org_id AND o.amber_id <> m.amber_id
                 AND o.role = 'admin' AND o.status = 'active' AND o.deleted_at IS NULL))
      RETURNING amber_id`,
    [orgId, amberId],
  );
  if (!rows[0]) return { ok: false, reason: "last_admin_or_missing" };
  return { ok: true };
}

// ─── groups ─────────────────────────────────────────────────────────────────

export async function createGroup({ orgId, name, purpose = null, description = null, createdBy = null } = {}) {
  const trimmed = String(name ?? "").trim();
  if (!orgId || !trimmed) return { ok: false, reason: "name_required" };
  try {
    const { rows } = await query(
      `INSERT INTO org_groups (org_id, name, purpose, description, created_by)
       VALUES ($1::uuid, $2, $3, $4, $5::uuid)
       RETURNING *`,
      [orgId, trimmed, trim(purpose), trim(description), createdBy],
    );
    return {
      ok: true,
      group: {
        id: String(rows[0].id),
        name: rows[0].name,
        purpose: rows[0].purpose ?? null,
        description: rows[0].description ?? null,
        memberCount: 0,
      },
    };
  } catch (err) {
    return { ok: false, reason: pgReason(err) };
  }
}

/** Empty strings are not values. A blank purpose is no purpose, not "". */
function trim(v) {
  const s = String(v ?? "").trim();
  return s === "" ? null : s;
}

export async function updateGroup({ orgId, groupId, name, purpose, description } = {}) {
  const sets = [];
  const params = [orgId, groupId];
  for (const [col, val] of [["name", name], ["purpose", purpose], ["description", description]]) {
    if (val === undefined) continue;
    params.push(col === "name" ? String(val).trim() : trim(val));
    sets.push(`${col} = $${params.length}`);
  }
  if (sets.length === 0) return { ok: false, reason: "nothing_to_change" };
  try {
    const { rowCount } = await query(
      `UPDATE org_groups SET ${sets.join(", ")}, updated_at = now()
        WHERE org_id = $1::uuid AND id = $2::uuid AND deleted_at IS NULL`,
      params,
    );
    return rowCount > 0 ? { ok: true } : { ok: false, reason: "not_found" };
  } catch (err) {
    return { ok: false, reason: pgReason(err) };
  }
}

export async function listGroups(orgId) {
  if (!orgId) return [];
  const { rows } = await query(
    `SELECT g.id, g.name, g.purpose, g.description, g.created_at,
            g.canvas_x, g.canvas_y, g.sort_order, g.pinned_at,
            (SELECT count(*) FROM org_group_members gm
              WHERE gm.org_id = g.org_id AND gm.group_id = g.id) AS member_count
       FROM org_groups g
      WHERE g.org_id = $1::uuid AND g.deleted_at IS NULL
      -- Pinned first, then the order somebody dragged them into, then by
      -- name so a fresh company with no arrangement is still alphabetical.
      ORDER BY g.pinned_at DESC NULLS LAST, g.sort_order ASC, lower(g.name) ASC`,
    [orgId],
  );
  return rows.map((r) => ({
    id: String(r.id),
    name: r.name,
    purpose: r.purpose ?? null,
    description: r.description ?? null,
    memberCount: Number(r.member_count ?? 0),
    createdAt: r.created_at ?? null,
    // null means "never been moved", which is what lets the first render lay
    // a group out automatically without that choice becoming permanent.
    x: r.canvas_x == null ? null : Number(r.canvas_x),
    y: r.canvas_y == null ? null : Number(r.canvas_y),
    sortOrder: Number(r.sort_order ?? 0),
    pinnedAt: r.pinned_at ?? null,
  }));
}

export async function deleteGroup({ orgId, groupId } = {}) {
  const { rowCount } = await query(
    `UPDATE org_groups SET deleted_at = now(), updated_at = now()
      WHERE org_id = $1::uuid AND id = $2::uuid AND deleted_at IS NULL`,
    [orgId, groupId],
  );
  return rowCount > 0;
}

/**
 * Put a member in a group. The composite foreign key to org_members means a
 * non-member cannot be added at all -- the insert fails rather than creating a
 * group row that a later join silently drops.
 */
export async function addGroupMember({ orgId, groupId, amberId, addedBy = null } = {}) {
  try {
    await query(
      `INSERT INTO org_group_members (org_id, group_id, amber_id, added_by)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid)
       ON CONFLICT (org_id, group_id, amber_id) DO NOTHING`,
      [orgId, groupId, amberId, addedBy],
    );
    return { ok: true };
  } catch (err) {
    if (err?.code === "23503") return { ok: false, reason: "not_a_member" };
    return { ok: false, reason: pgReason(err) };
  }
}

export async function removeGroupMember({ orgId, groupId, amberId } = {}) {
  const { rowCount } = await query(
    `DELETE FROM org_group_members
      WHERE org_id = $1::uuid AND group_id = $2::uuid AND amber_id = $3::uuid`,
    [orgId, groupId, amberId],
  );
  return rowCount > 0;
}

export async function listGroupMembers({ orgId, groupId } = {}) {
  const { rows } = await query(
    `SELECT gm.amber_id, u.full_name
       FROM org_group_members gm
       JOIN users u ON u.amber_id = gm.amber_id AND u.deleted_at IS NULL
      WHERE gm.org_id = $1::uuid AND gm.group_id = $2::uuid
      ORDER BY u.full_name ASC NULLS LAST`,
    [orgId, groupId],
  );
  return rows.map((r) => ({ amberId: String(r.amber_id), fullName: r.full_name ?? null }));
}

/** The groups one member is in. The share picker's list, and phase 4's graph filter. */
export async function listGroupsForMember({ orgId, amberId } = {}) {
  if (!orgId || !amberId) return [];
  const { rows } = await query(
    `SELECT g.id, g.name
       FROM org_group_members gm
       JOIN org_groups g ON g.org_id = gm.org_id AND g.id = gm.group_id
                        AND g.deleted_at IS NULL
      WHERE gm.org_id = $1::uuid AND gm.amber_id = $2::uuid
      ORDER BY lower(g.name) ASC`,
    [orgId, amberId],
  );
  return rows.map((r) => ({ id: String(r.id), name: r.name, purpose: r.purpose ?? null }));
}

// ─── policy ─────────────────────────────────────────────────────────────────

/**
 * The complete ceiling, defaults filled in.
 *
 * A classification with no row falls back to DEFAULT_POLICY rather than to "no
 * limit". That is the difference between a classification added next quarter
 * being tight until somebody loosens it, and being wide open until somebody
 * notices.
 */
export async function getPolicy(orgId) {
  const policy = { ...DEFAULT_POLICY };
  if (!orgId) return policy;
  const { rows } = await query(
    `SELECT classification, max_scope FROM org_policy WHERE org_id = $1::uuid`,
    [orgId],
  );
  for (const r of rows) {
    if (isClassification(r.classification) && isScope(r.max_scope)) {
      policy[r.classification] = r.max_scope;
    }
  }
  return policy;
}

export async function setPolicyEntry({ orgId, classification, maxScope, updatedBy = null } = {}) {
  if (!isClassification(classification)) return { ok: false, reason: "bad_classification" };
  if (!isScope(maxScope)) return { ok: false, reason: "bad_scope" };
  await query(
    `INSERT INTO org_policy (org_id, classification, max_scope, updated_by)
     VALUES ($1::uuid, $2, $3, $4::uuid)
     ON CONFLICT (org_id, classification)
     DO UPDATE SET max_scope = EXCLUDED.max_scope,
                   updated_by = EXCLUDED.updated_by,
                   updated_at = now()`,
    [orgId, classification, maxScope, updatedBy],
  );
  return { ok: true };
}

// ─── what has actually been shared ──────────────────────────────────────────

/**
 * EVERYTHING SHARED INSIDE THIS COMPANY, newest first, with the ceiling's
 * verdict on each row.
 *
 * This is the answer to the question an admin asks first and that no policy
 * screen can answer on its own: not "what is allowed" but "what has happened".
 * It exists because a ceiling nobody can see the effect of is a ceiling nobody
 * trusts.
 *
 * `permitted` IS COMPUTED BY org_scope_rank(), the same function the viewer
 * predicate uses, in the same statement. It is not a second implementation of
 * the comparison and must never become one -- an audit screen that disagreed
 * with the authorization rule would be worse than no audit screen, because it
 * would be believed.
 *
 * A row with permitted = false is a share that is currently reaching nobody:
 * either it was made before the ceiling was tightened, or the policy changed
 * under it. That is the interesting row on the page, which is why it is a
 * column and not a filter.
 */
export async function listOrgShares(orgId, { limit = 200 } = {}) {
  if (!orgId) return [];
  const { rows } = await query(
    `SELECT s.id, s.item_type, s.scope_type, s.scope_ref, s.classification,
            s.created_at, s.owner_id,
            u.full_name,
            g.name AS group_name,
            org_scope_rank(s.scope_type)
              <= org_scope_rank(COALESCE(p.max_scope, 'self')) AS permitted
       FROM shares s
       JOIN users u ON u.amber_id = s.owner_id
       LEFT JOIN org_policy p
         ON p.org_id = s.org_id AND p.classification = s.classification
       LEFT JOIN org_groups g
         ON g.org_id = s.org_id AND g.id = s.scope_ref
      WHERE s.org_id = $1::uuid AND s.deleted_at IS NULL
      ORDER BY s.created_at DESC
      LIMIT $2`,
    [orgId, Math.min(500, Math.max(1, Number(limit) || 200))],
  );
  return rows.map((r) => ({
    id: String(r.id),
    itemType: r.item_type,
    scopeType: r.scope_type,
    scopeRef: r.scope_ref ? String(r.scope_ref) : null,
    groupName: r.group_name ?? null,
    classification: r.classification,
    author: r.full_name ?? null,
    authorId: String(r.owner_id),
    createdAt: r.created_at ?? null,
    permitted: r.permitted === true,
  }));
}

// ─── workspaces ─────────────────────────────────────────────────────────────

/**
 * EVERY WORKSPACE THIS HUMAN CAN OPEN: this account, plus any account it is
 * linked to.
 *
 * THIS IS THE ONLY QUERY THAT CROSSES account_links AND IT RETURNS NO CONTENT.
 * A name, a kind, a company name when there is one. No contact, note, share or
 * graph edge is reachable through this table, and a future query that joins
 * through it to show somebody their personal contacts inside a company is the
 * bug this whole model exists to prevent, coming back.
 */
export async function listWorkspaces(amberId) {
  if (!amberId) return [];
  const { rows } = await query(
    `WITH ids AS (
        SELECT $1::uuid AS id
        UNION
        SELECT linked_amber_id FROM account_links WHERE amber_id = $1::uuid
     )
     SELECT u.amber_id, u.workspace_kind, u.full_name, u.phone,
            o.name AS org_name, m.role,
            (SELECT i.email FROM user_identities i
              WHERE i.amber_id = u.amber_id AND i.provider = 'email'
                AND i.deleted_at IS NULL
              ORDER BY i.created_at ASC LIMIT 1) AS email
       FROM ids
       JOIN users u ON u.amber_id = ids.id AND u.deleted_at IS NULL
       LEFT JOIN org_members m
              ON m.amber_id = u.amber_id AND m.deleted_at IS NULL
       LEFT JOIN organizations o ON o.id = m.org_id AND o.deleted_at IS NULL
      ORDER BY (u.amber_id = $1::uuid) DESC, u.workspace_kind ASC`,
    [amberId],
  );
  return rows.map((r) => ({
    amberId: String(r.amber_id),
    kind: r.workspace_kind,
    name: r.org_name || r.full_name || r.email || r.phone || "Amber",
    orgName: r.org_name ?? null,
    role: r.role ?? null,
    current: String(r.amber_id) === String(amberId),
  }));
}

/** Symmetric, written in pairs, idempotent. */
export async function linkAccounts(a, b, via = "phone") {
  if (!a || !b || String(a) === String(b)) return { ok: false, reason: "bad_pair" };
  try {
    await query(
      `INSERT INTO account_links (amber_id, linked_amber_id, linked_via)
       VALUES ($1::uuid, $2::uuid, $3), ($2::uuid, $1::uuid, $3)
       ON CONFLICT (amber_id, linked_amber_id) DO NOTHING`,
      [a, b, via],
    );
    return { ok: true };
  } catch {
    return { ok: false, reason: "write_failed" };
  }
}

/** May this account open that one? The switcher's authorization, and the only one. */
export async function accountsAreLinked(a, b) {
  if (!a || !b) return false;
  const { rows } = await query(
    `SELECT 1 FROM account_links WHERE amber_id = $1::uuid AND linked_amber_id = $2::uuid`,
    [a, b],
  );
  return rows.length > 0;
}

/** The account a verified phone belongs to, without creating one. */
export async function findAccountByPhone(phone) {
  if (!phone) return null;
  const { rows } = await query(
    `SELECT amber_id FROM users WHERE phone = $1 AND deleted_at IS NULL`,
    [phone],
  );
  return rows[0] ? String(rows[0].amber_id) : null;
}

/**
 * The kind of account, AND ITS PHONE IF IT HAS ONE.
 *
 * The phone matters because of what a session is used for afterwards. Roughly
 * thirty route files still resolve their owner from the phone claim on the
 * token -- that was correct while every account in this service was a phone
 * number -- so a session minted without one reaches none of them. Switching
 * into a personal workspace and finding an empty address book is exactly that:
 * the account has 977 contacts and the token had no way to say whose they are.
 *
 * So a switched session carries the phone of the account it is for. It is the
 * same claim that account's own sign-in would have produced; it is not extra
 * authority, it is the token being complete.
 */
export async function getAccountIdentity(amberId) {
  if (!amberId) return null;
  const { rows } = await query(
    `SELECT workspace_kind, phone FROM users
      WHERE amber_id = $1::uuid AND deleted_at IS NULL`,
    [amberId],
  );
  if (!rows[0]) return null;
  return { kind: rows[0].workspace_kind, phone: rows[0].phone ?? null };
}

export async function getWorkspaceKind(amberId) {
  return (await getAccountIdentity(amberId))?.kind ?? null;
}

/* ------------------------------------------------------- the group canvas */

/**
 * WHERE THE GROUPS SIT, AND WHAT RUNS BETWEEN THEM.
 *
 * Groups used to be drawn in a ring at equal angles, which is a statement:
 * the company is a wheel with equal spokes. No company is. Storing positions
 * lets the picture say what somebody actually believes about how their company
 * is arranged, which is the only reason to draw it rather than list it.
 */

export async function setGroupPosition({ orgId, groupId, x, y } = {}) {
  if (!orgId || !groupId) return { ok: false, reason: "bad_input" };
  const { rowCount } = await query(
    `UPDATE org_groups SET canvas_x = $3, canvas_y = $4, updated_at = now()
      WHERE org_id = $1 AND id = $2 AND deleted_at IS NULL`,
    [orgId, groupId, x, y],
  );
  return rowCount > 0 ? { ok: true } : { ok: false, reason: "not_found" };
}

/**
 * An edge, stored once.
 *
 * The pair is ordered before it is written so (a,b) and (b,a) are the same
 * row -- the CHECK on the table refuses anything else. Storing both directions
 * would mean deleting both, and the first delete anybody forgets leaves a
 * half-edge that nothing renders and nothing can remove.
 */
export async function linkGroups({ orgId, a, b, label = null, description = null, createdBy = null } = {}) {
  if (!orgId || !a || !b) return { ok: false, reason: "bad_input" };
  if (String(a) === String(b)) return { ok: false, reason: "same_group" };
  const [from, to] = String(a) < String(b) ? [a, b] : [b, a];
  try {
    const { rows } = await query(
      `INSERT INTO org_group_links (org_id, from_group_id, to_group_id, label, description, created_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (org_id, from_group_id, to_group_id)
       DO UPDATE SET label = EXCLUDED.label,
                     description = EXCLUDED.description,
                     updated_at = now()
       RETURNING *`,
      [orgId, from, to, label, description, createdBy],
    );
    return { ok: true, link: rows[0] };
  } catch (err) {
    // 23503 is a group id that is not in this organization. The composite FK
    // is what makes that impossible to get wrong from a route.
    if (err?.code === "23503") return { ok: false, reason: "no_such_group" };
    return { ok: false, reason: "write_failed" };
  }
}

export async function updateGroupLink({ orgId, linkId, label, description } = {}) {
  const { rows } = await query(
    `UPDATE org_group_links
        SET label       = CASE WHEN $3::boolean THEN $4 ELSE label END,
            description = CASE WHEN $5::boolean THEN $6 ELSE description END,
            updated_at  = now()
      WHERE org_id = $1 AND id = $2
      RETURNING *`,
    [orgId, linkId, label !== undefined, label ?? null, description !== undefined, description ?? null],
  );
  return rows[0] ? { ok: true, link: rows[0] } : { ok: false, reason: "not_found" };
}

export async function unlinkGroups({ orgId, linkId } = {}) {
  const { rowCount } = await query(
    `DELETE FROM org_group_links WHERE org_id = $1 AND id = $2`,
    [orgId, linkId],
  );
  return rowCount > 0 ? { ok: true } : { ok: false, reason: "not_found" };
}

export async function listGroupLinks(orgId) {
  if (!orgId) return [];
  const { rows } = await query(
    `SELECT l.id, l.from_group_id, l.to_group_id, l.label, l.description, l.created_at,
            f.name AS from_name, t.name AS to_name
       FROM org_group_links l
       JOIN org_groups f ON f.org_id = l.org_id AND f.id = l.from_group_id
       JOIN org_groups t ON t.org_id = l.org_id AND t.id = l.to_group_id
      WHERE l.org_id = $1
      ORDER BY l.created_at ASC`,
    [orgId],
  );
  return rows;
}

/**
 * The order the list is in, set by dragging.
 *
 * Takes the WHOLE order rather than one group's new index, because a drag
 * changes the relative position of everything it moved past -- sending one
 * row's new number means the server has to guess what happened to its
 * neighbors, and two people dragging at once would each guess differently.
 * One array, one truth, last write wins.
 *
 * Renumbered in tens so the next insert between two rows does not require
 * rewriting the list.
 */
export async function setGroupOrder({ orgId, ids = [] } = {}) {
  if (!orgId || !Array.isArray(ids) || ids.length === 0) return { ok: false, reason: "bad_input" };
  const { rowCount } = await query(
    `UPDATE org_groups g
        SET sort_order = v.n * 10, updated_at = now()
       FROM unnest($2::uuid[]) WITH ORDINALITY AS v(id, n)
      WHERE g.org_id = $1::uuid AND g.id = v.id AND g.deleted_at IS NULL`,
    [orgId, ids],
  );
  return { ok: true, moved: rowCount };
}

/** Pin a group to the top of the list, or let it fall back into order. */
export async function setGroupPinned({ orgId, groupId, pinned } = {}) {
  if (!orgId || !groupId) return { ok: false, reason: "bad_input" };
  const { rows } = await query(
    `UPDATE org_groups
        SET pinned_at = CASE WHEN $3 THEN now() ELSE NULL END, updated_at = now()
      WHERE org_id = $1::uuid AND id = $2::uuid AND deleted_at IS NULL
      RETURNING pinned_at`,
    [orgId, groupId, !!pinned],
  );
  if (rows.length === 0) return { ok: false, reason: "not_found" };
  return { ok: true, pinnedAt: rows[0].pinned_at };
}
