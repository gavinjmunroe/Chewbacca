/**
 * Analytics Cross-Funnel
 * Full-funnel sales analytics from first touch to closed deal.
 *
 * Computes stage-to-stage conversion rates, average days per stage,
 * win rate by pipeline/rep, deal size by pipeline, top loss reasons,
 * and generates 3-5 actionable insights.
 *
 * Follows prompt-delegation model: returns structured data, not prose.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp';
import { z } from 'zod';
import { BigQuery } from '@google-cloud/bigquery';

// ─── Constants ─────────────────────────────────────────────────────────────

const STAGE_ORDER = [
  'researching',
  'contacted',
  'conversation_started',
  'discovery_scheduled',
  'discovery_complete',
  'proposal_sent',
  'negotiating',
  'verbal_commit',
  'contract_sent',
  'closed_won',
] as const;

const TERMINAL_STAGES = ['closed_won', 'closed_lost', 'nurture', 'not_a_fit'];

// ─── Zod Schemas ───────────────────────────────────────────────────────────

const timeRangeSchema = z.union([
  z.enum(['last_30d', 'last_90d', 'last_year']),
  z.object({
    start: z.string().describe('Start date YYYY-MM-DD'),
    end: z.string().describe('End date YYYY-MM-DD'),
  }),
]);

export const crossFunnelInputSchema = z.object({
  client_id: z.string().describe('BMA tenant client identifier'),
  time_range: timeRangeSchema.describe('Preset or custom date range'),
  pipeline: z.enum(['partnerships', 'inbound', 'outbound']).optional()
    .describe('Optional pipeline filter — omit for all pipelines'),
});

export type CrossFunnelInput = z.infer<typeof crossFunnelInputSchema>;

const funnelStageSchema = z.object({
  stage: z.string(),
  entered: z.number(),
  exited: z.number(),
  conversion_pct: z.number(),
  avg_days: z.number().nullable(),
});

export const crossFunnelOutputSchema = z.object({
  funnel: z.array(funnelStageSchema),
  win_rate: z.object({
    overall: z.number(),
    by_pipeline: z.record(z.string(), z.number()),
    by_rep: z.record(z.string(), z.number()),
  }),
  avg_deal_size: z.object({
    overall: z.number().nullable(),
    by_pipeline: z.record(z.string(), z.number().nullable()),
  }),
  loss_reasons: z.array(z.string()),
  bottleneck: z.string(),
  insights: z.array(z.string()),
});

export type CrossFunnelOutput = z.infer<typeof crossFunnelOutputSchema>;

// ─── Helpers ───────────────────────────────────────────────────────────────

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

function resolveTimeRange(
  range: z.infer<typeof timeRangeSchema>,
): { startDate: string; endDate: string } {
  const today = new Date();
  const fmt = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const endDate = fmt(today);

  if (typeof range === 'string') {
    const daysBack = range === 'last_30d' ? 30 : range === 'last_90d' ? 90 : 365;
    const start = new Date(today);
    start.setDate(start.getDate() - daysBack);
    return { startDate: fmt(start), endDate };
  }
  return { startDate: range.start, endDate: range.end };
}

function stageIndex(stage: string): number {
  const idx = STAGE_ORDER.indexOf(stage as typeof STAGE_ORDER[number]);
  return idx >= 0 ? idx : -1;
}

function pipelineFilter(pipeline?: string): string {
  return pipeline ? 'AND pipeline = @pipeline' : '';
}

// ─── BigQuery Row Types ────────────────────────────────────────────────────

interface StageCountRow {
  stage: string;
  deal_count: number;
  avg_days_in_stage: number | null;
}

interface WinRateRow {
  group_key: string;
  closed_won: number;
  closed_lost: number;
  win_rate: number;
}

interface DealSizeRow {
  group_key: string;
  avg_value: number | null;
}

// ─── BigQuery Queries ──────────────────────────────────────────────────────

async function queryStageDistribution(
  bq: BigQuery, clientId: string, startDate: string, endDate: string, pipeline?: string,
): Promise<StageCountRow[]> {
  const pf = pipelineFilter(pipeline);
  const params: Record<string, string> = { client_id: clientId, start_date: startDate, end_date: endDate };
  if (pipeline) params.pipeline = pipeline;

  const [rows] = await bq.query({
    query: `
      SELECT
        stage,
        COUNT(*) AS deal_count,
        AVG(DATE_DIFF(
          COALESCE(DATE(updated_at), CURRENT_DATE()),
          DATE(created_at),
          DAY
        )) AS avg_days_in_stage
      FROM ${fqt('togari_structured_deals')}
      WHERE client_id = @client_id
        AND DATE(created_at) <= @end_date
        AND (DATE(updated_at) >= @start_date OR stage NOT IN ('closed_won', 'closed_lost', 'not_a_fit', 'nurture'))
        ${pf}
      GROUP BY stage
      ORDER BY deal_count DESC
    `,
    params,
    useLegacySql: false,
  });
  return (rows as Record<string, unknown>[]).map(r => ({
    stage: String(r.stage ?? ''),
    deal_count: Number(r.deal_count ?? 0),
    avg_days_in_stage: r.avg_days_in_stage != null ? Number(r.avg_days_in_stage) : null,
  }));
}

async function queryWinRateByPipeline(
  bq: BigQuery, clientId: string, startDate: string, endDate: string, pipeline?: string,
): Promise<WinRateRow[]> {
  const pf = pipelineFilter(pipeline);
  const params: Record<string, string> = { client_id: clientId, start_date: startDate, end_date: endDate };
  if (pipeline) params.pipeline = pipeline;

  const [rows] = await bq.query({
    query: `
      SELECT
        pipeline AS group_key,
        COUNTIF(stage = 'closed_won') AS closed_won,
        COUNTIF(stage = 'closed_lost') AS closed_lost,
        SAFE_DIVIDE(
          COUNTIF(stage = 'closed_won'),
          COUNTIF(stage IN ('closed_won', 'closed_lost'))
        ) * 100 AS win_rate
      FROM ${fqt('togari_structured_deals')}
      WHERE client_id = @client_id
        AND stage IN ('closed_won', 'closed_lost')
        AND DATE(updated_at) BETWEEN @start_date AND @end_date
        ${pf}
      GROUP BY pipeline
    `,
    params,
    useLegacySql: false,
  });
  return (rows as Record<string, unknown>[]).map(r => ({
    group_key: String(r.group_key ?? 'unknown'),
    closed_won: Number(r.closed_won ?? 0),
    closed_lost: Number(r.closed_lost ?? 0),
    win_rate: Number(r.win_rate ?? 0),
  }));
}

async function queryWinRateByRep(
  bq: BigQuery, clientId: string, startDate: string, endDate: string, pipeline?: string,
): Promise<WinRateRow[]> {
  const pf = pipelineFilter(pipeline);
  const params: Record<string, string> = { client_id: clientId, start_date: startDate, end_date: endDate };
  if (pipeline) params.pipeline = pipeline;

  const [rows] = await bq.query({
    query: `
      SELECT
        owner AS group_key,
        COUNTIF(stage = 'closed_won') AS closed_won,
        COUNTIF(stage = 'closed_lost') AS closed_lost,
        SAFE_DIVIDE(
          COUNTIF(stage = 'closed_won'),
          COUNTIF(stage IN ('closed_won', 'closed_lost'))
        ) * 100 AS win_rate
      FROM ${fqt('togari_structured_deals')}
      WHERE client_id = @client_id
        AND stage IN ('closed_won', 'closed_lost')
        AND DATE(updated_at) BETWEEN @start_date AND @end_date
        AND owner IS NOT NULL
        ${pf}
      GROUP BY owner
    `,
    params,
    useLegacySql: false,
  });
  return (rows as Record<string, unknown>[]).map(r => ({
    group_key: String(r.group_key ?? 'unknown'),
    closed_won: Number(r.closed_won ?? 0),
    closed_lost: Number(r.closed_lost ?? 0),
    win_rate: Number(r.win_rate ?? 0),
  }));
}

async function queryAvgDealSize(
  bq: BigQuery, clientId: string, startDate: string, endDate: string, pipeline?: string,
): Promise<{ overall: number | null; byPipeline: DealSizeRow[] }> {
  const pf = pipelineFilter(pipeline);
  const params: Record<string, string> = { client_id: clientId, start_date: startDate, end_date: endDate };
  if (pipeline) params.pipeline = pipeline;

  const [rows] = await bq.query({
    query: `
      SELECT
        'overall' AS group_key,
        AVG(value) AS avg_value
      FROM ${fqt('togari_structured_deals')}
      WHERE client_id = @client_id
        AND stage = 'closed_won'
        AND DATE(updated_at) BETWEEN @start_date AND @end_date
        AND value IS NOT NULL
        ${pf}

      UNION ALL

      SELECT
        pipeline AS group_key,
        AVG(value) AS avg_value
      FROM ${fqt('togari_structured_deals')}
      WHERE client_id = @client_id
        AND stage = 'closed_won'
        AND DATE(updated_at) BETWEEN @start_date AND @end_date
        AND value IS NOT NULL
        ${pf}
      GROUP BY pipeline
    `,
    params,
    useLegacySql: false,
  });

  const mapped = (rows as Record<string, unknown>[]).map(r => ({
    group_key: String(r.group_key ?? 'unknown'),
    avg_value: r.avg_value != null ? Number(r.avg_value) : null,
  }));

  const overallRow = mapped.find(r => r.group_key === 'overall');
  const byPipeline = mapped.filter(r => r.group_key !== 'overall');

  return { overall: overallRow?.avg_value ?? null, byPipeline };
}

async function queryLossReasons(
  bq: BigQuery, clientId: string, startDate: string, endDate: string, pipeline?: string,
): Promise<string[]> {
  const pf = pipelineFilter(pipeline);
  const params: Record<string, string> = { client_id: clientId, start_date: startDate, end_date: endDate };
  if (pipeline) params.pipeline = pipeline;

  const [rows] = await bq.query({
    query: `
      SELECT notes
      FROM ${fqt('togari_structured_deals')}
      WHERE client_id = @client_id
        AND stage = 'closed_lost'
        AND DATE(updated_at) BETWEEN @start_date AND @end_date
        AND notes IS NOT NULL
        AND TRIM(notes) != ''
        ${pf}
      ORDER BY updated_at DESC
      LIMIT 20
    `,
    params,
    useLegacySql: false,
  });

  return (rows as Record<string, unknown>[]).map(r => String(r.notes ?? '')).filter(Boolean);
}

// ─── Funnel Builder ────────────────────────────────────────────────────────

interface FunnelStage {
  stage: string;
  entered: number;
  exited: number;
  conversion_pct: number;
  avg_days: number | null;
}

function buildFunnel(stageRows: StageCountRow[]): FunnelStage[] {
  const countByStage = new Map<string, { count: number; avgDays: number | null }>();
  for (const row of stageRows) {
    countByStage.set(row.stage, { count: row.deal_count, avgDays: row.avg_days_in_stage });
  }

  // "Entered" a stage = deals currently at that stage index or any later stage
  // Build cumulative from end to start
  const cumulativeCounts: number[] = new Array(STAGE_ORDER.length).fill(0);
  for (const [stage, data] of countByStage) {
    const idx = stageIndex(stage);
    if (idx >= 0) {
      cumulativeCounts[idx] += data.count;
    }
    // closed_lost counts as having entered up to its current stage
    // but they're already counted at their stage
  }

  // Cumulate: entered[i] = sum of counts at stage i and all later stages
  const entered: number[] = new Array(STAGE_ORDER.length).fill(0);
  let runningTotal = 0;
  for (let i = STAGE_ORDER.length - 1; i >= 0; i--) {
    runningTotal += cumulativeCounts[i];
    entered[i] = runningTotal;
  }

  // Also add closed_lost deals — they entered stages up to their point
  // but since we don't have stage_history, they appear at 'closed_lost' stage
  // which isn't in STAGE_ORDER. We approximate by adding them to the top of funnel.
  const closedLostCount = countByStage.get('closed_lost')?.count ?? 0;
  for (let i = 0; i < STAGE_ORDER.length; i++) {
    entered[i] += closedLostCount;
    // closed_lost deals exited somewhere, but without history we add them to entered
    // for a conservative funnel view
  }

  const funnel: FunnelStage[] = [];
  for (let i = 0; i < STAGE_ORDER.length; i++) {
    const stage = STAGE_ORDER[i];
    const stageEntered = entered[i];
    const stageExited = i < STAGE_ORDER.length - 1 ? entered[i + 1] : (countByStage.get('closed_won')?.count ?? 0);
    const conversionPct = stageEntered > 0
      ? Math.round((stageExited / stageEntered) * 1000) / 10
      : 0;
    const avgDays = countByStage.get(stage)?.avgDays ?? null;

    funnel.push({
      stage,
      entered: stageEntered,
      exited: stageExited,
      conversion_pct: conversionPct,
      avg_days: avgDays !== null ? Math.round(avgDays * 10) / 10 : null,
    });
  }

  return funnel;
}

// ─── Insight Generator ─────────────────────────────────────────────────────

function generateInsights(
  funnel: FunnelStage[],
  winRateOverall: number,
  winRateByPipeline: Record<string, number>,
  avgDealSizeOverall: number | null,
  lossReasons: string[],
): string[] {
  const insights: string[] = [];

  // 1. Bottleneck — lowest conversion among non-terminal stages (exclude last = closed_won)
  const activeFunnel = funnel.filter(
    (f) => !TERMINAL_STAGES.includes(f.stage) && f.entered > 0 && f.stage !== 'closed_won',
  );
  if (activeFunnel.length > 0) {
    const bottleneck = activeFunnel.reduce((a, b) => a.conversion_pct < b.conversion_pct ? a : b);
    const nextStageIdx = stageIndex(bottleneck.stage) + 1;
    const nextStage = nextStageIdx < STAGE_ORDER.length ? STAGE_ORDER[nextStageIdx] : 'next stage';
    insights.push(
      `${bottleneck.stage} → ${nextStage} conversion is ${bottleneck.conversion_pct}% — this is the biggest drop-off in your funnel. Consider adding qualification steps before this transition.`,
    );
  }

  // 2. Win rate comparison across pipelines
  const pipelineEntries = Object.entries(winRateByPipeline).filter(([, v]) => v > 0);
  if (pipelineEntries.length >= 2) {
    const sorted = pipelineEntries.sort((a, b) => b[1] - a[1]);
    const [bestPipeline, bestRate] = sorted[0];
    const [worstPipeline, worstRate] = sorted[sorted.length - 1];
    if (bestRate > worstRate * 1.5) {
      insights.push(
        `${bestPipeline} pipeline win rate (${Math.round(bestRate)}%) significantly outperforms ${worstPipeline} (${Math.round(worstRate)}%). Consider shifting resources toward ${bestPipeline} or investigating what's different about ${worstPipeline} deals.`,
      );
    }
  }

  // 3. Cycle time outlier
  const withDays = funnel.filter(f => f.avg_days !== null && !TERMINAL_STAGES.includes(f.stage));
  if (withDays.length > 0) {
    const slowest = withDays.reduce((a, b) => (a.avg_days ?? 0) > (b.avg_days ?? 0) ? a : b);
    if (slowest.avg_days !== null && slowest.avg_days > 7) {
      insights.push(
        `Deals spend an average of ${slowest.avg_days} days in ${slowest.stage} — the longest stage in your funnel. Look for ways to accelerate this step.`,
      );
    }
  }

  // 4. Loss pattern
  if (lossReasons.length >= 3) {
    insights.push(
      `${lossReasons.length} deals were lost in this period with recorded notes. Review loss reasons to identify recurring objections or competitive threats.`,
    );
  }

  // 5. Overall win rate assessment
  if (winRateOverall > 0) {
    if (winRateOverall < 20) {
      insights.push(
        `Overall win rate is ${Math.round(winRateOverall)}% — below typical B2B benchmarks (20-30%). Focus on deal qualification earlier in the funnel to improve close rates.`,
      );
    } else if (winRateOverall > 50) {
      insights.push(
        `Overall win rate is ${Math.round(winRateOverall)}% — above average. Your team is closing well. Consider increasing top-of-funnel volume to capitalize on this efficiency.`,
      );
    }
  }

  return insights.slice(0, 5);
}

// ─── Tool Registration ─────────────────────────────────────────────────────

export function registerCrossFunnelAnalyticsTools(server: McpServer): void {
  server.tool(
    'analytics_cross_funnel',
    'Full-funnel sales analytics: stage-to-stage conversion rates, average days per stage, ' +
    'win rate by pipeline and rep, average deal size, top loss reasons, bottleneck identification, ' +
    'and 3-5 actionable insights. The single pane of glass for your entire sales operation.',
    {
      client_id: z.string().describe('BMA tenant client identifier'),
      time_range: timeRangeSchema.describe('Preset (last_30d, last_90d, last_year) or custom { start, end }'),
      pipeline: z.enum(['partnerships', 'inbound', 'outbound']).optional()
        .describe('Optional pipeline filter — omit to analyze all pipelines'),
    },
    async (params) => {
      try {
        const bq = getBqClient();
        const { startDate, endDate } = resolveTimeRange(params.time_range);
        const clientId = params.client_id;
        const pipeline = params.pipeline;

        // Run all queries in parallel
        const [stageRows, winByPipeline, winByRep, dealSize, lossReasons] = await Promise.all([
          queryStageDistribution(bq, clientId, startDate, endDate, pipeline),
          queryWinRateByPipeline(bq, clientId, startDate, endDate, pipeline),
          queryWinRateByRep(bq, clientId, startDate, endDate, pipeline),
          queryAvgDealSize(bq, clientId, startDate, endDate, pipeline),
          queryLossReasons(bq, clientId, startDate, endDate, pipeline),
        ]);

        // Build funnel
        const funnel = buildFunnel(stageRows);

        // Win rates
        const totalWon = winByPipeline.reduce((s, r) => s + r.closed_won, 0);
        const totalLost = winByPipeline.reduce((s, r) => s + r.closed_lost, 0);
        const overallWinRate = totalWon + totalLost > 0
          ? Math.round((totalWon / (totalWon + totalLost)) * 1000) / 10
          : 0;

        const winRateByPipelineMap: Record<string, number> = {};
        for (const r of winByPipeline) {
          winRateByPipelineMap[r.group_key] = Math.round(r.win_rate * 10) / 10;
        }

        const winRateByRepMap: Record<string, number> = {};
        for (const r of winByRep) {
          winRateByRepMap[r.group_key] = Math.round(r.win_rate * 10) / 10;
        }

        // Deal size
        const avgDealSizeByPipeline: Record<string, number | null> = {};
        for (const r of dealSize.byPipeline) {
          avgDealSizeByPipeline[r.group_key] = r.avg_value !== null ? Math.round(r.avg_value) : null;
        }

        // Bottleneck — active funnel stage with lowest conversion
        const activeFunnel = funnel.filter(
          f => !TERMINAL_STAGES.includes(f.stage) && f.entered > 0 && f.stage !== 'closed_won',
        );
        const bottleneck = activeFunnel.length > 0
          ? activeFunnel.reduce((a, b) => a.conversion_pct < b.conversion_pct ? a : b).stage
          : 'none';

        // Insights
        const insights = generateInsights(
          funnel,
          overallWinRate,
          winRateByPipelineMap,
          dealSize.overall !== null ? Math.round(dealSize.overall) : null,
          lossReasons,
        );

        const result = {
          action: 'analytics_cross_funnel',
          time_range: { start: startDate, end: endDate },
          pipeline_filter: pipeline ?? 'all',
          funnel,
          win_rate: {
            overall: overallWinRate,
            by_pipeline: winRateByPipelineMap,
            by_rep: winRateByRepMap,
          },
          avg_deal_size: {
            overall: dealSize.overall !== null ? Math.round(dealSize.overall) : null,
            by_pipeline: avgDealSizeByPipeline,
          },
          loss_reasons: lossReasons,
          bottleneck,
          insights,
        };

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify(result, null, 2),
          }],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              error: 'cross_funnel_analytics_failed',
              message,
            }),
          }],
          isError: true,
        };
      }
    },
  );
}
