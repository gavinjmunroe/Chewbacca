/**
 * @togari/storage — togari_invocations CRUD
 *
 * Audit log of every tool-use loop run (src/core/tool-use-runner.ts).
 * Writes are best-effort: a failure here MUST NOT block the user-visible
 * response. Schema mirrors sql/migrations/0023_togari_invocations.sql.
 */

import { randomUUID } from 'crypto';
import { BigQueryClient } from '../bigquery/client';
import { resolveDataset } from '../services/dataset-resolver';
import { createLogger } from '../observability/logger';

const logger = createLogger('storage/invocations');
const PROJECT_ID = 'midyear-glazing-485303-u3';

export interface InvocationToolCall {
  name: string;
  input: Record<string, unknown>;
  output: unknown;
  duration_ms: number;
  status: 'ok' | 'error' | 'needs_clarification';
}

export interface InvocationRow {
  invocation_id?: string;
  user_id?: string;
  channel_id?: string;
  thread_ts?: string;
  tenant_id: string;
  original_message?: string;
  tools_called: InvocationToolCall[];
  final_response?: string;
  iteration_count: number;
  started_at: Date;
  completed_at?: Date;
  error_text?: string;
  total_input_tokens?: number;
  total_output_tokens?: number;
}

function getBqClient(): BigQueryClient {
  return new BigQueryClient(
    PROJECT_ID,
    null,
    process.env.GCP_CREDENTIALS_BASE64 || process.env.GOOGLE_CREDENTIALS_BASE64 || null,
  );
}

function table(): string {
  return `\`${PROJECT_ID}.${resolveDataset()}.togari_invocations\``;
}

/**
 * Insert one invocation row. Best-effort: caller must NOT await the
 * returned promise on a critical path that would surface failures to
 * the end user — log and continue.
 */
export async function insertInvocation(row: InvocationRow): Promise<string> {
  const invocationId = row.invocation_id ?? randomUUID();
  const sql = `INSERT INTO ${table()}
    (invocation_id, user_id, channel_id, thread_ts, tenant_id, original_message,
     tools_called, final_response, iteration_count, started_at, completed_at,
     error_text, total_input_tokens, total_output_tokens)
    VALUES
    (@invocation_id, @user_id, @channel_id, @thread_ts, @tenant_id, @original_message,
     PARSE_JSON(@tools_called), @final_response, @iteration_count, @started_at, @completed_at,
     @error_text, @total_input_tokens, @total_output_tokens)`;

  try {
    await getBqClient().executeWrite(sql, {
      invocation_id: invocationId,
      user_id: row.user_id ?? null,
      channel_id: row.channel_id ?? null,
      thread_ts: row.thread_ts ?? null,
      tenant_id: row.tenant_id,
      original_message: row.original_message ?? null,
      tools_called: JSON.stringify(row.tools_called ?? []),
      final_response: row.final_response ?? null,
      iteration_count: row.iteration_count,
      started_at: row.started_at.toISOString(),
      completed_at: row.completed_at ? row.completed_at.toISOString() : null,
      error_text: row.error_text ?? null,
      total_input_tokens: row.total_input_tokens ?? null,
      total_output_tokens: row.total_output_tokens ?? null,
    });
  } catch (err) {
    logger.warn('insertInvocation failed (non-fatal)', {
      invocationId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
  return invocationId;
}
