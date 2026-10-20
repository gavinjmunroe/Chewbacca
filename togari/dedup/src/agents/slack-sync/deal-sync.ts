/**
 * Deal Sync — BigQuery deal upsert + activity logging for Slack messages.
 *
 * Tables: togari_data_lake.togari_structured_deals, togari_data_lake.activities.
 * Follows the same BigQuery client init pattern as deal-store.ts.
 */

import { BigQuery } from '@google-cloud/bigquery';
import { randomUUID } from 'crypto';
import type { ParsedMessage } from './parser';

// ─── Config ──────────────────────────────────────────────────────────────────

const PROJECT_ID = 'midyear-glazing-485303-u3';
const DATASET = 'togari_data_lake';
const DEALS_TABLE = `\`${PROJECT_ID}.${DATASET}.togari_structured_deals\``;
const ACTIVITIES_TABLE = `\`${PROJECT_ID}.${DATASET}.activities\``;

// ─── BigQuery Client ─────────────────────────────────────────────────────────

function getBqClient(): BigQuery {
  const options: ConstructorParameters<typeof BigQuery>[0] = {
    projectId: PROJECT_ID,
  };
  const gcpBase64 = process.env.GCP_CREDENTIALS_BASE64;
  if (gcpBase64) {
    const decoded = Buffer.from(gcpBase64, 'base64').toString('utf-8');
    options.credentials = JSON.parse(decoded);
  } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    options.keyFilename = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  }
  return new BigQuery(options);
}

// ─── Types ───────────────────────────────────────────────────────────────────

export interface DealSyncResult {
  action: 'created' | 'updated' | 'activity_only';
  deal_id: string;
  deal_name: string;
  previous_stage?: string;
  new_stage?: string;
  activity_id: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function findDealByCompany(
  bq: BigQuery,
  companyName: string,
): Promise<Record<string, unknown> | null> {
  const [rows] = await bq.query({
    query: `
      SELECT deal_id, deal_name, company, stage, pipeline, value, notes, owner
      FROM ${DEALS_TABLE}
      WHERE LOWER(company) LIKE @company_pattern
      ORDER BY updated_at DESC
      LIMIT 1
    `,
    params: { company_pattern: `%${companyName.toLowerCase()}%` },
    useLegacySql: false,
  });
  return rows.length > 0 ? (rows[0] as Record<string, unknown>) : null;
}

async function insertActivity(
  bq: BigQuery,
  params: {
    activity_id: string;
    deal_id: string;
    client_id: string;
    intent: string;
    raw_message: string;
  },
): Promise<void> {
  await bq.query({
    query: `
      INSERT INTO ${ACTIVITIES_TABLE} (
        activity_id, deal_id, client_id, contact_id,
        type, content, timestamp
      ) VALUES (
        @activity_id, @deal_id, @client_id, @contact_id,
        @type, @content, CURRENT_TIMESTAMP()
      )
    `,
    params: {
      activity_id: params.activity_id,
      deal_id: params.deal_id,
      client_id: params.client_id,
      contact_id: '',
      type: params.intent,
      content: params.raw_message,
    },
    types: {
      activity_id: 'STRING',
      deal_id: 'STRING',
      client_id: 'STRING',
      contact_id: 'STRING',
      type: 'STRING',
      content: 'STRING',
    },
    useLegacySql: false,
  });
}

// ─── Main Export ─────────────────────────────────────────────────────────────

export async function syncDeal(
  parsed: ParsedMessage,
  slackUser: string,
  slackChannel: string,
  rawMessage: string,
  clientId: string = 'bma',
): Promise<DealSyncResult> {
  const bq = getBqClient();
  const activityId = randomUUID();
  const companyName = parsed.company.name || parsed.person.company || 'Unknown';

  // Try to find an existing deal by company name
  const existing = await findDealByCompany(bq, companyName);

  let result: DealSyncResult;

  if (existing && parsed.intent === 'update_deal') {
    // ── UPDATE existing deal ──
    const dealId = existing.deal_id as string;
    const previousStage = existing.stage as string;
    const now = new Date().toISOString();
    const datePrefix = now.split('T')[0];

    const setClauses: string[] = ['updated_at = @updated_at'];
    const queryParams: Record<string, unknown> = {
      deal_id: dealId,
      updated_at: now,
    };

    if (parsed.deal.stage) {
      setClauses.push('stage = @stage');
      queryParams.stage = parsed.deal.stage;
    }
    if (parsed.deal.value !== undefined && parsed.deal.value !== null) {
      setClauses.push('value = @value');
      queryParams.value = parsed.deal.value;
    }
    if (parsed.deal.pipeline) {
      setClauses.push('pipeline = @pipeline');
      queryParams.pipeline = parsed.deal.pipeline;
    }
    // Always append the raw Slack message to notes
    setClauses.push(
      "notes = CASE WHEN notes IS NULL OR notes = '' THEN @note_text ELSE CONCAT(notes, '\\n', @note_text) END",
    );
    queryParams.note_text = `[${datePrefix}] ${rawMessage}`;
    if (parsed.deal.next_action) {
      setClauses.push('next_action = @next_action');
      queryParams.next_action = parsed.deal.next_action;
    }
    if (parsed.deal.next_action_date) {
      setClauses.push('next_action_date = DATE(@next_action_date)');
      queryParams.next_action_date = parsed.deal.next_action_date;
    }
    if (parsed.person.name) {
      const fullName = parsed.person.name;
      const spaceIdx = fullName.indexOf(' ');
      setClauses.push('contact_full_name = @contact_full_name');
      queryParams.contact_full_name = fullName;
      setClauses.push('contact_first_name = @contact_first_name');
      queryParams.contact_first_name = spaceIdx > 0 ? fullName.substring(0, spaceIdx) : fullName;
      setClauses.push('contact_last_name = @contact_last_name');
      queryParams.contact_last_name = spaceIdx > 0 ? fullName.substring(spaceIdx + 1) : null;
    }
    if (parsed.person.email) {
      setClauses.push('contact_email = @contact_email');
      queryParams.contact_email = parsed.person.email;
    }

    await bq.query({
      query: `UPDATE ${DEALS_TABLE} SET ${setClauses.join(', ')} WHERE deal_id = @deal_id`,
      params: queryParams,
      useLegacySql: false,
    });

    result = {
      action: 'updated',
      deal_id: dealId,
      deal_name: existing.deal_name as string,
      previous_stage: previousStage,
      new_stage: parsed.deal.stage || previousStage,
      activity_id: activityId,
    };
  } else if (!existing || parsed.intent === 'new_deal') {
    // ── INSERT new deal ──
    const dealId = randomUUID();
    const now = new Date().toISOString();
    const dealName = `${companyName} - ${parsed.deal.pipeline || 'outbound'}`;
    const defaultNextDate = new Date(Date.now() + 7 * 86400000)
      .toISOString()
      .split('T')[0];

    const contactFullName = parsed.person.name ?? null;
    const spaceIdx = contactFullName ? contactFullName.indexOf(' ') : -1;
    const contactFirstName = contactFullName
      ? (spaceIdx > 0 ? contactFullName.substring(0, spaceIdx) : contactFullName)
      : null;
    const contactLastName = contactFullName && spaceIdx > 0
      ? contactFullName.substring(spaceIdx + 1)
      : null;

    await bq.query({
      query: `
        INSERT INTO ${DEALS_TABLE} (
          deal_id, client_id, deal_name, company,
          value, stage, pipeline, owner,
          notes, next_action, next_action_date,
          created_at, updated_at,
          contact_full_name, contact_first_name, contact_last_name,
          contact_email, contact_linkedin, deal_source
        ) VALUES (
          @deal_id, @client_id, @deal_name, @company,
          @value, @stage, @pipeline, @owner,
          @notes, @next_action, DATE(@next_action_date),
          @created_at, @updated_at,
          @contact_full_name, @contact_first_name, @contact_last_name,
          @contact_email, @contact_linkedin, @deal_source
        )
      `,
      params: {
        deal_id: dealId,
        client_id: clientId,
        deal_name: dealName,
        company: companyName,
        value: parsed.deal.value ?? null,
        pipeline: parsed.deal.pipeline || 'outbound',
        stage: parsed.deal.stage || 'researching',
        owner: slackUser,
        notes: rawMessage,
        next_action: parsed.deal.next_action || 'Follow up',
        next_action_date: parsed.deal.next_action_date || defaultNextDate,
        created_at: now,
        updated_at: now,
        contact_full_name: contactFullName,
        contact_first_name: contactFirstName,
        contact_last_name: contactLastName,
        contact_email: parsed.person.email ?? null,
        contact_linkedin: null,
        deal_source: 'slack',
      },
      types: {
        deal_id: 'STRING',
        client_id: 'STRING',
        deal_name: 'STRING',
        company: 'STRING',
        value: 'FLOAT64',
        pipeline: 'STRING',
        stage: 'STRING',
        owner: 'STRING',
        notes: 'STRING',
        next_action: 'STRING',
        next_action_date: 'STRING',
        created_at: 'STRING',
        updated_at: 'STRING',
        contact_full_name: 'STRING',
        contact_first_name: 'STRING',
        contact_last_name: 'STRING',
        contact_email: 'STRING',
        contact_linkedin: 'STRING',
        deal_source: 'STRING',
      },
      useLegacySql: false,
    });

    result = {
      action: 'created',
      deal_id: dealId,
      deal_name: dealName,
      new_stage: parsed.deal.stage || 'researching',
      activity_id: activityId,
    };
  } else {
    // ── Activity only (log_activity, schedule_meeting, set_reminder on existing deal) ──
    result = {
      action: 'activity_only',
      deal_id: (existing.deal_id as string) || 'unknown',
      deal_name: (existing.deal_name as string) || companyName,
      activity_id: activityId,
    };
  }

  // Always log an activity record
  await insertActivity(bq, {
    activity_id: activityId,
    deal_id: result.deal_id,
    client_id: clientId,
    intent: parsed.intent,
    raw_message: rawMessage,
  });

  return result;
}
