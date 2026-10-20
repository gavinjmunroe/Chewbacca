/**
 * @togari/bof-server/agents
 * Registers all Bottom of Funnel agents
 *
 * 3 agent types from the BOF spec:
 *   1. Proposal Generator — generate proposals and SOWs for qualified opportunities
 *   2. Pilot Tracker — track pilot/trial status and milestones
 *   3. Onboarding Orchestrator — route and manage the onboarding process
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp';
import { registerProposalGeneratorTools } from './proposal-generator';
import { registerPilotTrackerTools } from './pilot-tracker';
import { registerOnboardingOrchestratorTools } from './onboarding-orchestrator';

export function registerAllBofAgents(server: McpServer): void {
  registerProposalGeneratorTools(server);
  registerPilotTrackerTools(server);
  registerOnboardingOrchestratorTools(server);
}
