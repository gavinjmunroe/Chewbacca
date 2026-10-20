/**
 * MOF Fireflies Agent
 * Takes the OUTPUT from the native Fireflies MCP connector (transcript text, summary, action items)
 * and normalizes it into the standard BMA call-log format.
 * Links the processed transcript to the correct deal and contact(s) in BigQuery.
 *
 * Usage: Run the Fireflies MCP tools first to fetch transcript content, then pipe
 * that output into this tool for deal-linked normalization.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp';
import { z } from 'zod';

const BQ_TABLE = `${process.env.GCP_PROJECT_ID ?? 'midyear-glazing-485303-u3'}.${process.env.BIGQUERY_DATASET ?? 'togari_data_lake'}.${process.env.BIGQUERY_DEALS_TABLE ?? 'togari_structured_deals'}`;

export function registerFirefliesAgentTools(server: McpServer): void {

  // @ts-ignore
  server.tool(
    'mof_fireflies_process',
    'Process the output from a Fireflies meeting transcript or summary into the standard BMA call-log format. ' +
    'Takes raw transcript text, summary, and action items (fetched via the native Fireflies MCP connector) ' +
    'and extracts: key outcomes, decisions, objections, buying roles, timeline, and competitors. ' +
    'Normalizes everything into a structured call-log entry and links it to the correct deal and contact(s) in BigQuery. ' +
    'Creates or updates the deal record with debrief, stage, and next action.',
    {
      transcript_id: z.string().describe('Fireflies transcript ID (from fireflies_get_transcript)'),
      transcript_text: z.string().describe('Full transcript text from the Fireflies connector'),
      summary: z.string().optional().describe('Meeting summary from Fireflies (from fireflies_get_summary)'),
      action_items: z.string().optional().describe('Action items extracted by Fireflies'),
      meeting_date: z.string().describe('Meeting date in YYYY-MM-DD format'),
      attendees: z.string().describe('Comma-separated list of attendee names and/or emails'),
    },
    async (params) => {
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            action: 'fireflies_normalization',
            instructions: `You are the MOF Fireflies Agent. Your job is to take raw Fireflies output and transform it into a structured BMA call-log entry, then link it to the correct deal and contact(s).

TRANSCRIPT ID: ${params.transcript_id}
MEETING DATE: ${params.meeting_date}
ATTENDEES: ${params.attendees}
${params.summary ? `\nFIREFLIES SUMMARY:\n${params.summary}` : ''}
${params.action_items ? `\nFIREFLIES ACTION ITEMS:\n${params.action_items}` : ''}

FULL TRANSCRIPT:
${params.transcript_text}

---

STEP 1: IDENTIFY ACCOUNT & CONTACTS
- Which company is this with? Extract from attendee emails/names.
- Which BMA team member(s) attended? (Kevin, Mike, Maggie, Gwen, Sagar, Caleb, Karthik)
- Which pipeline does this belong to? (partnerships / inbound / outbound)
- List all contacts on their side with name, title if detectable.

STEP 2: EXTRACT DEAL INTELLIGENCE
Extract all of the following. If not present, note "not mentioned":
- Call objective: What were we trying to accomplish going in?
- Key decisions made during the call
- Objections raised (use their exact words where possible)
- Buying committee roles: champion, economic buyer, technical evaluator, blocker, influencer
- Timeline and urgency signals (any date, quarter, or event mentioned)
- Competitors mentioned (explicitly or implicitly)
- Product/service questions or feature requests
- Budget signals (range, constraints, or procurement process hints)
- Relationship temperature (cold / warm / strong advocate)

STEP 3: NORMALIZE INTO STANDARD CALL-LOG FORMAT
Produce a call-log record with these exact fields:
{
  "transcript_id": "${params.transcript_id}",
  "meeting_date": "${params.meeting_date}",
  "attendees_bma": [...],
  "attendees_prospect": [...],
  "company": "...",
  "pipeline": "partnerships|inbound|outbound",
  "call_objective": "...",
  "key_outcomes": [...],
  "decisions_made": [...],
  "objections": [{ "verbatim": "...", "type": "..." }],
  "buying_roles": { "champion": "...", "economic_buyer": "...", "technical_evaluator": "...", "blocker": "...", "influencer": "..." },
  "timeline": "...",
  "competitors": [...],
  "product_questions": [...],
  "budget_signals": "...",
  "relationship_temperature": "cold|warm|advocate",
  "commitments_bma": [...],
  "commitments_prospect": [...]
}

STEP 4: LINK TO DEAL
- Search BigQuery table ${BQ_TABLE} by company name + pipeline
- If deal found: update with this call-log entry
- If no deal found: prompt to create one via mof_deal_create
- Set deal.last_contact_date to ${params.meeting_date}
- Suggest stage update if warranted (confirm before moving to verbal_commit or closed_lost)
- Set next_action and next_action_due based on commitments extracted

STEP 5: GENERATE CALL DEBRIEF (5-7 bullets)
1. One-line: what this meeting was about
2. Key outcome or decision
3. Biggest concern or objection raised
4. Who has the most influence on their side
5. Timeline they stated
6. What BMA committed to (by whom, by when)
7. What the prospect committed to

STEP 6: NEXT ACTION RECOMMENDATIONS
3-5 specific, concrete actions with suggested owners (Kevin / Mike / Maggie / Gwen) and due dates.
Flag:
- If Gwen should be looped in (partnership or referral angle)
- If Karthik should be looped in (technical or product question)
- Any risks that could stall or kill this deal

Return JSON: { callLog, dealUpdate, callDebrief, nextActions[], risks[], gwenFlag, karthikFlag }`,
          }, null, 2),
        }],
      };
    }
  );
}
