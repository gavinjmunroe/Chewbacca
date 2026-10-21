#!/usr/bin/env node
/**
 * PUT THE ORPHANED WORK ACCOUNTS IN THE WORKSPACE THEY BELONG TO.
 *
 *   railway run node scripts/join-orphans.js          # report
 *   railway run node scripts/join-orphans.js --run    # do it
 *
 * Sign-in now joins by domain, so this is only for the people who signed up
 * BEFORE that -- who are the ones who already tried the product, found every
 * screen empty, and formed an opinion about it. Making them sign in again to
 * be repaired is asking them to re-live it.
 */

import { query, closePool } from "../src/db/sql.js";
import { joinByDomain } from "../src/db/org-domain-join.js";
import { asOperator, operatorWorks } from "./_operator.js";

const run = process.argv.includes("--run");

async function main() {
  /*
   * joinByDomain reads `organizations` to find the claimant, and with no
   * tenant set that read returns nothing -- so every account comes back
   * `no_org_for_domain` whatever is in the table. That is what this script
   * reported for four people whose domain was sitting right there.
   */
  if (!(await operatorWorks())) {
    console.log(
      "\n  \x1b[31mThis script cannot read across workspaces.\x1b[0m\n" +
        "  Migration 092 has not been applied, so every account would report\n" +
        "  no_org_for_domain whatever is in the database. Run: npm run migrate\n",
    );
    process.exitCode = 1;
    return;
  }

  const { rows } = await query(
    `SELECT u.amber_id, u.full_name, ui.subject AS email
       FROM users u
       JOIN user_identities ui
         ON ui.amber_id = u.amber_id AND ui.provider = 'email' AND ui.deleted_at IS NULL
      WHERE u.deleted_at IS NULL
        AND u.workspace_kind = 'work'
        AND NOT EXISTS (
          SELECT 1 FROM org_members m
           WHERE m.amber_id = u.amber_id AND m.deleted_at IS NULL
        )
      ORDER BY u.created_at`,
  );

  console.log(`\n\x1b[1m${rows.length} work account(s) in no workspace\x1b[0m\n`);
  if (rows.length === 0) return;

  let joined = 0;
  for (const r of rows) {
    const out = await joinByDomain({ amberId: r.amber_id, email: r.email });

    if (!run) {
      const verdict = out.ok ? `would join ${out.orgName ?? out.orgId}` : `no match (${out.reason})`;
      console.log(`  ${r.email.padEnd(38)} ${verdict}`);
      /*
       * A DRY RUN THAT ACTUALLY JOINED somebody would be the worst possible
       * version of this, so the write is undone immediately. joinByDomain is
       * the only correct implementation of the rule and re-implementing it
       * here to be read-only is how the two drift.
       */
      if (out.joined) {
        await query(`DELETE FROM org_members WHERE org_id = $1::uuid AND amber_id = $2::uuid`, [
          out.orgId,
          r.amber_id,
        ]);
      }
      continue;
    }

    if (out.joined) {
      joined += 1;
      console.log(`  \x1b[32m✓\x1b[0m ${r.email} → ${out.orgName}`);
    } else {
      console.log(`  \x1b[33m!\x1b[0m ${r.email} — ${out.reason}`);
    }
  }

  console.log(
    run
      ? `\n\x1b[32m${joined} account(s) joined.\x1b[0m\n`
      : `\n\x1b[33mNothing written. Re-run with --run.\x1b[0m\n`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => closePool());
