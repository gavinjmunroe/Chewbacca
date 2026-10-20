/**
 * Clay table auto-registration.
 *
 * The universal connector accepts rows from ANY Clay table. The first time a
 * previously-unseen table_key arrives, we register it here so operators can see
 * which Clay tables are wired into Togari and how much traffic each drives. This
 * is the mechanism that makes "add the column to any table and it just works"
 * true: an unknown table is registered on the fly rather than rejected.
 *
 * MERGE semantics:
 *   WHEN MATCHED     -> bump last_seen_at, increment row_count.
 *   WHEN NOT MATCHED -> insert with status "active", row_count 1.
 *
 * Registration is best-effort. A failure here is logged and swallowed so an
 * unknown table (or a transient BigQuery blip) never breaks the caller's Clay
 * column. The action the caller asked for still runs.
 */

import { BigQueryClient } from "../../bigquery/client";
import { resolveDataset } from "../../services/dataset-resolver";
import { createLogger } from "../../observability/logger";

const logger = createLogger("routes/clay-connector/registry");

const PROJECT_ID = process.env.GCP_PROJECT_ID || "midyear-glazing-485303-u3";

/** The registry table that tracks every Clay table wired into the connector. */
export const REGISTRY_TABLE = "clay_table_registry";

function qualified(table: string): string {
  return `\`${PROJECT_ID}.${resolveDataset()}.${table}\``;
}

export interface RegisterInput {
  tableKey: string;
  clientId: string;
}

export interface RegisterResult {
  /** True when this table_key was inserted for the first time this call. */
  firstSeen: boolean;
}

/**
 * Register a Clay table if it has not been seen before; otherwise touch its
 * last_seen_at and increment its row_count. Never throws to the caller.
 */
export async function registerTableIfNew(
  bq: BigQueryClient,
  input: RegisterInput,
): Promise<RegisterResult> {
  const tableKey = (input.tableKey || "unknown").trim() || "unknown";
  const clientId = (input.clientId || "bma").trim() || "bma";

  // MERGE keyed on (table_key, client_id). We report firstSeen by reading the
  // registry once before the write; a race between two rows of the same new
  // table is harmless (both may report firstSeen true), because the MERGE stays
  // idempotent on the natural key.
  let firstSeen = false;
  try {
    const existing = await bq.executeQuery(
      `
      SELECT table_key
        FROM ${qualified(REGISTRY_TABLE)}
       WHERE table_key = @tableKey AND client_id = @clientId
       LIMIT 1
      `.trim(),
      { tableKey, clientId },
    );
    firstSeen = existing.rows.length === 0;
  } catch (err) {
    // A missing registry table or a read blip should not stop registration.
    const message = err instanceof Error ? err.message : String(err);
    logger.warn("clay-connector.registry.read_failed", {
      tableKey,
      clientId,
      error: message,
    });
  }

  const sql = `
    MERGE ${qualified(REGISTRY_TABLE)} AS target
    USING (
      SELECT
        @tableKey AS table_key,
        @clientId AS client_id
    ) AS source
    ON target.table_key = source.table_key
       AND target.client_id = source.client_id
    WHEN MATCHED THEN UPDATE SET
      last_seen_at = CURRENT_TIMESTAMP(),
      row_count = target.row_count + 1,
      status = "active"
    WHEN NOT MATCHED THEN INSERT
      (table_key, client_id, first_seen_at, last_seen_at, row_count, status)
      VALUES
      (source.table_key, source.client_id, CURRENT_TIMESTAMP(), CURRENT_TIMESTAMP(), 1, "active")
  `.trim();

  try {
    await bq.executeWrite(sql, { tableKey, clientId });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(
      "clay-connector.registry.merge_failed",
      err instanceof Error ? err : new Error(message),
      { tableKey, clientId },
    );
    // Swallow: an unknown table must still succeed at the action level.
  }

  return { firstSeen };
}
