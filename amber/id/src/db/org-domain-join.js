/**
 * SIGNING UP WITH A WORK ADDRESS SHOULD PUT YOU IN THE WORKSPACE.
 *
 * THE BUG THIS FIXES, watched live. Somebody signed up with their work
 * address, got an account, and landed in a product where every screen was
 * empty. Not broken -- empty, which is worse, because there is nothing to
 * report. The diagnostic said it in one line: a work account with zero
 * memberships.
 *
 * Signing up created the ACCOUNT and joined nothing. The only path into a
 * workspace was an invitation, so anybody who found the sign-up page first --
 * which is everybody, because that is what a sign-up page is for -- ended up
 * holding a valid account to a workspace they were not in. Connect a
 * calendar and it syncs into their own account, correctly, invisibly, where
 * the company will never see it. That is exactly what it looked like when
 * the calendar "didn't work".
 *
 * THE RULE, and it is the one the admin already set. An organization has an
 * email domain. If an address is on that domain, that person belongs to that
 * company -- that is what claiming the domain MEANS, and making them wait for
 * an invitation to a company they demonstrably work at is ceremony.
 *
 * WHAT GUARDS IT. A personal domain is never a company: gmail.com is on
 * nobody's letterhead, and one organization claiming it would swallow every
 * consumer sign-up on the platform. Exactly one organization may claim a
 * domain; two matches is a configuration mistake and joins nothing, loudly,
 * rather than picking one. And an existing membership is never touched -- a
 * person who was invited as an admin does not get quietly demoted to member
 * by signing in again.
 */

import { query } from "./sql.js";

/**
 * Domains nobody can claim, because they belong to everybody.
 *
 * Kept here rather than imported from org-memory-store so that file's list
 * can grow for its own reasons -- it is answering "is this person's employer
 * knowable from their address", which is a related question and not this one.
 */
const PERSONAL_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "yahoo.com", "ymail.com", "hotmail.com",
  "outlook.com", "live.com", "msn.com", "icloud.com", "me.com", "mac.com",
  "aol.com", "proton.me", "protonmail.com", "pm.me", "gmx.com", "mail.com",
  "zoho.com", "yandex.com", "qq.com", "163.com", "126.com", "naver.com",
]);

export function domainOf(email) {
  const at = String(email ?? "").toLowerCase().trim().split("@");
  return at.length === 2 && at[1] ? at[1] : null;
}

/**
 * Join the workspace that owns this address's domain, if one does.
 *
 * Safe to call on every sign-in: it is idempotent, it never changes an
 * existing membership, and it returns what happened rather than throwing,
 * because a sign-in must not fail over this.
 */
export async function joinByDomain({ amberId, email } = {}) {
  if (!amberId || !email) return { ok: false, reason: "bad_input" };

  const domain = domainOf(email);
  if (!domain) return { ok: false, reason: "bad_email" };
  if (PERSONAL_DOMAINS.has(domain)) return { ok: false, reason: "personal_domain" };

  try {
    /*
     * ALREADY IN ONE? Then nothing to do, and in particular no second
     * membership: a person belongs to one workspace per account, and the
     * separation between accounts is what keeps personal and work apart.
     */
    const { rows: already } = await query(
      `SELECT org_id FROM org_members WHERE amber_id = $1::uuid AND deleted_at IS NULL LIMIT 1`,
      [amberId],
    );
    if (already.length > 0) return { ok: true, joined: false, orgId: already[0].org_id };

    const { rows: orgs } = await query(
      `SELECT id, name FROM organizations
        WHERE lower(email_domain) = $1 AND deleted_at IS NULL
        LIMIT 2`,
      [domain],
    );

    if (orgs.length === 0) return { ok: false, reason: "no_org_for_domain" };
    if (orgs.length > 1) {
      /*
       * TWO COMPANIES CLAIMING ONE DOMAIN is a configuration mistake, and
       * guessing which one somebody meant would put a person -- and shortly
       * their calendar -- inside the wrong customer. Nothing is a better
       * answer than a coin flip.
       */
      console.warn(`[join] ${orgs.length} organizations claim ${domain}; joining none`);
      return { ok: false, reason: "ambiguous_domain" };
    }

    const org = orgs[0];

    /*
     * MEMBER, NEVER ADMIN. The person who creates the workspace is its admin;
     * everybody who arrives afterwards by having the right address is a
     * member until somebody says otherwise. A domain is evidence of
     * employment, not of authority.
     */
    const { rows: made } = await query(
      `INSERT INTO org_members (org_id, amber_id, role, status, joined_at)
       VALUES ($1::uuid, $2::uuid, 'member', 'active', now())
       ON CONFLICT (org_id, amber_id) DO UPDATE
          SET deleted_at = NULL, status = 'active'
       RETURNING org_id, role`,
      [org.id, amberId],
    );

    return {
      ok: true,
      joined: true,
      orgId: made[0]?.org_id ?? org.id,
      orgName: org.name,
      role: made[0]?.role ?? "member",
    };
  } catch (err) {
    // A sign-in must never fail because of this.
    console.warn(`[join] domain join failed: ${err?.message || err}`);
    return { ok: false, reason: "write_failed" };
  }
}
