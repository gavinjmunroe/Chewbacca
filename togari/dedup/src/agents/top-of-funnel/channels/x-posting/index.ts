/**
 * @togari/bma-content/agents/top-of-funnel/channels/x-posting
 * Channel: X/Twitter Posting — Thought leadership content publishing.
 * Theology frame: vedic_systems (per config/channels.ts).
 * Content types: single tweets (280 chars), threads (3-5 tweets), quote-tweet suggestions.
 * Weekly posting cadence. Trending topics + pipeline themes.
 * 4 tools: x_posting_build_list, x_posting_personalize, x_posting_create_sequence, x_posting_book_meeting
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp';
import { z } from 'zod';
import { buyerPersonaSchema } from '../../../../schemas/enums';
import { validateTheologyLine } from '../../../../config/channels';
import { sequencing } from '../../shared/sequencing';
import { meetingBooking } from '../../shared/meeting-booking';

const CHANNEL = 'x_posting';

const X_LIMITS = {
  tweetMaxChars: 280,
  threadMinTweets: 3,
  threadMaxTweets: 5,
} as const;

const xAccountSchema = z.enum(['sagar', 'bma']);

export function registerXPostingTools(server: McpServer): void {

  // ─── BUILD LIST (Trending Topics + Pipeline Themes) ───────────────────
  // @ts-ignore
  server.tool(
    'x_posting_build_list',
    'Run the content signal harvest for X/Twitter posting. ' +
    'Combines trending healthcare topics (via Exa) with pipeline themes ' +
    'to generate 10-15 ranked content ideas for tweets and threads.',
    {
      trending_topics: z.string().describe('Current trending topics in healthcare Twitter — hashtags, discourse, debates'),
      pipeline_themes: z.string().describe('Themes from Togari pipeline — what prospects are asking about, common objections'),
      healthcare_news: z.string().describe('Breaking or recent healthcare news to react to'),
      target_account: xAccountSchema.describe('Which X account: sagar or bma'),
      week_of: z.string().describe('Which content calendar week'),
    },
    async (params) => {
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            action: 'x_posting_build_list',
            channel: CHANNEL,
            instructions: `Run the weekly content signal harvest for the ${params.target_account} X account.

TRENDING TOPICS:
${params.trending_topics}

PIPELINE THEMES:
${params.pipeline_themes}

HEALTHCARE NEWS:
${params.healthcare_news}

Generate 10-15 content ideas. For each:
1. The idea in one sentence
2. Format: single_tweet, thread, or quote_tweet
3. Which trending topic or pipeline theme it connects to
4. Timeliness (react now vs. evergreen)
5. Relevance rank (1-10)

Focus on:
- Sharp takes on trending healthcare discourse
- Data-backed observations from pipeline activity
- Contrarian but defensible positions
- Threads that teach one concept clearly
${params.target_account === 'sagar' ? '- Vedic systems thinking applied to healthcare data. Direct, philosophical.' : ''}
${params.target_account === 'bma' ? '- Enterprise credible. Data intelligence. Never corporate-speak.' : ''}

Return JSON array sorted by relevance rank.`,
            targetAccount: params.target_account,
            weekOf: params.week_of,
          }, null, 2),
        }],
      };
    }
  );

  // ─── PERSONALIZE (Tweet / Thread Draft) ───────────────────────────────
  // @ts-ignore
  server.tool(
    'x_posting_personalize',
    'Generate tweet copy: single tweet (280 chars), thread (3-5 tweets), or quote-tweet suggestion. ' +
    'Sharp, direct, systems-thinking voice. No corporate speak.',
    {
      target_account: xAccountSchema.describe('Which X account: sagar or bma'),
      content_type: z.enum(['single_tweet', 'thread', 'quote_tweet']).describe('Tweet format'),
      core_idea: z.string().describe('One sentence — the core idea'),
      signal_or_data: z.string().describe('Data, event, or insight anchoring this content'),
      quote_tweet_url: z.string().optional().describe('URL of tweet to quote (only for quote_tweet type)'),
      week_of: z.string().describe('Content calendar week'),
    },
    async (params) => {
      const channelForValidation = params.target_account === 'sagar' ? 'sagar_linkedin' as const : 'bma_linkedin' as const;
      const theologyCheck = validateTheologyLine(channelForValidation, params.core_idea);

      const isThread = params.content_type === 'thread';
      const isQuote = params.content_type === 'quote_tweet';

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            action: 'x_posting_personalize',
            channel: CHANNEL,
            instructions: `Generate ${params.content_type} copy for the ${params.target_account} X account.

CORE IDEA: ${params.core_idea}
SIGNAL/DATA: ${params.signal_or_data}
${isQuote && params.quote_tweet_url ? `QUOTE TWEET: ${params.quote_tweet_url}` : ''}

${isThread ? `THREAD FORMAT (${X_LIMITS.threadMinTweets}-${X_LIMITS.threadMaxTweets} tweets):
- Tweet 1: Hook — the sharpest version of the idea. Stops the scroll.
- Tweets 2-${X_LIMITS.threadMaxTweets - 1}: Build the argument. One idea per tweet. Data or example in each.
- Final tweet: The takeaway + soft CTA (follow for more, what do you think, etc.)
- Each tweet max ${X_LIMITS.tweetMaxChars} chars. Number them (1/, 2/, etc.)` : ''}

${!isThread ? `SINGLE TWEET: Max ${X_LIMITS.tweetMaxChars} characters. Every word earns its place.` : ''}

VOICE (${params.target_account}):
${params.target_account === 'sagar' ? '- Direct, philosophical, systems-thinking. Vedic-informed but not preachy. Sharp observations.' : ''}
${params.target_account === 'bma' ? '- Enterprise credible. Data-first. Professional but never corporate. No jargon without substance.' : ''}

NEVER: synergy, leverage, ecosystem, "excited to announce", thread-bro energy ("Here's what nobody tells you about X")

Return JSON with ${isThread ? 'tweets (array of {text, charCount})' : 'tweet (string), charCount'}.`,
            constraints: {
              tweetMaxChars: X_LIMITS.tweetMaxChars,
              threadLength: isThread ? { min: X_LIMITS.threadMinTweets, max: X_LIMITS.threadMaxTweets } : undefined,
            },
            theologyValidation: theologyCheck,
          }, null, 2),
        }],
      };
    }
  );

  // ─── CREATE SEQUENCE (Weekly Content Calendar) ────────────────────────
  // @ts-ignore
  server.tool(
    'x_posting_create_sequence',
    'Build a weekly X/Twitter content calendar. ' +
    'Mixes single tweets, threads, and quote-tweets. ' +
    'X rewards consistency and timeliness — cadence matters more than polish.',
    {
      content_ideas: z.string().describe('JSON array of content ideas from build_list step'),
      target_account: xAccountSchema.describe('Which X account: sagar or bma'),
      week_of: z.string().describe('Start date for the content calendar'),
      tweets_per_week: z.number().min(3).max(10).default(5).describe('Target tweets per week'),
    },
    async (params) => {
      const prompt = sequencing.buildSequencePrompt({
        channel: CHANNEL,
        persona: 'x_audience',
        companyName: params.target_account,
        contactName: 'X audience',
        totalSteps: params.tweets_per_week,
        cadenceDays: [],
      });

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            action: 'x_posting_create_sequence',
            channel: CHANNEL,
            prompt,
            instructions: `Build a weekly X content calendar for @${params.target_account} starting ${params.week_of}.

CONTENT IDEAS:
${params.content_ideas}

SCHEDULING:
- ${params.tweets_per_week} tweets/week
- Best times: 8-10am EST (morning scroll), 12-1pm (lunch), 5-7pm (commute)
- Threads perform best Tuesday-Thursday mornings
- Single tweets can go any day
- React-tweets (quote tweets, news reactions) should go same-day as the news
- Space at least 4 hours between tweets

CONTENT MIX:
- 1-2 threads per week (deepest engagement)
- 2-3 single tweets (quick takes, data points)
- 1 quote-tweet or reaction (join existing conversation)

For each scheduled tweet:
1. Date and time
2. Format (single_tweet, thread, quote_tweet)
3. Brief content summary
4. Which idea it's based on

Return JSON as a weekly content calendar.`,
            targetAccount: params.target_account,
          }, null, 2),
        }],
      };
    }
  );

  // ─── BOOK MEETING (High-Intent Engagement → Meeting) ──────────────────
  // @ts-ignore
  server.tool(
    'x_posting_book_meeting',
    'Route a high-intent X/Twitter engagement to the meeting pipeline. ' +
    'When someone replies to a thread with clear interest or DMs asking for more. ' +
    'Kevin → Mike → Maggie routing.',
    {
      company_name: z.string().describe('Company name of the engaged person'),
      contact_name: z.string().describe('Name or X handle'),
      contact_title: z.string().optional().describe('Job title if known'),
      contact_x_handle: z.string().describe('X/Twitter handle'),
      contact_email: z.string().email().optional().describe('Email if available'),
      contact_linkedin: z.string().optional().describe('LinkedIn URL if found'),
      persona: buyerPersonaSchema.optional().describe('Buyer persona if identifiable'),
      engagement_type: z.enum(['reply', 'dm', 'quote_tweet', 'multiple']).describe('How they engaged'),
      engagement_detail: z.string().describe('What they said'),
      post_reference: z.string().describe('Which tweet/thread they engaged with'),
      partnership_angle: z.boolean().default(false).describe('Flag Gwen for partnership angle'),
    },
    async (params) => {
      const prompt = meetingBooking.buildMeetingBookingPrompt({
        channel: CHANNEL,
        companyName: params.company_name,
        contactName: params.contact_name,
        contactTitle: params.contact_title || 'unknown — enrich via LinkedIn',
        contactEmail: params.contact_email || 'unknown — find via LinkedIn or X bio',
        persona: params.persona || 'unknown',
        signalSummary: `[X/TWITTER - ${params.engagement_type}] ${params.engagement_detail} (on: ${params.post_reference})`,
        urgency: params.engagement_type === 'dm' ? 'immediate' : 'this_week',
        partnershipAngle: params.partnership_angle,
      });

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            action: 'x_posting_book_meeting',
            channel: CHANNEL,
            prompt,
            instructions: 'Route this X/Twitter engagement to a meeting. ' +
              'Enrich via LinkedIn/Clay — X profiles often lack business info. ' +
              'Kevin → Mike → Maggie routing.' +
              (params.partnership_angle ? ' GWEN FLAG: Partnership angle detected.' : ''),
            constraints: {
              contactXHandle: params.contact_x_handle,
              contactLinkedIn: params.contact_linkedin,
            },
          }, null, 2),
        }],
      };
    }
  );
}
