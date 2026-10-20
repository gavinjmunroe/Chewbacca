/**
 * @togari/bma-content/agents/top-of-funnel/channels/linkedin-posting
 * Channel: LinkedIn Posting — Content publishing across BMA LinkedIn channels
 * Absorbs logic from content-publisher.ts (generate_content_brief, generate_carousel, weekly_signal_harvest)
 * 4 tools: linkedin_posting_build_list, linkedin_posting_personalize, linkedin_posting_create_sequence, linkedin_posting_book_meeting
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp';
import { z } from 'zod';
import {
  channelSchema,
  contentTypeSchema,
  theologyFrameSchema,
  productSchema,
  timingTriggerSchema,
  carouselTemplateSchema,
  buyerPersonaSchema,
} from '../../../../schemas/enums';
import { sequencing } from '../../shared/sequencing';
import { meetingBooking } from '../../shared/meeting-booking';

const CHANNEL = 'linkedin_posting';

export function registerLinkedInPostingTools(server: McpServer): void {

  // ─── BUILD LIST (Signal Harvest) ──────────────────────────────────────
  // Absorbs weekly_signal_harvest from content-publisher.ts
  // @ts-ignore
  server.tool(
    'linkedin_posting_build_list',
    'Run the content signal harvest for LinkedIn posting. ' +
    'Reviews pipeline performance, LinkedIn engagement, healthcare news, and team observations ' +
    'to produce 10-15 ranked content ideas. Replaces weekly_signal_harvest.',
    {
      pipeline_highlights: z.string().describe('What happened in Togari pipeline last week — signals, objections, prospect questions'),
      linkedin_performance: z.string().describe('Which BMA LinkedIn posts got engagement, which did not, what comments said'),
      healthcare_news: z.string().describe('Funding, regulatory, market moves in healthcare this week'),
      team_observations: z.string().optional().describe('What Sagar or Kevin noticed in conversations'),
      week_of: z.string().describe('Which content calendar week'),
    },
    async (params) => {
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            action: 'linkedin_posting_build_list',
            channel: CHANNEL,
            instructions: `Run the weekly content signal harvest for BMA LinkedIn channels.

PIPELINE HIGHLIGHTS:
${params.pipeline_highlights}

LINKEDIN PERFORMANCE:
${params.linkedin_performance}

HEALTHCARE NEWS:
${params.healthcare_news}

${params.team_observations ? `TEAM OBSERVATIONS:\n${params.team_observations}\n` : ''}

Generate 10-15 raw content ideas. For each idea:
1. The idea in one sentence
2. Which channel (bma_linkedin, gartiwar, rytual, kevin_linkedin, sagar_linkedin)
3. Content type (post, carousel, video, essay)
4. Which persona it serves
5. Source signal (pipeline / engagement / news / team)
6. Relevance rank (1-10)

Focus on ideas that:
- Turn real pipeline insights into teaching content
- Show Togari data capability in action
- Address questions prospects actually asked
- Ride genuine healthcare news relevance

Return JSON array sorted by relevance rank.`,
            weekOf: params.week_of,
          }, null, 2),
        }],
      };
    }
  );

  // ─── PERSONALIZE (Content Brief + Carousel) ──────────────────────────
  // Absorbs generate_content_brief and generate_carousel from content-publisher.ts
  // @ts-ignore
  server.tool(
    'linkedin_posting_personalize',
    'Generate a content brief or carousel for LinkedIn posting. ' +
    'Requires all six content variables (product, persona, channel, tone, content type, timing). ' +
    'If carousel, generates slide-by-slide copy with visual prompts. ' +
    'Replaces generate_content_brief and generate_carousel.',
    {
      product: productSchema,
      persona: z.string().describe('Who specifically this is for'),
      target_channel: channelSchema.describe('Which LinkedIn channel (bma_linkedin, sagar_linkedin, kevin_linkedin, etc.)'),
      tone_frame: theologyFrameSchema,
      content_type: contentTypeSchema,
      timing_trigger: timingTriggerSchema,
      core_idea: z.string().describe('One sentence — the core idea'),
      signal_or_data: z.string().describe('What data, event, or insight anchors this content'),
      week_of: z.string().describe('Which content calendar week'),
      carousel_template: carouselTemplateSchema.optional().describe('If carousel: framework_explainer, case_study, myths_vs_reality, or mini_playbook'),
      num_slides: z.number().min(4).max(12).optional().describe('Number of carousel slides (default 8)'),
    },
    async (params) => {
      const isCarousel = params.content_type === 'carousel' && params.carousel_template;

      const briefInstructions = `Generate a content brief for the ${params.target_channel} channel.

CORE IDEA: ${params.core_idea}
SIGNAL/DATA: ${params.signal_or_data}

Generate:
1. Why this resonates with ${params.persona} on ${params.target_channel}
2. Five hook variations (the first line that stops the scroll). Pick the best one.
3. Three key points (max) — what the content proves or teaches
4. CTA — what we want the reader to do or feel
5. Visual direction (if applicable)

RULES:
- Never start a LinkedIn post with "I"
- Never use: synergy, leverage (as verb), ecosystem (without specifics), exciting (about our own work)
- Every carousel slide must stand alone as a complete thought
- Tone: ${params.tone_frame}
- Content type: ${params.content_type}`;

      const carouselInstructions = isCarousel ? `

CAROUSEL GENERATION (${params.carousel_template}):
- ${params.num_slides || 8} slides
- Max 35 words per slide, 70 char headlines
- Brand: Primary #001F3F (navy), Accent #24C3A8 (teal)
- Layout: 1080x1350 LinkedIn carousel format
- For each slide: headline, body, visual_prompt
- Also generate: LinkedIn caption + 3-5 hashtags` : '';

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            action: 'linkedin_posting_personalize',
            channel: CHANNEL,
            instructions: briefInstructions + carouselInstructions,
            variables: {
              product: params.product,
              persona: params.persona,
              targetChannel: params.target_channel,
              toneFrame: params.tone_frame,
              contentType: params.content_type,
              timingTrigger: params.timing_trigger,
            },
            outputType: isCarousel ? 'carousel' : 'content_brief',
          }, null, 2),
        }],
      };
    }
  );

  // ─── CREATE SEQUENCE (Content Calendar) ───────────────────────────────
  // @ts-ignore
  server.tool(
    'linkedin_posting_create_sequence',
    'Build a LinkedIn content calendar sequence for 1-2 weeks. ' +
    'Spaces out posts across channels with optimal timing. ' +
    'Mixes content types (posts, carousels, essays) for variety.',
    {
      content_ideas: z.string().describe('JSON array of content ideas from build_list step'),
      week_of: z.string().describe('Start date for the content calendar'),
      num_weeks: z.number().min(1).max(4).default(2).describe('How many weeks to plan'),
      posts_per_week: z.number().min(2).max(7).default(3).describe('Target posts per week per channel'),
    },
    async (params) => {
      const prompt = sequencing.buildSequencePrompt({
        channel: CHANNEL,
        persona: 'content_audience',
        companyName: 'BMA',
        contactName: 'LinkedIn audience',
        totalSteps: params.num_weeks * params.posts_per_week,
        cadenceDays: [],
      });

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            action: 'linkedin_posting_create_sequence',
            channel: CHANNEL,
            prompt,
            instructions: `Build a ${params.num_weeks}-week LinkedIn content calendar starting ${params.week_of}.

CONTENT IDEAS (from signal harvest):
${params.content_ideas}

SCHEDULING RULES:
- ${params.posts_per_week} posts per week per channel minimum
- BMA LinkedIn: Tuesday, Thursday, Saturday
- Sagar LinkedIn: Monday, Wednesday, Friday
- Kevin LinkedIn: Tuesday, Thursday
- Mix content types for variety
- Never publish two carousels in a row
- Each post should build on or reference previous content when possible

For each scheduled post, specify:
1. Date and time
2. Channel
3. Content type
4. Brief summary of the content
5. Which signal/idea it's based on

Return JSON as a content calendar with weekly breakdowns.`,
          }, null, 2),
        }],
      };
    }
  );

  // ─── BOOK MEETING (Engagement → Meeting) ──────────────────────────────
  // @ts-ignore
  server.tool(
    'linkedin_posting_book_meeting',
    'Route a high-intent LinkedIn engagement to the meeting pipeline. ' +
    'When someone comments asking for the artifact, DMs after a post, or shows clear buying intent. ' +
    'Kevin → Mike → Maggie routing.',
    {
      company_name: z.string().describe('Company name of the engaged person'),
      contact_name: z.string().describe('Name of the person who engaged'),
      contact_title: z.string().describe('Their job title'),
      contact_email: z.string().email().optional().describe('Email if available'),
      contact_linkedin: z.string().optional().describe('LinkedIn profile URL'),
      persona: buyerPersonaSchema.optional().describe('Buyer persona if identifiable'),
      engagement_type: z.enum(['comment', 'dm', 'share', 'multiple_engagements']).describe('How they engaged'),
      engagement_detail: z.string().describe('What they said/did'),
      post_reference: z.string().describe('Which post they engaged with'),
      partnership_angle: z.boolean().default(false).describe('Flag for Gwen if partnership/referral angle'),
    },
    async (params) => {
      const prompt = meetingBooking.buildMeetingBookingPrompt({
        channel: CHANNEL,
        companyName: params.company_name,
        contactName: params.contact_name,
        contactTitle: params.contact_title,
        contactEmail: params.contact_email || 'unknown — find via LinkedIn',
        persona: params.persona || 'unknown',
        signalSummary: `[LINKEDIN ENGAGEMENT - ${params.engagement_type}] ${params.engagement_detail} (on post: ${params.post_reference})`,
        urgency: params.engagement_type === 'dm' ? 'immediate' : 'this_week',
        partnershipAngle: params.partnership_angle,
      });

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            action: 'linkedin_posting_book_meeting',
            channel: CHANNEL,
            prompt,
            instructions: 'Route this LinkedIn engagement to a meeting. ' +
              'If we don\'t have their email, find it via LinkedIn profile or Clay enrichment first. ' +
              'Include the post they engaged with in the pre-meeting brief.',
          }, null, 2),
        }],
      };
    }
  );
}
