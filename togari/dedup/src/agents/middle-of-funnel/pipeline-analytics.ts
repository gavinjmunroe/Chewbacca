/**
 * MOF Pipeline Analytics
 * Computes pipeline performance metrics for a given time range.
 * Per pipeline: new opportunities, win rate, avg cycle time, closed lost reasons,
 * overdue count, and stage distribution.
 *
 * Returns structured data for downstream analysis. Stage conversion rates are not
 * available without a stage_history table — this is noted in the response.
 *
 * Data source: BigQuery table togari_structured_deals via deal-store.ts.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp';
import { z } from 'zod';
import {
  getPipelineMetrics,
  listDeals,
  type DealStoreConfig,
} from './deal-store.js';

/** Stage probability weights for pipeline coverage calculation */
const STAGE_WEIGHT: Record<string, number> = {
  researching: 0.05,
  contacted: 0.05,
  conversation_started: 0.10,
  discovery_scheduled: 0.20,
  discovery_complete: 0.20,
  proposal_sent: 0.35,
  negotiating: 0.50,
  verbal_commit: 0.75,
  contract_sent: 0.90,
};

function getDealStoreConfig(): DealStoreConfig {
  return {
    projectId: process.env.GCP_PROJECT_ID ?? 'midyear-glazing-485303-u3',
    dataset: process.env.BIGQUERY_DATASET ?? 'togari_data_lake',
    table: process.env.BIGQUERY_DEALS_TABLE ?? 'togari_structured_deals',
    credentialsPath: process.env.GOOGLE_APPLICATION_CREDENTIALS,
    gcpCredentialsBase64: process.env.GCP_CREDENTIALS_BASE64,
  };
}

export function registerPipelineAnalyticsTools(server: McpServer): void {

  // @ts-ignore
  server.tool(
    'mof_pipeline_analytics',
    'Compute pipeline performance analytics for a time range from togari_structured_deals in BigQuery. ' +
    'Per pipeline: new opportunities created, stage distribution, ' +
    'win rate, closed lost reason breakdown, and pipeline coverage vs. revenue target. ' +
    'Returns structured data with bottleneck identification. ' +
    'Note: stage conversion rates require a stage_history table not yet in the schema.',
    {
      pipeline: z.enum(['all', 'partnerships', 'inbound', 'outbound']).optional()
        .describe('Which pipeline to analyze — defaults to all if not specified'),
      start_date: z.string().describe('Analysis start date in YYYY-MM-DD format'),
      end_date: z.string().describe('Analysis end date in YYYY-MM-DD format'),
      target_revenue: z.number().optional()
        .describe('Optional revenue target for the period — used to compute pipeline coverage ratio'),
    },
    async (params) => {
      try {
        const config = getDealStoreConfig();
        const pipeline = params.pipeline || 'all';

        const metrics = await getPipelineMetrics(config, {
          pipeline: pipeline as 'all' | 'partnerships' | 'inbound' | 'outbound',
          startDate: params.start_date,
          endDate: params.end_date,
        });

        // Identify bottleneck stages — active stages with lowest deal counts
        const bottlenecks: { stage: string; pipeline: string; count: number }[] = [];
        for (const m of metrics) {
          const activeStages = m.byStage
            .filter((s) => !['closed_won', 'closed_lost', 'nurture', 'not_a_fit'].includes(s.stage))
            .sort((a, b) => a.count - b.count);
          if (activeStages.length > 0) {
            bottlenecks.push({
              stage: activeStages[0].stage,
              pipeline: m.pipeline,
              count: activeStages[0].count,
            });
          }
        }

        // Pipeline coverage calculation (if target_revenue provided)
        let coverage: Record<string, { weighted_value_index: number; target: number; ratio: number }> | null = null;
        if (params.target_revenue) {
          const activeDeals = await listDeals(config, {
            pipeline: pipeline !== 'all' ? pipeline as 'partnerships' | 'inbound' | 'outbound' : undefined,
            excludeTerminal: true,
          });

          const byPipeline = new Map<string, number>();
          for (const d of activeDeals) {
            const weight = STAGE_WEIGHT[d.stage] ?? 0;
            byPipeline.set(d.pipeline, (byPipeline.get(d.pipeline) ?? 0) + weight);
          }

          coverage = {};
          for (const [pl, weightedIdx] of byPipeline) {
            coverage[pl] = {
              weighted_value_index: Math.round(weightedIdx * 100) / 100,
              target: params.target_revenue,
              ratio: Math.round((weightedIdx / params.target_revenue) * 10000) / 100,
            };
          }
        }

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              period: { start: params.start_date, end: params.end_date },
              pipelines: metrics,
              bottlenecks,
              coverage,
              note_on_conversion_rates:
                'Stage-transition conversion rates (e.g. discovery → proposal) require a ' +
                'stage_history table that does not yet exist in the schema. Only current-state ' +
                'metrics are computed. Add a stage_changed_at column and stage_history table ' +
                'to enable conversion tracking.',
            }, null, 2),
          }],
        };
      } catch (err) {
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              error: 'pipeline_analytics_failed',
              message: err instanceof Error ? err.message : String(err),
            }, null, 2),
          }],
        };
      }
    },
  );
}
