#!/usr/bin/env node
/**
 * UNLINK, AND LINK THE RIGHT ONE.
 *
 * `--link-personal` chose the personal account with the most contacts in it, on
 * the assumption that a deployment with one real human in it is unambiguous.
 * It is not: a beta tester's address book is bigger than the founder's, so the
 * heuristic linked a work account to SOMEBODY ELSE'S personal Amber -- and a
 * link means a session for that account can be minted. That is not a demo
 * annoyance, it is one person able to open another person's data.
 *
 * The flag is gone. Linking takes a phone number and nothing else, because the
 * only thing that establishes "this human holds both accounts" is control of
 * the number on the other one.
 *
 *   railway run node scripts/fix-link.mjs --email you@company.com
 *       shows every link on that account, changes nothing
 *
 *   railway run node scripts/fix-link.mjs --email you@company.com --unlink-all
 *       removes them
 *
 *   railway run node scripts/fix-link.mjs --email you@company.com --link-phone +13125551234
 *       links the personal account on exactly that number
 */

import { query, closePool } from "../src/db/sql.js";
import { findAccountByEmail } from "../src/db/org-invite-store.js";
import { findAccountByPhone, linkAccounts, listWorkspaces } from "../src/db/org-store.js";

const arg = (f) => {
  const i = process.argv.indexOf(f);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : null;
};

const email = arg("--email");
const unlinkAll = process.argv.includes("--unlink-all");
const linkPhone = arg("--link-phone");

if (!email) {
  console.error("\n  Need --email.\n");
  await closePool();
  process.exit(1);
}

const me = await findAccountByEmail(email);
if (!me) {
  console.error(`\n  No account for ${email}.\n`);
  await closePool();
  process.exit(1);
}

if (unlinkAll) {
  const a = await query(`DELETE FROM account_links WHERE amber_id = $1::uuid`, [me]);
  const b = await query(`DELETE FROM account_links WHERE linked_amber_id = $1::uuid`, [me]);
  console.log(`\n  Removed ${a.rowCount + b.rowCount} link row(s). Nothing else was touched.`);
}

if (linkPhone) {
  const other = await findAccountByPhone(linkPhone);
  if (!other) {
    console.log(`\n  No account on ${linkPhone}. Nothing linked.`);
  } else if (String(other) === String(me)) {
    console.log(`\n  ${linkPhone} is this same account. Nothing linked.`);
  } else {
    const { rows } = await query(
      `SELECT full_name, (SELECT count(*) FROM contacts c
                           WHERE c.owner_id = u.amber_id AND c.deleted_at IS NULL) AS contacts
         FROM users u WHERE u.amber_id = $1::uuid`,
      [other],
    );
    const out = await linkAccounts(me, other, "phone");
    console.log(
      out.ok
        ? `\n  Linked ${linkPhone} -- ${rows[0]?.full_name ?? "unnamed"}, ${rows[0]?.contacts ?? 0} contacts.`
        : `\n  Could not link: ${out.reason}`,
    );
  }
}

const spaces = await listWorkspaces(me);
console.log("\n  Workspaces this account can open:\n");
for (const w of spaces) {
  console.log(`    ${w.current ? "*" : " "} ${w.kind.padEnd(9)} ${w.name}`);
}
console.log("");

await closePool();
