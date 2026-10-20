/**
 * @togari/cs-server/agents
 * Registers all Customer Success agents
 *
 * 3 agent types from the CS spec:
 *   1. Health Score — monitor customer health scores
 *   2. QBR Generator — generate Quarterly Business Reviews
 *   3. Upsell Detector — detect upsell/expansion signals
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp';
import { registerHealthScoreTools } from './health-score';
import { registerQbrGeneratorTools } from './qbr-generator';
import { registerUpsellDetectorTools } from './upsell-detector';

export function registerAllCsAgents(server: McpServer): void {
  registerHealthScoreTools(server);
  registerQbrGeneratorTools(server);
  registerUpsellDetectorTools(server);
}
