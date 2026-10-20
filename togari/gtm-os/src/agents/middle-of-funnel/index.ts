/**
 * @togari/mof-server/agents
 * Registers all Middle of Funnel agents
 *
 * 13 agent types from the master MOF spec:
 *   1. Orchestrator — routes requests to the right agent
 *   2. Reply Router — classifies replies, proposes responses
 *   3. Meeting Router — processes post-call, extracts insights
 *   4. Fireflies Agent — normalizes transcripts into deal updates
 *   5. Gmail Agent — processes email threads into deal updates
 *   6. Chat Dump Interpreter — structures messy notes into deal updates
 *   7. Deal Manager — CRUD for deals across 3 pipelines
 *   8. Kanban View — pipeline visualization
 *   9. Pipeline Analytics — conversion rates, cycle time, win rates
 *  10. Rep Analytics — per-rep performance and coaching
 *  11. Inbound Lead Agent — processes inbound leads
 *  12. Outbound Lead Agent — processes outbound prospects
 *  13. Partnerships Agent — handles BD/partner conversations
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp';
import { registerOrchestratorTools } from './orchestrator';
import { registerReplyRouterTools } from './reply-router';
import { registerMeetingRouterTools } from './meeting-router';
import { registerFirefliesAgentTools } from './fireflies-agent';
import { registerGmailAgentTools } from './gmail-agent';
import { registerChatDumpTools } from './chat-dump-interpreter';
import { registerDealManagerTools } from './deal-manager';
import { registerKanbanViewTools } from './kanban-view';
import { registerPipelineAnalyticsTools } from './pipeline-analytics';
import { registerRepAnalyticsTools } from './rep-analytics';
import { registerPlaybookTools } from './playbook-agent';

export function registerAllMofAgents(server: McpServer): void {
  registerOrchestratorTools(server);
  registerReplyRouterTools(server);
  registerMeetingRouterTools(server);
  registerFirefliesAgentTools(server);
  registerGmailAgentTools(server);
  registerChatDumpTools(server);
  registerDealManagerTools(server);
  registerKanbanViewTools(server);
  registerPipelineAnalyticsTools(server);
  registerRepAnalyticsTools(server);
  registerPlaybookTools(server);
}
