/**
 * @togari/storage — togari_pending_clarifications CRUD
 *
 * Persistent thread-scoped resume state for tool-use loop clarifications.
 * Replaces the in-memory `pendingClarifications` Map at
 * src/transports/slack/index.ts:73 — process restarts no longer lose
 * pending state, and audit is now queryable.
 *
 * Schema: sql/migrations/0025_togari_pending_clarifications.sql.
 *
 * Lookup contract (the runner calls findActiveByThread on every inbound
 * message BEFORE invoking Claude): returns the most-recently created
 * unresolved row for the thread whose expires_at is in the future.
 */

import { randomUUID } from 'crypto';
import { BigQueryClient } from '../bigquery/client';
import { resolveDataset } from '../services/dataset-resolver';
import { createLogger } from '../observability/logger';

const logger = createLogger('storage/pending-clarifications');
const PROJECT_ID = 'midyear-glazing-485303-u3';

export interface PendingClarificationRow {
  clarification_id: string;
  thread_ts: string;
  channel_id?: string | null;
  user_id?: string | null;
  tenant_id: string;
  original_message?: string | null;
  partial_state: Record<string, unknown>;
  question_asked?: string | null;
  tool_name?: string | null;
  created_at: Date;
  expires_at: Date;
  resolved_at?: Date | null;
  resolved_with?: string | null;
}

const DEFAULT_TTL_HOURS = 24;

function getBqClient(): BigQueryClient {
  return new BigQueryClient(
    PROJECT_ID,
    null,
    process.env.GCP_CREDENTIALS_BASE64 || process.env.GOOGLE_CREDENTIALS_BASE64 || null,
  );
}

function table(): string {
  return `\`${PROJECT_ID}.${resolveDataset()}.togari_pending_clarifications\``;
}

export async function insertPendingClarification(row: {
  thread_ts: string;
  channel_id?: string | null;
  user_id?: string | null;
  tenant_id: string;
  original_message?: string | null;
  partial_state: Record<string, unknown>;
  question_asked?: string | null;
  tool_name?: string | null;
  ttl_hours?: number;
}): Promise<string> {
  const clarificationId = randomUUID();
  const now = new Date();
  const ttlMs = (row.ttl_hours ?? DEFAULT_TTL_HOURS) * 60 * 60 * 1000;
  const expiresAt = new Date(now.getTime() + ttlMs);

  // Supersede any older unresolved clarifications in the same thread.
  // findActiveByThread() picks the most recent unresolved row; without
  // this UPDATE, two pending rows in one thread would compete on
  // ORDER BY created_at DESC LIMIT 1 — most-recent wins anyway, but
  // older rows would linger until expiry. Explicit resolution here
  // makes the audit trail accurate and keeps the active-row set small.
  try {
    await getBqClient().executeWrite(
      `UPDATE ${table()}
         SET resolved_at = CURRENT_TIMESTAMP(),
             resolved_with = 'superseded'
       WHERE thread_ts = @thread_ts
         AND tenant_id = @tenant_id
         AND resolved_at IS NULL
         AND expires_at > CURRENT_TIMESTAMP()`,
      {
        thread_ts: row.thread_ts,
        tenant_id: row.tenant_id,
      },
    );
  } catch (err) {
    logger.warn('supersedeOlderClarifications failed (non-fatal)', {
      thread_ts: row.thread_ts,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  const sql = `INSERT INTO ${table()}
    (clarification_id, thread_ts, channel_id, user_id, tenant_id,
     original_message, partial_state, question_asked, tool_name,
     created_at, expires_at, resolved_at, resolved_with)
    VALUES
    (@clarification_id, @thread_ts, @channel_id, @user_id, @tenant_id,
     @original_message, PARSE_JSON(@partial_state), @question_asked, @tool_name,
     @created_at, @expires_at, NULL, NULL)`;

  try {
    await getBqClient().executeWrite(sql, {
      clarification_id: clarificationId,
      thread_ts: row.thread_ts,
      channel_id: row.channel_id ?? null,
      user_id: row.user_id ?? null,
      tenant_id: row.tenant_id,
      original_message: row.original_message ?? null,
      partial_state: JSON.stringify(row.partial_state ?? {}),
      question_asked: row.question_asked ?? null,
      tool_name: row.tool_name ?? null,
      created_at: now.toISOString(),
      expires_at: expiresAt.toISOString(),
    });
  } catch (err) {
    logger.warn('insertPendingClarification failed', {
      clarificationId,
      thread_ts: row.thread_ts,
      error: err instanceof Error ? err.message : String(err),
    });
  }
  return clarificationId;
}

/**
 * Look up the most recent unresolved, unexpired clarification for a
 * thread. Returns null if none. The runner calls this before invoking
 * Claude on a new user message in an existing thread.
 */
export async function findActiveByThread(
  threadTs: string,
  tenantId: string,
): Promise<PendingClarificationRow | null> {
  const sql = `SELECT clarification_id, thread_ts, channel_id, user_id, tenant_id,
                      original_message,
                      TO_JSON_STRING(partial_state) AS partial_state,
                      question_asked, tool_name, created_at, expires_at,
                      resolved_at, resolved_with
               FROM ${table()}
               WHERE thread_ts = @thread_ts
                 AND tenant_id = @tenant_id
                 AND resolved_at IS NULL
                 AND expires_at > CURRENT_TIMESTAMP()
               ORDER BY created_at DESC
               LIMIT 1`;
  try {
    const result = await getBqClient().executeQuery(sql, {
      thread_ts: threadTs,
      tenant_id: tenantId,
    });
    if (result.rows.length === 0) return null;
    const r = result.rows[0] as Record<string, unknown>;
    return {
      clarification_id: String(r.clarification_id ?? ''),
      thread_ts: String(r.thread_ts ?? ''),
      channel_id: (r.channel_id as string | null) ?? null,
      user_id: (r.user_id as string | null) ?? null,
      tenant_id: String(r.tenant_id ?? ''),
      original_message: (r.original_message as string | null) ?? null,
      partial_state: r.partial_state ? JSON.parse(String(r.partial_state)) : {},
      question_asked: (r.question_asked as string | null) ?? null,
      tool_name: (r.tool_name as string | null) ?? null,
      created_at: new Date(String(r.created_at)),
      expires_at: new Date(String(r.expires_at)),
      resolved_at: r.resolved_at ? new Date(String(r.resolved_at)) : null,
      resolved_with: (r.resolved_with as string | null) ?? null,
    };
  } catch (err) {
    logger.warn('findActiveByThread failed', {
      thread_ts: threadTs,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

export async function markResolved(
  clarificationId: string,
  resolvedWith: string,
): Promise<void> {
  const sql = `UPDATE ${table()}
               SET resolved_at = CURRENT_TIMESTAMP(),
                   resolved_with = @resolved_with
               WHERE clarification_id = @clarification_id
                 AND resolved_at IS NULL`;
  try {
    await getBqClient().executeWrite(sql, {
      clarification_id: clarificationId,
      resolved_with: resolvedWith.slice(0, 1000),
    });
  } catch (err) {
    logger.warn('markResolved failed', {
      clarificationId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
