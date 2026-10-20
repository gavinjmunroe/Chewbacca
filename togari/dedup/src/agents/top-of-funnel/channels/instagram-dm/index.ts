/**
 * @togari/bma-content/agents/top-of-funnel/channels/instagram-dm
 * Channel: Instagram DM — Warm outreach to engaged followers.
 * Build lists from engagement signals only (people who liked/commented on posts).
 * Casual, short DMs. 2-step sequences max. Standard meeting routing.
 * 4 tools: instagram_dm_build_list, instagram_dm_personalize, instagram_dm_create_sequence, instagram_dm_book_meeting
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp';
import { z } from 'zod';
import { buyerPersonaSchema } from '../../../../schemas/enums';
import { validateTheologyLine } from '../../../../config/channels';
import { sequencing } from '../../shared/sequencing';
import { meetingBooking } from '../../shared/meeting-booking';

const CHANNEL = 'instagram_dm';

const INSTAGRAM_DM_LIMITS = {
  dmMaxChars: 1000,
  dailyDms: 30,
} as const;

export function registerInstagramDmTools(server: McpServer): void {

  // ─── BUILD LIST ───────────────────────────────────────────────────────
  // @ts-ignore
  server.tool(
    'instagram_dm_build_list',
    'Build a DM outreach list from Instagram engagement signals. ' +
    'Targets people who liked, commented, or saved recent posts — warm leads only. ' +
    'Cross-references with BigQuery contacts for enrichment.',
    {
      post_urls: z.array(z.string()).describe('Instagram post URLs to pull engagers from'),
      engagement_types: z.array(z.enum(['liked', 'commented', 'saved', 'shared'])).default(['liked', 'commented']).describe('Which engagement signals to include'),
      target_account: z.enum(['gartiwar', 'rytual', 'bma']).describe('Which Instagram account'),
      limit: z.number().min(1).max(30).default(15).describe('Max prospects to return'),
      exclude_handles: z.array(z.string()).optional().describe('Instagram handles to exclude'),
    },
    async (params) => {
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            action: 'instagram_dm_build_list',
            channel: CHANNEL,
            instructions: `Build an Instagram DM outreach list from engagement signals on the ${params.target_account} account.

POSTS TO SCAN:
${params.post_urls.map((u, i) => `${i + 1}. ${u}`).join('\n')}

ENGAGEMENT TYPES: ${params.engagement_types.join(', ')}

Steps:
1. Pull engagers from the listed posts (${params.engagement_types.join(', ')})
2. Cross-reference with BigQuery contacts for company/title enrichment
3. Score by engagement depth (commented > saved > liked)
4. Filter out bots, personal accounts with no business relevance
5. Return max ${params.limit} prospects sorted by engagement score

DAILY LIMIT: Max ${INSTAGRAM_DM_LIMITS.dailyDms} DMs/day.

Return JSON array with: instagramHandle, name, company (if known), engagementType, engagementDetail, score.`,
            constraints: {
              targetAccount: params.target_account,
              limit: params.limit,
              excludeHandles: params.exclude_handles,
              dailyDmLimit: INSTAGRAM_DM_LIMITS.dailyDms,
            },
          }, null, 2),
        }],
      };
    }
  );

  // ─── PERSONALIZE ──────────────────────────────────────────────────────
  // @ts-ignore
  server.tool(
    'instagram_dm_personalize',
    'Generate a casual, short Instagram DM for an engaged follower. ' +
    'References their specific engagement (comment, like). ' +
    'Warm and human — Instagram is personal, not a sales channel.',
    {
      contact_name: z.string().describe('Contact name or Instagram handle'),
      contact_instagram: z.string().describe('Instagram handle'),
      company_name: z.string().optional().describe('Company if known'),
      engagement_type: z.enum(['liked', 'commented', 'saved', 'shared']).describe('How they engaged'),
      engagement_detail: z.string().describe('What they commented or which post they engaged with'),
      target_account: z.enum(['gartiwar', 'rytual', 'bma']).describe('Which account is sending'),
      campaign_id: z.string().describe('Campaign identifier'),
    },
    async (params) => {
      const channelForValidation = params.target_account === 'gartiwar' ? 'gartiwar' as const
        : params.target_account === 'rytual' ? 'rytual' as const
        : 'instagram_dm' as const;
      const theologyCheck = validateTheologyLine(channelForValidation, '');

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            action: 'instagram_dm_personalize',
            channel: CHANNEL,
            instructions: `Generate a casual Instagram DM for @${params.contact_instagram}.

CONTEXT: They ${params.engagement_type} on a ${params.target_account} post.
DETAIL: ${params.engagement_detail}

Generate ONE short DM (max ${INSTAGRAM_DM_LIMITS.dmMaxChars} chars):
- Reference their specific engagement naturally
- Casual tone — like texting a friend of a friend
- One question to open conversation
- NO pitch, NO links, NO sales language
- If they commented, reference what they said

TONE: Human, warm, curious. Not "Hey! Loved your comment!" energy — more "saw your take on X, interesting because..."

Return JSON with dm (string), charCount, and personalizationNote.`,
            constraints: {
              dmMaxChars: INSTAGRAM_DM_LIMITS.dmMaxChars,
              campaignId: params.campaign_id,
              targetAccount: params.target_account,
            },
            theologyValidation: theologyCheck,
          }, null, 2),
        }],
      };
    }
  );

  // ─── CREATE SEQUENCE ──────────────────────────────────────────────────
  // @ts-ignore
  server.tool(
    'instagram_dm_create_sequence',
    'Build a simple 2-step Instagram DM sequence. ' +
    'Step 1: Initial DM referencing engagement. Step 2 (Day 3): One follow-up if no reply. ' +
    'That\'s it — don\'t over-message on Instagram.',
    {
      contact_instagram: z.string().describe('Instagram handle'),
      contact_name: z.string().describe('Contact name'),
      initial_dm: z.string().describe('Initial DM from personalize step'),
      target_account: z.enum(['gartiwar', 'rytual', 'bma']).describe('Sending account'),
      campaign_id: z.string().describe('Campaign identifier'),
    },
    async (params) => {
      const prompt = sequencing.buildSequencePrompt({
        channel: CHANNEL,
        persona: 'engaged_follower',
        companyName: params.contact_name,
        contactName: params.contact_instagram,
        totalSteps: 2,
        cadenceDays: [0, 3],
      });

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            action: 'instagram_dm_create_sequence',
            channel: CHANNEL,
            prompt,
            instructions: `Build a 2-step Instagram DM sequence for @${params.contact_instagram}.

Step 1 (Day 0): Send the provided initial DM.
Step 2 (Day 3): ONE follow-up if no reply — share something relevant, no ask.

If no reply after Step 2: stop. Do not message again.
If they reply at any step: route to book_meeting if interested, otherwise have a normal conversation.

DAILY LIMIT: Max ${INSTAGRAM_DM_LIMITS.dailyDms} DMs/day.

Return JSON array of 2 SequenceStep objects.`,
            initialDm: params.initial_dm,
            constraints: {
              maxSteps: 2,
              cadenceDays: [0, 3],
              campaignId: params.campaign_id,
              dailyDmLimit: INSTAGRAM_DM_LIMITS.dailyDms,
            },
          }, null, 2),
        }],
      };
    }
  );

  // ─── BOOK MEETING ─────────────────────────────────────────────────────
  // @ts-ignore
  server.tool(
    'instagram_dm_book_meeting',
    'Route a positive Instagram DM reply to the meeting pipeline. ' +
    'Kevin → Mike → Maggie routing. Enrich via LinkedIn since Instagram has limited business info.',
    {
      contact_name: z.string().describe('Contact name'),
      contact_instagram: z.string().describe('Instagram handle'),
      company_name: z.string().optional().describe('Company if known'),
      contact_email: z.string().email().optional().describe('Email if available'),
      persona: buyerPersonaSchema.optional().describe('Buyer persona if identifiable'),
      signal_summary: z.string().describe('What they said that signals interest'),
      urgency: z.enum(['immediate', 'this_week', 'next_week']).default('this_week').describe('Meeting urgency'),
      partnership_angle: z.boolean().default(false).describe('Flag Gwen for partnership angle'),
    },
    async (params) => {
      const prompt = meetingBooking.buildMeetingBookingPrompt({
        channel: CHANNEL,
        companyName: params.company_name || 'unknown — enrich from Instagram bio',
        contactName: params.contact_name,
        contactTitle: 'unknown — enrich via LinkedIn',
        contactEmail: params.contact_email || 'unknown — find via LinkedIn or Instagram bio',
        persona: params.persona || 'unknown',
        signalSummary: `[INSTAGRAM DM] ${params.signal_summary}`,
        urgency: params.urgency,
        partnershipAngle: params.partnership_angle,
      });

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            action: 'instagram_dm_book_meeting',
            channel: CHANNEL,
            prompt,
            instructions: 'Route this Instagram DM signal to a meeting. ' +
              'Enrich contact via LinkedIn/Clay before booking — Instagram profiles lack business info. ' +
              'Kevin → Mike → Maggie routing.' +
              (params.partnership_angle ? ' GWEN FLAG: Partnership angle detected.' : ''),
          }, null, 2),
        }],
      };
    }
  );
}
