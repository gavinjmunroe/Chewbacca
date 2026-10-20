/**
 * @togari/bma-content/agents/top-of-funnel/channels/warm-email
 * Channel: Warm Email — Inbound signals and triggers
 * Responds to: LinkedIn post engagement, website visitors, GTME job postings
 * 4 tools: warm_email_build_list, warm_email_personalize, warm_email_create_sequence, warm_email_book_meeting
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp';
import { z } from 'zod';
import { buyerPersonaSchema, offerTypeSchema, senderIdentitySchema } from '../../../../schemas/enums';
import { validateTheologyLine } from '../../../../config/channels';
import { research } from '../../shared/research';
import { personalization } from '../../shared/personalization';
import { sequencing } from '../../shared/sequencing';
import { meetingBooking } from '../../shared/meeting-booking';

const CHANNEL = 'warm_email';

const triggerTypeSchema = z.enum([
  'linkedin_post_engagement',  // They liked/commented on our post
  'website_visitor',           // They visited our site
  'gtme_job_posting',          // They posted a GTM engineering job
  'content_download',          // They downloaded an artifact
  'event_registration',        // They registered for something
  'referral',                  // Someone referred them
]);

export function registerWarmEmailTools(server: McpServer): void {

  // ─── BUILD LIST ───────────────────────────────────────────────────────
  // @ts-ignore
  server.tool(
    'warm_email_build_list',
    'Build a list of warm prospects from inbound signals and triggers. ' +
    'Sources: LinkedIn post engagements, website visitors, GTME job postings, content downloads. ' +
    'These people already showed interest — prioritize by recency and signal strength.',
    {
      trigger_type: triggerTypeSchema.describe('Type of inbound trigger to scan for'),
      time_window_hours: z.number().min(1).max(168).default(24).describe('How far back to look (hours)'),
      segment: z.string().optional().describe('Filter by healthcare subsegment'),
      persona: buyerPersonaSchema.optional().describe('Filter by buyer persona'),
      limit: z.number().min(1).max(50).default(10).describe('Max prospects to return'),
    },
    async (params) => {
      const researchPrompt = research.buildResearchPrompt(
        {
          segment: params.segment,
          persona: params.persona,
          keywords: [params.trigger_type],
          limit: params.limit,
        },
        CHANNEL
      );

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            action: 'warm_email_build_list',
            channel: CHANNEL,
            prompt: researchPrompt,
            instructions: `Scan for inbound signals of type: ${params.trigger_type}. ` +
              `Time window: last ${params.time_window_hours} hours. ` +
              'For each signal, identify the person, their company, title, and the specific trigger. ' +
              'Score by recency × signal strength. These are WARM — they already engaged. ' +
              'Return JSON array of prospects with their trigger details.',
            constraints: {
              triggerType: params.trigger_type,
              timeWindowHours: params.time_window_hours,
              segment: params.segment,
              persona: params.persona,
            },
          }, null, 2),
        }],
      };
    }
  );

  // ─── PERSONALIZE ──────────────────────────────────────────────────────
  // @ts-ignore
  server.tool(
    'warm_email_personalize',
    'Generate a warm email responding to an inbound trigger. ' +
    'References the specific trigger (post they engaged with, page they visited, job they posted). ' +
    'Warmer tone than cold — they already showed interest. Still one CTA, one artifact offer.',
    {
      persona: buyerPersonaSchema.describe('Buyer persona: A, B, or C'),
      company_name: z.string().describe('Company name'),
      contact_name: z.string().describe('Contact full name'),
      contact_title: z.string().describe('Contact job title'),
      contact_email: z.string().email().describe('Contact work email'),
      segment: z.string().describe('Healthcare subsegment'),
      trigger_type: triggerTypeSchema.describe('What triggered this outreach'),
      trigger_detail: z.string().describe('Specific detail: which post they liked, which page they visited, which job they posted'),
      signals: z.array(z.string()).describe('Additional signals about this prospect'),
      recommended_offer: offerTypeSchema.describe('Offer type: top_5_list, market_map, or competitive_signals'),
      sender_identity: senderIdentitySchema.describe('Sender: sagar or kevin'),
    },
    async (params) => {
      const prompt = personalization.buildPersonalizationPrompt(
        {
          channel: CHANNEL,
          companyName: params.company_name,
          contactName: params.contact_name,
          contactTitle: params.contact_title,
          persona: params.persona,
          segment: params.segment,
          signals: params.signals,
          additionalContext: `TRIGGER: ${params.trigger_type} — ${params.trigger_detail}`,
        },
        'warm_email'
      );

      const theologyCheck = validateTheologyLine('cold_email', prompt); // warm email uses same theology rules

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            action: 'warm_email_personalize',
            channel: CHANNEL,
            prompt,
            instructions: 'Generate a warm email that specifically references the trigger. ' +
              `They ${params.trigger_type.replace(/_/g, ' ')} — acknowledge it naturally. ` +
              'Warmer than cold email but still concise. One artifact offer. One CTA. ' +
              'Return JSON with subjectLine, emailBody, wordCount, offerDescription, triggerReference.',
            trigger: {
              type: params.trigger_type,
              detail: params.trigger_detail,
            },
            theologyValidation: {
              valid: theologyCheck.valid,
              violations: theologyCheck.violations,
            },
          }, null, 2),
        }],
      };
    }
  );

  // ─── CREATE SEQUENCE ──────────────────────────────────────────────────
  // @ts-ignore
  server.tool(
    'warm_email_create_sequence',
    'Build a warm email follow-up sequence. Faster cadence than cold — they already showed interest. ' +
    '3-4 steps: immediate response → insight share → social proof → soft close.',
    {
      company_name: z.string().describe('Company name'),
      contact_name: z.string().describe('Contact full name'),
      contact_email: z.string().email().describe('Contact work email'),
      persona: buyerPersonaSchema.describe('Buyer persona'),
      segment: z.string().describe('Healthcare subsegment'),
      trigger_type: triggerTypeSchema.describe('Original trigger type'),
      initial_email_subject: z.string().describe('Subject line from personalize step'),
      initial_email_body: z.string().describe('Email body from personalize step'),
    },
    async (params) => {
      const prompt = sequencing.buildSequencePrompt({
        channel: CHANNEL,
        persona: params.persona,
        companyName: params.company_name,
        contactName: params.contact_name,
        totalSteps: 4,
        cadenceDays: [0, 2, 5, 10],
      });

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            action: 'warm_email_create_sequence',
            channel: CHANNEL,
            prompt,
            instructions: 'Generate a 4-step warm email sequence. Faster cadence than cold. ' +
              'Step 1 is the trigger response (already written). Steps 2-4 are follow-ups. ' +
              'Warm prospects move faster — if positive reply at any step, route to meeting immediately.',
            initialEmail: {
              subject: params.initial_email_subject,
              body: params.initial_email_body,
            },
            trigger: params.trigger_type,
          }, null, 2),
        }],
      };
    }
  );

  // ─── BOOK MEETING ─────────────────────────────────────────────────────
  // @ts-ignore
  server.tool(
    'warm_email_book_meeting',
    'Route a positive warm email reply to the meeting pipeline. ' +
    'Warm leads get priority booking. Kevin → Mike → Maggie routing.',
    {
      company_name: z.string().describe('Company name'),
      contact_name: z.string().describe('Contact full name'),
      contact_title: z.string().describe('Contact job title'),
      contact_email: z.string().email().describe('Contact work email'),
      persona: buyerPersonaSchema.describe('Buyer persona'),
      signal_summary: z.string().describe('Summary of warm signal + reply'),
      trigger_type: triggerTypeSchema.describe('Original trigger that started the warm sequence'),
      partnership_angle: z.boolean().default(false).describe('Flag for Gwen if partnership/referral angle'),
    },
    async (params) => {
      const prompt = meetingBooking.buildMeetingBookingPrompt({
        channel: CHANNEL,
        companyName: params.company_name,
        contactName: params.contact_name,
        contactTitle: params.contact_title,
        contactEmail: params.contact_email,
        persona: params.persona,
        signalSummary: `[WARM - ${params.trigger_type}] ${params.signal_summary}`,
        urgency: 'immediate', // Warm leads always get immediate priority
        partnershipAngle: params.partnership_angle,
      });

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            action: 'warm_email_book_meeting',
            channel: CHANNEL,
            prompt,
            instructions: 'Route this warm lead to a meeting. PRIORITY — warm leads book faster. ' +
              'Include the original trigger context in the pre-meeting brief.',
          }, null, 2),
        }],
      };
    }
  );
}
