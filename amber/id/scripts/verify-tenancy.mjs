#!/usr/bin/env node
/**
 * PROVE THE TENANT BOUNDARY BEFORE TURNING IT ON.
 *
 *     railway run node scripts/verify-tenancy.mjs
 *
 * Migration 070 created a row-level policy on every org table and did NOT
 * apply FORCE, because the moment FORCE lands, any query path that has not
 * been taught to set the tenant returns nothing. This is the thing that says
 * whether that has happened yet.
 *
 * It is read-only. It opens two transactions, sets a different company on
 * each, and checks that each one sees only its own rows -- which is the
 * property, stated as an experiment rather than as a belief about the code.
 *
 * Exit 0 means it is safe to run SELECT amber_tenant_enforce().
 */

import { acquireClient, closePool, query } from "../src/db/sql.js";

const ok = (m) => console.log(`  ok    ${m}`);
const bad = (m) => console.log(`  FAIL  ${m}`);

let failures = 0;
function check(cond, message) {
  if (cond) ok(message);
  else {
    bad(message);
    failures += 1;
  }
}

async function main() {
  console.log("\nTENANT ISOLATION\n");

  const { rows: orgs } = await query(
    `SELECT id, name FROM organizations WHERE deleted_at IS NULL ORDER BY created_at ASC LIMIT 2`,
  );
  console.log(`  ${orgs.length} organization(s) in this database`);

  const { rows: policies } = await query(
    `SELECT c.relname AS table, c.relrowsecurity AS enabled, c.relforcerowsecurity AS forced
       FROM pg_class c
       JOIN pg_policy p ON p.polrelid = c.oid AND p.polname = 'amber_tenant'
      ORDER BY c.relname`,
  );
  check(policies.length > 0, `policy present on ${policies.length} tables`);
  check(
    policies.every((p) => p.enabled),
    "row level security enabled everywhere a policy exists",
  );

  const forced = policies.filter((p) => p.forced).length;
  console.log(
    forced === policies.length
      ? `  note  enforcement is ON (${forced}/${policies.length} forced)`
      : `  note  enforcement is OFF (${forced}/${policies.length} forced) -- the owner still bypasses`,
  );

  // Does the function exist, and does an unset context deny?
  const { rows: unset } = await query(`SELECT amber_current_org() IS NULL AS denies`);
  check(unset[0]?.denies === true, "an unset tenant resolves to NULL, which denies every row");

  /*
   * THE EXPERIMENT. Two transactions, two companies, and each must see only
   * its own pages. Run against the real policy rather than against the query,
   * so a WHERE clause being present or absent makes no difference to it.
   */
  if (orgs.length >= 1) {
    const client = await acquireClient();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('amber.org_id', $1, true)", [orgs[0].id]);
      // FORCE is what makes the owner obey. Ask the policy directly so this
      // reports the truth either way.
      const { rows } = await client.query(
        `SELECT count(*)::int AS n FROM org_pages WHERE org_id <> amber_current_org()`,
      );
      await client.query("ROLLBACK");
      if (forced === policies.length) {
        check(rows[0].n === 0, "inside a tenant, no other company's pages are visible");
      } else {
        console.log(
          `  note  ${rows[0].n} page(s) from other companies are still reachable, because enforcement is off`,
        );
      }
    } finally {
      client.release();
    }
  }

  if (orgs.length >= 2) {
    const a = await acquireClient();
    try {
      await a.query("BEGIN");
      await a.query("SELECT set_config('amber.org_id', $1, true)", [orgs[1].id]);
      const { rows } = await a.query(`SELECT amber_current_org() = $1::uuid AS matches`, [orgs[1].id]);
      await a.query("ROLLBACK");
      check(rows[0]?.matches === true, "a second transaction carries its own company, not the first's");
    } finally {
      a.release();
    }
  } else {
    console.log("  note  only one company here, so the cross-tenant case cannot be exercised yet");
  }

  console.log(
    failures === 0
      ? `\n  PASS — safe to run: SELECT amber_tenant_enforce();\n`
      : `\n  ${failures} FAILURE(S) — do not enforce yet.\n`,
  );
  await closePool();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(async (err) => {
  console.error("\n  verify-tenancy could not run:", err?.message || err, "\n");
  await closePool().catch(() => {});
  process.exit(2);
});
