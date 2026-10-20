/**
 * MOF Meeting Router (Enhanced)
 * Processes Fireflies transcripts, calendar events, or chat dumps labeled "post-call".
 * Extracts outcomes, objections, buying roles, timeline, competitors.
 * Generates 5-7 bullet Call Debrief + 3-5 recommended next actions.
 *
 * When deal_id or company is known, immediately appends a meeting note to the deal
 * via deal-store.ts so the record is updated before Claude processes the deeper analysis.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp';
import { z } from 'zod';
import {
  updateDeal,
  searchDeals,
  type DealStoreConfig,
} from './deal-store.js';

const pipelineTypeSchema = z.enum(['partnerships', 'inbound', 'outbound']);

function getDealStoreConfig(): DealStoreConfig {
  return {
    projectId: process.env.GCP_PROJECT_ID ?? 'midyear-glazing-485303-u3',
    dataset: process.env.BIGQUERY_DATASET ?? 'togari_data_lake',
    table: process.env.BIGQUERY_DEALS_TABLE ?? 'togari_structured_deals',
    credentialsPath: process.env.GOOGLE_APPLICATION_CREDENTIALS,
    gcpCredentialsBase64: process.env.GCP_CREDENTIALS_BASE64,
  };
}

export function registerMeetingRouterTools(server: McpServer): void {

  // @ts-ignore
  server.tool(
    'mof_meeting_router',
    'Process a meeting or call into structured deal intelligence. ' +
    'Accepts: Fireflies transcript, calendar event notes, or chat dump. ' +
    'Extracts: outcomes, objections, buying roles, timeline, competitors. ' +
    'Generates Call Debrief + recommended next actions. ' +
    'Automatically appends a meeting note to the deal when deal_id or company is known. ' +
    'Asks for confirmation before major stage jumps.',
    {
      source_type: z.enum(['fireflies_transcript', 'calendar_event', 'chat_dump', 'manual_notes']).describe('Where this meeting data came from'),
      meeting_content: z.string().describe('The transcript, notes, or dump to process'),
      company: z.string().optional().describe('Company name if known'),
      contact_names: z.string().optional().describe('Comma-separated attendees if known'),
      pipeline: pipelineTypeSchema.optional().describe('Pipeline if known'),
      deal_id: z.string().optional().describe('Deal ID if known'),
      rep_who_attended: z.string().optional().describe('Which team member ran the meeting'),
      meeting_date: z.string().optional().describe('Meeting date YYYY-MM-DD'),
    },
    async (params) => {
      const config = getDealStoreConfig();
      let dealWriteResult: { deal_id: string; updated_at: string } | null = null;

      // Attempt to write a meeting note immediately if we can identify the deal
      const noteText = `Meeting processed (${params.source_type})${params.meeting_date ? ` on ${params.meeting_date}` : ''}.${params.contact_names ? ` Attendees: ${params.contact_names}.` : ''}${params.rep_who_attended ? ` Rep: ${params.rep_who_attended}.` : ''}`;

      try {
        if (params.deal_id) {
          // Deal ID is known — write directly
          const result = await updateDeal(config, { deal_id: params.deal_id, notes: noteText });
          dealWriteResult = { deal_id: result.deal_id, updated_at: result.updated_at };
        } else if (params.company) {
          // Search by company; write if exactly one match
          const matches = await searchDeals(config, {
            query: params.company,
            pipeline: params.pipeline,
          });
          const exactMatch = matches.filter(
            (d) => d.company.toLowerCase() === params.company!.toLowerCase(),
          );
          if (exactMatch.length === 1) {
            const result = await updateDeal(config, { deal_id: exactMatch[0].deal_id, notes: noteText });
            dealWriteResult = { deal_id: result.deal_id, updated_at: result.updated_at };
          }
        }
      } catch {
        // Non-fatal — the instruction string still goes out for Claude to handle
      }

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            action: 'meeting_processing',
            ...(dealWriteResult && {
              deal_note_saved: {
                deal_id: dealWriteResult.deal_id,
                updated_at: dealWriteResult.updated_at,
                note: noteText,
              },
            }),
            instructions: `You are the MOF Meeting Router. Process this meeting into structured deal intelligence.

SOURCE: ${params.source_type}
${params.company ? `COMPANY: ${params.company}` : ''}
${params.contact_names ? `ATTENDEES: ${params.contact_names}` : ''}
${params.pipeline ? `PIPELINE: ${params.pipeline}` : ''}
${params.deal_id ? `DEAL ID: ${params.deal_id}` : ''}
${params.rep_who_attended ? `OUR REP: ${params.rep_who_attended}` : ''}
${params.meeting_date ? `DATE: ${params.meeting_date}` : ''}
${dealWriteResult ? `\nNOTE: A meeting note has already been saved to deal ${dealWriteResult.deal_id}.` : ''}

MEETING CONTENT:
${params.meeting_content}

STEP 1: IDENTIFY
- Account and contact(s)
- Pipeline and motion (partnerships/inbound/outbound)
- Which of our team attended

STEP 2: EXTRACT
- Call objective (what was the goal going in?)
- Key decisions made
- Objections raised (exact words if possible)
- Buying committee roles detected (champion, economic buyer, technical evaluator, blocker)
- Timeline and constraints
- Competitors mentioned
- Product questions or feature requests

STEP 3: UPDATE OR CREATE DEAL
- If deal_id provided, update it
- If no deal_id, search by company + contacts
- If no match, create new deal
- Set stage, owner, next action + due date
- Ask for confirmation before major stage jumps (to verbal_commit or closed_lost)

STEP 4: OUTPUT CALL DEBRIEF
5-7 bullet summary:
1. One-line: what this meeting was about
2. Key outcome/decision
3. Their biggest concern or objection
4. Who in their org has the most influence
5. Timeline they stated
6. What we committed to (by when, by whom)
7. What they committed to

STEP 5: RECOMMEND NEXT ACTIONS
3-5 specific actions:
- Include recommended email templates or resources from the Playbook
- Flag risks that could stall the deal
- If Gwen should be involved (partnership angle), say so
- If Karthik should be involved (product question), say so

MEETING ROUTING CONTEXT:
Mike and Maggie triage ALL meetings to Kevin.
Kevin is the closer — he runs the meetings.

Return JSON: { callDebrief, dealUpdate, nextActions[], risks[], gwenFlag, karthikFlag }`,
          }, null, 2),
        }],
      };
    },
  );
}
