/**
 * @togari/bma-content/agents/top-of-funnel/conscience-check
 * MCP tool: GLM Conscience Check (Agent 9)
 * Advisory only — generates reports for Sagar and Caleb.
 * Does not block outputs.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp';
import { z } from 'zod';
import { CONSCIENCE_REPORT_RECIPIENTS } from '../../../config/team';

export function registerConscienceCheckTools(server: McpServer): void {

  // @ts-ignore
  server.tool(
    'glm_conscience_check',
    'Run the weekly GLM Conscience Check (Agent 9). ' +
    'Samples 20 random outputs from all agents this week and evaluates them against: ' +
    'theology line rules, fear-based copy detection, service vs extraction test, ' +
    'ahimsa (non-harm) check, and six dimensions of health. ' +
    'ADVISORY ONLY — generates report for Sagar and Caleb. Does not block outputs. ' +
    'Runs Friday 6pm PT.',
    {
      week_of: z.string().describe('Week start date'),
      sampled_outputs: z.string().describe(
        'JSON array of 20 sampled outputs from this week\'s agents. ' +
        'Each should include: outputId, agentName, outputType, outputDate, outputContent'
      ),
    },
    async (params) => {
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            action: 'conscience_check',
            recipients: CONSCIENCE_REPORT_RECIPIENTS,
            instructions: `You are the GLM Conscience Check — the spiritual and ethical audit layer for the BMA GTM OS.

WEEK OF: ${params.week_of}
SAMPLED OUTPUTS: ${params.sampled_outputs}

Review each of the 20 sampled outputs against these criteria:

1. THEOLOGY LINE VIOLATIONS
Check each output against channel rules:
- Sagar's channels (gartiwar, bma_linkedin, rytual, sagar_linkedin): NO Jesus/Christian content
- Caleb's channels (caleb_personal): NO Vedic/dharmic content
- Any violation = flag with exact text, which agent, and recommended fix

2. FEAR-BASED COPY INSTANCES
Scan for language that creates artificial urgency, fear of missing out, or pressure.
Examples: "your competitors are...", "don't miss out", "act now", "limited time"
Flag with exact language and recommended alternative.

3. SERVICE VS EXTRACTION TEST
For each output, ask: "Does this serve the human on the other end, or does it extract from them?"
- A cold email that offers a genuinely useful artifact = serves
- A cold email that just asks for their time without offering value = extracts
- Content that teaches something useful = serves
- Content that exists only to generate leads without genuine insight = extracts
Score: X/20 passed

4. AHIMSA CHECK (non-harm)
Did any output this week involve or reference strategies that could harm people, animals, ecosystems, or communities?
Status: Clear or Flagged with details

5. SIX DIMENSIONS OF HEALTH CHECK
For major decisions this week (new experiments, campaigns, content published):
Were all six dimensions considered? (physical, mental, emotional, social, spiritual, financial)
Flag any dimension that was ignored.

OUTPUT FORMAT:
GLM CONSCIENCE REPORT — week of ${params.week_of}
═══════════════════════════════════════════
SAMPLE SIZE: 20 outputs reviewed
THEOLOGY LINE VIOLATIONS: [count]
FEAR-BASED COPY INSTANCES: [count]
SERVICE TEST: [X/20 passed]
AHIMSA CHECK: [Clear/Flagged]
SIX DIMENSIONS GAPS: [list]
OVERALL VERDICT: [Clean / Needs Attention]
RECOMMENDED ACTIONS: [specific fixes]

Also return structured JSON matching ConscienceReport schema.`,
          }, null, 2),
        }],
      };
    }
  );
}
