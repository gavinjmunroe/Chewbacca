/**
 * MOF Rep Analytics
 * Computes per-rep performance metrics for a given time range.
 * For each rep: deals owned, created, and closed; win rate; average cycle time;
 * overdue actions; stale deals; and the stage where their deals stall most.
 *
 * Returns structured data with a team comparison table.
 *
 * Data source: BigQuery table togari_structured_deals via deal-store.ts.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp';
import { z } from 'zod';
import {
  getRepMetrics,
  type DealStoreConfig,
  type RepMetrics,
} from './deal-store.js';

function getDealStoreConfig(): DealStoreConfig {
  return {
    projectId: process.env.GCP_PROJECT_ID ?? 'midyear-glazing-485303-u3',
    dataset: process.env.BIGQUERY_DATASET ?? 'togari_data_lake',
    table: process.env.BIGQUERY_DEALS_TABLE ?? 'togari_structured_deals',
    credentialsPath: process.env.GOOGLE_APPLICATION_CREDENTIALS,
    gcpCredentialsBase64: process.env.GCP_CREDENTIALS_BASE64,
  };
}

export function registerRepAnalyticsTools(server: McpServer): void {

  // @ts-ignore
  server.tool(
    'mof_rep_analytics',
    'Compute per-rep performance metrics from togari_structured_deals in BigQuery. ' +
    'For each specified rep: deals owned, created, and closed; win rate; ' +
    'average cycle time; overdue actions; stale deals; and the stage where their deals stall most. ' +
    'Returns structured data with a team comparison table.',
    {
      rep_names: z.string().describe('Comma-separated list of BMA team member names to analyze — e.g. "Kevin, Maggie" or "all"'),
      start_date: z.string().describe('Analysis start date in YYYY-MM-DD format'),
      end_date: z.string().describe('Analysis end date in YYYY-MM-DD format'),
    },
    async (params) => {
      try {
        const config = getDealStoreConfig();

        // Parse rep names: "all" → empty array (all owners), otherwise split on comma
        const reps = params.rep_names.toLowerCase().trim() === 'all'
          ? []
          : params.rep_names.split(',').map((r) => r.trim()).filter(Boolean);

        const metrics = await getRepMetrics(config, {
          reps: reps.length > 0 ? reps : undefined,
          startDate: params.start_date,
          endDate: params.end_date,
        });

        // Build team comparison table sorted by win rate descending
        const comparison = metrics
          .map((m: RepMetrics) => ({
            rep: m.owner,
            total_owned: m.totalOwned,
            win_rate: m.winRate,
            avg_cycle_days: m.avgCycleDays,
            stall_stage: m.stallStage?.stage ?? null,
            overdue_actions: m.overdueActions,
            stale_deals: m.staleDeals,
          }))
          .sort((a, b) => (b.win_rate ?? -1) - (a.win_rate ?? -1));

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              period: { start: params.start_date, end: params.end_date },
              reps: metrics,
              team_comparison: comparison,
            }, null, 2),
          }],
        };
      } catch (err) {
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              error: 'rep_analytics_failed',
              message: err instanceof Error ? err.message : String(err),
            }, null, 2),
          }],
        };
      }
    },
  );
}
