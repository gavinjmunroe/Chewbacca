#!/usr/bin/env node
/**
 * GIVE THE PEOPLE NAMED AFTER THEIR EMAIL ADDRESS A NAME.
 *
 *   railway run node scripts/name-people.js         # show what would change
 *   railway run node scripts/name-people.js --run
 *
 * Of 515 calendar guest entries, five carried a display name. Google does
 * not send them for most attendees, so the graph filled with nodes labeled
 * bvance@paychex.com and every screen that shows a person showed an address
 * -- including the answers, which came back "You know three people at
 * Paychex: bvance@paychex.com, jryan4@paychex.com...". That reads as a
 * database leaking rather than a product that knows somebody.
 *
 * The store now derives a name on write. This is for the rows written
 * before it did.
 *
 * IT ONLY TOUCHES ROWS WHOSE NAME IS STILL AN ADDRESS. Somebody who renamed
 * a contact by hand, or whose real name arrived from a producer, is never
 * overwritten -- a backfill that renames a person somebody already fixed is
 * the kind of help nobody asks for twice.
 */

import { query, closePool } from "../src/db/sql.js";
import { humanizeAddress } from "../src/db/org-memory-store.js";
import { asOperator, operatorWorks } from "./_operator.js";
import { withTenant } from "../src/db/tenant.js";

const run = process.argv.includes("--run");

async function main() {
  if (!(await operatorWorks())) {
    console.log("\n  \x1b[31mCannot read across workspaces — run: npm run migrate\x1b[0m\n");
    process.exitCode = 1;
    return;
  }

  const { rows: orgs } = await asOperator((c) =>
    c.query(`SELECT id, name FROM organizations WHERE deleted_at IS NULL ORDER BY name`),
  );

  let changed = 0;
  for (const org of orgs) {
    await withTenant(org.id, async () => {
      const { rows } = await query(
        `SELECT id, display_name FROM org_people
          WHERE org_id = $1::uuid AND deleted_at IS NULL AND display_name LIKE '%@%'`,
        [org.id],
      );
      if (rows.length === 0) return;

      console.log(`\n  \x1b[1m${org.name}\x1b[0m — ${rows.length} named after an address`);
      for (const r of rows) {
        const better = humanizeAddress(r.display_name);
        if (!better || better.toLowerCase() === String(r.display_name).toLowerCase()) {
          console.log(`    \x1b[33m·\x1b[0m ${r.display_name} — nothing recoverable, left alone`);
          continue;
        }
        console.log(`    ${run ? "\x1b[32m✓\x1b[0m" : "→"} ${r.display_name}  →  ${better}`);
        if (run) {
          await query(
            `UPDATE org_people SET display_name = $3, updated_at = now()
              WHERE org_id = $1::uuid AND id = $2::uuid AND display_name LIKE '%@%'`,
            [org.id, r.id, better],
          );
          changed += 1;
        }
      }
    }).catch((e) => console.log(`  skipped ${org.name}: ${e?.message ?? e}`));
  }

  console.log(
    run
      ? `\n  \x1b[32m${changed} renamed.\x1b[0m\n`
      : "\n  Nothing written. Re-run with --run.\n",
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => closePool());
