/**
 * @togari/bma-content/agents/top-of-funnel/channels
 * Registers all 8 channel agents (3 real + 5 stubs)
 * Each channel has 4 tools: build_list, personalize, create_sequence, book_meeting
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp';

// Real channels
import { registerColdEmailTools } from './cold-email';
import { registerWarmEmailTools } from './warm-email';
import { registerLinkedInPostingTools } from './linkedin-posting';

// Stub channels
import { registerLinkedInDmTools } from './linkedin-dm';
import { registerInstagramDmTools } from './instagram-dm';
import { registerIMessageDmTools } from './imessage-dm';
import { registerInstagramPostingTools } from './instagram-posting';
import { registerXPostingTools } from './x-posting';

export function registerAllChannels(server: McpServer): void {
  // Real channels — fully implemented
  registerColdEmailTools(server);
  registerWarmEmailTools(server);
  registerLinkedInPostingTools(server);

  // Stub channels — return not_yet_implemented
  registerLinkedInDmTools(server);
  registerInstagramDmTools(server);
  registerIMessageDmTools(server);
  registerInstagramPostingTools(server);
  registerXPostingTools(server);
}
