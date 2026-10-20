/**
 * Phase 1.5a — Capture every currently-scheduled reminder into
 * togari_data_lake.reminders_migration_staging so 1.5c can migrate
 * them without loss.
 *
 * CRITICAL: this script is READ-ONLY on source systems. It does NOT
 * delete, modify, or reschedule any Slack scheduled message — it only
 * enumerates and records. Existing reminders continue firing via
 * Slack's own delivery.
 *
 * Idempotent via a parameterized MERGE on (source_medium, source_id).
 * Re-running does NOT create duplicate rows.
 *
 * Usage:
 *   SLACK_BOT_TOKEN=xoxb-...  \
 *   GCP_CREDENTIALS_BASE64=... \
 *   npx tsx src/scripts/capture-reminders.ts
 *
 * Pagination: fully implemented against chat.scheduledMessages.list.
 * Rate limit: Slack Tier 3 = 50 req/min. We pace ~1 req per 1300ms to
 * stay well clear, which is more than enough for a single-tenant BMA
 * bot with tens-of-reminders volume.
 */

import { randomUUID } from 'crypto';
import { BigQueryClient } from '../bigquery/client';

const PROJECT_ID = 'midyear-glazing-485303-u3';
const DATASET = 'togari_data_lake';
const STAGING_TABLE = `\`${PROJECT_ID}.${DATASET}.reminders_migration_staging\``;

const PAGE_SIZE = 200;
const RATE_LIMIT_DELAY_MS = 1300; // well under Slack Tier 3 (50/min = 1200ms floor)

interface SlackScheduledMessage {
  id: string;
  channel_id: string;
  post_at: number;
  date_created: number;
  text: string;
}

interface SlackListResponse {
  ok: boolean;
  error?: string;
  scheduled_messages?: SlackScheduledMessage[];
  response_metadata?: { next_cursor?: string };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getBqClient(): BigQueryClient {
  return new BigQueryClient(
    PROJECT_ID,
    null,
    process.env.GCP_CREDENTIALS_BASE64 || process.env.GOOGLE_CREDENTIALS_BASE64 || null,
  );
}

async function fetchScheduledMessagesPage(
  token: string,
  cursor: string | null,
): Promise<SlackListResponse> {
  const body: Record<string, unknown> = { limit: PAGE_SIZE };
  if (cursor) body.cursor = cursor;

  const res = await fetch('https://slack.com/api/chat.scheduledMessages.list', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  let parsed: SlackListResponse;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`Slack returned non-JSON response (status ${res.status}): ${text.slice(0, 200)}`);
  }
  if (!res.ok || !parsed.ok) {
    throw new Error(`Slack API error: ${parsed.error ?? `HTTP ${res.status}`}`);
  }
  return parsed;
}

/**
 * Upsert a single staging row. Parameterized MERGE — the only write
 * form BigQuery exposes for "INSERT or UPDATE on conflict".
 */
async function upsertStagingRow(
  bq: BigQueryClient,
  row: {
    staging_id: string;
    source_medium: string;
    source_id: string;
    original_creator: string | null;
    original_text: string;
    fire_at_iso: string;
    channel_or_recipient: string;
    raw_payload_json: string;
  },
): Promise<void> {
  await bq.executeWrite(
    `MERGE ${STAGING_TABLE} T
     USING (
       SELECT
         @staging_id            AS staging_id,
         @source_medium         AS source_medium,
         @source_id             AS source_id,
         @original_creator      AS original_creator,
         @original_text         AS original_text,
         TIMESTAMP(@fire_at)    AS fire_at,
         @channel_or_recipient  AS channel_or_recipient,
         PARSE_JSON(@raw_payload) AS raw_payload
     ) S
     ON T.source_medium = S.source_medium AND T.source_id = S.source_id
     WHEN MATCHED THEN UPDATE SET
       original_creator     = S.original_creator,
       original_text        = S.original_text,
       fire_at              = S.fire_at,
       channel_or_recipient = S.channel_or_recipient,
       raw_payload          = S.raw_payload
     WHEN NOT MATCHED THEN INSERT (
       staging_id, source_medium, source_id, original_creator, original_text,
       fire_at, channel_or_recipient, raw_payload, captured_at,
       migrated_to_new_system, migrated_at
     ) VALUES (
       S.staging_id, S.source_medium, S.source_id, S.original_creator, S.original_text,
       S.fire_at, S.channel_or_recipient, S.raw_payload, CURRENT_TIMESTAMP(),
       FALSE, NULL
     )`,
    {
      staging_id: row.staging_id,
      source_medium: row.source_medium,
      source_id: row.source_id,
      original_creator: row.original_creator,
      original_text: row.original_text,
      fire_at: row.fire_at_iso,
      channel_or_recipient: row.channel_or_recipient,
      raw_payload: row.raw_payload_json,
    },
  );
}

async function captureSlackScheduledMessages(token: string, bq: BigQueryClient): Promise<number> {
  let cursor: string | null = null;
  let total = 0;
  let page = 0;

  while (true) {
    page++;
    const resp = await fetchScheduledMessagesPage(token, cursor);
    const batch = resp.scheduled_messages ?? [];
    console.log(`[capture] page ${page}: fetched ${batch.length} messages`);

    for (const msg of batch) {
      const fireAt = new Date(msg.post_at * 1000).toISOString();
      try {
        await upsertStagingRow(bq, {
          staging_id: randomUUID(),
          source_medium: 'slack_scheduled',
          source_id: msg.id,
          original_creator: null,  // Slack doesn't return the creator on this endpoint
          original_text: msg.text ?? '',
          fire_at_iso: fireAt,
          channel_or_recipient: msg.channel_id ?? '',
          raw_payload_json: JSON.stringify(msg),
        });
        total++;
        if (total % 100 === 0) {
          console.log(`[capture] progress: ${total} captured`);
        }
      } catch (err) {
        console.error(`[capture] failed for message ${msg.id}:`, err instanceof Error ? err.message : err);
        throw err; // abort — partial capture is worse than no capture
      }
    }

    cursor = resp.response_metadata?.next_cursor || null;
    if (!cursor) break;

    // Tier 3 rate limit: pace requests to avoid 429s even on re-runs.
    await sleep(RATE_LIMIT_DELAY_MS);
  }

  return total;
}

async function main(): Promise<void> {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) {
    console.error('SLACK_BOT_TOKEN is required.');
    process.exit(1);
  }

  const bq = getBqClient();

  console.log('Starting Phase 1.5a reminder capture.');
  console.log('  source_medium = slack_scheduled');
  console.log('  dataset       = togari_data_lake.reminders_migration_staging');
  console.log('');

  const slackCount = await captureSlackScheduledMessages(token, bq);

  console.log('');
  console.log('────────────────────────────────────────');
  console.log(`[capture] slack_scheduled   : ${slackCount} rows`);
  console.log('[capture] bigquery          : 0 rows (medium not in use per Step 0 inventory)');
  console.log('[capture] node_cron         : 0 rows (medium not in use)');
  console.log('[capture] cloud_tasks       : 0 rows (medium not in use)');
  console.log('────────────────────────────────────────');
  console.log(`[capture] TOTAL             : ${slackCount} rows`);
  console.log('');

  // Sanity-verify by counting
  const countResult = await bq.executeQuery(
    `SELECT source_medium, COUNT(*) AS n
     FROM ${STAGING_TABLE}
     GROUP BY source_medium
     ORDER BY source_medium`,
  );
  console.log('Staging table row counts per medium (post-capture):');
  for (const row of countResult.rows) {
    console.log(`  ${row.source_medium}: ${row.n}`);
  }
}

main().catch((err) => {
  console.error('✗ Capture failed:', err);
  process.exit(1);
});
