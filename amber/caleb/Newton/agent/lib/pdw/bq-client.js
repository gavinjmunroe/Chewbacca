/**
 * bq-client.js — singleton BigQuery client + tiny write helpers for
 * the medha_pdw dataset.
 *
 * Every write here is fire-and-forget: a BQ failure must NEVER block
 * the agent's reply path. We catch + warn, return false, and move on.
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
 * future multi-tenant slicing is one env-var flip away (decision 32:
 * don't pre-extract the column everywhere, but DO write it correctly).
 */

import { BigQuery } from "@google-cloud/bigquery";
import { enqueueFailedWrite } from "./bq-dlq.js";

const PROJECT = process.env.GCP_PROJECT_ID || null;
const DATASET = process.env.MEDHA_PDW_DATASET || "medha_pdw";
const TENANT_ID = process.env.MEDHA_TENANT || "medha";

let client = null;

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

/**
 * Insert one row into a medha_pdw table. Returns true on success,
 * false on failure (warning logged). Never throws.
 *
 * Flaw #37: on failure, the row gets pushed to the dead-letter queue
 * (bq-dlq.js) for the proactive-runner to replay later. Pass
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
  if (!keyColumns?.length) {
    throw new Error("mergeRow requires keyColumns");
  }
  // Parameterize with structs: build the WHEN MATCHED set list AND the
  // INSERT column list from the row's keys (skipping nothing — caller
  // is responsible for shaping the row to the table schema).
  const cols = Object.keys(row);
  const onClause = keyColumns.map((k) => `T.${k} = S.${k}`).join(" AND ");
  const setClause = cols
    .filter((c) => !keyColumns.includes(c))
    .map((c) => `T.${c} = S.${c}`)
    .join(", ");
  const insertCols = cols.join(", ");
  const insertVals = cols.map((c) => `S.${c}`).join(", ");

  const params = {};
  const types = {};
  for (const [k, v] of Object.entries(row)) {
    params[k] = v;
    // Let BQ infer types — explicit typing here is too brittle for
    // the schema's repeated/struct/json columns. For the simple
    // columns this MERGE flow uses (persons, groups), inference works.
  }
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
    console.warn(
      `[pdw] merge ${DATASET}.${table} failed: ${msg.slice(0, 200)}`,
    );
    return false;
  }
}

/**
 * Run a parameterized SELECT against the medha_pdw dataset. Returns
 * the array of rows on success, [] on failure (logged). Never throws —
 * dedupe + lookup paths should treat a BQ outage as "no match" so the
 * caller can fall back to whatever in-memory behavior they had.
 *
 * Used by flaw #21 (event_create cross-process idempotency), flaw #25
 * (commitment_add dedupe), flaw #26 (commitment conflict scan), and
 * flaw #30 (T-24h reminder cron pull).
 */
export async function query(sql, params = {}) {
  const c = getClient();
  if (!c) return [];
  try {
    const [rows] = await c.query({ query: sql, params });
    return Array.isArray(rows) ? rows : [];
  } catch (err) {
    const msg = err?.message || String(err);
    console.warn(`[pdw] query failed: ${msg.slice(0, 200)}`);
    return [];
  }
}

/**
 * Tiny accessor — some flaw fixes need a fully-qualified table ref to
 * stick into a query string. Keeps PROJECT/DATASET private.
 */
export function tableRef(table) {
  return `\`${PROJECT}.${DATASET}.${table}\``;
}
