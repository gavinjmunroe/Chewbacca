/**
 * @togari/bma-content/agents/top-of-funnel/shared
 * Registers shared MCP tools (signal-scout, conscience-check)
 * and exports internal libraries (research, personalization, sequencing, meeting-booking)
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp';
import { registerSignalScoutTools } from './signal-scout';
import { registerConscienceCheckTools } from './conscience-check';

export function registerSharedTools(server: McpServer): void {
  registerSignalScoutTools(server);
  registerConscienceCheckTools(server);
}

// Re-export internal libraries for channel agents to use
export { research } from './research';
export { personalization } from './personalization';
export { sequencing } from './sequencing';
export { meetingBooking } from './meeting-booking';
