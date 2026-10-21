#!/usr/bin/env node
/**
 * WHAT THIS ACCOUNT CAN ACTUALLY SIGN IN WITH.
 *
 *     railway run node scripts/whoami.mjs karthik@amberintelligence.ai
 *     railway run node scripts/whoami.mjs +15550100001
 *
 * Read-only. Written because "I cannot save anything" has four possible causes
 * -- a migration that has not run, a column that is not what you think, the
 * wrong account resolving from the token, or a real write failure -- and
 * guessing between them from a red box in a browser is how an afternoon goes.
 */

import { query, closePool } from "../src/db/sql.js";

const needle = process.argv[2];

async function main() {
  console.log("\nSCHEMA\n");
  const { rows: cols } = await query(
    `SELECT column_name FROM information_schema.columns
      WHERE table_name = 'users' AND column_name IN
        ('username','login_username','password_hash','workspace_kind')
      ORDER BY column_name`,
  );
  const have = new Set(cols.map((c) => c.column_name));
  for (const c of ["username", "login_username", "password_hash", "workspace_kind"]) {
    console.log(`  ${have.has(c) ? "ok   " : "MISSING"} users.${c}`);
  }
  if (!have.has("login_username")) {
    console.log("\n  -> migration 072 has not been applied. Nothing below will be right.\n");
  }

  const { rows: applied } = await query(
    `SELECT filename FROM schema_migrations ORDER BY filename DESC LIMIT 5`,
  ).catch(() => ({ rows: [] }));
  if (applied.length) {
    console.log("\n  last applied migrations:");
    for (const r of applied) console.log(`    ${r.filename}`);
  }

  if (!needle) {
    console.log("\n  pass an email, phone or username to look up one account.\n");
    await closePool();
    return;
  }

  console.log(`\nACCOUNTS MATCHING ${needle}\n`);
  const { rows } = await query(
    `SELECT u.amber_id, u.full_name, u.phone, u.workspace_kind,
            u.username                     AS profile_handle,
            ${have.has("login_username") ? "u.login_username" : "NULL"} AS login_username,
            u.password_hash IS NOT NULL    AS has_password,
            (SELECT i.subject FROM user_identities i
              WHERE i.amber_id = u.amber_id AND i.provider = 'email' AND i.deleted_at IS NULL
              ORDER BY i.created_at ASC LIMIT 1) AS email,
            (SELECT o.name FROM org_members m
               JOIN organizations o ON o.id = m.org_id
              WHERE m.amber_id = u.amber_id AND m.deleted_at IS NULL LIMIT 1) AS org
       FROM users u
      WHERE u.deleted_at IS NULL
        AND (u.phone = $1
             OR u.username = $1
             ${have.has("login_username") ? "OR u.login_username = $1" : ""}
             OR EXISTS (SELECT 1 FROM user_identities i
                         WHERE i.amber_id = u.amber_id AND i.provider = 'email'
                           AND i.subject = lower($1) AND i.deleted_at IS NULL))`,
    [needle],
  );

  if (rows.length === 0) {
    console.log("  no account matches that.\n");
  }
  for (const r of rows) {
    console.log(`  ${r.full_name ?? "(no name)"}  ${r.amber_id}`);
    console.log(`    kind            ${r.workspace_kind}`);
    console.log(`    email           ${r.email ?? "—"}`);
    console.log(`    phone           ${r.phone ?? "—"}`);
    console.log(`    profile handle  ${r.profile_handle ?? "—"}   (visible; not a credential)`);
    console.log(`    login username  ${r.login_username ?? "—"}`);
    console.log(`    password        ${r.has_password ? "set" : "not set"}`);
    console.log(`    organization    ${r.org ?? "—"}\n`);
  }

  // The question that produced this script: who is holding the name.
  if (have.has("login_username")) {
    const { rows: taken } = await query(
      `SELECT amber_id, workspace_kind FROM users
        WHERE login_username = lower($1) AND deleted_at IS NULL`,
      [needle],
    );
    if (taken.length) {
      console.log(`  login username "${needle}" is held by ${taken[0].amber_id} (${taken[0].workspace_kind})\n`);
    }
  }

  await closePool();
}

main().catch(async (err) => {
  console.error("\n  whoami could not run:", err?.message || err, "\n");
  await closePool().catch(() => {});
  process.exit(1);
});
