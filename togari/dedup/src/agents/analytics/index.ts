/**
 * @togari/analytics-server/agents
 * Registers all Analytics agents
 *
 * 3 agent types from the Analytics spec:
 *   1. Cross-Funnel Analytics — run analytics across all 5 funnel stages
 *   2. Data Enrichment — enrich deal and contact data via Clay, Structify, Exa
 *   3. Data Pipeline — execute data engineering pipelines (BMA internal + Healthcare GTM)
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp';
import { registerCrossFunnelAnalyticsTools } from './cross-funnel-analytics';
import { registerDataEnrichmentTools } from './data-enrichment';
import { registerDataPipelineTools } from './data-pipeline';

export function registerAllAnalyticsAgents(server: McpServer): void {
  registerCrossFunnelAnalyticsTools(server);
  registerDataEnrichmentTools(server);
  registerDataPipelineTools(server);
}
