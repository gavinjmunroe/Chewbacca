/**
 * What the dispatcher and sweeper need from a work queue.
 *
 * Two queues feed Perplexity Computer: reply drafting (reply_items) and
 * connection research (connection_items). Both walk the same state machine —
 * queued -> dispatching -> dispatched -> done, 'failed' from any middle state —
 * and both need the same protections: claim before sending, save the thread id
 * before calling it sent, never retry a row stuck mid-dispatch. Those live once,
 * in dispatch.ts and sweeper.ts, and each queue supplies its table and its
 * message through this interface.
 */

import { BigQueryClient } from "../bigquery/client";
import { resolveDataset } from "../services/dataset-resolver";
import { createLogger } from "../observability/logger";
import type { CallScope } from "./call-log";

const logger = createLogger("perplexity/queue");

const PROJECT_ID = process.env.GCP_PROJECT_ID || "midyear-glazing-485303-u3";

/** The columns the dispatcher and sweeper read. Every queue row has them. */
export interface QueueRow {
  row_id: string;
  client_id: string | null;
  pplx_thread_id?: string | null;
  pplx_account?: string | null;
}

export interface PerplexityQueue<R extends QueueRow> {
  /** How a row is named in alerts: "Reply", "Connection search". */
  label: string;
  /** Which daily cap and call-log kinds this queue's spend counts against. */
  scope: CallScope;
  /** How many queued rows one sweep pass may start. */
  dispatchPerPass(): number;
  /** What a person runs to put failed rows back, quoted in alerts. */
  requeueHint: string;
  /**
   * The task Perplexity is sent. May throw: the dispatcher builds it BEFORE
   * claiming the row, so a message that cannot be built costs nothing and
   * leaves the row queued for the next pass.
   */
  buildMessage(row: R): string | Promise<string>;
  /**
   * Optional, and run before anything else: settle the row from data Togari
   * already holds, or choose the message. Returns "served" when the queue
   * finished the row itself and nothing is to be sent; a message to send it
   * instead of buildMessage's; or null to fall through to buildMessage.
   * May throw, with the same effect as buildMessage throwing.
   *
   * Runs before the halt and daily-cap checks, because serving a row costs
   * nothing: a halted account must not stop work that needs no call.
   */
  plan?(row: R): Promise<{ served: true } | { served: false; message: string } | null>;

  findQueued(limit: number): Promise<R[]>;
  claimForDispatch(rowId: string): Promise<boolean>;
  saveDispatchIdentity(params: {
    rowId: string;
    threadId: string | null;
    account: string;
  }): Promise<void>;
  markDispatched(rowId: string): Promise<void>;
  markFailed(rowId: string, reason: string): Promise<void>;
  requeue(rowId: string): Promise<boolean>;
  findStuckDispatching(minutes: number): Promise<R[]>;
  findAncient(maxAgeMinutes: number): Promise<R[]>;
  findStuckDispatched(params: {
    staleMinutes: number;
    maxAttempts: number;
    limit?: number;
  }): Promise<R[]>;
  recordChaseAttempt(rowId: string): Promise<number>;
}

/** The parts of PerplexityQueue that are pure table bookkeeping. */
export type QueueStore<R extends QueueRow> = Pick<
  PerplexityQueue<R>,
  | "findQueued"
  | "claimForDispatch"
  | "saveDispatchIdentity"
  | "markDispatched"
  | "markFailed"
  | "requeue"
  | "findStuckDispatching"
  | "findAncient"
  | "findStuckDispatched"
  | "recordChaseAttempt"
>;

function bq(): BigQueryClient {
  return new BigQueryClient(
    PROJECT_ID,
    null,
    process.env.GCP_CREDENTIALS_BASE64 ||
      process.env.GOOGLE_CREDENTIALS_BASE64 ||
      null,
  );
}

const affected = (res: { numDmlAffectedRows?: string | number | null }) =>
  Number(res.numDmlAffectedRows ?? "0") > 0;

/**
 * The state-machine writes for a queue table, given its name and a loader for
 * a whole row.
 *
 * The SQL and the reasoning are reply_items' (src/replies/store.ts), where each
 * guard is explained by the incident that put it there. Only the table differs.
 */
export function createQueueStore<R extends QueueRow>(
  tableName: string,
  getRow: (rowId: string) => Promise<R | null>,
): QueueStore<R> {
  const table = () => `\`${PROJECT_ID}.${resolveDataset()}.${tableName}\``;

  async function loadAll(rows: Record<string, unknown>[]): Promise<R[]> {
    const out: R[] = [];
    for (const r of rows) {
      const full = await getRow(String(r.row_id));
      if (full) out.push(full);
    }
    return out;
  }

  const limitOf = (n: number, max: number) => Math.max(1, Math.min(max, Math.floor(n)));

  return {
    async findQueued(limit) {
      const { rows } = await bq().executeQuery(
        `SELECT row_id
           FROM ${table()}
          WHERE state = 'queued'
          ORDER BY created_at
          LIMIT ${limitOf(limit, 50)}`,
      );
      return loadAll(rows);
    },

    async claimForDispatch(rowId) {
      return affected(
        await bq().executeWrite(
          `UPDATE ${table()}
              SET state = 'dispatching', updated_at = CURRENT_TIMESTAMP()
            WHERE row_id = @rowId AND state = 'queued'`,
          { rowId },
        ),
      );
    },

    async saveDispatchIdentity({ rowId, threadId, account }) {
      await bq().executeWrite(
        `UPDATE ${table()}
            SET pplx_thread_id = @threadId,
                pplx_account = @account,
                updated_at = CURRENT_TIMESTAMP()
          WHERE row_id = @rowId`,
        { rowId, threadId, account },
      );
    },

    async markDispatched(rowId) {
      const moved = affected(
        await bq().executeWrite(
          `UPDATE ${table()}
              SET state = 'dispatched', updated_at = CURRENT_TIMESTAMP()
            WHERE row_id = @rowId AND state = 'dispatching'`,
          { rowId },
        ),
      );
      if (!moved) logger.info("queue.dispatched.already_moved_on", { table: tableName, rowId });
    },

    async markFailed(rowId, reason) {
      logger.warn("queue.failed", { table: tableName, rowId, reason });
      await bq().executeWrite(
        `UPDATE ${table()}
            SET state = 'failed', updated_at = CURRENT_TIMESTAMP()
          WHERE row_id = @rowId`,
        { rowId },
      );
    },

    async requeue(rowId) {
      const requeued = affected(
        await bq().executeWrite(
          `UPDATE ${table()}
              SET state = 'queued',
                  attempts = 0,
                  pplx_thread_id = NULL,
                  pplx_account = NULL,
                  updated_at = CURRENT_TIMESTAMP()
            WHERE row_id = @rowId AND state != 'done'`,
          { rowId },
        ),
      );
      if (!requeued) logger.info("queue.requeue.skipped_done", { table: tableName, rowId });
      return requeued;
    },

    async findStuckDispatching(minutes) {
      const { rows } = await bq().executeQuery(
        `SELECT row_id
           FROM ${table()}
          WHERE state = 'dispatching'
            AND updated_at < TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL @minutes MINUTE)
          LIMIT 50`,
        { minutes },
      );
      return loadAll(rows);
    },

    async findAncient(maxAgeMinutes) {
      const { rows } = await bq().executeQuery(
        `SELECT row_id
           FROM ${table()}
          WHERE state IN ('dispatched', 'dispatching')
            AND updated_at < TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL @maxAgeMinutes MINUTE)
          LIMIT 50`,
        { maxAgeMinutes },
      );
      return loadAll(rows);
    },

    async findStuckDispatched({ staleMinutes, maxAttempts, limit }) {
      const { rows } = await bq().executeQuery(
        `SELECT row_id
           FROM ${table()}
          WHERE state = 'dispatched'
            AND updated_at < TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL @staleMinutes MINUTE)
            AND attempts < @maxAttempts
          ORDER BY updated_at
          LIMIT ${limitOf(limit ?? 10, 50)}`,
        { staleMinutes, maxAttempts },
      );
      return loadAll(rows);
    },

    async recordChaseAttempt(rowId) {
      await bq().executeWrite(
        `UPDATE ${table()}
            SET attempts = IFNULL(attempts, 0) + 1, updated_at = CURRENT_TIMESTAMP()
          WHERE row_id = @rowId`,
        { rowId },
      );
      const { rows } = await bq().executeQuery(
        `SELECT attempts FROM ${table()} WHERE row_id = @rowId LIMIT 1`,
        { rowId },
      );
      return Number(rows[0]?.attempts ?? 0);
    },
  };
}
