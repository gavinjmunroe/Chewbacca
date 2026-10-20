/**
 * @togari/bma-content/agents/top-of-funnel/channels/linkedin-dm
 * Channel: LinkedIn DM — Partnership outreach only (not general cold outbound).
 * Theology frame: peer_warm — relational, dependable, no spiritual content, casual but professional.
 * 4 tools: linkedin_dm_build_list, linkedin_dm_personalize, linkedin_dm_create_sequence, linkedin_dm_book_meeting
 *
 * Key constraints:
 * - Connection request note: max 300 characters
 * - Follow-up DM: max 500 characters
 * - Daily limits: 25 connection requests/day, 50 DMs/day
 * - Sequence: Day 0 connection request, Day 3 follow-up, Day 7 value-add
 * - Routing: Kevin → Mike → Maggie triage chain; flag Gwen for partnership angles
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp';
import { z } from 'zod';
import { buyerPersonaSchema } from '../../../../schemas/enums';
import { validateTheologyLine } from '../../../../config/channels';
import { research } from '../../shared/research';
import { personalization } from '../../shared/personalization';
import { sequencing } from '../../shared/sequencing';
import { meetingBooking } from '../../shared/meeting-booking';

const CHANNEL = 'linkedin_dm';

/** LinkedIn platform constraints */
const LINKEDIN_LIMITS = {
  connectionRequestChars: 300,
  dmChars: 500,
  dailyConnectionRequests: 25,
  dailyDms: 50,
} as const;

export function registerLinkedInDmTools(server: McpServer): void {

  // ─── BUILD LIST ───────────────────────────────────────────────────────
  // Queries BigQuery contacts + Exa for partnership signals.
  // Filters for mutual connections, complementary companies, recent LinkedIn engagement.
  // @ts-ignore
  server.tool(
    'linkedin_dm_build_list',
    'Build a scored list of LinkedIn partnership prospects. ' +
    'Queries BigQuery contacts for mutual connections and complementary company profiles. ' +
    'Uses Exa to find companies with complementary products and recent partnership signals. ' +
    'Returns prospects ranked by partnership fit — NOT general cold outbound targets.',
    {
      segment: z.string().describe('Healthcare subsegment to target for partnerships (e.g., "digital health payers", "care coordination platforms")'),
      persona: buyerPersonaSchema.describe('Buyer persona: A (VP RevOps), B (Head of Strategy), C (CCO)'),
      partnership_type: z.enum(['complementary_product', 'channel_partner', 'referral_source', 'strategic_ally']).describe('Type of partnership being pursued'),
      keywords: z.array(z.string()).optional().describe('Additional targeting keywords for partnership fit'),
      limit: z.number().min(1).max(50).default(15).describe('Max prospects to return (lower than cold email — quality over volume)'),
      exclude_companies: z.array(z.string()).optional().describe('Companies to exclude (already in partnership pipeline)'),
      mutual_connections_min: z.number().min(0).default(1).describe('Minimum mutual LinkedIn connections required'),
    },
    async (params) => {
      const researchPrompt = research.buildResearchPrompt(
        {
          segment: params.segment,
          persona: params.persona,
          keywords: params.keywords,
          limit: params.limit,
        },
        CHANNEL
      );

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            action: 'linkedin_dm_build_list',
            channel: CHANNEL,
            prompt: researchPrompt,
            instructions: 'Execute this research prompt to build a LinkedIn partnership prospect list. ' +
              'Step 1: Query BigQuery contacts table for existing contacts with LinkedIn profiles ' +
              'in the target segment. Filter for contacts with mutual connections >= ' + params.mutual_connections_min + '. ' +
              'Step 2: Use Exa to search for companies with complementary products/services ' +
              'that signal partnership readiness (co-marketing content, integration announcements, ' +
              'partner program pages, "partnerships" job postings). ' +
              'Step 3: Cross-reference BigQuery contacts with Exa results. ' +
              'Score each prospect on partnership fit (not sales fit). ' +
              'Return JSON array of prospects sorted by partnership score.',
            constraints: {
              persona: params.persona,
              segment: params.segment,
              partnershipType: params.partnership_type,
              limit: params.limit,
              excludeCompanies: params.exclude_companies,
              mutualConnectionsMin: params.mutual_connections_min,
              dailyConnectionLimit: LINKEDIN_LIMITS.dailyConnectionRequests,
            },
            partnershipSignals: [
              'Complementary product in adjacent healthcare vertical',
              'Recent integration or partnership announcements',
              'Job posting for partnerships/BD roles',
              'Co-marketing content with similar companies',
              'Shared LinkedIn group memberships',
              'Mutual connections with Togari team',
              'Recent LinkedIn engagement with Togari content',
            ],
          }, null, 2),
        }],
      };
    }
  );

  // ─── PERSONALIZE ──────────────────────────────────────────────────────
  // Generates warm DM copy in the Peer Warm theology frame.
  // References shared connections/interests. Respects LinkedIn character limits.
  // @ts-ignore
  server.tool(
    'linkedin_dm_personalize',
    'Generate personalized LinkedIn DM copy for a partnership prospect. ' +
    'Peer Warm theology frame: casual but professional, relational, no spiritual content. ' +
    'Enforces LinkedIn character limits: 300 chars for connection request note, 500 chars for DMs. ' +
    'References shared connections and mutual interests. No pitch in opener — curiosity first.',
    {
      persona: buyerPersonaSchema.describe('Buyer persona: A, B, or C'),
      company_name: z.string().describe('Prospect company name'),
      contact_name: z.string().describe('Contact full name'),
      contact_title: z.string().describe('Contact job title'),
      contact_linkedin_url: z.string().describe('Contact LinkedIn profile URL'),
      segment: z.string().describe('Healthcare subsegment'),
      partnership_type: z.enum(['complementary_product', 'channel_partner', 'referral_source', 'strategic_ally']).describe('Type of partnership being pursued'),
      shared_connections: z.array(z.string()).optional().describe('Names of mutual LinkedIn connections'),
      shared_interests: z.array(z.string()).optional().describe('Shared interests, groups, or topics from their LinkedIn activity'),
      why_partner: z.string().describe('One-sentence reason why this company is a good partnership fit'),
      recent_activity: z.string().optional().describe('Recent LinkedIn post or activity to reference'),
      sender_identity: z.enum(['sagar', 'kevin']).describe('Who is sending: sagar or kevin'),
      campaign_id: z.string().describe('Campaign identifier for tracking'),
    },
    async (params) => {
      const personalizationPrompt = personalization.buildPersonalizationPrompt(
        {
          channel: CHANNEL,
          companyName: params.company_name,
          contactName: params.contact_name,
          contactTitle: params.contact_title,
          persona: params.persona,
          segment: params.segment,
          signals: [
            params.why_partner,
            ...(params.shared_connections?.map(c => `Mutual connection: ${c}`) || []),
            ...(params.shared_interests?.map(i => `Shared interest: ${i}`) || []),
            ...(params.recent_activity ? [`Recent activity: ${params.recent_activity}`] : []),
          ],
          additionalContext: `Partnership type: ${params.partnership_type}`,
        },
        'linkedin_dm'
      );

      const theologyCheck = validateTheologyLine('linkedin_dm', personalizationPrompt);

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            action: 'linkedin_dm_personalize',
            channel: CHANNEL,
            prompt: personalizationPrompt,
            instructions: 'Generate LinkedIn DM copy for this partnership prospect. ' +
              'Produce TWO pieces of copy:\n' +
              '1. CONNECTION REQUEST NOTE: Max ' + LINKEDIN_LIMITS.connectionRequestChars + ' characters. ' +
              'Reference a shared connection or mutual interest. No pitch. One question or observation.\n' +
              '2. FOLLOW-UP DM: Max ' + LINKEDIN_LIMITS.dmChars + ' characters. ' +
              'Partnership framing — what you could build/explore together. One clear next step.\n\n' +
              'TONE (Peer Warm): Casual but professional. Like messaging a colleague you respect ' +
              'but haven\'t met yet. No formal language, no pitch deck energy. Relational.\n\n' +
              'PROHIBITIONS: No spiritual content. No fear-based copy. No "synergy" or "leverage." ' +
              'No "I\'d love to pick your brain." No multiple CTAs.\n\n' +
              'Return JSON with connectionRequestNote (string, charCount), followUpDm (string, charCount), ' +
              'and personalizationNotes (what was referenced and why).',
            constraints: {
              connectionRequestMaxChars: LINKEDIN_LIMITS.connectionRequestChars,
              dmMaxChars: LINKEDIN_LIMITS.dmChars,
              theologyFrame: 'peer_warm',
              campaignId: params.campaign_id,
              senderIdentity: params.sender_identity,
            },
            theologyValidation: {
              valid: theologyCheck.valid,
              violations: theologyCheck.violations,
            },
            blacklist: [
              'synergy', 'leverage', 'ecosystem',
              'I\'d love to pick your brain',
              'quick question', 'hope this finds you well',
              'I wanted to reach out', 'just following up',
              'do you have 15 minutes',
            ],
          }, null, 2),
        }],
      };
    }
  );

  // ─── CREATE SEQUENCE ──────────────────────────────────────────────────
  // 3-step lightweight sequence: connection request Day 0, follow-up Day 3, value-add Day 7.
  // @ts-ignore
  server.tool(
    'linkedin_dm_create_sequence',
    'Build a 3-step LinkedIn DM partnership sequence. ' +
    'Step 1 (Day 0): Connection request with personalized note (300 chars). ' +
    'Step 2 (Day 3): Follow-up DM after connection accepted (500 chars). ' +
    'Step 3 (Day 7): Value-add share — relevant content or insight (500 chars). ' +
    'Lighter cadence than cold email. Includes reply branching and Gwen handoff on positive signal.',
    {
      company_name: z.string().describe('Prospect company name'),
      contact_name: z.string().describe('Contact full name'),
      contact_linkedin_url: z.string().describe('Contact LinkedIn profile URL'),
      persona: buyerPersonaSchema.describe('Buyer persona: A, B, or C'),
      segment: z.string().describe('Healthcare subsegment'),
      partnership_type: z.enum(['complementary_product', 'channel_partner', 'referral_source', 'strategic_ally']).describe('Type of partnership'),
      connection_request_note: z.string().max(300).describe('Connection request note from the personalize step (max 300 chars)'),
      follow_up_dm: z.string().max(500).describe('Follow-up DM from the personalize step (max 500 chars)'),
      campaign_id: z.string().describe('Campaign identifier'),
    },
    async (params) => {
      const prompt = sequencing.buildSequencePrompt({
        channel: CHANNEL,
        persona: params.persona,
        companyName: params.company_name,
        contactName: params.contact_name,
        totalSteps: 3,
        cadenceDays: [0, 3, 7],
      });

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            action: 'linkedin_dm_create_sequence',
            channel: CHANNEL,
            prompt,
            instructions: 'Generate a 3-step LinkedIn DM partnership sequence.\n\n' +
              'Step 1 (Day 0): Connection request with the provided note. ' +
              'If not accepted within 3 days, stop sequence.\n\n' +
              'Step 2 (Day 3): Follow-up DM using the provided copy. ' +
              'Only fires if connection was accepted. Partnership framing.\n\n' +
              'Step 3 (Day 7): Value-add share — share a relevant article, insight, ' +
              'or data point that demonstrates mutual value. No ask. Pure give.\n\n' +
              'REPLY BRANCHING:\n' +
              '- Positive interest → Flag Gwen (partnerships) + route to meeting-booking\n' +
              '- Curious but not ready → Add to nurture, share content monthly\n' +
              '- Not interested → Graceful close, no further DMs\n' +
              '- Connection not accepted → Stop sequence after Day 0\n\n' +
              'DAILY LIMITS: Max ' + LINKEDIN_LIMITS.dailyConnectionRequests + ' connection requests/day, ' +
              'max ' + LINKEDIN_LIMITS.dailyDms + ' DMs/day. Queue overflow for next business day.\n\n' +
              'Return JSON array of SequenceStep objects with reply branching.',
            initialMessages: {
              connectionRequestNote: params.connection_request_note,
              followUpDm: params.follow_up_dm,
            },
            constraints: {
              campaignId: params.campaign_id,
              partnershipType: params.partnership_type,
              maxSteps: 3,
              cadenceDays: [0, 3, 7],
              connectionRequestMaxChars: LINKEDIN_LIMITS.connectionRequestChars,
              dmMaxChars: LINKEDIN_LIMITS.dmChars,
              dailyConnectionLimit: LINKEDIN_LIMITS.dailyConnectionRequests,
              dailyDmLimit: LINKEDIN_LIMITS.dailyDms,
            },
          }, null, 2),
        }],
      };
    }
  );

  // ─── BOOK MEETING ─────────────────────────────────────────────────────
  // Routes positive LinkedIn DM replies through Kevin → Mike → Maggie triage chain.
  // Flags Gwen when partnership opportunity detected.
  // @ts-ignore
  server.tool(
    'linkedin_dm_book_meeting',
    'Route a positive LinkedIn DM reply to the meeting pipeline. ' +
    'Kevin Kong → Mike → Maggie routing (same as cold email). ' +
    'Flags Gwen (partnerships) when target is a potential partner company. ' +
    'Generates pre-meeting brief with LinkedIn profile context and partnership hypothesis.',
    {
      company_name: z.string().describe('Prospect company name'),
      contact_name: z.string().describe('Contact full name'),
      contact_title: z.string().describe('Contact job title'),
      contact_linkedin_url: z.string().describe('Contact LinkedIn profile URL'),
      contact_email: z.string().email().optional().describe('Contact email if available (may not have it from LinkedIn)'),
      persona: buyerPersonaSchema.describe('Buyer persona'),
      partnership_type: z.enum(['complementary_product', 'channel_partner', 'referral_source', 'strategic_ally']).describe('Type of partnership'),
      signal_summary: z.string().describe('Summary of the positive signal from their DM reply'),
      shared_connections: z.array(z.string()).optional().describe('Mutual connections that could warm the intro further'),
      urgency: z.enum(['immediate', 'this_week', 'next_week']).describe('Meeting urgency'),
      flag_gwen: z.boolean().default(true).describe('Flag Gwen for partnership review (default true for this channel)'),
    },
    async (params) => {
      const prompt = meetingBooking.buildMeetingBookingPrompt({
        channel: CHANNEL,
        companyName: params.company_name,
        contactName: params.contact_name,
        contactTitle: params.contact_title,
        contactEmail: params.contact_email || `${params.contact_name.toLowerCase().replace(/\s/g, '.')}@unknown.com`,
        persona: params.persona,
        signalSummary: params.signal_summary,
        urgency: params.urgency,
        partnershipAngle: params.flag_gwen,
      });

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            action: 'linkedin_dm_book_meeting',
            channel: CHANNEL,
            prompt,
            instructions: 'Route this positive LinkedIn DM signal to a meeting.\n\n' +
              'ROUTING ORDER (HARD RULE): Kevin Kong → Mike → Maggie\n' +
              '1. Check Kevin\'s availability first\n' +
              '2. If Kevin unavailable, check Mike\n' +
              '3. If Mike unavailable, check Maggie\n\n' +
              (params.flag_gwen
                ? 'GWEN FLAG: This is a partnership opportunity. Flag Gwen (partnerships) for review. ' +
                  'Gwen should receive the pre-meeting brief and partnership hypothesis before the meeting.\n\n'
                : '') +
              'PRE-MEETING BRIEF should include:\n' +
              '- LinkedIn profile summary of the contact\n' +
              '- Partnership hypothesis: why this company is a fit\n' +
              '- Partnership type: ' + params.partnership_type + '\n' +
              '- Shared connections: ' + (params.shared_connections?.join(', ') || 'none identified') + '\n' +
              '- Full DM thread context\n' +
              '- Suggested talking points for partnership conversation\n\n' +
              'Return JSON with meetingAssignment, proposedSlots, meetingBrief, and gwenNotification.',
            constraints: {
              partnershipType: params.partnership_type,
              flagGwen: params.flag_gwen,
              contactLinkedIn: params.contact_linkedin_url,
            },
          }, null, 2),
        }],
      };
    }
  );
}
