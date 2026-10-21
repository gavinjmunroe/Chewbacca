/**
 * RUN A REPORTING QUERY THAT CAN SEE EVERY TENANT.
 *
 * WHY THIS EXISTS. An admin script asks questions ABOUT every workspace --
 * how many are there, which domain does each claim, who is in none of them --
 * and there is no tenant to scope those to. Once isolation was actually
 * enforced, every one of those reads correctly returned nothing, and the
 * scripts reported their own blindness as a finding: "Workspaces: none",
 * printed while a live workspace sat in the table.
 *
 * That cost hours. A diagnostic that reports fiction is worse than no
 * diagnostic, because it is confident and specific and it sends somebody to
 * fix a thing that was never broken.
 *
 * ONE TRANSACTION, ONE CONNECTION, which is the whole reason this is a helper
 * rather than a line somebody repeats. set_config(..., true) is
 * transaction-local; raising the flag on a pooled connection and then
 * querying on a different one gives a reassuring empty answer for the wrong
 * reason -- exactly the failure this is here to end.
 */

import { withTransaction } from "../src/db/sql.js";

export async function asOperator(fn, { tenant = null } = {}) {
  return withTransaction(async (client) => {
    await client.query(`SELECT set_config('amber.operator', 'on', true)`);

    /*
     * A WRITE NEEDS THE TENANT TOO, and finding that out cost a run.
     *
     * The operator policy is FOR SELECT, deliberately -- a reporting flag
     * must not be a way to change anything. Postgres applies the USING
     * clause of the permissive policies to LOCATE a row for a DELETE or an
     * UPDATE as well, and the operator policy is not among them for those
     * commands. So a delete issued with only the operator flag up matches
     * nothing, reports rowCount 0, and looks exactly like a row that was
     * already gone.
     *
     * The purge printed six ✗ for six rows that were all still there.
     *
     * Passing the tenant sets amber.org_id alongside, so the ordinary tenant
     * policy admits the row the way it does for the application. The
     * operator flag stays read-only and the write goes through the same door
     * every other write uses.
     */
    if (tenant) {
      await client.query(`SELECT set_config('amber.org_id', $1, true)`, [String(tenant)]);
    }

    return fn(client);
  });
}

/**
 * Is the flag actually doing anything?
 *
 * A script that silently falls back to seeing nothing is the bug again in a
 * new shape, so this is checked ONCE at startup and said out loud. If
 * migration 092 has not been applied, the operator policy does not exist, the
 * reads return nothing, and the honest thing is to say so rather than print
 * an empty estate.
 */
export async function operatorWorks() {
  try {
    const { rows } = await withTransaction(async (client) => {
      await client.query(`SELECT set_config('amber.operator', 'on', true)`);
      return client.query(`SELECT amber_operator() AS on`);
    });
    return rows[0]?.on === true;
  } catch {
    return false;
  }
}
