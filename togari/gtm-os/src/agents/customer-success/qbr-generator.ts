/**
 * CS QBR Generator
 * Generates structured Quarterly Business Reviews from BigQuery data.
 *
 * Queries 90-day windows across deals, activities, pilots, and enrichments.
 * Computes trends by comparing to the previous quarter when data exists.
 * Follows prompt-delegation model: returns structured data, not prose.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp';
import { z } from 'zod';
import { BigQuery } from '@google-cloud/bigquery';

// ─── Zod Schemas ────────────────────────────────────────────────────────────

export const qbrInputSchema = z.object({
  client_id: z.string().describe('BMA tenant client identifier'),
  quarter: z.string().regex(/^Q[1-4]_\d{4}$/).describe('Quarter in format Q1_2026'),
});

export type QbrInput = z.infer<typeof qbrInputSchema>;

const metricEntrySchema = z.object({
  category: z.string(),
  metric: z.string(),
  value: z.union([z.number(), z.string()]),
  trend: z.enum(['up', 'down', 'flat', 'new']),
});

export const qbrOutputSchema = z.object({
  qbr: z.object({
    quarter: z.string(),
    quarter_summary: z.object({
      deals_opened: z.number(),
      deals_closed_won: z.number(),
      deals_closed_lost: z.number(),
      revenue_closed: z.number(),
      pipeline_value: z.number(),
      activities_total: z.number(),
      activities_by_type: z.record(z.string(), z.number()),
      pilots_active: z.number(),
      pilots_completed: z.number(),
      avg_pilot_health: z.number().nullable(),
    }),
    wins: z.array(z.string()),
    risks: z.array(z.string()),
    metrics: z.array(metricEntrySchema),
    recommendations: z.array(z.string()),
    next_quarter_goals: z.array(z.string()),
    comparison_to_prior: z.object({
      deals_opened_delta: z.number().nullable(),
      revenue_delta: z.number().nullable(),
      activities_delta: z.number().nullable(),
    }).nullable(),
  }),
});

export type QbrOutput = z.infer<typeof qbrOutputSchema>;

// ─── Quarter Date Helpers ───────────────────────────────────────────────────

function parseQuarter(quarter: string): { startDate: string; endDate: string } {
  const match = quarter.match(/^Q([1-4])_(\d{4})$/);
  if (!match) throw new Error(`Invalid quarter format: ${quarter}`);
  const q = parseInt(match[1], 10);
  const year = parseInt(match[2], 10);
  const startMonth = (q - 1) * 3 + 1;
  const endMonth = startMonth + 2;
  const lastDay = new Date(year, endMonth, 0).getDate();
  return {
    startDate: `${year}-${String(startMonth).padStart(2, '0')}-01`,
    endDate: `${year}-${String(endMonth).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`,
  };
}

function priorQuarter(quarter: string): string {
  const match = quarter.match(/^Q([1-4])_(\d{4})$/);
  if (!match) throw new Error(`Invalid quarter format: ${quarter}`);
  let q = parseInt(match[1], 10);
  let year = parseInt(match[2], 10);
  q -= 1;
  if (q === 0) { q = 4; year -= 1; }
  return `Q${q}_${year}`;
}

// ─── BigQuery Row Types ─────────────────────────────────────────────────────

interface DealSummaryRow {
  deals_opened: number;
  deals_closed_won: number;
  deals_closed_lost: number;
  revenue_closed: number;
  pipeline_value: number;
  avg_deal_value: number | null;
  deals_moved_stages: number;
}

interface ActivitySummaryRow {
  total_activities: number;
  meetings: number;
  calls: number;
  emails: number;
  notes: number;
  other: number;
}

interface PilotSummaryRow {
  active_pilots: number;
  completed_pilots: number;
  at_risk_pilots: number;
  avg_health_score: number | null;
  milestones_hit: number;
}

interface StalledDealRow {
  deal_name: string;
  stage: string;
  days_stalled: number;
  value: number | null;
}

interface TopDealRow {
  deal_name: string;
  company: string;
  value: number | null;
  stage: string;
}

// ─── BigQuery Helpers ───────────────────────────────────────────────────────

function fqt(table: string): string {
  const project = process.env.GCP_PROJECT_ID ?? 'midyear-glazing-485303-u3';
  const dataset = process.env.BIGQUERY_DATASET ?? 'togari_data_lake';
  return `\`${project}.${dataset}.${table}\``;
}

function getBqClient(): BigQuery {
  const projectId = process.env.GCP_PROJECT_ID;
  const options: ConstructorParameters<typeof BigQuery>[0] = { projectId };

  const gcpCredentialsBase64 = process.env.GCP_CREDENTIALS_BASE64;
  const credentialsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;

  if (gcpCredentialsBase64) {
    const decoded = Buffer.from(gcpCredentialsBase64, 'base64').toString('utf-8');
    options.credentials = JSON.parse(decoded);
  } else if (credentialsPath) {
    options.keyFilename = credentialsPath;
  }

  return new BigQuery(options);
}

async function queryDealSummary(
  bq: BigQuery, clientId: string, startDate: string, endDate: string,
): Promise<DealSummaryRow> {
  const [rows] = await bq.query({
    query: `
      SELECT
        COUNTIF(DATE(created_at) BETWEEN @start_date AND @end_date) AS deals_opened,
        COUNTIF(stage = 'closed_won'
          AND DATE(updated_at) BETWEEN @start_date AND @end_date) AS deals_closed_won,
        COUNTIF(stage = 'closed_lost'
          AND DATE(updated_at) BETWEEN @start_date AND @end_date) AS deals_closed_lost,
        COALESCE(SUM(CASE WHEN stage = 'closed_won'
          AND DATE(updated_at) BETWEEN @start_date AND @end_date THEN value END), 0) AS revenue_closed,
        COALESCE(SUM(CASE WHEN stage NOT IN ('closed_won', 'closed_lost', 'not_a_fit', 'nurture')
          THEN value END), 0) AS pipeline_value,
        AVG(CASE WHEN DATE(created_at) BETWEEN @start_date AND @end_date THEN value END) AS avg_deal_value,
        COUNTIF(DATE(updated_at) BETWEEN @start_date AND @end_date
          AND stage NOT IN ('closed_won', 'closed_lost')) AS deals_moved_stages
      FROM ${fqt('togari_structured_deals')}
      WHERE client_id = @client_id
    `,
    params: { client_id: clientId, start_date: startDate, end_date: endDate },
    useLegacySql: false,
  });
  const row = (rows as Record<string, unknown>[])[0];
  return {
    deals_opened: Number(row?.deals_opened ?? 0),
    deals_closed_won: Number(row?.deals_closed_won ?? 0),
    deals_closed_lost: Number(row?.deals_closed_lost ?? 0),
    revenue_closed: Number(row?.revenue_closed ?? 0),
    pipeline_value: Number(row?.pipeline_value ?? 0),
    avg_deal_value: row?.avg_deal_value != null ? Number(row.avg_deal_value) : null,
    deals_moved_stages: Number(row?.deals_moved_stages ?? 0),
  };
}

async function queryActivitySummary(
  bq: BigQuery, clientId: string, startDate: string, endDate: string,
): Promise<ActivitySummaryRow> {
  const [rows] = await bq.query({
    query: `
      SELECT
        COUNT(*) AS total_activities,
        COUNTIF(a.activity_type = 'meeting_notes') AS meetings,
        COUNTIF(a.activity_type = 'call_summary') AS calls,
        COUNTIF(a.activity_type IN ('email_sent', 'email_received')) AS emails,
        COUNTIF(a.activity_type = 'note') AS notes,
        COUNTIF(a.activity_type NOT IN ('meeting_notes', 'call_summary', 'email_sent', 'email_received', 'note')) AS other
      FROM ${fqt('activities')} a
      JOIN ${fqt('togari_structured_deals')} d ON a.deal_id = d.deal_id
      WHERE d.client_id = @client_id
        AND DATE(a.created_at) BETWEEN @start_date AND @end_date
    `,
    params: { client_id: clientId, start_date: startDate, end_date: endDate },
    useLegacySql: false,
  });
  const row = (rows as Record<string, unknown>[])[0];
  return {
    total_activities: Number(row?.total_activities ?? 0),
    meetings: Number(row?.meetings ?? 0),
    calls: Number(row?.calls ?? 0),
    emails: Number(row?.emails ?? 0),
    notes: Number(row?.notes ?? 0),
    other: Number(row?.other ?? 0),
  };
}

async function queryPilotSummary(
  bq: BigQuery, clientId: string, startDate: string, endDate: string,
): Promise<PilotSummaryRow> {
  const [rows] = await bq.query({
    query: `
      SELECT
        COUNTIF(status = 'active') AS active_pilots,
        COUNTIF(status = 'completed'
          AND DATE(updated_at) BETWEEN @start_date AND @end_date) AS completed_pilots,
        COUNTIF(status = 'at_risk') AS at_risk_pilots,
        AVG(health_score) AS avg_health_score,
        (SELECT COUNT(*) FROM UNNEST(milestones) m WHERE JSON_VALUE(m, '$.status') = 'completed') AS milestones_hit
      FROM ${fqt('pilots')}
      WHERE client_id = @client_id
        AND (DATE(created_at) <= @end_date)
    `,
    params: { client_id: clientId, start_date: startDate, end_date: endDate },
    useLegacySql: false,
  });
  const row = (rows as Record<string, unknown>[])[0];
  return {
    active_pilots: Number(row?.active_pilots ?? 0),
    completed_pilots: Number(row?.completed_pilots ?? 0),
    at_risk_pilots: Number(row?.at_risk_pilots ?? 0),
    avg_health_score: row?.avg_health_score != null ? Number(row.avg_health_score) : null,
    milestones_hit: Number(row?.milestones_hit ?? 0),
  };
}

async function queryStalledDeals(
  bq: BigQuery, clientId: string,
): Promise<StalledDealRow[]> {
  const [rows] = await bq.query({
    query: `
      SELECT
        deal_name, stage, value,
        DATE_DIFF(CURRENT_DATE(), DATE(updated_at), DAY) AS days_stalled
      FROM ${fqt('togari_structured_deals')}
      WHERE client_id = @client_id
        AND stage NOT IN ('closed_won', 'closed_lost', 'not_a_fit', 'nurture')
        AND DATE_DIFF(CURRENT_DATE(), DATE(updated_at), DAY) > 14
      ORDER BY days_stalled DESC
      LIMIT 10
    `,
    params: { client_id: clientId },
    useLegacySql: false,
  });
  return (rows as Record<string, unknown>[]).map(r => ({
    deal_name: String(r.deal_name ?? ''),
    stage: String(r.stage ?? ''),
    days_stalled: Number(r.days_stalled ?? 0),
    value: r.value != null ? Number(r.value) : null,
  }));
}

async function queryTopClosedDeals(
  bq: BigQuery, clientId: string, startDate: string, endDate: string,
): Promise<TopDealRow[]> {
  const [rows] = await bq.query({
    query: `
      SELECT deal_name, company, value, stage
      FROM ${fqt('togari_structured_deals')}
      WHERE client_id = @client_id
        AND stage = 'closed_won'
        AND DATE(updated_at) BETWEEN @start_date AND @end_date
      ORDER BY value DESC
      LIMIT 5
    `,
    params: { client_id: clientId, start_date: startDate, end_date: endDate },
    useLegacySql: false,
  });
  return (rows as Record<string, unknown>[]).map(r => ({
    deal_name: String(r.deal_name ?? ''),
    company: String(r.company ?? ''),
    value: r.value != null ? Number(r.value) : null,
    stage: String(r.stage ?? ''),
  }));
}

// ─── Synthesis Helpers ──────────────────────────────────────────────────────

function generateWins(
  deals: DealSummaryRow,
  pilots: PilotSummaryRow,
  topDeals: TopDealRow[],
): string[] {
  const wins: string[] = [];
  if (deals.deals_closed_won > 0) {
    wins.push(`Closed ${deals.deals_closed_won} deal(s) worth $${deals.revenue_closed.toLocaleString()}.`);
  }
  for (const d of topDeals.slice(0, 3)) {
    wins.push(`Won ${d.deal_name} (${d.company}) — $${(d.value ?? 0).toLocaleString()}.`);
  }
  if (pilots.completed_pilots > 0) {
    wins.push(`Completed ${pilots.completed_pilots} pilot(s) successfully.`);
  }
  if (pilots.milestones_hit > 0) {
    wins.push(`Hit ${pilots.milestones_hit} pilot milestone(s).`);
  }
  if (deals.deals_opened > 5) {
    wins.push(`Strong pipeline generation — ${deals.deals_opened} new deals opened.`);
  }
  return wins.length > 0 ? wins : ['No significant wins to report this quarter.'];
}

function generateRisks(
  deals: DealSummaryRow,
  pilots: PilotSummaryRow,
  activities: ActivitySummaryRow,
  stalledDeals: StalledDealRow[],
): string[] {
  const risks: string[] = [];
  if (stalledDeals.length > 0) {
    const names = stalledDeals.slice(0, 3).map(d => `${d.deal_name} (${d.days_stalled}d)`).join(', ');
    risks.push(`${stalledDeals.length} stalled deal(s): ${names}.`);
  }
  if (deals.deals_closed_lost > deals.deals_closed_won) {
    risks.push(`More deals lost (${deals.deals_closed_lost}) than won (${deals.deals_closed_won}) — review loss reasons.`);
  }
  if (pilots.at_risk_pilots > 0) {
    risks.push(`${pilots.at_risk_pilots} pilot(s) at risk — may need intervention.`);
  }
  if (activities.total_activities < 10) {
    risks.push('Low activity volume this quarter — engagement may be declining.');
  }
  if (activities.meetings === 0) {
    risks.push('Zero meetings logged — face-time with clients is critical.');
  }
  return risks.length > 0 ? risks : ['No significant risks identified.'];
}

function generateRecommendations(
  deals: DealSummaryRow,
  pilots: PilotSummaryRow,
  activities: ActivitySummaryRow,
  stalledDeals: StalledDealRow[],
): string[] {
  const recs: string[] = [];
  if (stalledDeals.length > 0) {
    recs.push(`Prioritize unblocking ${Math.min(stalledDeals.length, 3)} stalled deals with targeted outreach.`);
  }
  if (pilots.at_risk_pilots > 0) {
    recs.push('Conduct pilot health reviews and address blockers before they escalate.');
  }
  if (activities.meetings < 5) {
    recs.push('Increase meeting cadence — target at least 2 client meetings per week next quarter.');
  }
  if (deals.pipeline_value > 0 && deals.deals_closed_won === 0) {
    recs.push(`Convert pipeline — $${deals.pipeline_value.toLocaleString()} in active deals needs close plans.`);
  }
  if (deals.deals_opened < 3) {
    recs.push('Ramp up top-of-funnel — fewer than 3 deals opened this quarter.');
  }
  // Always give at least 3 recommendations
  if (recs.length < 3) {
    recs.push('Review and update ideal customer profile based on this quarter\'s wins and losses.');
  }
  if (recs.length < 3) {
    recs.push('Document and share best practices from successful deals across the team.');
  }
  return recs.slice(0, 5);
}

function generateNextQuarterGoals(
  deals: DealSummaryRow,
  activities: ActivitySummaryRow,
  pilots: PilotSummaryRow,
): string[] {
  const goals: string[] = [];
  // Revenue target: +20% over this quarter, or minimum baseline
  const revenueTarget = deals.revenue_closed > 0
    ? Math.round(deals.revenue_closed * 1.2)
    : 50000;
  goals.push(`Close $${revenueTarget.toLocaleString()} in revenue.`);

  // Deal target
  const dealTarget = Math.max(deals.deals_opened + 2, 5);
  goals.push(`Open ${dealTarget} new deals.`);

  // Activity target
  const activityTarget = Math.max(Math.round(activities.total_activities * 1.3), 20);
  goals.push(`Log ${activityTarget} activities (meetings, calls, emails).`);

  // Pilot goals
  if (pilots.at_risk_pilots > 0) {
    goals.push('Resolve all at-risk pilots — bring health scores above 50.');
  } else if (pilots.active_pilots > 0) {
    goals.push('Complete active pilot(s) and convert to full contracts.');
  } else {
    goals.push('Launch at least 1 new pilot program.');
  }

  goals.push('Reduce average deal cycle time by 10%.');

  return goals.slice(0, 5);
}

function buildMetricsTable(
  deals: DealSummaryRow,
  priorDeals: DealSummaryRow | null,
  activities: ActivitySummaryRow,
  priorActivities: ActivitySummaryRow | null,
  pilots: PilotSummaryRow,
): z.infer<typeof metricEntrySchema>[] {
  function trend(current: number, prior: number | null | undefined): 'up' | 'down' | 'flat' | 'new' {
    if (prior == null) return 'new';
    if (current > prior) return 'up';
    if (current < prior) return 'down';
    return 'flat';
  }

  return [
    { category: 'Pipeline', metric: 'Deals Opened', value: deals.deals_opened, trend: trend(deals.deals_opened, priorDeals?.deals_opened) },
    { category: 'Pipeline', metric: 'Deals Closed Won', value: deals.deals_closed_won, trend: trend(deals.deals_closed_won, priorDeals?.deals_closed_won) },
    { category: 'Pipeline', metric: 'Deals Closed Lost', value: deals.deals_closed_lost, trend: trend(deals.deals_closed_lost, priorDeals?.deals_closed_lost) },
    { category: 'Revenue', metric: 'Revenue Closed', value: `$${deals.revenue_closed.toLocaleString()}`, trend: trend(deals.revenue_closed, priorDeals?.revenue_closed) },
    { category: 'Revenue', metric: 'Pipeline Value', value: `$${deals.pipeline_value.toLocaleString()}`, trend: trend(deals.pipeline_value, priorDeals?.pipeline_value) },
    { category: 'Revenue', metric: 'Avg Deal Value', value: deals.avg_deal_value != null ? `$${Math.round(deals.avg_deal_value).toLocaleString()}` : 'N/A', trend: deals.avg_deal_value != null && priorDeals?.avg_deal_value != null ? trend(deals.avg_deal_value, priorDeals.avg_deal_value) : 'new' },
    { category: 'Activity', metric: 'Total Activities', value: activities.total_activities, trend: trend(activities.total_activities, priorActivities?.total_activities) },
    { category: 'Activity', metric: 'Meetings', value: activities.meetings, trend: trend(activities.meetings, priorActivities?.meetings) },
    { category: 'Activity', metric: 'Calls', value: activities.calls, trend: trend(activities.calls, priorActivities?.calls) },
    { category: 'Activity', metric: 'Emails', value: activities.emails, trend: trend(activities.emails, priorActivities?.emails) },
    { category: 'Pilots', metric: 'Active Pilots', value: pilots.active_pilots, trend: 'new' },
    { category: 'Pilots', metric: 'Completed Pilots', value: pilots.completed_pilots, trend: 'new' },
    { category: 'Pilots', metric: 'Avg Pilot Health', value: pilots.avg_health_score != null ? Math.round(pilots.avg_health_score) : 'N/A', trend: 'new' },
  ];
}

// ─── Tool Registration ──────────────────────────────────────────────────────

export function registerQbrGeneratorTools(server: McpServer): void {
  // @ts-ignore — deep Zod type instantiation
  server.tool(
    'cs_generate_qbr',
    'Generate a structured Quarterly Business Review. Queries 90 days of deals, activities, pilots, and enrichments from BigQuery. Compares to prior quarter when data exists. Returns quarter_summary, wins, risks, metrics_table, recommendations, and next_quarter_goals.',
    {
      client_id: z.string().describe('BMA tenant client identifier'),
      quarter: z.string().regex(/^Q[1-4]_\d{4}$/).describe('Quarter in format Q1_2026'),
    },
    async (params) => {
      try {
        const bq = getBqClient();
        const { startDate, endDate } = parseQuarter(params.quarter);

        // Also compute prior quarter dates for comparison
        const prior = priorQuarter(params.quarter);
        const priorDates = parseQuarter(prior);

        // Query current quarter data + prior quarter for comparison + stalled/top deals
        const [deals, activities, pilots, stalledDeals, topDeals, priorDeals, priorActivities] = await Promise.all([
          queryDealSummary(bq, params.client_id, startDate, endDate),
          queryActivitySummary(bq, params.client_id, startDate, endDate),
          queryPilotSummary(bq, params.client_id, startDate, endDate),
          queryStalledDeals(bq, params.client_id),
          queryTopClosedDeals(bq, params.client_id, startDate, endDate),
          queryDealSummary(bq, params.client_id, priorDates.startDate, priorDates.endDate),
          queryActivitySummary(bq, params.client_id, priorDates.startDate, priorDates.endDate),
        ]);

        // Determine if prior quarter has data
        const hasPriorData = priorDeals.deals_opened > 0 || priorActivities.total_activities > 0;

        const wins = generateWins(deals, pilots, topDeals);
        const risks = generateRisks(deals, pilots, activities, stalledDeals);
        const recommendations = generateRecommendations(deals, pilots, activities, stalledDeals);
        const nextQuarterGoals = generateNextQuarterGoals(deals, activities, pilots);
        const metrics = buildMetricsTable(
          deals,
          hasPriorData ? priorDeals : null,
          activities,
          hasPriorData ? priorActivities : null,
          pilots,
        );

        const comparison = hasPriorData ? {
          deals_opened_delta: deals.deals_opened - priorDeals.deals_opened,
          revenue_delta: deals.revenue_closed - priorDeals.revenue_closed,
          activities_delta: activities.total_activities - priorActivities.total_activities,
        } : null;

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              action: 'cs_generate_qbr',
              qbr: {
                quarter: params.quarter,
                quarter_summary: {
                  deals_opened: deals.deals_opened,
                  deals_closed_won: deals.deals_closed_won,
                  deals_closed_lost: deals.deals_closed_lost,
                  revenue_closed: deals.revenue_closed,
                  pipeline_value: deals.pipeline_value,
                  activities_total: activities.total_activities,
                  activities_by_type: {
                    meetings: activities.meetings,
                    calls: activities.calls,
                    emails: activities.emails,
                    notes: activities.notes,
                    other: activities.other,
                  },
                  pilots_active: pilots.active_pilots,
                  pilots_completed: pilots.completed_pilots,
                  avg_pilot_health: pilots.avg_health_score,
                },
                wins,
                risks,
                metrics,
                recommendations,
                next_quarter_goals: nextQuarterGoals,
                comparison_to_prior: comparison,
              },
              client_id: params.client_id,
            }, null, 2),
          }],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              error: 'qbr_generation_failed',
              message,
            }),
          }],
          isError: true,
        };
      }
    },
  );
}
