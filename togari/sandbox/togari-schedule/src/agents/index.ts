import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp';
import { registerOpportunityNotificationAgents } from './opportunity-notifications';

export function registerAllAgents(server: McpServer): void {
  registerOpportunityNotificationAgents(server);
}
