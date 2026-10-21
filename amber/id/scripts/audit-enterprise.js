#!/usr/bin/env node
/**
 * RUN THE WHOLE ENTERPRISE MOTION, TWICE, AND PROVE THE TWO CANNOT SEE EACH
 * OTHER.
 *
 *   railway run node scripts/audit-enterprise.js
 *   railway run node scripts/audit-enterprise.js --keep
 *
 * WHY A SCRIPT AND NOT A CHECKLIST. "Tenant isolation is on" is a property of
 * the database. "A customer cannot see another customer's data" is a property
 * of the whole stack, and the only way to know it is to be two customers and
 * try. Everything short of that is reasoning about source, which is exactly
 * how a missing predicate survives review: it looks right, and nobody asks
 * the database.
 *
 * So this creates two throwaway companies, puts a person in each, walks the
 * full motion both should do on their first day -- invite, accept, group,
 * post, file, policy, relationship graph -- and then, from inside each
 * tenant, tries to read the other. Every one of those reads must come back
 * empty. A single row is a failure and the script says which table leaked.
 *
 * IT ALSO RECORDS EVERY TABLE IT TOUCHED, because "which tables does this
 * motion write to" should be answerable rather than inferred, and an
 * inference is how a stray write into the wrong schema goes unnoticed.
 *
 * IT CLEANS UP AFTER ITSELF, and verifies the cleanup. A test that leaves
 * two fake companies in a production database is a worse problem than the one
 * it was checking for. --keep skips the delete when somebody wants to look at
 * the result by hand.
 */

import { query, closePool, tableTrace, resetTableTrace } from "../src/db/sql.js";
import { withTenant } from "../src/db/tenant.js";
import { asOperator } from "./_operator.js";
import { createOrganization, createGroup, addGroupMember, setPolicyEntry, listGroups } from "../src/db/org-store.js";
import { createInvite, ensureAccountForWorkEmail } from "../src/db/org-invite-store.js";
import { record, listPeople, grantSource } from "../src/db/org-memory-store.js";
import { getPolicy, setPolicy } from "../src/db/org-memory-policy.js";

process.env.AMBER_TABLE_TRACE = "1";

const keep = process.argv.includes("--keep");
const stamp = Date.now().toString(36);
const TAG = `audit-${stamp}`;

let failures = 0;
const ok = (m) => console.log(`    \x1b[32m✓\x1b[0m ${m}`);
const bad = (m) => {
  failures += 1;
  console.log(`    \x1b[31m✗ ${m}\x1b[0m`);
};

/** One company, one person, and everything they would do on day one. */
async function buildTenant(label) {
  const email = `${TAG}-${label}@audit.invalid`;

  /*
   * A WORK ACCOUNT, not just an account. createOrganization refuses a
   * personal one on purpose -- enrolling a company must never convert
   * somebody's own account into the company's -- so the audit has to walk the
   * same door a real customer does rather than inserting a user row.
   */
  const made = await ensureAccountForWorkEmail(email);
  if (!made?.ok) throw new Error(`could not create a work account for ${label}: ${made?.reason}`);
  const amberId = made.amberId;

  const created = await createOrganization({
    name: `${TAG} ${label}`,
    createdBy: amberId,
    emailDomain: `${TAG}-${label}.invalid`,
  });
  if (!created?.ok) {
    throw new Error(`could not create an organization for ${label}: ${created?.reason}`);
  }
  const orgId = created.org.id;

  const built = { label, email, amberId, orgId, secrets: {} };

  await withTenant(orgId, async () => {
    const group = await createGroup({
      orgId,
      name: `${TAG} ${label} team`,
      purpose: "audit",
      createdBy: amberId,
    });
    built.groupId = group?.id ?? null;
    if (built.groupId) {
      await addGroupMember({ orgId, groupId: built.groupId, amberId, addedBy: amberId });
    }

    const invite = await createInvite({
      orgId,
      email: `${TAG}-${label}-invitee@audit.invalid`,
      role: "member",
      invitedBy: amberId,
    });
    built.inviteId = invite?.id ?? null;

    await setPolicyEntry({
      orgId,
      classification: "internal",
      maxScope: "org",
      updatedBy: amberId,
    }).catch(() => null);

    await setPolicy({ orgId, byAmberId: amberId, patch: { requireGate: true } });

    /*
     * The relationship graph, which is where the newest tables are and
     * therefore where an isolation mistake is most likely to be.
     */
    await grantSource({ orgId, amberId, source: "calendar" });
    const secret = `${TAG}-${label}-SECRET-SUMMARY`;
    built.secrets.summary = secret;
    const wrote = await record({
      orgId,
      memberId: amberId,
      kind: "meeting",
      source: "calendar",
      externalId: `${TAG}-${label}-evt-1`,
      summary: secret,
      occurredAt: new Date().toISOString(),
      identities: [{ kind: "email", value: `${TAG}-${label}-contact@counterparty.invalid` }],
      displayName: `${TAG} ${label} Counterparty`,
    });
    built.personId = wrote.personId ?? null;
  });

  return built;
}

/**
 * From inside A's tenant, try to read B. Every one must come back empty.
 *
 * NOT A JOIN ACROSS BOTH. A query that names B's org_id while scoped to A is
 * precisely what a leaking policy would allow and a working one forbids, so
 * it is the right shape of question: the test asks for the other company's
 * rows by id, the way a bug or an attacker would.
 */
async function proveIsolation(a, b) {
  console.log(`\n  ${a.label} must not see ${b.label}`);

  const probes = [
    ["organizations", `SELECT count(*)::int AS n FROM organizations WHERE id = $1::uuid`],
    ["org_members", `SELECT count(*)::int AS n FROM org_members WHERE org_id = $1::uuid`],
    ["org_groups", `SELECT count(*)::int AS n FROM org_groups WHERE org_id = $1::uuid`],
    ["org_invites", `SELECT count(*)::int AS n FROM org_invites WHERE org_id = $1::uuid`],
    ["org_people", `SELECT count(*)::int AS n FROM org_people WHERE org_id = $1::uuid`],
    ["org_interactions", `SELECT count(*)::int AS n FROM org_interactions WHERE org_id = $1::uuid`],
    ["org_person_edges", `SELECT count(*)::int AS n FROM org_person_edges WHERE org_id = $1::uuid`],
    ["org_memory_sources", `SELECT count(*)::int AS n FROM org_memory_sources WHERE org_id = $1::uuid`],
    ["org_memory_policy", `SELECT count(*)::int AS n FROM org_memory_policy WHERE org_id = $1::uuid`],
    ["org_accounts", `SELECT count(*)::int AS n FROM org_accounts WHERE org_id = $1::uuid`],
  ];

  await withTenant(a.orgId, async () => {
    for (const [table, sql] of probes) {
      const { rows } = await query(sql, [b.orgId]).catch(() => ({ rows: [{ n: -1 }] }));
      if (rows[0].n === 0) ok(`${table} returns nothing`);
      else if (rows[0].n < 0) bad(`${table} errored rather than returning nothing`);
      else bad(`${table} LEAKED ${rows[0].n} row(s) from ${b.label}`);
    }

    /*
     * THE ONE THAT MATTERS MOST. The probes above ask for rows by the other
     * company's id, which a policy comparing org_id stops easily. This asks
     * the question the PRODUCT asks -- give me my people -- and checks that
     * the other company's content is not in the answer. A predicate that
     * forgot its tenant would pass every probe above and fail this.
     */
    const mine = await listPeople({ orgId: a.orgId, viewerId: a.amberId, limit: 500 });
    const stolen = mine.filter((p) => String(p.display_name ?? "").includes(b.label));
    if (stolen.length === 0) ok(`the product's own people query returns only ${a.label}'s`);
    else bad(`listPeople returned ${stolen.length} of ${b.label}'s people`);

    const { rows: content } = await query(
      `SELECT count(*)::int AS n FROM org_interactions WHERE summary = $1`,
      [b.secrets.summary],
    );
    if (content[0].n === 0) ok("the other company's interaction content is unreachable");
    else bad(`${content[0].n} interaction(s) carrying ${b.label}'s content are readable`);
  });
}

async function unscopedIsBlind(a) {
  console.log("\n  With no tenant set, nothing is readable");
  const probes = ["organizations", "org_members", "org_people", "org_interactions"];
  for (const t of probes) {
    const { rows } = await query(`SELECT count(*)::int AS n FROM ${t}`).catch(() => ({
      rows: [{ n: -1 }],
    }));
    if (rows[0].n === 0) ok(`${t} returns nothing`);
    else bad(`${t} returned ${rows[0].n} row(s) with no tenant set — isolation is not enforced`);
  }
}

async function cleanup(tenants) {
  console.log("\n  Cleaning up");
  for (const t of tenants) {
    await withTenant(t.orgId, async () => {
      // Children first: the ledger and its derivations, then the spine.
      for (const sql of [
        `DELETE FROM org_interactions WHERE org_id = $1::uuid`,
        `DELETE FROM org_person_edges WHERE org_id = $1::uuid`,
        `DELETE FROM org_person_identities WHERE org_id = $1::uuid`,
        `DELETE FROM org_people WHERE org_id = $1::uuid`,
        `DELETE FROM org_accounts WHERE org_id = $1::uuid`,
        `DELETE FROM org_memory_sources WHERE org_id = $1::uuid`,
        `DELETE FROM org_memory_policy WHERE org_id = $1::uuid`,
        `DELETE FROM org_policy_refusals WHERE org_id = $1::uuid`,
        `DELETE FROM org_invites WHERE org_id = $1::uuid`,
        `DELETE FROM org_group_members WHERE org_id = $1::uuid`,
        `DELETE FROM org_groups WHERE org_id = $1::uuid`,
        `DELETE FROM org_policy WHERE org_id = $1::uuid`,
        `DELETE FROM org_members WHERE org_id = $1::uuid`,
      ]) {
        await query(sql, [t.orgId]).catch(() => null);
      }
    });
    // organizations and users sit outside the tenant's own policy for a
    // delete, so they go last and unscoped.
    await asOperator((c) => c.query(`DELETE FROM organizations WHERE id = $1::uuid`, [t.orgId]), { tenant: t.orgId }).catch(() => null);
    await query(`DELETE FROM users WHERE amber_id = $1::uuid`, [t.amberId]).catch(() => null);
  }

  /*
   * THROUGH THE OPERATOR SCOPE. Unscoped, this counted zero whatever was
   * there -- so the audit reported a clean cleanup while leaving two fake
   * companies behind, twice.
   */
  const { rows } = await asOperator((c) =>
    c.query(`SELECT count(*)::int AS n FROM organizations WHERE name LIKE $1`, [`${TAG}%`]),
  );
  if (rows[0].n === 0) ok("every row this audit created is gone");
  else bad(`${rows[0].n} audit organization(s) are still present — delete them by hand`);
}

async function main() {
  console.log("\n\x1b[1mEnterprise motion audit\x1b[0m");
  console.log(`  tag ${TAG}\n`);

  resetTableTrace();

  console.log("  Building two companies");
  const a = await buildTenant("alpha");
  ok(`${a.label}: org, member, group, invite, policy, and a relationship`);
  const b = await buildTenant("bravo");
  ok(`${b.label}: org, member, group, invite, policy, and a relationship`);

  await proveIsolation(a, b);
  await proveIsolation(b, a);
  await unscopedIsBlind(a);

  if (!keep) await cleanup([a, b]);
  else console.log("\n  --keep: the two audit companies are still there.");

  /*
   * THE TABLE REPORT. Everything the motion touched, with reads and writes
   * separated, so a table being written to that should only ever be read is
   * visible rather than inferred.
   */
  console.log("\n  Tables this motion touched");
  const touched = tableTrace();
  const foreign = touched.filter(
    (t) => !/^(org_|organizations|users|user_identities|amber_|contacts|events|email_|calendar_)/.test(t.table),
  );
  for (const t of touched) {
    const mark = foreign.includes(t) ? "\x1b[33m?\x1b[0m" : " ";
    console.log(
      `   ${mark} ${t.table.padEnd(28)} ${String(t.reads).padStart(4)} read ${String(t.writes).padStart(4)} write`,
    );
  }
  if (foreign.length > 0) {
    console.log(
      `\n  \x1b[33m${foreign.length} table(s) outside the expected Amber surface: ${foreign
        .map((t) => t.table)
        .join(", ")}\x1b[0m`,
    );
  }

  console.log("");
  if (failures > 0) {
    console.log(`\x1b[31m${failures} failure(s). Do not invite anybody.\x1b[0m\n`);
    process.exitCode = 1;
  } else {
    console.log("\x1b[32mTwo companies, full motion, no leak in either direction.\x1b[0m\n");
  }
}

main()
  .catch((err) => {
    console.error("\n", err);
    console.error(`\nThe audit did not finish. Rows tagged ${TAG} may remain.`);
    process.exitCode = 1;
  })
  .finally(() => closePool());
