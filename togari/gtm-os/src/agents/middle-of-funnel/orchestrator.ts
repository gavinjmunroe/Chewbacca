/**
 * MOF Orchestrator — System Brain
 * Routes requests to the right specialized agent.
 * Enforces naming conventions, data hygiene, and pipeline definitions.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp';
import { z } from 'zod';

export function registerOrchestratorTools(server: McpServer): void {

  // @ts-ignore
  server.tool(
    'mof_orchestrator',
    'The MOF system brain. Accepts any sales operations request and routes it to the correct agent. ' +
    'Use this when you are not sure which MOF tool to call — describe the intent and the orchestrator will tell you exactly which tool(s) to invoke and in what order. ' +
    'Also validates that deal updates follow pipeline/stage definitions and data hygiene rules.',
    {
      intent: z.string().describe('What the human wants to do, in plain language'),
      context: z.string().optional().describe('Any additional context: deal name, rep name, pipeline, etc.'),
    },
    async (params) => {
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            action: 'orchestrate',
            instructions: `You are the MOF Orchestrator — the system brain for the Middle of Funnel sales operations system.

A human has asked: "${params.intent}"
${params.context ? `Context: ${params.context}` : ''}

Your job is to:
1. Interpret the intent
2. Choose which MOF tool(s) to call, and in what order
3. Present the plan to the human before executing

AVAILABLE MOF TOOLS:
- mof_reply_router: Classify a reply, propose response options
- mof_meeting_router: Process a meeting/call, generate debrief, update deal
- mof_fireflies_process: Process a Fireflies transcript into deal updates
- mof_gmail_process: Process a Gmail thread into deal updates
- mof_chat_dump: Structure messy notes/dumps into deal updates
- mof_deal_create: Create a new deal in partnerships/inbound/outbound pipeline
- mof_deal_update: Update an existing deal (stage, owner, next action)
- mof_deal_search: Find a deal by company, contact, or pipeline
- mof_kanban_view: Generate a Kanban board for a pipeline, rep, or time window
- mof_pipeline_analytics: Compute pipeline metrics for a time range
- mof_rep_analytics: Compute per-rep performance metrics
- mof_playbook_query: Look up ICP, qualification criteria, email frameworks, objection handling

ROUTING RULES:
- "Process this meeting" → mof_fireflies_process (if transcript available) or mof_meeting_router
- "Classify this reply" → mof_reply_router
- "Show me the pipeline" → mof_kanban_view
- "How is [rep] doing?" → mof_rep_analytics
- "Turn this into a deal" → mof_chat_dump then mof_deal_create
- "Update [deal]" → mof_deal_search then mof_deal_update

FIRST PRINCIPLES (Vedanta-style):
- Non-attachment to tools: prefer simple over clever
- Truth over optimism: reflect real state, not wishes
- Continuous refinement: every interaction improves the system
- Single source of truth: deal status must be unambiguous

Return a JSON plan: { tools: [{name, reason, order}], humanQuestion: "..." }`,
          }, null, 2),
        }],
      };
    }
  );
}
