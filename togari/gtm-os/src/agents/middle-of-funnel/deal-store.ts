/**
 * Deal Store — BigQuery persistence layer for the togari_structured_deals table.
 *
 * Actual BigQuery schema (togari_data_lake.togari_structured_deals):
 *   deal_id (STRING), client_id (STRING), deal_name (STRING), company (STRING),
 *   contact_ids (REPEATED STRING), value (FLOAT64), stage (STRING), pipeline (STRING),
 *   owner (STRING), close_date (DATE), notes (STRING), next_action (STRING),
 *   next_action_date (DATE), created_at (TIMESTAMP), updated_at (TIMESTAMP),
 *   contact_full_name (STRING), contact_first_name (STRING), contact_last_name (STRING),
 *   contact_email (STRING), contact_linkedin (STRING), deal_source (STRING),
 *   deal_duration (STRING), deal_amount_cycle (STRING)
 */

import { BigQuery } from '@google-cloud/bigquery';
import { randomUUID } from 'crypto';
import { getRequestClientId } from '../../middleware/auth.js';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface DealRecord {
  deal_id: string;
  client_id: string | null;
  deal_name: string;
  company: string;
  contact_ids: string[];
  value: number | null;
  pipeline: 'partnerships' | 'inbound' | 'outbound';
  stage: string;
  owner: string;
  close_date: string | null;
  notes: string | null;
  next_action: string;
  next_action_date: string;
  created_at: string;
  updated_at: string;
  // Contact fields (from merged external deals)
  contact_full_name: string | null;
  contact_first_name: string | null;
  contact_last_name: string | null;
  contact_email: string | null;
  contact_linkedin: string | null;
  // Deal metadata (from merged external deals)
  deal_source: string | null;
  deal_duration: string | null;
  deal_amount_cycle: string | null;
}

export interface CreateDealParams {
  deal_name: string;
  company: string;
  client_id?: string;
  contact_ids?: string[];
  pipeline: 'partnerships' | 'inbound' | 'outbound';
  stage: string;
  owner: string;
  value?: number;
  close_date?: string;
  notes?: string;
  next_action: string;
  next_action_date: string;
  // Contact fields (optional)
  contact_full_name?: string;
  contact_first_name?: string;
  contact_last_name?: string;
  contact_email?: string;
  contact_linkedin?: string;
  // Deal metadata (optional)
  deal_source?: string;
  deal_duration?: string;
  deal_amount_cycle?: string;
}

export interface UpdateDealParams {
  deal_id: string;
  deal_name?: string;
  stage?: string;
  owner?: string;
  value?: number;
  close_date?: string;
  next_action?: string;
  next_action_date?: string;
  /** Appended to existing notes with a newline separator */
  notes?: string;
  // Contact fields
  contact_full_name?: string;
  contact_first_name?: string;
  contact_last_name?: string;
  contact_email?: string;
  contact_linkedin?: string;
  // Deal metadata
  deal_source?: string;
  deal_duration?: string;
  deal_amount_cycle?: string;
}

export interface SearchDealsParams {
  query: string;
  pipeline?: 'partnerships' | 'inbound' | 'outbound';
}

export interface DealStoreConfig {
  projectId: string;
  dataset: string;
  table: string;
  credentialsPath?: string;
  gcpCredentialsBase64?: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getBqClient(config: DealStoreConfig): BigQuery {
  const options: ConstructorParameters<typeof BigQuery>[0] = {
    projectId: config.projectId,
  };
  if (config.gcpCredentialsBase64) {
    const decoded = Buffer.from(config.gcpCredentialsBase64, 'base64').toString('utf-8');
    options.credentials = JSON.parse(decoded);
  } else if (config.credentialsPath) {
    options.keyFilename = config.credentialsPath;
  }
  return new BigQuery(options);
}

function fqTable(config: DealStoreConfig): string {
  return `\`${config.projectId}.${config.dataset}.${config.table}\``;
}

// ─── createDeal ───────────────────────────────────────────────────────────────

export async function createDeal(
  config: DealStoreConfig,
  params: CreateDealParams,
): Promise<{ deal_id: string; created_at: string }> {
  const bq = getBqClient(config);
  const deal_id = randomUUID();
  const now = new Date().toISOString();

  // Prefer the JWT-injected client_id from the async context; fall back to
  // the explicitly-passed param (useful in stdio / test mode with TENANT_ID).
  const client_id = getRequestClientId() ?? params.client_id ?? null;

  const closeDateSql = params.close_date ? 'DATE(@close_date)' : 'NULL';

  await bq.query({
    query: `
      INSERT INTO ${fqTable(config)} (
        deal_id, client_id, deal_name, company, contact_ids,
        value, pipeline, stage, owner, close_date,
        notes, next_action, next_action_date,
        created_at, updated_at,
        contact_full_name, contact_first_name, contact_last_name,
        contact_email, contact_linkedin,
        deal_source, deal_duration, deal_amount_cycle
      ) VALUES (
        @deal_id, @client_id, @deal_name, @company, @contact_ids,
        @value, @pipeline, @stage, @owner, ${closeDateSql},
        @notes, @next_action, DATE(@next_action_date),
        @created_at, @updated_at,
        @contact_full_name, @contact_first_name, @contact_last_name,
        @contact_email, @contact_linkedin,
        @deal_source, @deal_duration, @deal_amount_cycle
      )
    `,
    params: {
      deal_id,
      client_id,
      deal_name: params.deal_name,
      company: params.company,
      contact_ids: params.contact_ids ?? [],
      value: params.value ?? null,
      pipeline: params.pipeline,
      stage: params.stage,
      owner: params.owner,
      ...(params.close_date && { close_date: params.close_date }),
      notes: params.notes ?? null,
      next_action: params.next_action,
      next_action_date: params.next_action_date,
      created_at: now,
      updated_at: now,
      contact_full_name: params.contact_full_name ?? null,
      contact_first_name: params.contact_first_name ?? null,
      contact_last_name: params.contact_last_name ?? null,
      contact_email: params.contact_email ?? null,
      contact_linkedin: params.contact_linkedin ?? null,
      deal_source: params.deal_source ?? null,
      deal_duration: params.deal_duration ?? null,
      deal_amount_cycle: params.deal_amount_cycle ?? null,
    },
    types: {
      deal_id: 'STRING',
      client_id: 'STRING',
      deal_name: 'STRING',
      company: 'STRING',
      contact_ids: ['STRING'],
      value: 'FLOAT64',
      pipeline: 'STRING',
      stage: 'STRING',
      owner: 'STRING',
      ...(params.close_date && { close_date: 'STRING' }),
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
      deal_duration: 'STRING',
      deal_amount_cycle: 'STRING',
    },
    useLegacySql: false,
  });

  return { deal_id, created_at: now };
}

// ─── updateDeal ───────────────────────────────────────────────────────────────

export async function updateDeal(
  config: DealStoreConfig,
  params: UpdateDealParams,
): Promise<{ deal_id: string; fields_updated: string[]; updated_at: string }> {
  const bq = getBqClient(config);
  const table = fqTable(config);
  const now = new Date().toISOString();

  const [existingRows] = await bq.query({
    query: `SELECT deal_id FROM ${table} WHERE deal_id = @deal_id LIMIT 1`,
    params: { deal_id: params.deal_id },
    useLegacySql: false,
  });

  if (!existingRows || existingRows.length === 0) {
    throw new Error(`Deal not found: ${params.deal_id}. Run mof_deal_search to locate the correct deal_id.`);
  }

  const setClauses: string[] = ['updated_at = @updated_at'];
  const queryParams: Record<string, unknown> = {
    deal_id: params.deal_id,
    updated_at: now,
  };
  const fieldsUpdated: string[] = [];

  if (params.deal_name !== undefined) {
    setClauses.push('deal_name = @deal_name');
    queryParams['deal_name'] = params.deal_name;
    fieldsUpdated.push('deal_name');
  }
  if (params.stage !== undefined) {
    setClauses.push('stage = @stage');
    queryParams['stage'] = params.stage;
    fieldsUpdated.push('stage');
  }
  if (params.owner !== undefined) {
    setClauses.push('owner = @owner');
    queryParams['owner'] = params.owner;
    fieldsUpdated.push('owner');
  }
  if (params.value !== undefined) {
    setClauses.push('value = @value');
    queryParams['value'] = params.value;
    fieldsUpdated.push('value');
  }
  if (params.close_date !== undefined) {
    setClauses.push('close_date = DATE(@close_date)');
    queryParams['close_date'] = params.close_date;
    fieldsUpdated.push('close_date');
  }
  if (params.next_action !== undefined) {
    setClauses.push('next_action = @next_action');
    queryParams['next_action'] = params.next_action;
    fieldsUpdated.push('next_action');
  }
  if (params.next_action_date !== undefined) {
    setClauses.push('next_action_date = DATE(@next_action_date)');
    queryParams['next_action_date'] = params.next_action_date;
    fieldsUpdated.push('next_action_date');
  }
  if (params.notes !== undefined) {
    // Append to existing notes with newline separator
    setClauses.push(
      'notes = CASE WHEN notes IS NULL OR notes = \'\' THEN @note_text ELSE CONCAT(notes, \'\\n\', @note_text) END',
    );
    queryParams['note_text'] = params.notes;
    fieldsUpdated.push('notes');
  }
  for (const field of [
    'contact_full_name', 'contact_first_name', 'contact_last_name',
    'contact_email', 'contact_linkedin',
    'deal_source', 'deal_duration', 'deal_amount_cycle',
  ] as const) {
    if (params[field] !== undefined) {
      setClauses.push(`${field} = @${field}`);
      queryParams[field] = params[field];
      fieldsUpdated.push(field);
    }
  }

  await bq.query({
    query: `UPDATE ${table} SET ${setClauses.join(', ')} WHERE deal_id = @deal_id`,
    params: queryParams,
    useLegacySql: false,
  });

  return { deal_id: params.deal_id, fields_updated: fieldsUpdated, updated_at: now };
}

// ─── searchDeals ─────────────────────────────────────────────────────────────

export async function searchDeals(
  config: DealStoreConfig,
  params: SearchDealsParams,
): Promise<DealRecord[]> {
  const bq = getBqClient(config);
  const table = fqTable(config);

  const q = `%${params.query.toLowerCase()}%`;
  const queryParams: Record<string, unknown> = { q };

  let sql = `
    SELECT
      deal_id, client_id, deal_name, company, contact_ids,
      value, pipeline, stage, owner,
      CAST(close_date AS STRING) AS close_date,
      notes, next_action,
      CAST(next_action_date AS STRING) AS next_action_date,
      CAST(created_at AS STRING) AS created_at,
      CAST(updated_at AS STRING) AS updated_at,
      contact_full_name, contact_first_name, contact_last_name,
      contact_email, contact_linkedin,
      deal_source, deal_duration, deal_amount_cycle
    FROM ${table}
    WHERE (
      LOWER(company) LIKE @q
      OR LOWER(deal_name) LIKE @q
      OR LOWER(owner) LIKE @q
      OR LOWER(COALESCE(contact_full_name, '')) LIKE @q
      OR LOWER(COALESCE(contact_email, '')) LIKE @q
    )
  `;

  if (params.pipeline) {
    sql += ' AND pipeline = @pipeline';
    queryParams['pipeline'] = params.pipeline;
  }

  sql += ' ORDER BY updated_at DESC LIMIT 10';

  const [rows] = await bq.query({ query: sql, params: queryParams, useLegacySql: false });
  return rows as DealRecord[];
}

// ─── listDeals ──────────────────────────────────────────────────────────────

export interface ListDealsOptions {
  pipeline?: 'partnerships' | 'inbound' | 'outbound';
  owner?: string;
  since?: string;
  excludeTerminal?: boolean;
}

export interface DealWithFlags extends DealRecord {
  days_since_update: number;
  is_overdue: boolean;
  is_stale: boolean;
}

export async function listDeals(
  config: DealStoreConfig,
  options: ListDealsOptions = {},
): Promise<DealWithFlags[]> {
  const bq = getBqClient(config);
  const table = fqTable(config);
  const queryParams: Record<string, unknown> = {};
  const whereClauses: string[] = [];

  if (options.pipeline) {
    whereClauses.push('pipeline = @pipeline');
    queryParams['pipeline'] = options.pipeline;
  }
  if (options.owner) {
    whereClauses.push('LOWER(owner) = LOWER(@owner)');
    queryParams['owner'] = options.owner;
  }
  if (options.since) {
    whereClauses.push('updated_at >= @since');
    queryParams['since'] = options.since;
  }
  if (options.excludeTerminal) {
    whereClauses.push("stage NOT IN ('closed_won','closed_lost','not_a_fit','nurture')");
  }

  const whereSQL = whereClauses.length > 0
    ? `WHERE ${whereClauses.join(' AND ')}`
    : '';

  const sql = `
    SELECT
      deal_id, client_id, deal_name, company, contact_ids,
      value, pipeline, stage, owner,
      CAST(close_date AS STRING) AS close_date,
      notes, next_action,
      CAST(next_action_date AS STRING) AS next_action_date,
      CAST(created_at AS STRING) AS created_at,
      CAST(updated_at AS STRING) AS updated_at,
      contact_full_name, contact_first_name, contact_last_name,
      contact_email, contact_linkedin,
      deal_source, deal_duration, deal_amount_cycle,
      DATE_DIFF(CURRENT_DATE(), DATE(updated_at), DAY) AS days_since_update,
      next_action_date < CURRENT_DATE() AS is_overdue,
      CASE
        WHEN pipeline = 'outbound'
          THEN DATE_DIFF(CURRENT_DATE(), DATE(updated_at), DAY) > 7
        ELSE DATE_DIFF(CURRENT_DATE(), DATE(updated_at), DAY) > 14
      END AS is_stale
    FROM ${table}
    ${whereSQL}
    ORDER BY stage, next_action_date
  `;

  const [rows] = await bq.query({ query: sql, params: queryParams, useLegacySql: false });
  return rows as DealWithFlags[];
}

// ─── getPipelineMetrics ─────────────────────────────────────────────────────

export interface PipelineMetricsOptions {
  pipeline?: 'all' | 'partnerships' | 'inbound' | 'outbound';
  startDate: string;
  endDate: string;
}

export interface StageCount { stage: string; count: number }

export interface PipelineMetrics {
  pipeline: string;
  createdInPeriod: number;
  activeDeals: number;
  closedWon: number;
  closedLost: number;
  winRate: number | null;
  avgCycleDays: number | null;
  overdueCount: number;
  byStage: StageCount[];
}

export async function getPipelineMetrics(
  config: DealStoreConfig,
  options: PipelineMetricsOptions,
): Promise<PipelineMetrics[]> {
  const bq = getBqClient(config);
  const table = fqTable(config);
  const pipelineFilter = options.pipeline && options.pipeline !== 'all'
    ? 'WHERE pipeline = @pipeline'
    : '';
  const baseParams: Record<string, unknown> = {
    start_date: options.startDate,
    end_date: options.endDate,
  };
  if (options.pipeline && options.pipeline !== 'all') {
    baseParams['pipeline'] = options.pipeline;
  }

  const [aggRows] = await bq.query({
    query: `
      SELECT
        pipeline,
        COUNTIF(DATE(created_at) BETWEEN @start_date AND @end_date) AS created_in_period,
        COUNTIF(stage NOT IN ('closed_won','closed_lost','not_a_fit','nurture')) AS active_deals,
        COUNTIF(stage = 'closed_won' AND DATE(updated_at) BETWEEN @start_date AND @end_date) AS closed_won,
        COUNTIF(stage = 'closed_lost' AND DATE(updated_at) BETWEEN @start_date AND @end_date) AS closed_lost,
        AVG(CASE WHEN stage = 'closed_won' AND DATE(updated_at) BETWEEN @start_date AND @end_date
             THEN DATE_DIFF(DATE(updated_at), DATE(created_at), DAY) END) AS avg_cycle_days,
        COUNTIF(next_action_date < CURRENT_DATE()
          AND stage NOT IN ('closed_won','closed_lost','not_a_fit','nurture')) AS overdue_count
      FROM ${table}
      ${pipelineFilter}
      GROUP BY pipeline
    `,
    params: baseParams,
    useLegacySql: false,
  });

  const [stageRows] = await bq.query({
    query: `
      SELECT pipeline, stage, COUNT(*) AS cnt
      FROM ${table}
      ${pipelineFilter}
      GROUP BY pipeline, stage
    `,
    params: baseParams,
    useLegacySql: false,
  });

  type AggRow = Record<string, unknown>;
  return (aggRows as AggRow[]).map((row) => {
    const pl = row['pipeline'] as string;
    const won = Number(row['closed_won'] ?? 0);
    const lost = Number(row['closed_lost'] ?? 0);
    const totalClosed = won + lost;

    const stages = (stageRows as AggRow[])
      .filter((s) => s['pipeline'] === pl)
      .map((s) => ({ stage: s['stage'] as string, count: Number(s['cnt']) }));

    return {
      pipeline: pl,
      createdInPeriod: Number(row['created_in_period'] ?? 0),
      activeDeals: Number(row['active_deals'] ?? 0),
      closedWon: won,
      closedLost: lost,
      winRate: totalClosed > 0 ? Math.round((won / totalClosed) * 100) : null,
      avgCycleDays: row['avg_cycle_days'] != null ? Math.round(Number(row['avg_cycle_days'])) : null,
      overdueCount: Number(row['overdue_count'] ?? 0),
      byStage: stages,
    };
  });
}

// ─── getRepMetrics ──────────────────────────────────────────────────────────

export interface RepMetricsOptions {
  reps?: string[];
  startDate: string;
  endDate: string;
}

export interface RepStallStage { stage: string; count: number }

export interface RepMetrics {
  owner: string;
  totalOwned: number;
  createdInPeriod: number;
  wonInPeriod: number;
  lostInPeriod: number;
  winRate: number | null;
  avgCycleDays: number | null;
  overdueActions: number;
  staleDeals: number;
  stallStage: RepStallStage | null;
  byStage: StageCount[];
}

export async function getRepMetrics(
  config: DealStoreConfig,
  options: RepMetricsOptions,
): Promise<RepMetrics[]> {
  const bq = getBqClient(config);
  const table = fqTable(config);
  const hasRepFilter = options.reps && options.reps.length > 0;
  const repFilter = hasRepFilter
    ? 'WHERE LOWER(owner) IN UNNEST(@rep_list)'
    : '';
  const baseParams: Record<string, unknown> = {
    start_date: options.startDate,
    end_date: options.endDate,
  };
  if (hasRepFilter) {
    baseParams['rep_list'] = options.reps!.map((r) => r.toLowerCase());
  }

  const [repRows] = await bq.query({
    query: `
      SELECT
        owner,
        COUNT(*) AS total_owned,
        COUNTIF(DATE(created_at) BETWEEN @start_date AND @end_date) AS created_in_period,
        COUNTIF(stage = 'closed_won' AND DATE(updated_at) BETWEEN @start_date AND @end_date) AS won_in_period,
        COUNTIF(stage = 'closed_lost' AND DATE(updated_at) BETWEEN @start_date AND @end_date) AS lost_in_period,
        AVG(CASE WHEN stage = 'closed_won' AND DATE(updated_at) BETWEEN @start_date AND @end_date
             THEN DATE_DIFF(DATE(updated_at), DATE(created_at), DAY) END) AS avg_cycle_days,
        COUNTIF(next_action_date < CURRENT_DATE()
          AND stage NOT IN ('closed_won','closed_lost','not_a_fit','nurture')) AS overdue_actions,
        COUNTIF(DATE_DIFF(CURRENT_DATE(), DATE(updated_at), DAY) > 14
          AND stage NOT IN ('closed_won','closed_lost','not_a_fit','nurture')) AS stale_deals
      FROM ${table}
      ${repFilter}
      GROUP BY owner
    `,
    params: baseParams,
    useLegacySql: false,
  });

  const [stageRows] = await bq.query({
    query: `
      SELECT owner, stage, COUNT(*) AS cnt
      FROM ${table}
      WHERE stage NOT IN ('closed_won','closed_lost','not_a_fit','nurture')
        ${hasRepFilter ? 'AND LOWER(owner) IN UNNEST(@rep_list)' : ''}
      GROUP BY owner, stage
      ORDER BY owner, cnt DESC
    `,
    params: baseParams,
    useLegacySql: false,
  });

  type Row = Record<string, unknown>;
  const stagesByOwner = new Map<string, StageCount[]>();
  for (const s of stageRows as Row[]) {
    const o = s['owner'] as string;
    if (!stagesByOwner.has(o)) stagesByOwner.set(o, []);
    stagesByOwner.get(o)!.push({ stage: s['stage'] as string, count: Number(s['cnt']) });
  }

  return (repRows as Row[]).map((row) => {
    const o = row['owner'] as string;
    const won = Number(row['won_in_period'] ?? 0);
    const lost = Number(row['lost_in_period'] ?? 0);
    const totalClosed = won + lost;
    const stages = stagesByOwner.get(o) ?? [];
    const stall = stages.length > 0 ? { stage: stages[0].stage, count: stages[0].count } : null;

    return {
      owner: o,
      totalOwned: Number(row['total_owned'] ?? 0),
      createdInPeriod: Number(row['created_in_period'] ?? 0),
      wonInPeriod: won,
      lostInPeriod: lost,
      winRate: totalClosed > 0 ? Math.round((won / totalClosed) * 100) : null,
      avgCycleDays: row['avg_cycle_days'] != null ? Math.round(Number(row['avg_cycle_days'])) : null,
      overdueActions: Number(row['overdue_actions'] ?? 0),
      staleDeals: Number(row['stale_deals'] ?? 0),
      stallStage: stall,
      byStage: stages,
    };
  });
}
