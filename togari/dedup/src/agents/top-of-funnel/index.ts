/**
 * @togari/bma-content/agents/top-of-funnel
 * Top of Funnel (Marketing) — Channel-based agent architecture
 *
 * Shared MCP tools:
 *   - generate_signal_package (signal scout)
 *   - glm_conscience_check (conscience check)
 *
 * 8 Channels × 4 tools each = 32 channel tools:
 *   Real:  cold_email, warm_email, linkedin_posting
 *   Stubs: linkedin_dm, instagram_dm, imessage_dm, instagram_posting, x_posting
 *
 * Each channel has: build_list, personalize, create_sequence, book_meeting
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp';
import { registerSharedTools } from './shared';
import { registerAllChannels } from './channels';

export function registerTopOfFunnelAgents(server: McpServer): void {
  // Shared tools (signal-scout + conscience-check)
  registerSharedTools(server);

  // All 8 channel agents (3 real + 5 stubs)
  registerAllChannels(server);
}
