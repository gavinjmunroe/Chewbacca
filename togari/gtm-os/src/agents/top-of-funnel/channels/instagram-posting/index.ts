/**
 * @togari/bma-content/agents/top-of-funnel/channels/instagram-posting
 * Channel: Instagram Posting — Visual-first content publishing for Gartiwar, Rytual, and BMA accounts.
 * Theology frame: nature_reverent (per config/channels.ts) — Vedic, nature-rooted, no hype.
 * 4 tools: instagram_posting_build_list, instagram_posting_personalize, instagram_posting_create_sequence, instagram_posting_book_meeting
 *
 * Key differences from linkedin_posting:
 * - Visual-first: every post needs image/video direction, not just text
 * - Carousel briefs: 6-10 slides with title + body per slide (1080x1080 or 1080x1350)
 * - Caption limits: max 2200 chars, first 125 chars visible before "...more"
 * - Hashtags: max 30 per post
 * - Content types: carousels, single-image posts, Reels concepts
 * - Theology check per account: gartiwar (no Jesus), rytual (no hype/urgency)
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp';
import { z } from 'zod';
import {
  channelSchema,
  theologyFrameSchema,
  productSchema,
  timingTriggerSchema,
  buyerPersonaSchema,
} from '../../../../schemas/enums';
import { validateTheologyLine } from '../../../../config/channels';
import { sequencing } from '../../shared/sequencing';
import { meetingBooking } from '../../shared/meeting-booking';

const CHANNEL = 'instagram_posting';

/** Instagram platform constraints */
const INSTAGRAM_LIMITS = {
  captionMaxChars: 2200,
  captionVisibleChars: 125,
  maxHashtags: 30,
  carouselMinSlides: 6,
  carouselMaxSlides: 10,
  reelMaxSeconds: 90,
} as const;

/** Instagram accounts mapped to theology-validated channels */
const INSTAGRAM_ACCOUNTS = {
  gartiwar: { channel: 'gartiwar' as const, theologyFrame: 'nature_reverent' as const },
  rytual: { channel: 'rytual' as const, theologyFrame: 'nature_reverent' as const },
  bma: { channel: 'bma_linkedin' as const, theologyFrame: 'enterprise_credible' as const },
} as const;

const instagramAccountSchema = z.enum(['gartiwar', 'rytual', 'bma']);
const instagramContentTypeSchema = z.enum(['carousel', 'single_image', 'reel']);

export function registerInstagramPostingTools(server: McpServer): void {

  // ─── BUILD LIST (Content Topic Harvest) ───────────────────────────────
  // Harvests content topics from pipeline activity + Exa industry news.
  // NOT a person list — a topic/content list.
  // @ts-ignore
  server.tool(
    'instagram_posting_build_list',
    'Run the content signal harvest for Instagram posting. ' +
    'Generates 10-15 ranked content topics from pipeline activity, Exa industry news, ' +
    'Instagram engagement data, and team observations. ' +
    'Returns visual-first content ideas suited for carousels, single images, and Reels.',
    {
      pipeline_highlights: z.string().describe('What happened in Togari pipeline last week — signals, objections, prospect questions'),
      instagram_performance: z.string().describe('Which Instagram posts got engagement, saves, shares — what visual formats resonated'),
      healthcare_news: z.string().describe('Funding, regulatory, market moves in healthcare this week (use Exa for industry news)'),
      team_observations: z.string().optional().describe('What Sagar or team noticed in conversations — visual ideas, nature moments, client breakthroughs'),
      target_account: instagramAccountSchema.describe('Which Instagram account: gartiwar, rytual, or bma'),
      week_of: z.string().describe('Which content calendar week'),
    },
    async (params) => {
      const account = INSTAGRAM_ACCOUNTS[params.target_account];

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            action: 'instagram_posting_build_list',
            channel: CHANNEL,
            instructions: `Run the weekly content signal harvest for the ${params.target_account} Instagram account.

PIPELINE HIGHLIGHTS:
${params.pipeline_highlights}

INSTAGRAM PERFORMANCE:
${params.instagram_performance}

HEALTHCARE NEWS (use Exa to find additional industry news):
${params.healthcare_news}

${params.team_observations ? `TEAM OBSERVATIONS:\n${params.team_observations}\n` : ''}

ACCOUNT: ${params.target_account}
THEOLOGY FRAME: ${account.theologyFrame}

Generate 10-15 visual-first content ideas. For each idea:
1. The idea in one sentence
2. Visual concept (what the image/video would look like)
3. Content format: carousel, single_image, or reel
4. Which persona or audience it serves
5. Source signal (pipeline / engagement / news / team / exa)
6. Relevance rank (1-10)
7. Hashtag direction (3-5 seed hashtags)

Focus on ideas that:
- Are VISUAL-FIRST — the image stops the scroll, caption adds context
- Turn real pipeline insights into visual teaching content
- Fit the ${params.target_account} account aesthetic and theology
${params.target_account === 'gartiwar' ? '- Nature imagery, wellness, dharmic themes. No Jesus content.' : ''}
${params.target_account === 'rytual' ? '- Contemplative, reverent, nature-rooted. No hype. No urgency. "We will be here when you are ready."' : ''}
${params.target_account === 'bma' ? '- Enterprise credible. Data visualizations, frameworks, market intelligence.' : ''}
- Ride genuine healthcare news relevance

Return JSON array sorted by relevance rank.`,
            targetAccount: params.target_account,
            theologyFrame: account.theologyFrame,
            weekOf: params.week_of,
          }, null, 2),
        }],
      };
    }
  );

  // ─── PERSONALIZE (Carousel Brief or Caption Draft) ────────────────────
  // Generates carousel briefs (6-10 slides) or single-post captions.
  // Checks theology frame per Instagram account.
  // @ts-ignore
  server.tool(
    'instagram_posting_personalize',
    'Generate an Instagram content brief: carousel (6-10 slides with title + body per slide) ' +
    'or single-post caption (max 2200 chars, first 125 visible). ' +
    'Includes visual direction, hashtag strategy (max 30), and theology frame validation. ' +
    'For Reels, generates a concept script with shot list.',
    {
      product: productSchema,
      persona: z.string().describe('Who specifically this is for'),
      target_account: instagramAccountSchema.describe('Which Instagram account: gartiwar, rytual, or bma'),
      tone_frame: theologyFrameSchema,
      content_type: instagramContentTypeSchema.describe('Content format: carousel, single_image, or reel'),
      timing_trigger: timingTriggerSchema,
      core_idea: z.string().describe('One sentence — the core idea'),
      signal_or_data: z.string().describe('What data, event, or insight anchors this content'),
      week_of: z.string().describe('Which content calendar week'),
      num_slides: z.number().min(6).max(10).optional().describe('Number of carousel slides (default 8, only for carousel type)'),
      visual_direction: z.string().optional().describe('Any specific visual direction or aesthetic notes'),
    },
    async (params) => {
      const account = INSTAGRAM_ACCOUNTS[params.target_account];
      const theologyCheck = validateTheologyLine(account.channel, params.core_idea);

      const isCarousel = params.content_type === 'carousel';
      const isReel = params.content_type === 'reel';
      const slideCount = params.num_slides || 8;

      const carouselInstructions = isCarousel ? `
CAROUSEL GENERATION:
- ${slideCount} slides (min ${INSTAGRAM_LIMITS.carouselMinSlides}, max ${INSTAGRAM_LIMITS.carouselMaxSlides})
- Format: 1080x1080 (square) or 1080x1350 (portrait)
- For EACH slide, generate:
  1. slide_number
  2. title (max 50 chars — bold, attention-grabbing)
  3. body_text (max 100 chars — one key insight per slide)
  4. visual_prompt (describe the background image/illustration)
- Slide 1: Hook slide — stop the scroll. Bold statement or question.
- Slides 2-${slideCount - 1}: Teaching slides — one idea per slide, visual-first.
- Slide ${slideCount}: CTA slide — what to do next (save, share, DM).
- Each slide MUST stand alone as a complete thought.
- Also generate: Instagram caption (max ${INSTAGRAM_LIMITS.captionMaxChars} chars) + hashtags (max ${INSTAGRAM_LIMITS.maxHashtags}).` : '';

      const reelInstructions = isReel ? `
REEL CONCEPT:
- Max ${INSTAGRAM_LIMITS.reelMaxSeconds} seconds
- Generate:
  1. Hook (first 3 seconds — what stops the scroll)
  2. Shot list (3-5 shots with description and duration)
  3. On-screen text overlay per shot
  4. Audio direction (voiceover, music mood, trending sound suggestion)
  5. Caption (max ${INSTAGRAM_LIMITS.captionMaxChars} chars)
  6. Hashtags (max ${INSTAGRAM_LIMITS.maxHashtags})` : '';

      const singleImageInstructions = !isCarousel && !isReel ? `
SINGLE IMAGE POST:
- Generate:
  1. Visual concept (describe the image in detail)
  2. On-image text (if any — keep minimal)
  3. Caption: max ${INSTAGRAM_LIMITS.captionMaxChars} chars total
     - First ${INSTAGRAM_LIMITS.captionVisibleChars} chars are critical (visible before "...more")
     - Lead with the hook in those first ${INSTAGRAM_LIMITS.captionVisibleChars} chars
  4. Hashtags (max ${INSTAGRAM_LIMITS.maxHashtags})` : '';

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            action: 'instagram_posting_personalize',
            channel: CHANNEL,
            instructions: `Generate an Instagram ${params.content_type} brief for the ${params.target_account} account.

CORE IDEA: ${params.core_idea}
SIGNAL/DATA: ${params.signal_or_data}
${params.visual_direction ? `VISUAL DIRECTION: ${params.visual_direction}` : ''}

ACCOUNT RULES (${params.target_account}):
- Theology frame: ${account.theologyFrame}
${params.target_account === 'gartiwar' ? '- Vedic, dharmic, nature-based. No Jesus content. No corporate language.' : ''}
${params.target_account === 'rytual' ? '- Contemplative. Reverent. Nature imagery. No hype. No urgency. No countdown timers.' : ''}
${params.target_account === 'bma' ? '- Enterprise credible. Data-driven. Serious but not boring.' : ''}
${carouselInstructions}${reelInstructions}${singleImageInstructions}

CAPTION RULES:
- Max ${INSTAGRAM_LIMITS.captionMaxChars} characters
- First ${INSTAGRAM_LIMITS.captionVisibleChars} characters MUST hook — this is all they see before "...more"
- Hashtags: max ${INSTAGRAM_LIMITS.maxHashtags}, mix of broad + niche
- Never use: synergy, leverage (as verb), ecosystem (without specifics), exciting (about our own work)
- Tone must match ${account.theologyFrame} theology frame

Return JSON with contentType, visualBrief, caption (with charCount), hashtags, and any format-specific fields.`,
            variables: {
              product: params.product,
              persona: params.persona,
              targetAccount: params.target_account,
              toneFrame: params.tone_frame,
              contentType: params.content_type,
              timingTrigger: params.timing_trigger,
            },
            constraints: {
              captionMaxChars: INSTAGRAM_LIMITS.captionMaxChars,
              captionVisibleChars: INSTAGRAM_LIMITS.captionVisibleChars,
              maxHashtags: INSTAGRAM_LIMITS.maxHashtags,
              slideCount: isCarousel ? slideCount : undefined,
              reelMaxSeconds: isReel ? INSTAGRAM_LIMITS.reelMaxSeconds : undefined,
            },
            theologyValidation: {
              valid: theologyCheck.valid,
              violations: theologyCheck.violations,
            },
            outputType: params.content_type,
          }, null, 2),
        }],
      };
    }
  );

  // ─── CREATE SEQUENCE (Weekly Content Calendar) ────────────────────────
  // Builds a weekly content calendar with 3-5 posts and optimal posting times.
  // @ts-ignore
  server.tool(
    'instagram_posting_create_sequence',
    'Build an Instagram content calendar for 1-2 weeks. ' +
    'Schedules 3-5 posts per week with optimal posting times. ' +
    'Mixes carousels, single images, and Reels for algorithmic variety. ' +
    'Reels get priority reach — calendar should include at least 1-2 per week.',
    {
      content_ideas: z.string().describe('JSON array of content ideas from build_list step'),
      target_account: instagramAccountSchema.describe('Which Instagram account: gartiwar, rytual, or bma'),
      week_of: z.string().describe('Start date for the content calendar'),
      num_weeks: z.number().min(1).max(4).default(2).describe('How many weeks to plan'),
      posts_per_week: z.number().min(3).max(5).default(4).describe('Target posts per week (3-5)'),
    },
    async (params) => {
      const account = INSTAGRAM_ACCOUNTS[params.target_account];

      const prompt = sequencing.buildSequencePrompt({
        channel: CHANNEL,
        persona: 'instagram_audience',
        companyName: params.target_account,
        contactName: 'Instagram audience',
        totalSteps: params.num_weeks * params.posts_per_week,
        cadenceDays: [],
      });

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            action: 'instagram_posting_create_sequence',
            channel: CHANNEL,
            prompt,
            instructions: `Build a ${params.num_weeks}-week Instagram content calendar for the ${params.target_account} account starting ${params.week_of}.

CONTENT IDEAS (from signal harvest):
${params.content_ideas}

SCHEDULING RULES:
- ${params.posts_per_week} posts per week
- Optimal posting times for ${params.target_account}:
  - Reels: Tuesday/Thursday 11am-1pm, Saturday 9-11am (highest reach)
  - Carousels: Monday/Wednesday 12-2pm (highest saves)
  - Single images: Any day, 10am-2pm window
- At least 1-2 Reels per week (algorithm prioritizes video)
- No more than 2 carousels in a row
- Mix content types for variety across the week
- Space posts at least 1 day apart

CONTENT MIX TARGETS:
- 30-40% Reels (algorithm boost)
- 30-40% Carousels (highest saves and shares)
- 20-30% Single image posts (brand aesthetic)

THEOLOGY FRAME: ${account.theologyFrame}
${params.target_account === 'gartiwar' ? 'Account aesthetic: nature, wellness, dharmic. No Jesus content.' : ''}
${params.target_account === 'rytual' ? 'Account aesthetic: contemplative, reverent, plant medicine. No hype.' : ''}
${params.target_account === 'bma' ? 'Account aesthetic: enterprise, data-driven, healthcare intelligence.' : ''}

For each scheduled post, specify:
1. Date and optimal time
2. Content type (carousel, single_image, reel)
3. Brief summary of the content
4. Visual direction (1 sentence)
5. Which signal/idea it's based on
6. Caption hook (first ${INSTAGRAM_LIMITS.captionVisibleChars} chars)

Return JSON as a content calendar with weekly breakdowns.`,
            targetAccount: params.target_account,
            theologyFrame: account.theologyFrame,
          }, null, 2),
        }],
      };
    }
  );

  // ─── BOOK MEETING (High-Intent Engagement → Meeting) ──────────────────
  // Routes high-intent Instagram DM or comment engagement to the meeting pipeline.
  // @ts-ignore
  server.tool(
    'instagram_posting_book_meeting',
    'Route a high-intent Instagram engagement to the meeting pipeline. ' +
    'When someone DMs after a post, comments asking for more info, or shows clear buying intent. ' +
    'Kevin → Mike → Maggie routing. Flags Gwen for partnership angles.',
    {
      company_name: z.string().describe('Company name of the engaged person (if identifiable)'),
      contact_name: z.string().describe('Name or Instagram handle of the person who engaged'),
      contact_title: z.string().optional().describe('Their job title (may not be available from Instagram)'),
      contact_email: z.string().email().optional().describe('Email if available'),
      contact_instagram: z.string().describe('Instagram handle'),
      contact_linkedin: z.string().optional().describe('LinkedIn profile URL if found'),
      persona: buyerPersonaSchema.optional().describe('Buyer persona if identifiable'),
      engagement_type: z.enum(['dm', 'comment', 'story_reply', 'multiple_engagements']).describe('How they engaged'),
      engagement_detail: z.string().describe('What they said/did — the actual message or comment'),
      post_reference: z.string().describe('Which post they engaged with (URL or description)'),
      target_account: instagramAccountSchema.describe('Which Instagram account received the engagement'),
      partnership_angle: z.boolean().default(false).describe('Flag for Gwen if partnership/referral angle'),
    },
    async (params) => {
      const prompt = meetingBooking.buildMeetingBookingPrompt({
        channel: CHANNEL,
        companyName: params.company_name,
        contactName: params.contact_name,
        contactTitle: params.contact_title || 'unknown — enrich via LinkedIn',
        contactEmail: params.contact_email || 'unknown — find via LinkedIn or Instagram bio',
        persona: params.persona || 'unknown',
        signalSummary: `[INSTAGRAM ENGAGEMENT - ${params.engagement_type} on ${params.target_account}] ${params.engagement_detail} (on post: ${params.post_reference})`,
        urgency: params.engagement_type === 'dm' ? 'immediate' : 'this_week',
        partnershipAngle: params.partnership_angle,
      });

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            action: 'instagram_posting_book_meeting',
            channel: CHANNEL,
            prompt,
            instructions: 'Route this Instagram engagement to a meeting.\n\n' +
              'ENRICHMENT NEEDED: Instagram profiles have limited business info.\n' +
              '1. Check Instagram bio for LinkedIn link, website, or email\n' +
              '2. Search LinkedIn by name + company to find full profile\n' +
              '3. Use Clay enrichment if name and company are known\n' +
              '4. Include the post they engaged with in the pre-meeting brief\n\n' +
              'ROUTING: Kevin → Mike → Maggie (hard rule)\n' +
              (params.partnership_angle
                ? 'GWEN FLAG: Partnership angle detected. Flag Gwen for review.\n'
                : '') +
              '\nReturn JSON with meetingAssignment, proposedSlots, meetingBrief, and enrichmentResults.',
            constraints: {
              targetAccount: params.target_account,
              contactInstagram: params.contact_instagram,
              contactLinkedIn: params.contact_linkedin,
            },
          }, null, 2),
        }],
      };
    }
  );
}
