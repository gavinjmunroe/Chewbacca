/**
 * bq-client.js — singleton BigQuery client + tiny write helpers for
 * the medha_pdw dataset.
 *
 * Every write here is fire-and-forget: a BQ failure must NEVER block
 * the API's reply path. We catch + warn, return false, and move on.
 *
 * Auth:
 *   - GOOGLE_APPLICATION_CREDENTIALS_JSON (raw JSON in env, our Railway shape)
 *   - falls back to GOOGLE_APPLICATION_CREDENTIALS (file path, standard GCP)
 *
 * Project / dataset:
 *   - GCP_PROJECT_ID            (e.g. midyear-glazing-485303-u3)
 *   - MEDHA_PDW_DATASET         (default: medha_pdw)
 *
 * The TENANT_ID column is set from MEDHA_TENANT (default "medha") so
 * future multi-tenant slicing is one env-var flip away (trip-planning
 * decision 32: don't pre-extract the column everywhere, but DO write
 * it correctly).
 *
 * Lifted from medha-imessage Newton/agent/lib/pdw/bq-client.js with
 * read-side `queryRows` and `getOne` helpers added for the dashboard.
 */

import { BigQuery } from "@google-cloud/bigquery";
import { enqueueFailedWrite } from "./bq-dlq.js";

const PROJECT = process.env.GCP_PROJECT_ID || null;
const DATASET = process.env.MEDHA_PDW_DATASET || "medha_pdw";
const TENANT_ID = process.env.MEDHA_TENANT || "medha";

let client = null;

/**
 * TABLES THIS PROCESS HAS GIVEN UP ON, AND WHY THAT IS NOT GIVING UP.
 *
 *   [pdw] merge medha_pdw.contact_cadence failed: Not found: Table ... x962
 *
 * A rollup over a nine-hundred-contact book calls mergeRow once per contact.
 * When the table does not exist, every one of those is a full BigQuery round
 * trip that fails the same way, so a job that should take seconds spends
 * minutes on a thousand doomed requests and buries its real output under a
 * thousand identical lines. From outside it looks like a hang.
 *
 * Fire-and-forget was always the right call for a BQ failure -- see the header
 * -- but "never block the reply path" is not the same as "try again a thousand
 * times". A missing table, a missing dataset and a refused permission are all
 * STRUCTURAL: they are the same on the thousandth attempt as on the first, and
 * nothing that happens inside this process will change them. So the first one
 * disables that table for the life of the process, says so once, and every
 * later call returns immediately without touching the network.
 *
 * A timeout or a rate limit is NOT structural and is deliberately absent from
 * the test below: those do resolve on their own, and disabling a mirror for
 * the rest of a long-running server because one write was throttled would turn
 * a blip into an outage.
 */
const disabledTables = new Map(); // table -> count of writes skipped since

/** Is this the kind of failure that will still be true on the next attempt? */
export function isStructuralBqError(message) {
  const m = String(message ?? "").toLowerCase();
  return (
    m.includes("not found") ||
    m.includes("notfound") ||
    m.includes("does not exist") ||
    m.includes("permission denied") ||
    m.includes("access denied") ||
    m.includes("accessdenied") ||
    m.includes("403")
  );
}

/** Test seam, and a way for a long-lived process to retry after a deploy. */
export function resetDisabledTables() {
  disabledTables.clear();
}

export function skippedWrites() {
  return Object.fromEntries(disabledTables);
}

function getClient() {
  if (client) return client;
  if (!PROJECT) return null;
  const credsJson = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
  if (credsJson) {
    try {
      const credentials = JSON.parse(credsJson);
      client = new BigQuery({ projectId: PROJECT, credentials });
      return client;
    } catch (err) {
      console.warn(`[pdw] creds parse failed: ${err.message}`);
      return null;
    }
  }
  client = new BigQuery({ projectId: PROJECT });
  return client;
}

export function isReady() {
  return !!(
    PROJECT &&
    (process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON ||
      process.env.GOOGLE_APPLICATION_CREDENTIALS)
  );
}

export function tenantId() {
  return TENANT_ID;
}

export function projectId() {
  return PROJECT;
}

export function datasetId() {
  return DATASET;
}

/**
 * Insert one row into a medha_pdw table. Returns true on success,
 * false on failure (warning logged). Never throws.
 *
 * Flaw #37: on failure, the row gets pushed to the dead-letter queue
 * (bq-dlq.js) for a background replayer to retry later. Pass
 * {skipDlq: true} from the replayer itself to avoid infinite recursion.
 */
export async function insertRow(table, row, { skipDlq = false } = {}) {
  const c = getClient();
  if (!c) {
    if (!skipDlq) await enqueueFailedWrite(table, row, "bq_client_not_ready");
    return false;
  }
  try {
    await c.dataset(DATASET).table(table).insert([row]);
    return true;
  } catch (err) {
    const msg =
      err?.errors?.[0]?.errors?.[0]?.message || err?.message || String(err);
    console.warn(
      `[pdw] insert ${DATASET}.${table} failed: ${msg.slice(0, 200)}`,
    );
    if (!skipDlq) await enqueueFailedWrite(table, row, msg);
    return false;
  }
}

/**
 * UPSERT-ish via MERGE. Use for `persons` and `groups` where the same
 * key (person_id / group_id) may appear repeatedly and we want the
 * latest values. Tables that are append-only (event_messages) should
 * use insertRow() instead.
 *
 * The keyColumns array names the equality predicate columns (always
 * including tenant_id for the eventual multi-tenant slice).
 */
export async function mergeRow(table, row, keyColumns) {
  const c = getClient();
  if (!c) return false;
  // Already known to be impossible. Counted rather than logged, so the volume
  // is recoverable without a line per row.
  if (disabledTables.has(table)) {
    disabledTables.set(table, disabledTables.get(table) + 1);
    return false;
  }
  if (!keyColumns?.length) {
    throw new Error("mergeRow requires keyColumns");
  }
  const cols = Object.keys(row);
  const onClause = keyColumns.map((k) => `T.${k} = S.${k}`).join(" AND ");
  const setClause = cols
    .filter((c) => !keyColumns.includes(c))
    .map((c) => `T.${c} = S.${c}`)
    .join(", ");
  const insertCols = cols.join(", ");
  const insertVals = cols.map((c) => `S.${c}`).join(", ");

  const params = {};
  for (const [k, v] of Object.entries(row)) params[k] = v;
  const query = `
    MERGE \`${PROJECT}.${DATASET}.${table}\` T
    USING (SELECT ${cols.map((c) => `@${c} AS ${c}`).join(", ")}) S
    ON ${onClause}
    WHEN MATCHED THEN
      UPDATE SET ${setClause}
    WHEN NOT MATCHED THEN
      INSERT (${insertCols}) VALUES (${insertVals})
  `;
  try {
    await c.query({ query, params });
    return true;
  } catch (err) {
    const msg = err?.message || String(err);
    if (isStructuralBqError(msg)) {
      disabledTables.set(table, 0);
      console.warn(
        `[pdw] merge ${DATASET}.${table} failed: ${msg.slice(0, 200)}\n` +
          `[pdw] ${DATASET}.${table} is unreachable for structural reasons; ` +
          `mirroring to it is OFF for the rest of this process and will not be ` +
          `retried or logged again. Everything else continues normally.`,
      );
    } else {
      console.warn(`[pdw] merge ${DATASET}.${table} failed: ${msg.slice(0, 200)}`);
    }
    return false;
  }
}

/**
 * Read helper for the dashboard. Returns an array of rows or null on
 * error. The caller is responsible for validating tenant scope.
 *
 * Parameters use BQ's @name placeholder syntax. Always parameterize
 * (never string-concat) user input into a query.
 */
export async function queryRows(sql, params = {}) {
  const c = getClient();
  if (!c) return null;
  try {
    const [rows] = await c.query({ query: sql, params });
    return rows || [];
  } catch (err) {
    const msg = err?.message || String(err);
    console.warn(`[pdw] query failed: ${msg.slice(0, 200)}`);
    return null;
  }
}

/**
 * Convenience wrapper for "expect 0 or 1 row" reads. Returns the row
 * object on hit, null on miss or error.
 */
export async function getOne(sql, params = {}) {
  const rows = await queryRows(sql, params);
  if (!rows || rows.length === 0) return null;
  return rows[0];
}
