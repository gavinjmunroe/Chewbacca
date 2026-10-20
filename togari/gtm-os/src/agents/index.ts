/**
 * @togari/bma-gtm — Unified GTM OS Agent Registry
 *
 * All 5 funnel stages in one server:
 *   - TOF: 34 tools (8 channels × 4 + 2 shared)
 *   - MOF: 13 tools (Reply Router, Meeting Router, Deal Manager, etc.)
 *   - BOF: 3 tools (Proposal Generator, Pilot Tracker, Onboarding)
 *   - CS:  3 tools (Health Score, QBR Generator, Upsell Detector)
 *   - Analytics: 3 tools (Cross-Funnel, Enrichment, Pipeline)
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp';
import { registerTopOfFunnelAgents } from './top-of-funnel';
import { registerAllMofAgents } from './middle-of-funnel';
import { registerAllBofAgents } from './bottom-of-funnel';
import { registerAllCsAgents } from './customer-success';
import { registerAllAnalyticsAgents } from './analytics';

export function registerAllAgents(server: McpServer): void {
  registerTopOfFunnelAgents(server);
  registerAllMofAgents(server);
  registerAllBofAgents(server);
  registerAllCsAgents(server);
  registerAllAnalyticsAgents(server);
}
