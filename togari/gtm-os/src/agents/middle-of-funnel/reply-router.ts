/**
 * MOF Reply Router (Enhanced)
 * Classifies inbound replies, maps to deals, generates response options.
 * Handles: positive, neutral, objection, scheduling, referral, unsubscribe, OOO, spam.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp';
import { z } from 'zod';

const replyIntentSchema = z.enum([
  'interested_book_call',
  'needs_info',
  'objection',
  'budget_timing_issue',
  'internal_referrer',
  'not_a_fit',
  'unsubscribe',
  'ooo',
  'spam',
  'unclear',
]);

const pipelineTypeSchema = z.enum(['partnerships', 'inbound', 'outbound']);

export function registerReplyRouterTools(server: McpServer): void {

  // @ts-ignore
  server.tool(
    'mof_reply_router',
    'Classify an inbound email reply and generate 2-3 tailored response options. ' +
    'Maps reply to existing deal or creates new one. Updates stage and logs the reply. ' +
    'For objections, pulls from Playbook Agent with questions to advance the sale. ' +
    'Escalates edge cases with summary and recommended action.',
    {
      reply_body: z.string().describe('The full reply text'),
      original_email: z.string().optional().describe('The email we sent that they replied to'),
      contact_name: z.string().describe('Who replied'),
      contact_title: z.string().optional().describe('Their job title'),
      contact_email: z.string().email().describe('Their email address'),
      company: z.string().describe('Company name'),
      pipeline: pipelineTypeSchema.optional().describe('Which pipeline this belongs to'),
      deal_id: z.string().optional().describe('Existing deal ID if known'),
    },
    async (params) => {
      // Quick unsubscribe detection
      const replyLower = params.reply_body.toLowerCase().trim();
      const isUnsubscribe =
        replyLower.includes('remove me') ||
        replyLower.includes('unsubscribe') ||
        replyLower === 'not interested' ||
        replyLower === 'not interested.' ||
        replyLower.includes('take me off') ||
        replyLower.includes('stop emailing');

      const isOoo = replyLower.includes('out of office') ||
        replyLower.includes('on vacation') ||
        replyLower.includes('away from') ||
        replyLower.includes('auto-reply');

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            action: 'reply_classification',
            quickDetection: {
              unsubscribe: isUnsubscribe,
              ooo: isOoo,
            },
            instructions: `You are the MOF Reply Router. Classify this reply and generate response options.

REPLY FROM: ${params.contact_name}${params.contact_title ? ` (${params.contact_title})` : ''} at ${params.company}
EMAIL: ${params.contact_email}
${params.pipeline ? `PIPELINE: ${params.pipeline}` : ''}
${params.deal_id ? `DEAL ID: ${params.deal_id}` : ''}

THEIR REPLY:
${params.reply_body}

${params.original_email ? `OUR ORIGINAL EMAIL:\n${params.original_email}` : ''}

STEP 1: CLASSIFY INTENT
Choose one: interested_book_call, needs_info, objection, budget_timing_issue, internal_referrer, not_a_fit, unsubscribe, ooo, spam, unclear

STEP 2: MAP TO DEAL
- If deal_id provided, update that deal
- If no deal_id, search by company + contact
- If no match, create new deal

STEP 3: UPDATE DEAL
- Set stage based on classification:
  * interested_book_call → conversation_started (then route to meeting)
  * needs_info → conversation_started
  * objection → conversation_started (flag for follow-up)
  * budget_timing_issue → conversation_started (add to nurture)
  * internal_referrer → researching (new contact)
  * not_a_fit → closed_lost (reason: not_a_fit)
  * unsubscribe → closed_lost (reason: unsubscribed, NO further contact EVER)
  * ooo → no stage change, note return date
- Log: last inbound message date, new contacts/stakeholders mentioned

STEP 4: GENERATE 3 RESPONSE OPTIONS
1. Conservative — safe, professional, moves conversation forward gently
2. Assertive — direct, proposes specific next step
3. Experimental — creative angle, pattern interrupt

For objections, reference the Playbook Agent: propose tailored responses + QUESTIONS that advance the sale rather than defend.

STEP 5: ASK
"Which version should we send? Any custom notes to log on this deal?"

MEETING ROUTING:
If interested_book_call → route to Kevin (Mike and Maggie triage to Kevin).
Flag Gwen if partnership/referral angle detected.

Return JSON: { intent, dealUpdate, responseOptions[3], humanQuestion }`,
          }, null, 2),
        }],
      };
    }
  );
}
