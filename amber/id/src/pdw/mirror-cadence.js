/**
 * THE CADENCE NUMBERS, MIRRORED INTO BIGQUERY.
 *
 * Cloud SQL is the system of record and stays that way -- every read the app
 * makes goes there. BigQuery is for the questions Postgres is the wrong shape
 * for: how does contact frequency across a whole user base move over months,
 * which channels carry which kinds of relationship, what does a warming
 * relationship look like before it warms. Those are scans over history, and
 * running them against the transactional database is how a dashboard takes the
 * app down.
 *
 * SO THIS IS A MIRROR, NOT A MOVE. Nothing here is read back by the app, and
 * nothing the app does depends on it succeeding. If BigQuery is unconfigured --
 * which it is in every environment without GCP credentials, including every
 * test run -- this costs one boolean check and returns.
 *
 * ONE ROW PER OWNER PER CONTACT PER CHANNEL, merged on that key, so re-running
 * the rollup restates rather than duplicates. The alternative, appending a
 * snapshot per run, would grow without bound and make every query a
 * "latest row per key" window function -- expensive and easy to get subtly
 * wrong in a way nobody notices until a number is off.
 *
 * WHAT IS NOT MIRRORED: names, phone numbers, email addresses, subject lines,
 * anything a message said. A contact is a uuid here. The warehouse gets the
 * SHAPE of the correspondence and none of its content, which is the same line
 * the email tables draw and for the same reason.
 */

import { isReady, mergeRow, tenantId } from "./bq-client.js";

/** The BigQuery table this mirrors into. */
export const CADENCE_TABLE = "contact_cadence";
const KEY_COLUMNS = ["tenant_id", "owner_id", "contact_id", "channel"];

const int = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
};
const ts = (v) => {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

/**
 * One contact_channel_stats row, in warehouse shape. Pure.
 *
 * Exported separately from the write so the mapping can be tested without a
 * BigQuery client, a project id, or a network -- which is the only way this
 * gets tested at all, since no test environment has credentials.
 */
export function cadenceRow(ownerId, row, { tenant = null, computedAt = new Date() } = {}) {
  if (!ownerId || !row?.contact_id || !row?.channel) return null;
  return {
    tenant_id: tenant ?? tenantId(),
    owner_id: String(ownerId),
    contact_id: String(row.contact_id),
    channel: String(row.channel),
    first_at: ts(row.first_at),
    last_at: ts(row.last_at),
    count_30d: int(row.count_30d),
    count_90d: int(row.count_90d),
    count_all: int(row.count_all),
    // How many of the owner's own connected accounts carry this relationship.
    accounts: Math.max(1, int(row.accounts)),
    computed_at: ts(computedAt) ?? new Date().toISOString(),
  };
}

/**
 * Mirror one owner's channel stats. Returns how many rows were written.
 *
 * NEVER THROWS, and a per-row failure does not abandon the rest -- a mirror
 * that gives up halfway leaves the warehouse in a state that is neither the old
 * picture nor the new one, which is worse than a few missing rows.
 *
 * Sequential on purpose. This runs behind a rollup, not a request, so there is
 * nobody waiting, and a burst of parallel MERGEs against one table is how a
 * mirror earns itself a rate limit.
 */
export async function mirrorOwnerCadence(ownerId, rows, { write = mergeRow, ready = isReady } = {}) {
  if (!ready()) return 0;
  let written = 0;
  for (const raw of rows || []) {
    const row = cadenceRow(ownerId, raw);
    if (!row) continue;
    try {
      if (await write(CADENCE_TABLE, row, KEY_COLUMNS)) written += 1;
    } catch {
      // bq-client already logs. Keep going.
    }
  }
  return written;
}
