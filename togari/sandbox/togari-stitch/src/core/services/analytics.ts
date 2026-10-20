/**
 * Cross-entity healthcare analytics backed by BigQuery
 *
 * All queries use parameterized client_id — NEVER string-interpolate tenant IDs.
 * Dataset: togari_healthcare
 * Project: midyear-glazing-485303-u3
 */

import { BigQuery } from '@google-cloud/bigquery';
import { createLogger } from '../utils/logger';

const logger = createLogger('analytics');

const GCP_PROJECT_ID = 'midyear-glazing-485303-u3';
const DATASET = 'togari_healthcare';
const QUERY_TIMEOUT_MS = 30_000;

// ---------------------------------------------------------------------------
// BigQuery client (lazy singleton)
// ---------------------------------------------------------------------------

let bqClient: BigQuery | null = null;

function getBQ(): BigQuery {
  if (!bqClient) {
    bqClient = new BigQuery({ projectId: GCP_PROJECT_ID });
  }
  return bqClient;
}

interface QueryOptions {
  timeRange?: { start: string; end: string };
}

async function runQuery<T>(sql: string, params: Record<string, unknown>): Promise<T[]> {
  const bq = getBQ();
  const [rows] = await bq.query({
    query: sql,
    params,
    location: 'us-central1',
    jobTimeoutMs: QUERY_TIMEOUT_MS.toString(),
  });
  return rows as T[];
}

// ---------------------------------------------------------------------------
// Analytics functions
// ---------------------------------------------------------------------------

export interface FunnelRow {
  stage: string;
  count: number;
  avg_score: number;
}

export async function leadFunnel(
  clientId: string,
  timeRange?: { start: string; end: string },
): Promise<FunnelRow[]> {
  let sql = `
    SELECT
      status AS stage,
      COUNT(*) AS count,
      AVG(composite_score) AS avg_score
    FROM \`${GCP_PROJECT_ID}.${DATASET}.persons\`
    WHERE client_id = @clientId
  `;
  const params: Record<string, unknown> = { clientId };
  if (timeRange) {
    sql += ` AND created_at >= @startDate AND created_at <= @endDate`;
    params.startDate = timeRange.start;
    params.endDate = timeRange.end;
  }
  sql += ` GROUP BY status ORDER BY count DESC`;
  return runQuery<FunnelRow>(sql, params);
}

export interface ScoringDistRow {
  tier: string;
  count: number;
  avg_composite: number;
}

export async function scoringDistribution(
  clientId: string,
  timeRange?: { start: string; end: string },
): Promise<ScoringDistRow[]> {
  let sql = `
    SELECT
      scoring_tier AS tier,
      COUNT(*) AS count,
      AVG(composite_score) AS avg_composite
    FROM \`${GCP_PROJECT_ID}.${DATASET}.persons\`
    WHERE client_id = @clientId
  `;
  const params: Record<string, unknown> = { clientId };
  if (timeRange) {
    sql += ` AND created_at >= @startDate AND created_at <= @endDate`;
    params.startDate = timeRange.start;
    params.endDate = timeRange.end;
  }
  sql += ` GROUP BY scoring_tier ORDER BY count DESC`;
  return runQuery<ScoringDistRow>(sql, params);
}

export interface EnrichmentCoverageRow {
  source: string;
  contacts_enriched: number;
  total_contacts: number;
  coverage_pct: number;
  total_cost: number;
}

export async function enrichmentCoverage(clientId: string): Promise<EnrichmentCoverageRow[]> {
  const sql = `
    WITH enriched AS (
      SELECT source, COUNT(DISTINCT entity_id) AS contacts_enriched, SUM(cost_usd) AS total_cost
      FROM \`${GCP_PROJECT_ID}.${DATASET}.enrichment_log\`
      WHERE client_id = @clientId AND entity_type = 'person'
      GROUP BY source
    ),
    total AS (
      SELECT COUNT(*) AS total_contacts
      FROM \`${GCP_PROJECT_ID}.${DATASET}.persons\`
      WHERE client_id = @clientId
    )
    SELECT
      e.source,
      e.contacts_enriched,
      t.total_contacts,
      SAFE_DIVIDE(e.contacts_enriched, t.total_contacts) * 100 AS coverage_pct,
      e.total_cost
    FROM enriched e
    CROSS JOIN total t
    ORDER BY e.contacts_enriched DESC
  `;
  return runQuery<EnrichmentCoverageRow>(sql, { clientId });
}

export interface TouchpointRow {
  type: string;
  count: number;
  sentiment_breakdown: Record<string, number>;
}

export async function touchpointAnalysis(
  clientId: string,
  timeRange?: { start: string; end: string },
): Promise<TouchpointRow[]> {
  let sql = `
    SELECT
      type,
      COUNT(*) AS count,
      COUNTIF(sentiment = 'positive') AS positive,
      COUNTIF(sentiment = 'neutral') AS neutral,
      COUNTIF(sentiment = 'negative') AS negative
    FROM \`${GCP_PROJECT_ID}.${DATASET}.touchpoints\`
    WHERE client_id = @clientId
  `;
  const params: Record<string, unknown> = { clientId };
  if (timeRange) {
    sql += ` AND created_at >= @startDate AND created_at <= @endDate`;
    params.startDate = timeRange.start;
    params.endDate = timeRange.end;
  }
  sql += ` GROUP BY type ORDER BY count DESC`;

  const rows = await runQuery<any>(sql, params);
  return rows.map((r: any) => ({
    type: r.type,
    count: r.count,
    sentiment_breakdown: {
      positive: r.positive || 0,
      neutral: r.neutral || 0,
      negative: r.negative || 0,
    },
  }));
}

export interface VerticalRow {
  vertical: string;
  count: number;
  avg_score: number;
  top_tier_pct: number;
}

export async function verticalBreakdown(clientId: string): Promise<VerticalRow[]> {
  const sql = `
    SELECT
      vertical,
      COUNT(*) AS count,
      AVG(composite_score) AS avg_score,
      SAFE_DIVIDE(COUNTIF(scoring_tier = 'high_touch'), COUNT(*)) * 100 AS top_tier_pct
    FROM \`${GCP_PROJECT_ID}.${DATASET}.persons\`
    WHERE client_id = @clientId
    GROUP BY vertical
    ORDER BY count DESC
  `;
  return runQuery<VerticalRow>(sql, { clientId });
}

export interface ScoringTrendRow {
  scored_at: string;
  composite: number;
  internal: number;
  external: number;
  tier: string;
}

export async function scoringTrend(
  clientId: string,
  personId: string,
  limit: number = 20,
): Promise<ScoringTrendRow[]> {
  const sql = `
    SELECT
      FORMAT_TIMESTAMP('%Y-%m-%dT%H:%M:%SZ', scored_at) AS scored_at,
      composite_score AS composite,
      internal_score AS internal,
      external_score AS external,
      tier
    FROM \`${GCP_PROJECT_ID}.${DATASET}.scoring_history\`
    WHERE client_id = @clientId AND person_id = @personId
    ORDER BY scored_at DESC
    LIMIT @limit
  `;
  return runQuery<ScoringTrendRow>(sql, { clientId, personId, limit });
}
