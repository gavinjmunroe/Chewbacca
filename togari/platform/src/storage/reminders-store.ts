/**
 * @togari/storage — togari_reminders CRUD
 *
 * First-class persistent rows for every Slack reminder scheduled by the
 * tool-use runner. Replaces the fire-and-forget chat.scheduleMessage
 * pattern in src/transports/slack/index.ts:541-572. Each row carries
 * enough metadata (slack_scheduled_message_id, confirmation_channel/ts)
 * for the [❌ Cancel] button to undo the schedule.
 *
 * Schema: sql/migrations/0024_togari_reminders.sql.
 */

import { randomUUID } from 'crypto';
import { BigQueryClient } from '../bigquery/client';
import { resolveDataset } from '../services/dataset-resolver';
import { createLogger } from '../observability/logger';

const logger = createLogger('storage/reminders');
const PROJECT_ID = 'midyear-glazing-485303-u3';

export type ReminderStatus = 'scheduled' | 'cancelled' | 'fired' | 'failed';
export type SlackApiMethod = 'reminders.add' | 'chat.scheduleMessage';

export interface ReminderRow {
  reminder_id: string;
  slack_scheduled_message_id?: string | null;   // id from chat.scheduleMessage (Q…)
  slack_reminder_id?: string | null;             // id from reminders.add (Rm…)
  slack_api_method?: SlackApiMethod | null;
  confirmation_channel?: string | null;
  confirmation_ts?: string | null;
  channel?: string | null;
  thread_ts?: string | null;
  creator_user_id?: string | null;
  target_user_id?: string | null;
  mentioned_user_ids?: string[];
  original_text?: string | null;
  reminder_text?: string | null;
  parsed_intent?: Record<string, unknown> | null;
  scheduled_at?: Date | null;
  fired_at?: Date | null;
  cancelled_at?: Date | null;
  cancelled_by?: string | null;
  status: ReminderStatus;
  tenant_id: string;
}

function getBqClient(): BigQueryClient {
  return new BigQueryClient(
    PROJECT_ID,
    null,
    process.env.GCP_CREDENTIALS_BASE64 || process.env.GOOGLE_CREDENTIALS_BASE64 || null,
  );
}

function table(): string {
  return `\`${PROJECT_ID}.${resolveDataset()}.togari_reminders\``;
}

export async function insertReminder(row: Omit<ReminderRow, 'reminder_id'> & { reminder_id?: string }): Promise<string> {
  const reminderId = row.reminder_id ?? randomUUID();
  const sql = `INSERT INTO ${table()}
    (reminder_id, slack_scheduled_message_id, slack_reminder_id, slack_api_method,
     confirmation_channel, confirmation_ts,
     channel, thread_ts, creator_user_id, target_user_id, mentioned_user_ids,
     original_text, reminder_text, parsed_intent, scheduled_at, fired_at,
     cancelled_at, cancelled_by, status, tenant_id, created_at, updated_at)
    VALUES
    (@reminder_id, @slack_scheduled_message_id, @slack_reminder_id, @slack_api_method,
     @confirmation_channel, @confirmation_ts,
     @channel, @thread_ts, @creator_user_id, @target_user_id, @mentioned_user_ids,
     @original_text, @reminder_text, PARSE_JSON(@parsed_intent), @scheduled_at, @fired_at,
     @cancelled_at, @cancelled_by, @status, @tenant_id, CURRENT_TIMESTAMP(), CURRENT_TIMESTAMP())`;

  try {
    await getBqClient().executeWrite(sql, {
      reminder_id: reminderId,
      slack_scheduled_message_id: row.slack_scheduled_message_id ?? null,
      slack_reminder_id: row.slack_reminder_id ?? null,
      slack_api_method: row.slack_api_method ?? null,
      confirmation_channel: row.confirmation_channel ?? null,
      confirmation_ts: row.confirmation_ts ?? null,
      channel: row.channel ?? null,
      thread_ts: row.thread_ts ?? null,
      creator_user_id: row.creator_user_id ?? null,
      target_user_id: row.target_user_id ?? null,
      mentioned_user_ids: row.mentioned_user_ids ?? [],
      original_text: row.original_text ?? null,
      reminder_text: row.reminder_text ?? null,
      parsed_intent: row.parsed_intent ? JSON.stringify(row.parsed_intent) : '{}',
      scheduled_at: row.scheduled_at ? row.scheduled_at.toISOString() : null,
      fired_at: row.fired_at ? row.fired_at.toISOString() : null,
      cancelled_at: row.cancelled_at ? row.cancelled_at.toISOString() : null,
      cancelled_by: row.cancelled_by ?? null,
      status: row.status,
      tenant_id: row.tenant_id,
    });
  } catch (err) {
    logger.warn('insertReminder failed (non-fatal)', {
      reminderId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
  return reminderId;
}

export async function getReminderById(reminderId: string): Promise<ReminderRow | null> {
  const sql = `SELECT reminder_id, slack_scheduled_message_id, slack_reminder_id, slack_api_method,
                      confirmation_channel,
                      confirmation_ts, channel, thread_ts, creator_user_id, target_user_id,
                      mentioned_user_ids, original_text, reminder_text,
                      TO_JSON_STRING(parsed_intent) AS parsed_intent,
                      scheduled_at, fired_at, cancelled_at, cancelled_by, status, tenant_id
               FROM ${table()}
               WHERE reminder_id = @reminder_id
               LIMIT 1`;
  try {
    const result = await getBqClient().executeQuery(sql, { reminder_id: reminderId });
    if (result.rows.length === 0) return null;
    const r = result.rows[0] as Record<string, unknown>;
    return {
      reminder_id: String(r.reminder_id ?? ''),
      slack_scheduled_message_id: (r.slack_scheduled_message_id as string | null) ?? null,
      slack_reminder_id: (r.slack_reminder_id as string | null) ?? null,
      slack_api_method: (r.slack_api_method as SlackApiMethod | null) ?? null,
      confirmation_channel: (r.confirmation_channel as string | null) ?? null,
      confirmation_ts: (r.confirmation_ts as string | null) ?? null,
      channel: (r.channel as string | null) ?? null,
      thread_ts: (r.thread_ts as string | null) ?? null,
      creator_user_id: (r.creator_user_id as string | null) ?? null,
      target_user_id: (r.target_user_id as string | null) ?? null,
      mentioned_user_ids: (r.mentioned_user_ids as string[] | undefined) ?? [],
      original_text: (r.original_text as string | null) ?? null,
      reminder_text: (r.reminder_text as string | null) ?? null,
      parsed_intent: r.parsed_intent ? JSON.parse(String(r.parsed_intent)) : null,
      scheduled_at: r.scheduled_at ? new Date(String(r.scheduled_at)) : null,
      fired_at: r.fired_at ? new Date(String(r.fired_at)) : null,
      cancelled_at: r.cancelled_at ? new Date(String(r.cancelled_at)) : null,
      cancelled_by: (r.cancelled_by as string | null) ?? null,
      status: (r.status as ReminderStatus) ?? 'scheduled',
      tenant_id: String(r.tenant_id ?? ''),
    };
  } catch (err) {
    logger.warn('getReminderById failed', {
      reminderId,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/**
 * Mark a reminder as fired. Called lazily when a user clicks the cancel
 * button after the scheduled_at has already passed — Slack doesn't notify
 * us when scheduled messages actually fire, so this is our best signal.
 */
export async function markReminderFired(reminderId: string): Promise<void> {
  const sql = `UPDATE ${table()}
               SET status = 'fired',
                   fired_at = COALESCE(scheduled_at, CURRENT_TIMESTAMP()),
                   updated_at = CURRENT_TIMESTAMP()
               WHERE reminder_id = @reminder_id
                 AND status = 'scheduled'`;
  try {
    await getBqClient().executeWrite(sql, { reminder_id: reminderId });
  } catch (err) {
    logger.warn('markReminderFired failed', {
      reminderId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function markReminderCancelled(
  reminderId: string,
  cancelledBy: string,
): Promise<void> {
  const sql = `UPDATE ${table()}
               SET status = 'cancelled',
                   cancelled_at = CURRENT_TIMESTAMP(),
                   cancelled_by = @cancelled_by,
                   updated_at = CURRENT_TIMESTAMP()
               WHERE reminder_id = @reminder_id
                 AND status = 'scheduled'`;
  try {
    await getBqClient().executeWrite(sql, {
      reminder_id: reminderId,
      cancelled_by: cancelledBy,
    });
  } catch (err) {
    logger.warn('markReminderCancelled failed', {
      reminderId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
