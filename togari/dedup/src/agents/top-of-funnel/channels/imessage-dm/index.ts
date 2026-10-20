/**
 * @togari/bma-content/agents/top-of-funnel/channels/imessage-dm
 * Channel: iMessage DM — HIGHEST trust channel. Warm contacts ONLY.
 * HARD CONSTRAINT: Never cold. Contacts must have existing relationship signals
 * (prior meetings, emails, mutual connections) in BigQuery before outreach.
 * Ultra-short messages (<100 chars). Zero sales language. Relationship maintenance.
 * 4 tools: imessage_dm_build_list, imessage_dm_personalize, imessage_dm_create_sequence, imessage_dm_book_meeting
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp';
import { z } from 'zod';
import { buyerPersonaSchema } from '../../../../schemas/enums';
import { sequencing } from '../../shared/sequencing';
import { meetingBooking } from '../../shared/meeting-booking';

const CHANNEL = 'imessage_dm';

const IMESSAGE_LIMITS = {
  messageMaxChars: 100,
  dailyMessages: 10,
} as const;

export function registerIMessageDmTools(server: McpServer): void {

  // ─── BUILD LIST ───────────────────────────────────────────────────────
  // @ts-ignore
  server.tool(
    'imessage_dm_build_list',
    'Build a warm contact list for iMessage outreach. ' +
    'HARD FILTER: Only returns contacts with existing relationship signals in BigQuery ' +
    '(prior meetings, email exchanges, or mutual connection intros). ' +
    'Never cold contacts. This is relationship maintenance, not outreach.',
    {
      segment: z.string().optional().describe('Healthcare subsegment to filter (optional)'),
      relationship_signals: z.array(z.enum(['prior_meeting', 'prior_email_exchange', 'prior_imessage_thread', 'mutual_connection_intro'])).default(['prior_meeting', 'prior_email_exchange']).describe('Required relationship signals in BigQuery'),
      last_contact_days: z.number().min(7).max(180).default(30).describe('Days since last interaction (find contacts going stale)'),
      limit: z.number().min(1).max(10).default(5).describe('Max contacts — keep it small, these are personal'),
    },
    async (params) => {
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            action: 'imessage_dm_build_list',
            channel: CHANNEL,
            instructions: `Build a warm contact list for iMessage outreach.

HARD FILTER — contacts MUST have at least one of these relationship signals in BigQuery:
${params.relationship_signals.map(s => `- ${s}`).join('\n')}

STALE THRESHOLD: Last interaction > ${params.last_contact_days} days ago.
${params.segment ? `SEGMENT FILTER: ${params.segment}` : 'NO segment filter — all warm contacts eligible.'}

Steps:
1. Query BigQuery contacts for people with phone numbers AND at least one relationship signal
2. Filter to contacts whose last interaction was ${params.last_contact_days}+ days ago
3. Verify phone number exists (iMessage requires it)
4. Return max ${params.limit} contacts sorted by relationship depth

ABSOLUTE RULE: If a contact has ZERO relationship signals, they MUST NOT appear in this list.
This is relationship maintenance — not cold outreach.

Return JSON array with: name, phone, company, lastInteraction, relationshipSignals, suggestedTopic.`,
            constraints: {
              limit: params.limit,
              requiredSignals: params.relationship_signals,
              lastContactDays: params.last_contact_days,
              dailyLimit: IMESSAGE_LIMITS.dailyMessages,
            },
          }, null, 2),
        }],
      };
    }
  );

  // ─── PERSONALIZE ──────────────────────────────────────────────────────
  // @ts-ignore
  server.tool(
    'imessage_dm_personalize',
    'Draft an ultra-short iMessage for a warm contact. ' +
    'Max 100 characters. Zero sales language. ' +
    'Like texting someone you already know — because you do.',
    {
      contact_name: z.string().describe('Contact first name'),
      contact_phone: z.string().describe('Contact phone number'),
      company_name: z.string().describe('Their company'),
      last_interaction: z.string().describe('What your last interaction was (e.g., "met at HLTH conf Oct 2025")'),
      relationship_context: z.string().describe('Brief context on the relationship'),
      suggested_topic: z.string().describe('What to message about — keep it natural'),
      campaign_id: z.string().describe('Campaign identifier'),
    },
    async (params) => {
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            action: 'imessage_dm_personalize',
            channel: CHANNEL,
            instructions: `Draft an iMessage for ${params.contact_name}.

RELATIONSHIP: ${params.relationship_context}
LAST INTERACTION: ${params.last_interaction}
TOPIC: ${params.suggested_topic}

Generate ONE message. Max ${IMESSAGE_LIMITS.messageMaxChars} characters. That's ~15-20 words.

RULES:
- Sound like YOU already know them (because you do)
- Reference something specific from your relationship
- Zero sales language. Zero pitch. Zero CTA.
- No "hope you're doing well" — that's not how you text friends
- If asking something, make it genuinely curious
- Lowercase okay. Abbreviations okay. Emoji sparingly.

EXAMPLES of the RIGHT tone:
- "hey saw [company] just raised — congrats, well deserved"
- "that panel you did at HLTH was solid, loved the take on [x]"
- "been meaning to ask — how'd that [thing] work out?"

EXAMPLES of WRONG tone (never do this):
- "Hi [Name], I hope this message finds you well!"
- "Would love to catch up and discuss potential synergies"
- "We've been working on something I think you'd find interesting"

Return JSON with message (string), charCount, and tone_check (pass/fail).`,
            constraints: {
              messageMaxChars: IMESSAGE_LIMITS.messageMaxChars,
              campaignId: params.campaign_id,
            },
          }, null, 2),
        }],
      };
    }
  );

  // ─── CREATE SEQUENCE ──────────────────────────────────────────────────
  // @ts-ignore
  server.tool(
    'imessage_dm_create_sequence',
    'Build a 1-2 step iMessage sequence. Step 1: The message. ' +
    'Step 2 (optional, Day 5+): One natural follow-up ONLY if the topic warrants it. ' +
    'Do NOT over-message personal contacts.',
    {
      contact_name: z.string().describe('Contact first name'),
      contact_phone: z.string().describe('Contact phone number'),
      initial_message: z.string().max(100).describe('Initial message from personalize step'),
      needs_follow_up: z.boolean().default(false).describe('Whether a follow-up makes sense (usually no)'),
      campaign_id: z.string().describe('Campaign identifier'),
    },
    async (params) => {
      const prompt = sequencing.buildSequencePrompt({
        channel: CHANNEL,
        persona: 'warm_contact',
        companyName: params.contact_name,
        contactName: params.contact_name,
        totalSteps: params.needs_follow_up ? 2 : 1,
        cadenceDays: params.needs_follow_up ? [0, 5] : [0],
      });

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            action: 'imessage_dm_create_sequence',
            channel: CHANNEL,
            prompt,
            instructions: `Build a ${params.needs_follow_up ? '2' : '1'}-step iMessage sequence for ${params.contact_name}.

Step 1 (Day 0): Send the provided message.
${params.needs_follow_up ? 'Step 2 (Day 5): ONE follow-up — only if naturally warranted. Still <100 chars.' : 'NO follow-up. One message is enough.'}

If they reply: have a normal conversation. Route to book_meeting only if THEY bring up business.
If no reply: that's fine. Do not chase. These are personal contacts.

DAILY LIMIT: Max ${IMESSAGE_LIMITS.dailyMessages} messages/day.

Return JSON array of SequenceStep objects.`,
            initialMessage: params.initial_message,
            constraints: {
              maxSteps: params.needs_follow_up ? 2 : 1,
              cadenceDays: params.needs_follow_up ? [0, 5] : [0],
              messageMaxChars: IMESSAGE_LIMITS.messageMaxChars,
              campaignId: params.campaign_id,
              dailyLimit: IMESSAGE_LIMITS.dailyMessages,
            },
          }, null, 2),
        }],
      };
    }
  );

  // ─── BOOK MEETING ─────────────────────────────────────────────────────
  // @ts-ignore
  server.tool(
    'imessage_dm_book_meeting',
    'Route a positive iMessage reply to the meeting pipeline. ' +
    'Only when THEY bring up business — never push. ' +
    'Kevin → Mike → Maggie routing.',
    {
      contact_name: z.string().describe('Contact name'),
      contact_phone: z.string().describe('Contact phone number'),
      contact_email: z.string().email().optional().describe('Email if known'),
      company_name: z.string().describe('Their company'),
      persona: buyerPersonaSchema.optional().describe('Buyer persona if identifiable'),
      signal_summary: z.string().describe('What they said that signals business interest'),
      urgency: z.enum(['immediate', 'this_week', 'next_week']).default('next_week').describe('Meeting urgency (default relaxed for warm contacts)'),
      partnership_angle: z.boolean().default(false).describe('Flag Gwen for partnership angle'),
    },
    async (params) => {
      const prompt = meetingBooking.buildMeetingBookingPrompt({
        channel: CHANNEL,
        companyName: params.company_name,
        contactName: params.contact_name,
        contactTitle: 'known contact — check BigQuery',
        contactEmail: params.contact_email || 'check BigQuery — known contact',
        persona: params.persona || 'unknown',
        signalSummary: `[IMESSAGE — WARM CONTACT] ${params.signal_summary}`,
        urgency: params.urgency,
        partnershipAngle: params.partnership_angle,
      });

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            action: 'imessage_dm_book_meeting',
            channel: CHANNEL,
            prompt,
            instructions: 'Route this warm contact iMessage signal to a meeting. ' +
              'This is someone we already know — include full relationship history from BigQuery. ' +
              'Kevin → Mike → Maggie routing. Keep the tone warm — this came from a personal channel.' +
              (params.partnership_angle ? ' GWEN FLAG: Partnership angle detected.' : ''),
          }, null, 2),
        }],
      };
    }
  );
}
