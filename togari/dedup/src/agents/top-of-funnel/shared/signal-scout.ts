/**
 * @togari/bma-content/agents/top-of-funnel/signal-scout
 * MCP tool: Generate a signal package for a prospect
 * Agent 1: Signal Scout
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp';
import { z } from 'zod';
import { buildSignalGenerationPrompt } from '../../../prompts/signal-generation';
import { buyerPersonaSchema } from '../../../schemas/enums';

export const TOOL_NAME = 'generate_signal_package';
export const TOOL_DESCRIPTION =
  'Generate a complete 4-step signal package for a prospect account. ' +
  'Combines Togari internal GCP data with external web research to produce a Why Now sentence, ' +
  'signal strength score, and outreach recommendation. ' +
  'If signal strength is below 6/10, recommends HOLD.';

export function registerSignalScoutTools(server: McpServer): void {
  // @ts-ignore
  server.tool(
    TOOL_NAME,
    TOOL_DESCRIPTION,
    {
      company_name: z.string().describe('Company name'),
      domain: z.string().describe('Company domain'),
      contact_name: z.string().describe('Full name of the contact'),
      contact_title: z.string().describe('Contact job title'),
      persona: buyerPersonaSchema.describe('Buyer persona tag: A (VP RevOps), B (Head of Strategy), C (CCO)'),
      segment: z.string().describe('Healthcare subsegment'),
      internal_data_context: z.string().optional().describe(
        'Optional: pre-fetched Togari GCP data relevant to this company'
      ),
    },
    async (params) => {
      const prompt = buildSignalGenerationPrompt({
        companyName: params.company_name,
        domain: params.domain,
        contactName: params.contact_name,
        contactTitle: params.contact_title,
        persona: params.persona,
        segment: params.segment,
        internalDataContext: params.internal_data_context,
      });

      // Return the prompt for Claude to execute
      // The calling Claude instance will process this and return the signal package
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            action: 'signal_generation',
            prompt,
            instructions: 'Execute this signal generation prompt. Research the company externally. ' +
              'Return a JSON signal package. If signal strength is below 6, recommend HOLD.',
            outputSchema: 'SignalPackage from @togari/bma-content/schemas/signal-package',
          }, null, 2),
        }],
      };
    }
  );
}
