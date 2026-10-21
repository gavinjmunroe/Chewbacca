#!/usr/bin/env node
/**
 * WHICH COMPANY OWNS WHICH EMAIL DOMAIN.
 *
 *   railway run node scripts/org-domain.js
 *   railway run node scripts/org-domain.js --set <org-slug-or-id> --domain amberintelligence.ai
 *
 * THE GAP THIS CLOSES. Joining by domain is the thing that puts somebody who
 * signed up into the workspace they work at. It can only do that if the
 * workspace has claimed a domain, and nothing in the product ever asked --
 * createOrganization takes emailDomain and the console never set it. So every
 * org has been sitting with a null domain, every signup has landed in
 * no-man's-land, and the repair script reported `no_org_for_domain` for
 * people whose address is obviously the company's.
 *
 * It also shows the ACCOUNTS WITH NO WORKSPACE next to the domains, because
 * the mismatch is the answer and seeing both halves at once is how somebody
 * spots that the domain is set to the wrong thing rather than missing.
 */

import { query, closePool } from "../src/db/sql.js";
import { withTenant } from "../src/db/tenant.js";
import { asOperator, operatorWorks } from "./_operator.js";

const arg = (n) => {
  const i = process.argv.indexOf(`--${n}`);
  return i > -1 ? process.argv[i + 1] : null;
};

const target = arg("set");
const purge = process.argv.includes("--purge-test");
const create = arg("create");
const owner = (arg("owner") || "").trim().toLowerCase();
const domain = (arg("domain") || "").trim().toLowerCase().replace(/^@/, "");

async function main() {
  /*
   * DELETE THE WORKSPACES THE TEST SCRIPTS LEFT BEHIND.
   *
   * audit-enterprise and audit-pressure each build throwaway companies and
   * delete them afterwards. Their cleanup ran unscoped, saw nothing -- the
   * same blindness 092 fixed -- and deleted nothing. Then it VERIFIED itself
   * with an equally blind count and reported "every row this run created is
   * gone". Six fake companies accumulated in a production database while the
   * scripts said they had not.
   *
   * A cleanup that verifies itself with the same broken read it cleaned with
   * is not a cleanup, and that is the actual lesson: the check has to be
   * able to see what the delete could not.
   *
   * Scoped to the two prefixes those scripts use and nothing else.
   */
  if (purge) {
    const { rows: junk } = await asOperator((c) =>
      c.query(
        `SELECT id, name FROM organizations
          WHERE (name LIKE 'press-%' OR name LIKE 'audit-%') AND deleted_at IS NULL
          ORDER BY name`,
      ),
    );

    if (junk.length === 0) {
      console.log("\n  No test workspaces to remove.\n");
      return;
    }

    console.log(`\n  Removing ${junk.length} test workspace(s)\n`);
    for (const o of junk) {
      await withTenant(o.id, async () => {
        for (const table of [
          "org_audiences", "org_page_revisions", "org_page_attachments", "org_pages",
          "org_api_keys", "org_interaction_shares", "org_interactions", "org_ai_imports",
          "org_person_edges", "org_person_identities",
          "org_accounts", "org_memory_sources", "org_policy_refusals", "org_memory_policy",
          "org_invites", "org_group_members", "org_groups", "org_policy", "org_members",
        ]) {
          await query(`DELETE FROM ${table} WHERE org_id = $1::uuid`, [o.id]).catch(() => null);
        }
        // People last: everything above references them.
        await query(`UPDATE org_people SET merged_into = NULL WHERE org_id = $1::uuid`, [o.id]).catch(() => null);
        await query(`DELETE FROM org_people WHERE org_id = $1::uuid`, [o.id]).catch(() => null);
      }).catch(() => null);

      const { rowCount } = await asOperator(
        (c) => c.query(`DELETE FROM organizations WHERE id = $1::uuid`, [o.id]),
        { tenant: o.id },
      );
      console.log(`  ${rowCount ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"} ${o.name}`);
    }

    await query(
      `DELETE FROM user_identities WHERE provider = 'email'
        AND (subject LIKE 'press-%' OR subject LIKE 'audit-%')`,
    ).catch(() => null);
    await query(
      `DELETE FROM users WHERE amber_id NOT IN (SELECT amber_id FROM user_identities)
        AND workspace_kind = 'work' AND created_at > now() - interval '7 days'`,
    ).catch(() => null);

    /*
     * VERIFIED THROUGH THE OPERATOR SCOPE, which is the whole point. The
     * previous version checked its own work with the read that could not
     * see, so "gone" meant "invisible to me".
     */
    const { rows: left } = await asOperator((c) =>
      c.query(
        `SELECT count(*)::int AS n FROM organizations
          WHERE (name LIKE 'press-%' OR name LIKE 'audit-%') AND deleted_at IS NULL`,
      ),
    );
    console.log(
      left[0].n === 0
        ? "\n  \x1b[32mAll test workspaces removed.\x1b[0m\n"
        : `\n  \x1b[31m${left[0].n} still there.\x1b[0m\n`,
    );
    return;
  }

  /*
   * CREATE THE WORKSPACE.
   *
   * WHY THIS EXISTS AS A SCRIPT. The console assumes a workspace already
   * exists -- every screen in it is scoped to one -- and the only way to make
   * the first one was a sign-up flow that, as it turned out, created an
   * account and no company. So a database with people in it and no workspace
   * at all is reachable, and from inside the product there is no way out of
   * it: every screen is empty and the thing that would fix it is behind one
   * of them.
   *
   * It takes an owner, because a company with no admin cannot be
   * administered, and the person who runs this is the one who should hold it.
   */
  if (create) {
    if (!owner) {
      console.log("\n  --create needs --owner <work email> — a workspace with no admin cannot be administered.\n");
      process.exitCode = 1;
      return;
    }

    const { rows: who } = await query(
      `SELECT u.amber_id FROM users u
         JOIN user_identities ui
           ON ui.amber_id = u.amber_id AND ui.provider = 'email' AND ui.deleted_at IS NULL
        WHERE lower(ui.subject) = $1 AND u.deleted_at IS NULL
        LIMIT 1`,
      [owner],
    );
    if (who.length === 0) {
      console.log(`\n  No account signs in with ${owner}. They have to sign in once first.\n`);
      process.exitCode = 1;
      return;
    }

    const { createOrganization } = await import("../src/db/org-store.js");
    const made = await createOrganization({
      name: create,
      createdBy: who[0].amber_id,
      emailDomain: domain || null,
    });
    if (!made?.ok) {
      console.log(`\n  Could not create it: ${made?.reason ?? "unknown"}\n`);
      process.exitCode = 1;
      return;
    }

    console.log(`\n  \x1b[32m✓\x1b[0m ${made.org.name} created, ${owner} is its admin`);
    if (domain) {
      console.log(`  It claims ${domain} — anyone signing in from that domain joins as a member.`);
      console.log("  Bring in the people already waiting: node scripts/join-orphans.js --run\n");
    } else {
      console.log("  No domain claimed. Set one so colleagues join by signing in:");
      console.log(`    node scripts/org-domain.js --set ${made.org.slug} --domain <domain>\n`);
    }
    return;
  }

  if (target) {
    if (!domain) {
      console.log("\n  --set needs --domain too.\n");
      return;
    }
    /*
     * ONE COMPANY PER DOMAIN. Two claiming the same one makes joinByDomain
     * refuse both -- correctly, because a coin flip picks a customer -- so
     * the conflict is caught here, where somebody can still choose.
     */
    const { rows: clash } = await asOperator((c) =>
      c.query(
        `SELECT id, name, slug FROM organizations
          WHERE lower(email_domain) = $1 AND deleted_at IS NULL
            AND id::text <> $2 AND slug <> $2`,
        [domain, target],
      ),
    );
    if (clash.length > 0) {
      console.log(`\n  \x1b[31m${clash[0].name} already claims ${domain}.\x1b[0m`);
      console.log("  Two companies claiming one domain joins nobody. Pick one.\n");
      process.exitCode = 1;
      return;
    }

    /*
     * The UPDATE is a write and the operator policy is SELECT-only, so this
     * runs in the same transaction with the flag up only so the row can be
     * FOUND. Postgres applies the USING clause of every permissive policy to
     * locate the row, and the tenant policy's WITH CHECK still governs what
     * may be written.
     */
    /*
     * THE TARGET'S ID FIRST, so the UPDATE can set amber.org_id and be
     * admitted by the tenant policy. The operator flag is SELECT-only and
     * cannot locate a row for a write -- which is why the purge silently
     * changed nothing before this was understood.
     */
    const { rows: found } = await asOperator((c) =>
      c.query(
        `SELECT id FROM organizations
          WHERE (id::text = $1 OR slug = $1) AND deleted_at IS NULL LIMIT 1`,
        [target],
      ),
    );
    if (found.length === 0) {
      console.log(`\n  No workspace matches "${target}".\n`);
      process.exitCode = 1;
      return;
    }

    const { rows } = await asOperator(
      (c) =>
        c.query(
          `UPDATE organizations SET email_domain = $1, updated_at = now()
            WHERE id = $2::uuid AND deleted_at IS NULL
            RETURNING id, name, slug, email_domain`,
          [domain, found[0].id],
        ),
      { tenant: found[0].id },
    );
    if (rows.length === 0) {
      console.log(`\n  No workspace matches "${target}".\n`);
      process.exitCode = 1;
      return;
    }
    console.log(`\n  \x1b[32m✓\x1b[0m ${rows[0].name} now claims ${rows[0].email_domain}`);
    console.log("  Anyone signing in from that domain joins it as a member.");
    console.log("  Repair the people already stranded: node scripts/join-orphans.js --run\n");
    return;
  }

  /*
   * THROUGH THE OPERATOR SCOPE, and checked first.
   *
   * Without it this read returns nothing -- correctly, because no tenant is
   * set -- and the script prints "Workspaces: none" over a live workspace.
   * That exact sentence cost an evening, so a script that cannot see is now
   * a script that says it cannot see.
   */
  if (!(await operatorWorks())) {
    console.log(
      "\n  \x1b[31mThis script cannot read across workspaces.\x1b[0m\n" +
        "  Migration 092 has not been applied, so every count below would be zero\n" +
        "  whatever is actually in the database. Run: npm run migrate\n",
    );
    process.exitCode = 1;
    return;
  }

  const { rows: orgs } = await asOperator((c) =>
    c.query(
      `SELECT o.id, o.name, o.slug, o.email_domain, o.restrict_domain,
              (SELECT count(*)::int FROM org_members m
                WHERE m.org_id = o.id AND m.deleted_at IS NULL) AS members
         FROM organizations o WHERE o.deleted_at IS NULL ORDER BY o.created_at`,
    ),
  );

  console.log("\n\x1b[1mWorkspaces\x1b[0m\n");
  if (orgs.length === 0) {
    /*
     * NO WORKSPACE AT ALL is not a variation of "the domain is wrong", and
     * saying "none" and then listing stranded accounts invites somebody to
     * go looking for a domain to fix. There is nothing to join.
     */
    console.log("  \x1b[31mnone — there is genuinely no workspace, so every console screen is empty\x1b[0m");
    console.log("  Make one:");
    console.log('    node scripts/org-domain.js --create "Your Company" --owner you@company.com --domain company.com\n');
  }
  for (const o of orgs) {
    const claim = o.email_domain
      ? `\x1b[32m${o.email_domain}\x1b[0m${o.restrict_domain ? " (restricted)" : ""}`
      : "\x1b[31mno domain claimed\x1b[0m";
    console.log(`  ${o.name}`);
    console.log(`    slug ${o.slug}   ${o.members} member(s)   ${claim}`);
  }

  const { rows: stranded } = await asOperator((c) => c.query(
    `SELECT ui.subject AS email
       FROM users u
       JOIN user_identities ui
         ON ui.amber_id = u.amber_id AND ui.provider = 'email' AND ui.deleted_at IS NULL
      WHERE u.deleted_at IS NULL AND u.workspace_kind = 'work'
        AND NOT EXISTS (
          SELECT 1 FROM org_members m WHERE m.amber_id = u.amber_id AND m.deleted_at IS NULL
        )
      ORDER BY ui.subject`,
  ));

  if (stranded.length > 0) {
    console.log("\n\x1b[1mWork accounts in no workspace\x1b[0m\n");
    const byDomain = new Map();
    for (const s of stranded) {
      const d = s.email.split("@")[1] ?? "?";
      byDomain.set(d, (byDomain.get(d) ?? 0) + 1);
    }
    for (const [d, n] of [...byDomain].sort((a, b) => b[1] - a[1])) {
      const owner = orgs.find((o) => (o.email_domain ?? "").toLowerCase() === d);
      console.log(
        `  ${String(n).padStart(2)} on ${d.padEnd(30)} ${
          owner ? `→ ${owner.name}` : "\x1b[33mno workspace claims this\x1b[0m"
        }`,
      );
    }
    console.log(
      "\n  Claim one:  node scripts/org-domain.js --set <slug> --domain <domain>\n" +
        "  Then:       node scripts/join-orphans.js --run\n",
    );
  } else {
    console.log("\n  Every work account is in a workspace.\n");
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => closePool());
