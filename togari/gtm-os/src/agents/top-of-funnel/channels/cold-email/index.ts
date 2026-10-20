/**
 * @togari/bma-content/agents/top-of-funnel/channels/cold-email
 * Channel: Cold Email — Outbound, high volume to TAM
 * 4 tools: cold_email_build_list, cold_email_personalize, cold_email_create_sequence, cold_email_book_meeting
 * Absorbs logic from the old email-writer.ts (generate_email_draft)
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp';
import { z } from 'zod';
import { buyerPersonaSchema, offerTypeSchema, senderIdentitySchema } from '../../../../schemas/enums';
import { buildEmailGenerationPrompt } from '../../../../prompts/email-generation';
import { validateTheologyLine } from '../../../../config/channels';
import { research } from '../../shared/research';
import { personalization } from '../../shared/personalization';
import { sequencing } from '../../shared/sequencing';
import { meetingBooking } from '../../shared/meeting-booking';

const CHANNEL = 'cold_email';

export function registerColdEmailTools(server: McpServer): void {

  // ─── BUILD LIST ───────────────────────────────────────────────────────
  // @ts-ignore
  server.tool(
    'cold_email_build_list',
    'Build a scored prospect list for cold email outbound. ' +
    'Uses Clay, Exa, and Structify to find targets matching segment + persona criteria. ' +
    'Returns prospects ranked by signal strength. High volume — designed for TAM coverage.',
    {
      segment: z.string().describe('Healthcare subsegment to target (e.g., "digital health payers", "revenue cycle management")'),
      persona: buyerPersonaSchema.describe('Buyer persona: A (VP RevOps), B (Head of Strategy), C (CCO)'),
      keywords: z.array(z.string()).optional().describe('Additional targeting keywords'),
      limit: z.number().min(1).max(100).default(25).describe('Max prospects to return'),
      exclude_domains: z.array(z.string()).optional().describe('Domains to exclude (already contacted)'),
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
            action: 'cold_email_build_list',
            channel: CHANNEL,
            prompt: researchPrompt,
            instructions: 'Execute this research prompt to build a cold email prospect list. ' +
              'Use web research to find companies matching the segment. ' +
              'For each prospect, find contact info matching the persona. ' +
              'Score each 1-10 based on signal strength. ' +
              'Return JSON array of prospects sorted by score.',
            constraints: {
              persona: params.persona,
              segment: params.segment,
              limit: params.limit,
              excludeDomains: params.exclude_domains,
            },
          }, null, 2),
        }],
      };
    }
  );

  // ─── PERSONALIZE ──────────────────────────────────────────────────────
  // Absorbs generate_email_draft from email-writer.ts
  // @ts-ignore
  server.tool(
    'cold_email_personalize',
    'Generate a persona-specific cold email for a prospect. ' +
    'Requires a completed signal package or equivalent signals. ' +
    'Enforces word count limits per persona (A: 120w, B: 150w, C: 90w). ' +
    'Returns subject line, body, and offer description. Replaces generate_email_draft.',
    {
      persona: buyerPersonaSchema.describe('Buyer persona: A, B, or C'),
      company_name: z.string().describe('Company name'),
      contact_name: z.string().describe('Contact full name'),
      contact_title: z.string().describe('Contact job title'),
      contact_email: z.string().email().describe('Contact work email'),
      segment: z.string().describe('Healthcare subsegment'),
      why_now: z.string().describe('The Why Now synthesis sentence from signal package'),
      internal_signal: z.string().describe('Internal signal statement'),
      external_signal: z.string().describe('Best external signal'),
      recommended_offer: offerTypeSchema.describe('Offer type: top_5_list, market_map, or competitive_signals'),
      best_proof_point: z.string().describe('Most relevant case or data example'),
      sender_identity: senderIdentitySchema.describe('Sender: sagar or kevin'),
      campaign_id: z.string().describe('Campaign identifier for tracking'),
      experiment_id: z.string().optional().describe('A/B test experiment ID if applicable'),
      experiment_version: z.string().optional().describe('A/B test version label'),
    },
    async (params) => {
      // Use the existing email generation prompt builder
      const prompt = buildEmailGenerationPrompt({
        persona: params.persona,
        companyName: params.company_name,
        contactName: params.contact_name,
        contactTitle: params.contact_title,
        whyNow: params.why_now,
        internalSignal: params.internal_signal,
        externalSignal: params.external_signal,
        recommendedOffer: params.recommended_offer,
        bestProofPoint: params.best_proof_point,
        senderIdentity: params.sender_identity,
        segment: params.segment,
      });

      const theologyCheck = validateTheologyLine('cold_email', prompt);

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            action: 'cold_email_personalize',
            channel: CHANNEL,
            prompt,
            instructions: 'Generate the cold email draft. Strictly enforce word count limits. ' +
              'Return JSON with subjectLine, emailBody, wordCount, and offerDescription. ' +
              'The email will be reviewed by a GTM engineer before sending — never send autonomously.',
            constraints: {
              persona: params.persona,
              campaignId: params.campaign_id,
              experimentId: params.experiment_id,
              experimentVersion: params.experiment_version,
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
    'cold_email_create_sequence',
    'Build a multi-step cold email sequence with timing and reply branching. ' +
    'Generates 3-4 step sequence: initial email → follow-up → break-up → LinkedIn touch. ' +
    'Includes reply branching for positive/objection/no-reply paths.',
    {
      company_name: z.string().describe('Company name'),
      contact_name: z.string().describe('Contact full name'),
      contact_email: z.string().email().describe('Contact work email'),
      persona: buyerPersonaSchema.describe('Buyer persona: A, B, or C'),
      segment: z.string().describe('Healthcare subsegment'),
      initial_email_subject: z.string().describe('Subject line from the personalize step'),
      initial_email_body: z.string().describe('Email body from the personalize step'),
      campaign_id: z.string().describe('Campaign identifier'),
    },
    async (params) => {
      const prompt = sequencing.buildSequencePrompt({
        channel: CHANNEL,
        persona: params.persona,
        companyName: params.company_name,
        contactName: params.contact_name,
        totalSteps: 4,
        cadenceDays: [0, 3, 7, 14],
      });

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            action: 'cold_email_create_sequence',
            channel: CHANNEL,
            prompt,
            instructions: 'Generate a 4-step cold email sequence. ' +
              'Step 1 uses the provided initial email. Steps 2-4 are follow-ups. ' +
              'Include reply branching at each step. ' +
              'Return JSON array of SequenceStep objects.',
            initialEmail: {
              subject: params.initial_email_subject,
              body: params.initial_email_body,
            },
            constraints: {
              campaignId: params.campaign_id,
              maxSteps: 4,
              cadenceDays: [0, 3, 7, 14],
            },
          }, null, 2),
        }],
      };
    }
  );

  // ─── BOOK MEETING ─────────────────────────────────────────────────────
  // @ts-ignore
  server.tool(
    'cold_email_book_meeting',
    'Route a positive cold email reply to the meeting pipeline. ' +
    'Kevin Kong → Mike → Maggie routing. Generates pre-meeting brief. ' +
    'Flags Gwen when partnership/referral angle detected.',
    {
      company_name: z.string().describe('Company name'),
      contact_name: z.string().describe('Contact full name'),
      contact_title: z.string().describe('Contact job title'),
      contact_email: z.string().email().describe('Contact work email'),
      persona: buyerPersonaSchema.describe('Buyer persona'),
      signal_summary: z.string().describe('Summary of the positive signal/reply'),
      urgency: z.enum(['immediate', 'this_week', 'next_week']).describe('Meeting urgency'),
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
        signalSummary: params.signal_summary,
        urgency: params.urgency,
        partnershipAngle: params.partnership_angle,
      });

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            action: 'cold_email_book_meeting',
            channel: CHANNEL,
            prompt,
            instructions: 'Route this positive signal to a meeting. ' +
              'Use the MOF meeting-router to check availability and book. ' +
              'Generate a pre-meeting brief with all context from the cold email thread.',
          }, null, 2),
        }],
      };
    }
  );
}
