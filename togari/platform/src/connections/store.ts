/**
 * connection_items persistence (migration 0037).
 *
 * Owns every write to connection_items, for the reason src/replies/store.ts
 * owns reply_items: row_id uniqueness is a property of the MERGE below, not of
 * the table, so a raw INSERT from anywhere else duplicates rows on Clay's
 * first retry. The state-machine writes come from createQueueStore and are
 * reply_items' SQL against this table.
 */

import crypto from "crypto";
import { BigQueryClient } from "../bigquery/client";
import { resolveDataset } from "../services/dataset-resolver";
import { createLogger } from "../observability/logger";
import { createQueueStore } from "../perplexity/queue";
import type { ReplyState } from "../replies/types";
import type { ConnectionIngestPayload } from "./types";

const logger = createLogger("connections/store");

const PROJECT_ID = process.env.GCP_PROJECT_ID || "midyear-glazing-485303-u3";

function connectionItemsTable(): string {
  return `\`${PROJECT_ID}.${resolveDataset()}.connection_items\``;
}

function moduleBq(): BigQueryClient {
  return new BigQueryClient(
    PROJECT_ID,
    null,
    process.env.GCP_CREDENTIALS_BASE64 ||
      process.env.GOOGLE_CREDENTIALS_BASE64 ||
      null,
  );
}

/** Stable across retries, so a duplicate POST returns the original id. */
export function connectionItemId(rowId: string): string {
  return crypto.createHash("sha256").update(rowId).digest("hex");
}

export interface ConnectionItemRef {
  id: string;
  row_id: string;
  state: ReplyState;
}

export interface ConnectionItemRow extends ConnectionItemRef {
  client_id: string | null;
  person_name: string;
  person_title: string | null;
  person_company: string;
  person_company_domain: string | null;
  person_linkedin: string | null;
  person_location: string | null;
  person_email: string | null;
  work_history: string | null;
  pplx_thread_id: string | null;
  pplx_account: string | null;
  attempts: number;
}

export async function findConnectionItem(rowId: string): Promise<ConnectionItemRef | null> {
  const { rows } = await moduleBq().executeQuery(
    `SELECT id, row_id, state
       FROM ${connectionItemsTable()}
      WHERE row_id = @rowId
      LIMIT 1`,
    { rowId },
  );
  const row = rows[0];
  if (!row) return null;
  return {
    id: String(row.id ?? connectionItemId(rowId)),
    row_id: String(row.row_id ?? rowId),
    state: String(row.state ?? "queued") as ReplyState,
  };
}

/**
 * Insert a person at state 'queued' — only if row_id is new. No WHEN MATCHED
 * branch, so a repeat POST changes nothing (see insertQueuedReply).
 */
export async function insertQueuedConnection(
  payload: ConnectionIngestPayload,
  clientId: string,
): Promise<{ id: string; inserted: boolean }> {
  const rowId = payload.row_id.trim();
  const id = connectionItemId(rowId);

  const result = await moduleBq().executeWrite(
    `MERGE ${connectionItemsTable()} T
     USING (SELECT @rowId AS row_id) S
     ON T.row_id = S.row_id
     WHEN NOT MATCHED THEN INSERT
       (id, row_id, client_id, state, attempts, created_at, updated_at,
        person_name, person_title, person_company, person_company_domain,
        person_linkedin, person_location, person_email, work_history)
     VALUES
       (@id, @rowId, @clientId, 'queued', 0, CURRENT_TIMESTAMP(), CURRENT_TIMESTAMP(),
        @personName, @personTitle, @personCompany, @personCompanyDomain,
        @personLinkedin, @personLocation, @personEmail, @workHistory)`,
    {
      id,
      rowId,
      clientId,
      personName: payload.person_name,
      personTitle: payload.person_title ?? null,
      personCompany: payload.person_company,
      personCompanyDomain: payload.person_company_domain ?? null,
      personLinkedin: payload.person_linkedin ?? null,
      personLocation: payload.person_location ?? null,
      personEmail: payload.person_email?.trim() || null,
      // Bounded: it goes into every task message, and a whole enrichment blob
      // is mostly noise to the AI.
      workHistory: payload.work_history ? payload.work_history.slice(0, 8000) : null,
    },
  );

  const inserted = Number(result.numDmlAffectedRows ?? "0") > 0;
  if (!inserted) logger.info("connections.insert.lost_race", { rowId, id });
  return { id, inserted };
}

export async function getConnectionItem(rowId: string): Promise<ConnectionItemRow | null> {
  const { rows } = await moduleBq().executeQuery(
    `SELECT id, row_id, state, client_id,
            person_name, person_title, person_company, person_company_domain,
            person_linkedin, person_location, person_email, work_history,
            pplx_thread_id, pplx_account, attempts
       FROM ${connectionItemsTable()}
      WHERE row_id = @rowId
      LIMIT 1`,
    { rowId },
  );
  const row = rows[0];
  if (!row) return null;
  const str = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
  return {
    id: String(row.id ?? connectionItemId(rowId)),
    row_id: String(row.row_id ?? rowId),
    state: String(row.state ?? "queued") as ReplyState,
    client_id: str(row.client_id),
    person_name: String(row.person_name ?? ""),
    person_title: str(row.person_title),
    person_company: String(row.person_company ?? ""),
    person_company_domain: str(row.person_company_domain),
    person_linkedin: str(row.person_linkedin),
    person_location: str(row.person_location),
    person_email: str(row.person_email),
    work_history: str(row.work_history),
    pplx_thread_id: str(row.pplx_thread_id),
    pplx_account: str(row.pplx_account),
    attempts: Number(row.attempts ?? 0),
  };
}

/**
 * Save Perplexity's answer and move the row to done, once.
 *
 * Compare-and-set on state != 'done', claimed BEFORE anything goes to Clay, for
 * the reason claimReplyResult is: Perplexity retrying a callback must not put
 * every connection into the Clay table twice.
 */
export async function claimConnectionResult(params: {
  rowId: string;
  identityConfirmed: boolean | null;
  targetRowsRead: number | null;
  targetRowsExpected: number | null;
  connectionsFound: number | null;
  connectionsJson: string | null;
  resultJson: string;
}): Promise<boolean> {
  const num = (n: number | null) => (n == null ? null : String(n));
  const result = await moduleBq().executeWrite(
    `UPDATE ${connectionItemsTable()}
        SET state = 'done',
            identity_confirmed = SAFE_CAST(@identityConfirmed AS BOOL),
            target_rows_read = SAFE_CAST(@targetRowsRead AS INT64),
            target_rows_expected = SAFE_CAST(@targetRowsExpected AS INT64),
            connections_found = SAFE_CAST(@connectionsFound AS INT64),
            connections_json = @connectionsJson,
            result_json = @resultJson,
            updated_at = CURRENT_TIMESTAMP()
      WHERE row_id = @rowId
        AND state != 'done'`,
    {
      rowId: params.rowId,
      identityConfirmed:
        params.identityConfirmed == null ? null : String(params.identityConfirmed),
      targetRowsRead: num(params.targetRowsRead),
      targetRowsExpected: num(params.targetRowsExpected),
      connectionsFound: num(params.connectionsFound),
      connectionsJson: params.connectionsJson,
      resultJson: params.resultJson,
    },
  );
  const claimed = Number(result.numDmlAffectedRows ?? "0") > 0;
  if (!claimed) logger.info("connections.result.already_done", { rowId: params.rowId });
  return claimed;
}

/** The email intake recorded for a person, if any. */
export async function findPersonEmail(rowId: string): Promise<string | null> {
  const { rows } = await moduleBq().executeQuery(
    `SELECT person_email FROM ${connectionItemsTable()} WHERE row_id = @rowId LIMIT 1`,
    { rowId },
  );
  const email = rows[0]?.person_email;
  return email ? String(email) : null;
}

/** How many rows Clay accepted, so a partial push is visible afterwards. */
export async function recordClayPosted(rowId: string, posted: number): Promise<void> {
  await moduleBq().executeWrite(
    `UPDATE ${connectionItemsTable()}
        SET clay_posted = SAFE_CAST(@posted AS INT64), updated_at = CURRENT_TIMESTAMP()
      WHERE row_id = @rowId`,
    { rowId, posted: String(posted) },
  );
}

// ── How a row was researched (migration 0050) ─────────────────────────────

let researchColumnsSeen = false;

/**
 * Whether research_mode and reused_result_json exist yet. Until migration
 * 0050 is applied, reuse is off and every row is researched in full as
 * before: a top-up whose stored half cannot be saved could not be merged when
 * its result came back. Read once and remembered once true.
 */
export async function researchModeColumns(): Promise<boolean> {
  if (researchColumnsSeen) return true;
  try {
    const { rows } = await moduleBq().executeQuery(
      `SELECT column_name FROM \`${PROJECT_ID}.${resolveDataset()}\`.INFORMATION_SCHEMA.COLUMNS
        WHERE table_name = 'connection_items'
          AND column_name IN ('research_mode', 'reused_result_json')`,
    );
    researchColumnsSeen = rows.length === 2;
  } catch (error) {
    logger.warn("connections.research_columns_unreadable", { error: String(error) });
  }
  return researchColumnsSeen;
}

export function _resetResearchModeColumns(): void {
  researchColumnsSeen = false;
}

/**
 * Record how a queued row is about to be researched, and for a reuse or top-up
 * the stored histories it starts from. Written before anything is spent, while
 * the row is still queued; a pass that then skips the row leaves it queued and
 * the next pass decides again.
 */
export async function recordResearchMode(
  rowId: string,
  mode: "reuse" | "topup" | "full",
  reusedJson: string | null,
): Promise<void> {
  await moduleBq().executeWrite(
    `UPDATE ${connectionItemsTable()}
        SET research_mode = @mode, reused_result_json = @reusedJson,
            updated_at = CURRENT_TIMESTAMP()
      WHERE row_id = @rowId AND state = 'queued'`,
    { rowId, mode, reusedJson },
  );
}

/** How a row was researched, and the stored half of a top-up, if any. */
export async function getResearchMode(
  rowId: string,
): Promise<{ mode: string | null; reusedJson: string | null }> {
  if (!(await researchModeColumns())) return { mode: null, reusedJson: null };
  const { rows } = await moduleBq().executeQuery(
    `SELECT research_mode, reused_result_json
       FROM ${connectionItemsTable()}
      WHERE row_id = @rowId
      LIMIT 1`,
    { rowId },
  );
  const r = rows[0];
  return {
    mode: r?.research_mode == null ? null : String(r.research_mode),
    reusedJson: r?.reused_result_json == null ? null : String(r.reused_result_json),
  };
}

/** The state-machine writes the dispatcher and sweeper drive. */
export const connectionQueueStore = createQueueStore<ConnectionItemRow>(
  "connection_items",
  getConnectionItem,
);
