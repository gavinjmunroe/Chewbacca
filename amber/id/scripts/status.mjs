#!/usr/bin/env node
/**
 * WHAT IS ACTUALLY IN THERE.
 *
 * Written because three rounds of "run this and tell me what happened" is a
 * worse way to find out than one command that prints the truth. No arguments,
 * no flags, reads only.
 */

import { query, closePool } from "../src/db/sql.js";

const line = (k, v) => console.log(`    ${String(k).padEnd(34)} ${v}`);

console.log("\n  ── ACCOUNTS ─────────────────────────────────────────────\n");
const { rows: accounts } = await query(
  `SELECT u.amber_id, u.workspace_kind, u.full_name, u.phone,
          u.password_hash IS NOT NULL AS has_password,
          (SELECT i.subject FROM user_identities i
            WHERE i.amber_id = u.amber_id AND i.provider = 'email'
              AND i.deleted_at IS NULL LIMIT 1) AS email,
          (SELECT count(*) FROM contacts c
            WHERE c.owner_id = u.amber_id AND c.deleted_at IS NULL) AS contacts
     FROM users u
    WHERE u.deleted_at IS NULL
      AND (u.workspace_kind = 'work' OR EXISTS (
            SELECT 1 FROM contacts c WHERE c.owner_id = u.amber_id LIMIT 1))
    ORDER BY u.workspace_kind, contacts DESC
    LIMIT 40`,
);
for (const a of accounts) {
  const who = a.full_name || a.email || a.phone || a.amber_id;
  line(
    `${a.workspace_kind.padEnd(9)} ${who}`,
    `${a.contacts} contacts${a.has_password ? " · password set" : ""}`,
  );
}

console.log("\n  ── ORGANIZATIONS ────────────────────────────────────────\n");
const { rows: orgs } = await query(
  `SELECT o.id, o.name,
          (SELECT count(*) FROM org_members m WHERE m.org_id = o.id AND m.deleted_at IS NULL) AS members,
          (SELECT count(*) FROM org_groups g WHERE g.org_id = o.id AND g.deleted_at IS NULL) AS groups,
          (SELECT count(*) FROM org_group_members gm WHERE gm.org_id = o.id) AS placements
     FROM organizations o WHERE o.deleted_at IS NULL`,
);
if (!orgs.length) console.log("    none");
for (const o of orgs) {
  line(o.name, `${o.members} members · ${o.groups} teams · ${o.placements} placements`);
}

console.log("\n  ── WORKSPACE LINKS ──────────────────────────────────────\n");
const { rows: links } = await query(
  `SELECT a.full_name AS a_name, a.workspace_kind AS a_kind, a.phone AS a_phone,
          b.full_name AS b_name, b.workspace_kind AS b_kind, b.phone AS b_phone
     FROM account_links l
     JOIN users a ON a.amber_id = l.amber_id
     JOIN users b ON b.amber_id = l.linked_amber_id`,
);
if (!links.length) console.log("    none -- the switcher will not appear");
for (const l of links) {
  line(
    `${l.a_kind}: ${l.a_name ?? l.a_phone ?? "?"}`,
    `-> ${l.b_kind}: ${l.b_name ?? l.b_phone ?? "?"}`,
  );
}
console.log("");
await closePool();
