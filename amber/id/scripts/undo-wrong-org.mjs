#!/usr/bin/env node
/**
 * UNDO AN ACCOUNT THAT WAS WRONGLY ENROLLED AS A COMPANY.
 *
 * Before migration 065, creating an organization enrolled THE CALLER'S OWN
 * ACCOUNT -- so a personal Amber, with somebody's own address book in it,
 * became a company account because of one button. The migration marks every
 * existing account `personal` again and the org routes refuse them, but the
 * organization row and the membership are still sitting there.
 *
 * This removes them. It deletes the ORGANIZATION and everything that belongs to
 * the organization -- its groups, its policy, its invitations, its membership
 * rows. It does not touch a single contact, note, share or graph edge: those
 * rows always belonged to the personal account and still do.
 *
 *   railway run node scripts/undo-wrong-org.mjs                 # show
 *   railway run node scripts/undo-wrong-org.mjs --delete <slug> # do it
 */

import { query, closePool } from "../src/db/sql.js";

const args = process.argv.slice(2);
const doIt = args.includes("--delete");
const slug = args[args.indexOf("--delete") + 1];

const { rows } = await query(
  `SELECT o.id, o.name, o.slug, o.created_at,
          (SELECT count(*) FROM org_members m WHERE m.org_id = o.id AND m.deleted_at IS NULL) AS members,
          (SELECT count(*) FROM shares s WHERE s.org_id = o.id) AS shares
     FROM organizations o
    WHERE o.deleted_at IS NULL
    ORDER BY o.created_at ASC`,
);

if (rows.length === 0) {
  console.log("\n  No organizations exist.\n");
  await closePool();
  process.exit(0);
}

console.log("\n  Organizations:\n");
for (const r of rows) {
  console.log(`    ${r.slug.padEnd(24)} ${r.name}`);
  console.log(`    ${"".padEnd(24)} ${r.members} member(s), ${r.shares} share(s), created ${new Date(r.created_at).toISOString().slice(0, 10)}`);
}

if (!doIt) {
  console.log("\n  Nothing changed. To remove one:");
  console.log("    railway run node scripts/undo-wrong-org.mjs --delete <slug>\n");
  await closePool();
  process.exit(0);
}

const target = rows.find((r) => r.slug === slug);
if (!target) {
  console.error(`\n  No organization with slug "${slug}".\n`);
  await closePool();
  process.exit(1);
}

/*
 * SHARES FIRST, AND ONLY THEIR ORG STAMP.
 *
 * shares.org_id is ON DELETE CASCADE, so dropping the organization would take
 * the share rows with it -- and those shares were made by a personal account
 * about personal contacts. They are not the company's to delete. Clearing the
 * stamp first turns them back into exactly what they always were.
 */
const unstamped = await query(
  `UPDATE shares SET org_id = NULL, classification = NULL
    WHERE org_id = $1::uuid AND scope_type NOT IN ('org', 'group')`,
  [target.id],
);
const orgScoped = await query(
  `DELETE FROM shares WHERE org_id = $1::uuid AND scope_type IN ('org', 'group')`,
  [target.id],
);
const gone = await query(`DELETE FROM organizations WHERE id = $1::uuid`, [target.id]);

console.log(`\n  Removed ${target.name}.`);
console.log(`    ${unstamped.rowCount} personal share(s) un-stamped and left alone`);
console.log(`    ${orgScoped.rowCount} share(s) addressed to the company deleted`);
console.log(`    ${gone.rowCount} organization row deleted (members, groups, policy, invites cascade)`);
console.log(`\n  No contact, note or graph row was touched.\n`);

await closePool();
