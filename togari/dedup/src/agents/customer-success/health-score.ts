/**
 * CS Health Score
 * Computes a 0-100 composite health score for a client account.
 *
 * Four dimensions (0-25 each):
 *   1. Engagement — activity frequency normalized across 30/60/90-day windows
 *   2. Adoption — deal count, pilot count, and pilot health
 *   3. Satisfaction — activity recency and sentiment proxy
 *   4. Expansion Potential — value trend and new contacts appearing
 *
 * Risk thresholds: >=70 healthy, 50-69 monitor, <50 at_risk.
 * Follows prompt-delegation model: returns structured data, not prose.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp';
import { z } from 'zod';
import { BigQuery } from '@google-cloud/bigquery';

// ─── Zod Schemas ────────────────────────────────────────────────────────────

export const healthScoreInputSchema = z.object({
  account_client_id: z.string().describe('Client/company identifier to score'),
  requesting_client_id: z.string().describe('BMA tenant requesting the score'),
});

export type HealthScoreInput = z.infer<typeof healthScoreInputSchema>;

const dimensionsSchema = z.object({
  engagement: z.number().min(0).max(25).describe('Activity frequency score (0-25)'),
  adoption: z.number().min(0).max(25).describe('Deal/pilot adoption score (0-25)'),
  satisfaction: z.number().min(0).max(25).describe('Activity recency and sentiment proxy (0-25)'),
  expansion_potential: z.number().min(0).max(25).describe('Value trend and new contacts (0-25)'),
});

const riskLevelSchema = z.enum(['healthy', 'monitor', 'at_risk']);
const trendSchema = z.enum(['improving', 'stable', 'declining']);

export const healthScoreOutputSchema = z.object({
  overall_score: z.number().min(0).max(100).describe('Composite health score'),
  dimensions: dimensionsSchema,
  risk_level: riskLevelSchema,
  trend: trendSchema,
  recommended_actions: z.array(z.string()).describe('Prioritized next steps'),
});

export type HealthScoreOutput = z.infer<typeof healthScoreOutputSchema>;

// ─── BigQuery Row Types ─────────────────────────────────────────────────────

interface DealAggRow {
  total_deals: number;
  total_value: number;
  active_deals: number;
  closed_won: number;
  closed_lost: number;
  avg_days_in_stage: number | null;
  recent_deals_30d: number;
  recent_deals_90d: number;
}

interface ActivityAggRow {
  activity_count_30d: number;
  activity_count_60d: number;
  activity_count_90d: number;
  meeting_count_30d: number;
  call_count_30d: number;
  email_count_30d: number;
  days_since_last_activity: number | null;
  distinct_activity_types: number;
}

interface PilotAggRow {
  pilot_count: number;
  active_pilots: number;
  avg_health_score: number | null;
  completed_pilots: number;
  at_risk_pilots: number;
}

interface StageVelocityRow {
  avg_velocity_days: number | null;
  deals_progressed_30d: number;
  deals_stalled: number;
}

interface ContactTrendRow {
  contacts_30d: number;
  contacts_60d: number;
  contacts_90d: number;
  total_contacts: number;
}

interface ValueTrendRow {
  value_recent_half: number;
  value_older_half: number;
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

async function queryDealAgg(bq: BigQuery, clientId: string): Promise<DealAggRow> {
  const [rows] = await bq.query({
    query: `
      SELECT
        COUNT(*) AS total_deals,
        COALESCE(SUM(value), 0) AS total_value,
        COUNTIF(stage NOT IN ('closed_won', 'closed_lost', 'not_a_fit', 'nurture')) AS active_deals,
        COUNTIF(stage = 'closed_won') AS closed_won,
        COUNTIF(stage = 'closed_lost') AS closed_lost,
        AVG(DATE_DIFF(CURRENT_DATE(), DATE(updated_at), DAY)) AS avg_days_in_stage,
        COUNTIF(DATE(created_at) >= DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY)) AS recent_deals_30d,
        COUNTIF(DATE(created_at) >= DATE_SUB(CURRENT_DATE(), INTERVAL 90 DAY)) AS recent_deals_90d
      FROM ${fqt('togari_structured_deals')}
      WHERE client_id = @client_id
    `,
    params: { client_id: clientId },
    useLegacySql: false,
  });
  const row = (rows as Record<string, unknown>[])[0];
  return {
    total_deals: Number(row?.total_deals ?? 0),
    total_value: Number(row?.total_value ?? 0),
    active_deals: Number(row?.active_deals ?? 0),
    closed_won: Number(row?.closed_won ?? 0),
    closed_lost: Number(row?.closed_lost ?? 0),
    avg_days_in_stage: row?.avg_days_in_stage != null ? Number(row.avg_days_in_stage) : null,
    recent_deals_30d: Number(row?.recent_deals_30d ?? 0),
    recent_deals_90d: Number(row?.recent_deals_90d ?? 0),
  };
}

async function queryActivityAgg(bq: BigQuery, clientId: string): Promise<ActivityAggRow> {
  const [rows] = await bq.query({
    query: `
      SELECT
        COUNTIF(DATE(a.created_at) >= DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY)) AS activity_count_30d,
        COUNTIF(DATE(a.created_at) >= DATE_SUB(CURRENT_DATE(), INTERVAL 60 DAY)) AS activity_count_60d,
        COUNTIF(DATE(a.created_at) >= DATE_SUB(CURRENT_DATE(), INTERVAL 90 DAY)) AS activity_count_90d,
        COUNTIF(a.activity_type = 'meeting_notes'
          AND DATE(a.created_at) >= DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY)) AS meeting_count_30d,
        COUNTIF(a.activity_type = 'call_summary'
          AND DATE(a.created_at) >= DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY)) AS call_count_30d,
        COUNTIF(a.activity_type IN ('email_sent', 'email_received')
          AND DATE(a.created_at) >= DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY)) AS email_count_30d,
        DATE_DIFF(CURRENT_DATE(), DATE(MAX(a.created_at)), DAY) AS days_since_last_activity,
        COUNT(DISTINCT a.activity_type) AS distinct_activity_types
      FROM ${fqt('activities')} a
      JOIN ${fqt('togari_structured_deals')} d ON a.deal_id = d.deal_id
      WHERE d.client_id = @client_id
    `,
    params: { client_id: clientId },
    useLegacySql: false,
  });
  const row = (rows as Record<string, unknown>[])[0];
  return {
    activity_count_30d: Number(row?.activity_count_30d ?? 0),
    activity_count_60d: Number(row?.activity_count_60d ?? 0),
    activity_count_90d: Number(row?.activity_count_90d ?? 0),
    meeting_count_30d: Number(row?.meeting_count_30d ?? 0),
    call_count_30d: Number(row?.call_count_30d ?? 0),
    email_count_30d: Number(row?.email_count_30d ?? 0),
    days_since_last_activity: row?.days_since_last_activity != null ? Number(row.days_since_last_activity) : null,
    distinct_activity_types: Number(row?.distinct_activity_types ?? 0),
  };
}

async function queryPilotAgg(bq: BigQuery, clientId: string): Promise<PilotAggRow> {
  const [rows] = await bq.query({
    query: `
      SELECT
        COUNT(*) AS pilot_count,
        COUNTIF(status = 'active') AS active_pilots,
        AVG(health_score) AS avg_health_score,
        COUNTIF(status = 'completed') AS completed_pilots,
        COUNTIF(status = 'at_risk') AS at_risk_pilots
      FROM ${fqt('pilots')}
      WHERE client_id = @client_id
    `,
    params: { client_id: clientId },
    useLegacySql: false,
  });
  const row = (rows as Record<string, unknown>[])[0];
  return {
    pilot_count: Number(row?.pilot_count ?? 0),
    active_pilots: Number(row?.active_pilots ?? 0),
    avg_health_score: row?.avg_health_score != null ? Number(row.avg_health_score) : null,
    completed_pilots: Number(row?.completed_pilots ?? 0),
    at_risk_pilots: Number(row?.at_risk_pilots ?? 0),
  };
}

async function queryStageVelocity(bq: BigQuery, clientId: string): Promise<StageVelocityRow> {
  const [rows] = await bq.query({
    query: `
      SELECT
        AVG(
          CASE WHEN stage NOT IN ('closed_won', 'closed_lost', 'not_a_fit', 'nurture')
          THEN DATE_DIFF(DATE(updated_at), DATE(created_at), DAY)
          END
        ) AS avg_velocity_days,
        COUNTIF(
          DATE(updated_at) >= DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY)
          AND stage NOT IN ('closed_won', 'closed_lost', 'not_a_fit', 'nurture')
        ) AS deals_progressed_30d,
        COUNTIF(
          DATE_DIFF(CURRENT_DATE(), DATE(updated_at), DAY) > 14
          AND stage NOT IN ('closed_won', 'closed_lost', 'not_a_fit', 'nurture')
        ) AS deals_stalled
      FROM ${fqt('togari_structured_deals')}
      WHERE client_id = @client_id
    `,
    params: { client_id: clientId },
    useLegacySql: false,
  });
  const row = (rows as Record<string, unknown>[])[0];
  return {
    avg_velocity_days: row?.avg_velocity_days != null ? Number(row.avg_velocity_days) : null,
    deals_progressed_30d: Number(row?.deals_progressed_30d ?? 0),
    deals_stalled: Number(row?.deals_stalled ?? 0),
  };
}

async function queryContactTrend(bq: BigQuery, clientId: string): Promise<ContactTrendRow> {
  const [rows] = await bq.query({
    query: `
      SELECT
        COUNTIF(DATE(created_at) >= DATE_SUB(CURRENT_DATE(), INTERVAL 30 DAY)) AS contacts_30d,
        COUNTIF(DATE(created_at) >= DATE_SUB(CURRENT_DATE(), INTERVAL 60 DAY)) AS contacts_60d,
        COUNTIF(DATE(created_at) >= DATE_SUB(CURRENT_DATE(), INTERVAL 90 DAY)) AS contacts_90d,
        COUNT(*) AS total_contacts
      FROM ${fqt('togari_structured_deals')}
      WHERE client_id = @client_id
        AND ARRAY_LENGTH(contact_ids) > 0
    `,
    params: { client_id: clientId },
    useLegacySql: false,
  });
  const row = (rows as Record<string, unknown>[])[0];
  return {
    contacts_30d: Number(row?.contacts_30d ?? 0),
    contacts_60d: Number(row?.contacts_60d ?? 0),
    contacts_90d: Number(row?.contacts_90d ?? 0),
    total_contacts: Number(row?.total_contacts ?? 0),
  };
}

async function queryValueTrend(bq: BigQuery, clientId: string): Promise<ValueTrendRow> {
  const [rows] = await bq.query({
    query: `
      WITH ordered_deals AS (
        SELECT value, created_at,
          ROW_NUMBER() OVER (ORDER BY created_at DESC) AS rn,
          COUNT(*) OVER () AS total
        FROM ${fqt('togari_structured_deals')}
        WHERE client_id = @client_id AND value IS NOT NULL
      )
      SELECT
        COALESCE(SUM(CASE WHEN rn <= total / 2 THEN value END), 0) AS value_recent_half,
        COALESCE(SUM(CASE WHEN rn > total / 2 THEN value END), 0) AS value_older_half
      FROM ordered_deals
    `,
    params: { client_id: clientId },
    useLegacySql: false,
  });
  const row = (rows as Record<string, unknown>[])[0];
  return {
    value_recent_half: Number(row?.value_recent_half ?? 0),
    value_older_half: Number(row?.value_older_half ?? 0),
  };
}

// ─── Dimension Scorers (0-25 each) ─────────────────────────────────────────

function scoreEngagement(activity: ActivityAggRow): number {
  // Activity frequency normalized: weight recent activity higher
  // Benchmarks: 10+ activities/30d = excellent, 5 = good, 1 = poor, 0 = zero
  const freq30 = Math.min(activity.activity_count_30d / 10, 1) * 10;

  // Activity type diversity (meetings + calls + emails = well-rounded)
  const diversity = Math.min(activity.distinct_activity_types / 4, 1) * 5;

  // Recency bonus: activity within last 7 days
  const recencyBonus = activity.days_since_last_activity !== null && activity.days_since_last_activity <= 7 ? 5 : 0;

  // Trend: 30d vs prior 30d activity momentum
  const activity30 = activity.activity_count_30d;
  const activity30to60 = activity.activity_count_60d - activity.activity_count_30d;
  const trendBonus = activity30 > activity30to60 ? 5 : activity30 === activity30to60 ? 2.5 : 0;

  return Math.min(25, Math.round(freq30 + diversity + recencyBonus + trendBonus));
}

function scoreAdoption(deals: DealAggRow, pilots: PilotAggRow): number {
  // Deal volume: more deals = more adoption
  const dealScore = Math.min(deals.total_deals / 5, 1) * 8;

  // Active deals in pipeline
  const activeScore = Math.min(deals.active_deals / 3, 1) * 5;

  // Pilot engagement
  const pilotScore = pilots.pilot_count > 0
    ? Math.min(pilots.pilot_count / 2, 1) * 5
    : 0;

  // Pilot health (avg health of active pilots)
  const pilotHealthScore = pilots.avg_health_score !== null
    ? (pilots.avg_health_score / 100) * 5
    : 0;

  // Win rate bonus
  const totalClosed = deals.closed_won + deals.closed_lost;
  const winRate = totalClosed > 0 ? deals.closed_won / totalClosed : 0;
  const winBonus = winRate * 2;

  return Math.min(25, Math.round(dealScore + activeScore + pilotScore + pilotHealthScore + winBonus));
}

function scoreSatisfaction(activity: ActivityAggRow, pilots: PilotAggRow, velocity: StageVelocityRow): number {
  // Recency of contact: recent activity = satisfied client still engaged
  let recencyScore: number;
  if (activity.days_since_last_activity === null) {
    recencyScore = 0;
  } else if (activity.days_since_last_activity <= 3) {
    recencyScore = 10;
  } else if (activity.days_since_last_activity <= 7) {
    recencyScore = 8;
  } else if (activity.days_since_last_activity <= 14) {
    recencyScore = 5;
  } else if (activity.days_since_last_activity <= 30) {
    recencyScore = 2;
  } else {
    recencyScore = 0;
  }

  // Meeting frequency as sentiment proxy (meetings = face-time = engaged)
  const meetingScore = Math.min(activity.meeting_count_30d / 3, 1) * 5;

  // No at-risk pilots = satisfaction indicator
  const pilotRiskPenalty = pilots.at_risk_pilots > 0 ? -3 * Math.min(pilots.at_risk_pilots, 2) : 0;
  const completedPilotBonus = Math.min(pilots.completed_pilots, 2) * 2;

  // Deal velocity: fast-moving deals = satisfied, engaged buyer
  const velocityScore = velocity.deals_stalled === 0 ? 5 : Math.max(0, 5 - velocity.deals_stalled * 2);

  return Math.min(25, Math.max(0, Math.round(
    recencyScore + meetingScore + completedPilotBonus + pilotRiskPenalty + velocityScore,
  )));
}

function scoreExpansion(
  deals: DealAggRow,
  contacts: ContactTrendRow,
  valueTrend: ValueTrendRow,
): number {
  // Value trend: recent deals worth more than older deals
  let valueTrendScore: number;
  if (valueTrend.value_older_half === 0 && valueTrend.value_recent_half === 0) {
    valueTrendScore = 0;
  } else if (valueTrend.value_older_half === 0) {
    valueTrendScore = 10; // All value is recent — strong signal
  } else {
    const ratio = valueTrend.value_recent_half / valueTrend.value_older_half;
    valueTrendScore = ratio >= 1.5 ? 10 : ratio >= 1.0 ? 7 : ratio >= 0.7 ? 4 : 1;
  }

  // New contacts appearing (stakeholder expansion)
  const newContactScore = contacts.contacts_30d > 0
    ? Math.min(contacts.contacts_30d / 2, 1) * 5
    : 0;

  // Recent deal creation signals expansion intent
  const recentDealScore = Math.min(deals.recent_deals_30d / 2, 1) * 5;

  // Total value floor: higher value accounts have more expansion room
  const valueFloor = Math.min(deals.total_value / 100000, 1) * 5;

  return Math.min(25, Math.round(valueTrendScore + newContactScore + recentDealScore + valueFloor));
}

// ─── Trend Detection ────────────────────────────────────────────────────────

function detectTrend(activity: ActivityAggRow, valueTrend: ValueTrendRow): 'improving' | 'stable' | 'declining' {
  // Compare 30d vs prior 30d (30-60d window)
  const recent = activity.activity_count_30d;
  const prior = activity.activity_count_60d - activity.activity_count_30d;

  const activityTrend = prior === 0
    ? (recent > 0 ? 1 : 0)
    : (recent - prior) / prior;

  // Value trend
  const valueTrendRatio = valueTrend.value_older_half === 0
    ? (valueTrend.value_recent_half > 0 ? 1 : 0)
    : (valueTrend.value_recent_half - valueTrend.value_older_half) / valueTrend.value_older_half;

  const combined = activityTrend * 0.6 + valueTrendRatio * 0.4;

  if (combined > 0.15) return 'improving';
  if (combined < -0.15) return 'declining';
  return 'stable';
}

// ─── Recommended Actions ────────────────────────────────────────────────────

function generateRecommendations(
  overallScore: number,
  dimensions: { engagement: number; adoption: number; satisfaction: number; expansion_potential: number },
  activity: ActivityAggRow,
  pilots: PilotAggRow,
  velocity: StageVelocityRow,
): string[] {
  const actions: string[] = [];

  // Low engagement
  if (dimensions.engagement < 12) {
    if (activity.days_since_last_activity !== null && activity.days_since_last_activity > 14) {
      actions.push('Schedule a check-in call — no activity in over 2 weeks.');
    }
    if (activity.meeting_count_30d === 0) {
      actions.push('Book a face-to-face meeting — no meetings in the last 30 days.');
    }
    if (activity.activity_count_30d < 3) {
      actions.push('Increase touchpoint frequency — fewer than 3 activities in last 30 days.');
    }
  }

  // Low adoption
  if (dimensions.adoption < 12) {
    if (pilots.pilot_count === 0) {
      actions.push('Propose a pilot program to drive deeper product adoption.');
    }
    if (pilots.at_risk_pilots > 0) {
      actions.push(`Address ${pilots.at_risk_pilots} at-risk pilot(s) — review milestones and blockers.`);
    }
  }

  // Low satisfaction
  if (dimensions.satisfaction < 12) {
    if (velocity.deals_stalled > 0) {
      actions.push(`Unblock ${velocity.deals_stalled} stalled deal(s) — investigate stage bottlenecks.`);
    }
    actions.push('Send a satisfaction survey or schedule an executive check-in.');
  }

  // Low expansion
  if (dimensions.expansion_potential < 12) {
    actions.push('Identify upsell opportunities — review account for expansion signals.');
    actions.push('Map additional stakeholders — current contact coverage may be thin.');
  }

  // Overall risk
  if (overallScore < 50) {
    actions.unshift('URGENT: Account is at risk of churning — escalate to CS leadership.');
  } else if (overallScore < 70) {
    actions.unshift('Account needs attention — schedule a strategic review.');
  }

  // Cap at 5 actions
  return actions.slice(0, 5);
}

// ─── Tool Registration ──────────────────────────────────────────────────────

export function registerHealthScoreTools(server: McpServer): void {
  server.tool(
    'cs_health_score',
    'Compute a 0-100 composite health score for a client account. Scores 4 dimensions (engagement, adoption, satisfaction, expansion_potential) from BigQuery data. Returns overall score, dimension breakdown, risk level, trend, and recommended actions.',
    {
      account_client_id: z.string().describe('Client/company identifier to score'),
      requesting_client_id: z.string().describe('BMA tenant requesting the score'),
    },
    async (params) => {
      try {
        const bq = getBqClient();
        const clientId = params.account_client_id;

        // Query all data dimensions in parallel
        const [deals, activity, pilots, velocity, contacts, valueTrend] = await Promise.all([
          queryDealAgg(bq, clientId),
          queryActivityAgg(bq, clientId),
          queryPilotAgg(bq, clientId),
          queryStageVelocity(bq, clientId),
          queryContactTrend(bq, clientId),
          queryValueTrend(bq, clientId),
        ]);

        // Score each dimension (0-25)
        const dimensions = {
          engagement: scoreEngagement(activity),
          adoption: scoreAdoption(deals, pilots),
          satisfaction: scoreSatisfaction(activity, pilots, velocity),
          expansion_potential: scoreExpansion(deals, contacts, valueTrend),
        };

        // Composite score (0-100)
        const overallScore = dimensions.engagement
          + dimensions.adoption
          + dimensions.satisfaction
          + dimensions.expansion_potential;

        // Risk level
        const riskLevel: 'healthy' | 'monitor' | 'at_risk' =
          overallScore >= 70 ? 'healthy' :
          overallScore >= 50 ? 'monitor' :
          'at_risk';

        // Trend
        const trend = detectTrend(activity, valueTrend);

        // Recommended actions
        const recommendedActions = generateRecommendations(
          overallScore, dimensions, activity, pilots, velocity,
        );

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              action: 'cs_health_score',
              overall_score: overallScore,
              dimensions,
              risk_level: riskLevel,
              trend,
              recommended_actions: recommendedActions,
              data_summary: {
                deals: {
                  total: deals.total_deals,
                  active: deals.active_deals,
                  total_value: deals.total_value,
                  won: deals.closed_won,
                  lost: deals.closed_lost,
                },
                activities: {
                  last_30d: activity.activity_count_30d,
                  last_60d: activity.activity_count_60d,
                  last_90d: activity.activity_count_90d,
                  days_since_last: activity.days_since_last_activity,
                },
                pilots: {
                  total: pilots.pilot_count,
                  active: pilots.active_pilots,
                  at_risk: pilots.at_risk_pilots,
                  avg_health: pilots.avg_health_score,
                },
                velocity: {
                  avg_days: velocity.avg_velocity_days,
                  progressed_30d: velocity.deals_progressed_30d,
                  stalled: velocity.deals_stalled,
                },
              },
              requesting_client_id: params.requesting_client_id,
            }, null, 2),
          }],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              error: 'health_score_failed',
              message,
            }),
          }],
          isError: true,
        };
      }
    },
  );
}
