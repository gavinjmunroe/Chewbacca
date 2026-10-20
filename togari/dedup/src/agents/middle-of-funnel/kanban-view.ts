/**
 * MOF Kanban View
 * Generates a visual Kanban board representation of the BMA pipeline.
 * Filterable by pipeline, rep, and time window.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp';
import { z } from 'zod';
import {
  listDeals,
  type DealStoreConfig,
  type DealWithFlags,
} from './deal-store.js';

const STAGE_ORDER = [
  'researching', 'contacted', 'conversation_started',
  'discovery_scheduled', 'discovery_complete',
  'proposal_sent', 'negotiating',
  'verbal_commit', 'contract_sent',
  'nurture', 'not_a_fit',
  'closed_won', 'closed_lost',
] as const;

const STAGE_RANK: Record<string, number> = {
  contract_sent: 8, verbal_commit: 7, negotiating: 6, proposal_sent: 5,
  discovery_complete: 4, discovery_scheduled: 3, conversation_started: 2,
  contacted: 1, researching: 0,
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

function computeSinceDate(timeWindow: string): string | undefined {
  const now = new Date();
  switch (timeWindow) {
    case 'this_week': {
      const d = new Date(now);
      d.setDate(d.getDate() - d.getDay());
      return d.toISOString().slice(0, 10);
    }
    case 'this_month':
      return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
    case 'this_quarter': {
      const qMonth = Math.floor(now.getMonth() / 3) * 3 + 1;
      return `${now.getFullYear()}-${String(qMonth).padStart(2, '0')}-01`;
    }
    default:
      return undefined;
  }
}

export function registerKanbanViewTools(server: McpServer): void {

  // @ts-ignore
  server.tool(
    'mof_kanban_view',
    'Generate a Kanban board view of the BMA pipeline from the BigQuery deals table. ' +
    'Filterable by pipeline (all/partnerships/inbound/outbound), rep, and time window. ' +
    'Columns = deal stages. Cards show owner, value, next action date, and time-in-stage. ' +
    'Also produces a "where the heat is" section identifying deals that need immediate attention.',
    {
      pipeline: z.enum(['all', 'partnerships', 'inbound', 'outbound']).optional()
        .describe('Which pipeline to display — defaults to all if not specified'),
      rep: z.string().optional()
        .describe('Filter by BMA team member name — e.g. "Kevin" or "Maggie"'),
      time_window: z.enum(['this_week', 'this_month', 'this_quarter', 'all'])
        .describe('How far back to look for deal activity'),
      format: z.enum(['summary', 'detailed'])
        .describe('Summary = one-line per deal; Detailed = full card with all fields'),
    },
    async (params) => {
      try {
        const config = getDealStoreConfig();
        const pipelineOpt = params.pipeline === 'all' ? undefined : params.pipeline;
        const since = computeSinceDate(params.time_window);

        const deals = await listDeals(config, {
          pipeline: pipelineOpt,
          owner: params.rep,
          since,
        });

        // Group deals by stage
        const kanban: Record<string, DealWithFlags[]> = {};
        for (const stage of STAGE_ORDER) {
          kanban[stage] = [];
        }
        for (const d of deals) {
          if (!kanban[d.stage]) kanban[d.stage] = [];
          kanban[d.stage].push(d);
        }

        const activeStages = new Set(STAGE_ORDER.slice(0, 9));
        const activeDeals = deals.filter((d) => activeStages.has(d.stage));
        const byStage: Record<string, number> = {};
        const byPipeline: Record<string, number> = {};
        const byOwner: Record<string, number> = {};
        let overdueCount = 0;
        let staleCount = 0;

        for (const d of activeDeals) {
          byStage[d.stage] = (byStage[d.stage] ?? 0) + 1;
          byPipeline[d.pipeline] = (byPipeline[d.pipeline] ?? 0) + 1;
          byOwner[d.owner] = (byOwner[d.owner] ?? 0) + 1;
          if (d.is_overdue) overdueCount++;
          if (d.is_stale) staleCount++;
        }

        const actionRequired = activeDeals
          .filter((d) => d.is_overdue)
          .map((d) => ({
            deal_id: d.deal_id,
            deal_name: d.deal_name,
            company: d.company,
            owner: d.owner,
            next_action: d.next_action,
            next_action_date: d.next_action_date,
          }));

        const atRisk = activeDeals
          .filter((d) => d.is_stale)
          .map((d) => ({
            deal_id: d.deal_id,
            deal_name: d.deal_name,
            company: d.company,
            owner: d.owner,
            stage: d.stage,
            days_since_update: d.days_since_update,
          }));

        const hottestDeals = activeDeals
          .filter((d) => (STAGE_RANK[d.stage] ?? 0) >= 5)
          .sort((a, b) => (STAGE_RANK[b.stage] ?? 0) - (STAGE_RANK[a.stage] ?? 0))
          .slice(0, 5)
          .map((d) => ({
            deal_id: d.deal_id,
            deal_name: d.deal_name,
            company: d.company,
            owner: d.owner,
            stage: d.stage,
            value: d.value,
            next_action: d.next_action,
            next_action_date: d.next_action_date,
          }));

        const kanbanCards: Record<string, unknown[]> = {};
        for (const [stage, stageDeals] of Object.entries(kanban)) {
          if (stageDeals.length === 0) continue;
          kanbanCards[stage] = stageDeals.map((d) => {
            if (params.format === 'detailed') {
              return {
                deal_id: d.deal_id,
                deal_name: d.deal_name,
                company: d.company,
                pipeline: d.pipeline,
                owner: d.owner,
                stage: d.stage,
                value: d.value,
                close_date: d.close_date,
                days_since_update: d.days_since_update,
                created_at: d.created_at,
                next_action: d.next_action,
                next_action_date: d.next_action_date,
                is_overdue: d.is_overdue,
                is_stale: d.is_stale,
              };
            }
            return {
              deal_id: d.deal_id,
              deal_name: d.deal_name,
              company: d.company,
              owner: d.owner,
              value: d.value,
              next_action_date: d.next_action_date,
              days_since_update: d.days_since_update,
              is_overdue: d.is_overdue,
            };
          });
        }

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              summary: {
                total_active: activeDeals.length,
                by_stage: byStage,
                by_pipeline: byPipeline,
                by_owner: byOwner,
                overdue_count: overdueCount,
                stale_count: staleCount,
              },
              kanban: kanbanCards,
              heat: {
                action_required: actionRequired,
                at_risk: atRisk,
                hottest_deals: hottestDeals,
              },
            }, null, 2),
          }],
        };
      } catch (err) {
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              error: 'kanban_view_failed',
              message: err instanceof Error ? err.message : String(err),
            }, null, 2),
          }],
        };
      }
    },
  );
}
