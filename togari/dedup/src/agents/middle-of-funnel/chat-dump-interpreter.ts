/**
 * MOF Chat Dump Interpreter
 * Handles the messy reality of sales operations: humans pasting raw notes, bullet dumps,
 * screenshot descriptions, Slack threads, or stream-of-consciousness updates after a meeting.
 * Identifies which account(s) and contact(s) are involved, extracts a structured summary,
 * proposes deal updates, and asks clarifying questions when information is incomplete.
 *
 * When context_hint identifies a unique deal, immediately logs the dump ingestion
 * via deal-store.ts so the record is timestamped before Claude processes the content.
 *
 * This is the "intake valve" — when something does not fit a clean Fireflies or Gmail flow,
 * it comes here first.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp';
import { z } from 'zod';
import {
  updateDeal,
  searchDeals,
  type DealStoreConfig,
} from './deal-store.js';

function getDealStoreConfig(): DealStoreConfig {
  return {
    projectId: process.env.GCP_PROJECT_ID ?? 'midyear-glazing-485303-u3',
    dataset: process.env.BIGQUERY_DATASET ?? 'togari_data_lake',
    table: process.env.BIGQUERY_DEALS_TABLE ?? 'togari_structured_deals',
    credentialsPath: process.env.GOOGLE_APPLICATION_CREDENTIALS,
    gcpCredentialsBase64: process.env.GCP_CREDENTIALS_BASE64,
  };
}

export function registerChatDumpTools(server: McpServer): void {

  // @ts-ignore
  server.tool(
    'mof_chat_dump',
    'Interpret messy raw notes, bullet dumps, screenshot descriptions, or stream-of-consciousness updates ' +
    'that a human pastes after a meeting or conversation. ' +
    'Identifies which account(s) and contact(s) are involved, extracts a structured deal summary, ' +
    'and proposes deal updates. ' +
    'Automatically logs dump ingestion to the deal when context_hint identifies a unique match. ' +
    'Asks targeted clarifying questions when pipeline, ownership, or next action are ambiguous. ' +
    'Use this when the input does not cleanly fit the Fireflies or Gmail flow.',
    {
      raw_dump: z.string().describe('The raw notes, bullets, screenshot description, or unstructured text to interpret'),
      context_hint: z.string().optional().describe('Optional framing hint, e.g. "this is about Aledade" or "post-call with Kevin"'),
    },
    async (params) => {
      const config = getDealStoreConfig();
      let dealWriteResult: { deal_id: string; company: string; updated_at: string } | null = null;

      // If context_hint is provided, try to find the deal and log the ingestion
      if (params.context_hint) {
        try {
          const matches = await searchDeals(config, { query: params.context_hint });
          if (matches.length === 1) {
            const noteText = `Chat dump ingested. Context: ${params.context_hint}. Raw length: ${params.raw_dump.length} chars.`;
            const result = await updateDeal(config, { deal_id: matches[0].deal_id, notes: noteText });
            dealWriteResult = {
              deal_id: result.deal_id,
              company: matches[0].company,
              updated_at: result.updated_at,
            };
          }
        } catch {
          // Non-fatal — the instruction string still goes out for Claude to handle
        }
      }

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            action: 'chat_dump_interpretation',
            ...(dealWriteResult && {
              deal_note_saved: {
                deal_id: dealWriteResult.deal_id,
                company: dealWriteResult.company,
                updated_at: dealWriteResult.updated_at,
              },
            }),
            instructions: `You are the MOF Chat Dump Interpreter. A human has pasted raw, unstructured content and you need to make sense of it.

${params.context_hint ? `CONTEXT HINT: ${params.context_hint}\n` : ''}
${dealWriteResult ? `NOTE: Dump ingestion has been logged to deal ${dealWriteResult.deal_id} (${dealWriteResult.company}).\n` : ''}

RAW DUMP:
${params.raw_dump}

---

STEP 1: TRIAGE
Determine what type of content this is:
- post_call_notes: Notes taken during or after a sales call
- email_thread_paste: Email content pasted in raw
- slack_thread: Slack conversation dump
- screenshot_description: Someone describing what they saw in a screenshot
- bullet_list: Quick unstructured bullets about a deal or meeting
- mixed: Multiple types combined
- unclear: Cannot determine without clarification

STEP 2: IDENTIFY ACCOUNT(S) AND CONTACT(S)
Extract every company name and person name mentioned. For each:
- Company: name, any known pipeline association
- Contact: name, title (if mentioned), email (if mentioned)
- BMA team member(s) involved: Kevin, Mike, Maggie, Gwen, Sagar, Caleb, Karthik
- Relationship between parties

If multiple companies are mentioned, list all and note if they are related (e.g., parent/subsidiary, partner network).

STEP 3: EXTRACT WHAT YOU CAN
Pull out everything extractable — do NOT skip partial information:
- Meeting or conversation date (explicit or inferred)
- What was discussed
- Any decisions made
- Any objections or concerns
- Any commitments (BMA side and prospect side)
- Timeline or urgency signals
- Budget signals
- Competitors mentioned
- Next steps mentioned

STEP 4: ASSESS COMPLETENESS
For each of the following required fields, mark KNOWN or MISSING:
- Company: [known/missing]
- Pipeline (partnerships/inbound/outbound): [known/missing]
- Deal owner (BMA rep): [known/missing]
- Stage: [known/missing]
- Next action: [known/missing]
- Next action due date: [known/missing]
- Primary contact: [known/missing]

STEP 5: PROPOSE DEAL UPDATE
Based on what was extracted, propose:
{
  "company": "...",
  "pipeline": "partnerships|inbound|outbound|unknown",
  "stage": "...",
  "owner": "...",
  "notes": "...",
  "next_action": "...",
  "next_action_due": "..."
}

Mark any field you cannot determine with null and include it in the clarification questions.

STEP 6: ASK CLARIFYING QUESTIONS (if needed)
For each MISSING required field, ask ONE specific question. Be direct — no fluff.
Good: "Which pipeline is this — partnerships, inbound, or outbound?"
Bad: "Could you perhaps clarify which pipeline this might belong to?"

Maximum 3 clarifying questions. Prioritize:
1. Pipeline (always ask if missing — never assume)
2. Deal owner (always ask if missing)
3. Next action + due date (ask as one question)

If all required fields are known: skip this step and proceed directly to proposing the deal create or update.

STEP 7: RECOMMEND NEXT TOOL
Tell the human which MOF tool to run next:
- If new deal: "Run mof_deal_create with the following params: ..."
- If existing deal: "Run mof_deal_update with deal_id [X] and these params: ..."
- If needs more context first: "Answer the questions above, then I will route to the correct tool"

Return JSON: { contentType, accounts[], contacts[], extractedData, completenessCheck, proposedDealUpdate, clarifyingQuestions[], recommendedNextTool }`,
          }, null, 2),
        }],
      };
    },
  );
}
