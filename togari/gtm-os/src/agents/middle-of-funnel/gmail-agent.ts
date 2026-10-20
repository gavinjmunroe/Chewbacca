/**
 * MOF Gmail Agent
 * Takes the OUTPUT from the native Gmail MCP connector (thread content) and extracts
 * deal-relevant context: last message status, relationship tone, commitments made.
 * Updates the corresponding deal record and surfaces a suggested next touch.
 *
 * Usage: Fetch the thread via gmail_read_thread or gmail_search_messages first,
 * then pipe that content here for deal-linked processing.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp';
import { z } from 'zod';

const BQ_TABLE = `${process.env.GCP_PROJECT_ID ?? 'midyear-glazing-485303-u3'}.${process.env.BIGQUERY_DATASET ?? 'togari_data_lake'}.${process.env.BIGQUERY_DEALS_TABLE ?? 'togari_structured_deals'}`;

export function registerGmailAgentTools(server: McpServer): void {

  // @ts-ignore
  server.tool(
    'mof_gmail_process',
    'Process the output from a Gmail email thread into structured deal intelligence. ' +
    'Takes thread content fetched via the native Gmail MCP connector and extracts: ' +
    'last message status, reply intent, relationship tone (cold/warm/advocate), and commitments made. ' +
    'Maps the thread to the correct deal in BigQuery, updates the record, and suggests the next touch. ' +
    'Handles full threads, single messages, and forwarded content.',
    {
      thread_content: z.string().describe('Full email thread content from gmail_read_thread or gmail_read_message'),
      contact_email: z.string().describe('Email address of the prospect or partner contact'),
      company: z.string().optional().describe('Company name if known — used to look up the deal'),
      deal_id: z.string().optional().describe('Existing deal ID in togari_structured_deals if already known'),
    },
    async (params) => {
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            action: 'gmail_thread_processing',
            instructions: `You are the MOF Gmail Agent. Process this email thread and extract structured deal intelligence.

CONTACT EMAIL: ${params.contact_email}
${params.company ? `COMPANY: ${params.company}` : ''}
${params.deal_id ? `DEAL ID: ${params.deal_id}` : ''}

EMAIL THREAD:
${params.thread_content}

---

STEP 1: PARSE THE THREAD
- Identify all participants: BMA team members vs. prospect/partner contacts
- Establish chronological order of messages
- Identify the most recent message and who sent it
- Flag if BMA owes a reply (last message is from their side)
- Flag if the prospect/partner owes a reply (last message is from BMA)

STEP 2: EXTRACT RELATIONSHIP CONTEXT
- Contact name(s) and title(s) if mentioned or inferable
- Company (use ${params.company || 'extract from email domain/signature'})
- Pipeline: partnerships, inbound, or outbound — infer from context
- Relationship temperature: cold (no warmth), warm (engaged, responsive), advocate (actively helping)
- Thread tone: transactional, consultative, casual, formal, urgent
- Number of exchanges (depth of conversation)

STEP 3: EXTRACT DEAL UPDATES
Identify and extract:
- Expressed interest level (explicit or implicit)
- Objections or concerns raised
- Commitments made by BMA side (to send materials, schedule a call, follow up by date)
- Commitments made by their side (to review, share internally, get approval)
- Any timeline or budget signals
- Other stakeholders mentioned by name or title
- Any explicit rejection or disqualification signals

STEP 4: CLASSIFY LAST MESSAGE INTENT
Choose one:
- interested_book_call: They want to move forward or schedule something
- needs_info: They asked a question or requested materials
- objection: They raised a concern or pushback
- budget_timing_issue: They cited budget cycle or "not right now"
- internal_referrer: They referred us to someone else on their team
- not_a_fit: They declined or said it is not relevant
- unsubscribe: They asked to stop receiving emails (flag — DO NOT contact again)
- ooo: Out of office auto-reply
- ghosted: BMA sent the last message, no reply in 5+ days
- awaiting_their_action: They committed to something and we are waiting
- unclear: Cannot determine

STEP 5: LINK TO DEAL IN BIGQUERY
- BigQuery table: ${BQ_TABLE}
- Search by: deal_id (if provided), OR company + contact_email
- If deal found: update last_contact_date, last_reply_intent, relationship_temperature, and any new notes
- If no deal found: recommend creating one via mof_deal_create
- Never change deal owner unless explicitly instructed

STEP 6: RECOMMEND NEXT TOUCH
Based on classification, propose ONE specific next action:
- Who should send it (Kevin / Mike / Maggie / Gwen / Caleb)
- What the message should accomplish (not the message itself — use mof_reply_router for that)
- When to send it (today / tomorrow / in X days / when they respond)
- If ghosted: recommend a specific bump strategy
- If unsubscribe: log as closed_lost with reason "unsubscribed" and recommend no further contact

Return JSON: { threadSummary, contactInfo, dealUpdate, lastMessageIntent, nextTouch, flags }`,
          }, null, 2),
        }],
      };
    }
  );
}
