#!/usr/bin/env node
/**
 * REMOVE THE SEEDED ACCOUNTS.
 *
 * Seeded people were real rows -- real accounts, real membership, real group
 * placements -- which is what made the screens worth looking at and is also why
 * they cannot be left behind. A roster with thirty invented colleagues in it is
 * not a demo artifact once the demo is over; it is thirty wrong rows in a
 * production database.
 *
 * Every seeded address is @example.com, which RFC 2606 reserves so that
 * invented data cannot collide with a real person's. That is the handle this
 * uses, and it is the reason the seed used that domain in the first place.
 *
 * Deleting the users row takes the membership and placements with it by
 * ON DELETE CASCADE. Nothing belonging to a real account is touched -- the
 * teams themselves survive, because somebody may have meant those.
 *
 *   railway run node scripts/remove-seed.mjs            # show
 *   railway run node scripts/remove-seed.mjs --delete   # do it
 */

import { query, closePool } from "../src/db/sql.js";

const doIt = process.argv.includes("--delete");

const { rows } = await query(
  `SELECT u.amber_id, u.full_name, i.subject AS email
     FROM user_identities i
     JOIN users u ON u.amber_id = i.amber_id AND u.deleted_at IS NULL
    WHERE i.provider = 'email' AND i.subject LIKE '%@example.com'
    ORDER BY u.full_name`,
);

if (!rows.length) {
  console.log("\n  No seeded accounts. Nothing to remove.\n");
  await closePool();
  process.exit(0);
}

console.log(`\n  ${rows.length} seeded account(s):\n`);
for (const r of rows) console.log(`    ${(r.full_name ?? "?").padEnd(26)} ${r.email}`);

if (!doIt) {
  console.log("\n  Nothing changed. Add --delete to remove them.\n");
  await closePool();
  process.exit(0);
}

const gone = await query(
  `DELETE FROM users WHERE amber_id IN (
     SELECT i.amber_id FROM user_identities i
      WHERE i.provider = 'email' AND i.subject LIKE '%@example.com')`,
);
console.log(`\n  Removed ${gone.rowCount} account(s). Membership and team placements went with them.`);
console.log("  Teams themselves were left alone.\n");

await closePool();
