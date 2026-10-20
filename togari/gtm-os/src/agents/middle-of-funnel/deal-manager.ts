/**
 * MOF Deal Manager
 * CRUD for deals across the three BMA pipelines: partnerships, inbound, outbound.
 * Reads/writes to the BigQuery deals table.
 *
 * Three tools:
 *   mof_deal_create — Create a new deal
 *   mof_deal_update — Update an existing deal
 *   mof_deal_search — Find deals by company, deal name, or owner
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp';
import { z } from 'zod';
import {
  createDeal,
  updateDeal,
  searchDeals,
  type DealStoreConfig,
  type DealRecord,
} from './deal-store.js';
import { publishEvent } from '../../events';

const pipelineSchema = z.enum(['partnerships', 'inbound', 'outbound'])
  .describe('Which of the three BMA pipelines this deal belongs to');

const stageSchema = z.enum([
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
  'closed_lost',
  'nurture',
  'not_a_fit',
]).describe('Current stage of the deal');

function getDealStoreConfig(): DealStoreConfig {
  return {
    projectId: process.env.GCP_PROJECT_ID ?? 'midyear-glazing-485303-u3',
    dataset: process.env.BIGQUERY_DATASET ?? 'togari_data_lake',
    table: process.env.BIGQUERY_DEALS_TABLE ?? 'togari_structured_deals',
    credentialsPath: process.env.GOOGLE_APPLICATION_CREDENTIALS,
    gcpCredentialsBase64: process.env.GCP_CREDENTIALS_BASE64,
  };
}

export function registerDealManagerTools(server: McpServer): void {

  // ─── mof_deal_create ────────────────────────────────────────────────────────

  // @ts-ignore
  server.tool(
    'mof_deal_create',
    'Create a new deal in the BMA pipeline. ' +
    'Writes to the BigQuery deals table. ' +
    'Returns the new deal_id. ' +
    'Do not create duplicate deals — run mof_deal_search first if unsure.',
    {
      deal_name: z.string().describe('Name of the deal — e.g. "Acme Corp - Enterprise Pilot"'),
      company: z.string().describe('Company name'),
      client_id: z.string().optional().describe('Client ID if known'),
      pipeline: pipelineSchema,
      stage: stageSchema,
      owner: z.string().describe('BMA team member who owns this deal (Kevin, Mike, Maggie, Gwen, Caleb, Sagar)'),
      value: z.number().optional().describe('Estimated deal value in dollars'),
      close_date: z.string().optional().describe('Expected close date in YYYY-MM-DD format'),
      next_action: z.string().describe('The single most important next action to move this deal forward'),
      next_action_date: z.string().describe('Due date for next action in YYYY-MM-DD format'),
      notes: z.string().optional().describe('Initial notes for the deal'),
    },
    async (params) => {
      try {
        const config = getDealStoreConfig();

        // Duplicate check — same company + pipeline
        const existing = await searchDeals(config, {
          query: params.company,
          pipeline: params.pipeline,
        });
        const duplicate = existing.find(
          (d) => d.company.toLowerCase() === params.company.toLowerCase(),
        );
        if (duplicate) {
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({
                error: 'potential_duplicate',
                message: `A deal for "${duplicate.company}" already exists in the ${params.pipeline} pipeline (deal_id: ${duplicate.deal_id}, stage: ${duplicate.stage}, owner: ${duplicate.owner}). Confirm this is a distinct deal before proceeding.`,
                existing_deal: {
                  deal_id: duplicate.deal_id,
                  deal_name: duplicate.deal_name,
                  company: duplicate.company,
                  pipeline: duplicate.pipeline,
                  stage: duplicate.stage,
                  owner: duplicate.owner,
                  updated_at: duplicate.updated_at,
                },
              }, null, 2),
            }],
          };
        }

        const result = await createDeal(config, params);

        // Fire-and-forget event
        publishEvent('deal_created', {
          deal_id: result.deal_id,
          deal_name: params.deal_name,
          company: params.company,
          pipeline: params.pipeline,
          stage: params.stage,
          owner: params.owner,
          value: params.value ?? null,
          deal_source: null,
        });

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              success: true,
              deal_id: result.deal_id,
              deal_name: params.deal_name,
              company: params.company,
              pipeline: params.pipeline,
              stage: params.stage,
              owner: params.owner,
              next_action: params.next_action,
              next_action_date: params.next_action_date,
              created_at: result.created_at,
            }, null, 2),
          }],
        };
      } catch (err) {
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              error: 'create_failed',
              message: err instanceof Error ? err.message : String(err),
            }, null, 2),
          }],
        };
      }
    },
  );

  // ─── mof_deal_update ────────────────────────────────────────────────────────

  // @ts-ignore
  server.tool(
    'mof_deal_update',
    'Update an existing deal in the BigQuery deals table. ' +
    'Only updates fields explicitly provided — never overwrites fields not included in the call. ' +
    'Never changes deal owner without explicit instruction. ' +
    'Always updates updated_at timestamp.',
    {
      deal_id: z.string().describe('BigQuery deal_id of the deal to update'),
      deal_name: z.string().optional().describe('Updated deal name'),
      stage: stageSchema.optional().describe('New stage'),
      owner: z.string().optional().describe('New owner — only provide when explicitly transferring ownership'),
      value: z.number().optional().describe('Updated deal value in dollars'),
      close_date: z.string().optional().describe('Updated expected close date in YYYY-MM-DD format'),
      next_action: z.string().optional().describe('Updated next action'),
      next_action_date: z.string().optional().describe('Updated due date for next action in YYYY-MM-DD format'),
      notes: z.string().optional().describe('Note to append to existing deal notes'),
    },
    async (params) => {
      try {
        const result = await updateDeal(getDealStoreConfig(), params);

        // Fire-and-forget event
        publishEvent('deal_updated', {
          deal_id: result.deal_id,
          fields_updated: result.fields_updated,
          changes: Object.fromEntries(
            result.fields_updated.map((f: string) => [f, (params as Record<string, unknown>)[f]]),
          ),
        });

        // If stage changed, emit a separate stage change event
        if (params.stage) {
          publishEvent('deal_stage_changed', {
            deal_id: result.deal_id,
            deal_name: params.deal_name ?? result.deal_id,
            company: '',
            pipeline: '',
            previous_stage: '',
            new_stage: params.stage,
            owner: params.owner ?? '',
          });
        }

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              success: true,
              deal_id: result.deal_id,
              fields_updated: result.fields_updated,
              updated_at: result.updated_at,
            }, null, 2),
          }],
        };
      } catch (err) {
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              error: 'update_failed',
              message: err instanceof Error ? err.message : String(err),
            }, null, 2),
          }],
        };
      }
    },
  );

  // ─── mof_deal_search ────────────────────────────────────────────────────────

  // @ts-ignore
  server.tool(
    'mof_deal_search',
    'Find deals in the BigQuery deals table by company name, deal name, or owner. ' +
    'Optionally filter by pipeline. ' +
    'Returns matching deals with key fields. ' +
    'Use this before mof_deal_create to avoid duplicates, and before mof_deal_update when you do not have the deal_id.',
    {
      query: z.string().describe('Search term — company name, deal name, or owner'),
      pipeline: pipelineSchema.optional().describe('Filter results to a specific pipeline'),
    },
    async (params) => {
      try {
        const deals = await searchDeals(getDealStoreConfig(), params);

        const summarized = deals.map((d: DealRecord) => ({
          deal_id: d.deal_id,
          deal_name: d.deal_name,
          company: d.company,
          pipeline: d.pipeline,
          stage: d.stage,
          owner: d.owner,
          value: d.value,
          close_date: d.close_date,
          next_action: d.next_action,
          next_action_date: d.next_action_date,
          updated_at: d.updated_at,
          summary: `${d.deal_name} (${d.pipeline}) — ${d.owner} — ${d.stage} — next: ${d.next_action} by ${d.next_action_date}`,
        }));

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              total_matches: summarized.length,
              deals: summarized,
              ...(summarized.length === 0 && {
                suggestion: 'No matches found. Try a different search term or create a new deal with mof_deal_create.',
              }),
            }, null, 2),
          }],
        };
      } catch (err) {
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              error: 'search_failed',
              message: err instanceof Error ? err.message : String(err),
            }, null, 2),
          }],
        };
      }
    },
  );
}
