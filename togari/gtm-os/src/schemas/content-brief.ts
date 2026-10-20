/**
 * @togari/bma-content/schemas/content-brief
 * Zod schemas for content briefs and carousel generation
 * from CONTENT_ENGINE.md and BMA LinkedIn Content System MD
 */

import { z } from 'zod';
import {
  channelSchema,
  contentTypeSchema,
  theologyFrameSchema,
  carouselTemplateSchema,
  productSchema,
  timingTriggerSchema,
} from './enums';

// ============================================================================
// THE SIX CONTENT VARIABLES (from CONTENT_ENGINE.md)
// Every content decision is governed by these six variables.
// If any is undefined, do not write the content.
// ============================================================================

export const contentVariablesSchema = z.object({
  product: productSchema,
  persona: z.string().describe('Who specifically is this for'),
  channel: channelSchema,
  toneFrame: theologyFrameSchema,
  contentType: contentTypeSchema,
  timingTrigger: timingTriggerSchema,
});

// ============================================================================
// CONTENT BRIEF (from CONTENT_ENGINE.md Stage 2)
// ============================================================================

export const contentBriefSchema = z.object({
  id: z.string(),
  variables: contentVariablesSchema,

  coreIdea: z.string().describe('One sentence'),
  whyResonates: z.string().describe('Why this idea matters to the specific persona on this channel'),
  signalUsed: z.string().describe('What data, event, or insight anchors it'),
  hook: z.string().describe('The first line that stops the scroll — write 5 versions, pick the best'),
  keyPoints: z.array(z.string()).max(3).describe('What the content proves or teaches'),
  cta: z.string().describe('What we want the reader to do or feel'),
  visualDirection: z.string().optional().describe('What the image/video shows'),

  // Status
  status: z.enum(['proposed', 'approved', 'in_production', 'completed']).default('proposed'),
  approvedBy: z.string().optional(),
  approvedAt: z.string().datetime().optional(),

  // Metadata
  createdAt: z.string().datetime(),
  weekOf: z.string().describe('Which content calendar week'),
});

// ============================================================================
// CAROUSEL SLIDE (from BMA LinkedIn Content System MD)
// ============================================================================

export const carouselSlideSchema = z.object({
  index: z.number().min(1),
  type: z.enum(['hook', 'body', 'example', 'cta']),
  headline: z.string().max(70).describe('Max 70 characters'),
  body: z.string().describe('Body text for the slide'),
  supportingExample: z.string().optional(),
  visualPrompt: z.string().describe(
    'Asset prompt for Flora/designer — references brand spec'
  ),
});

// ============================================================================
// FULL CAROUSEL (from BMA LinkedIn Content System MD Section 6)
// ============================================================================

export const carouselSchema = z.object({
  id: z.string(),
  template: carouselTemplateSchema,
  title: z.string(),
  sourceReferences: z.array(z.string()).describe('call IDs, chunk IDs, doc IDs'),

  // Slides
  slides: z.array(carouselSlideSchema).min(4).max(12),

  // LinkedIn copy
  linkedinCaption: z.string().describe('1-3 short paragraphs'),
  hashtags: z.array(z.string()).min(3).max(5),

  // Brand compliance
  brandConstraints: z.object({
    maxWordsPerSlide: z.number().default(35),
    headlineMaxChars: z.number().default(70),
    imageryStyle: z.string().default('Minimal, editorial, soft gradients, no stock photography'),
  }),

  // Metadata
  contentBriefId: z.string().optional(),
  generatedAt: z.string().datetime(),
  status: z.enum(['draft', 'approved', 'published']).default('draft'),
});

// ============================================================================
// BRAND SYSTEM (from BMA LinkedIn Content System MD Section 5.3)
// ============================================================================

export const brandSystemSchema = z.object({
  brand: z.string().default('Blue Modern Advisory'),
  colors: z.object({
    primary: z.string().default('#001F3F'),
    accent: z.string().default('#24C3A8'),
    background: z.string().default('#0A1929'),
    text: z.string().default('#FFFFFF'),
  }),
  typography: z.object({
    headingFont: z.string().default('Inter'),
    bodyFont: z.string().default('Inter'),
  }),
  imageryStyle: z.string().default(
    'Minimal, editorial, soft gradients, no stock photography, navy and teal palette'
  ),
  layoutRules: z.object({
    maxWordsPerSlide: z.number().default(35),
    headlineMaxChars: z.number().default(70),
    slideAspectRatio: z.string().default('1080x1350'),
  }),
  toneRules: z.array(z.string()).default([
    'Practical, specific, no fluff',
    'B2B aspirational but grounded',
    'Never start a LinkedIn post with "I"',
    'Every slide must stand alone as a complete thought',
  ]),
  prohibitedWords: z.array(z.string()).default([
    'synergy', 'leverage', 'ecosystem', 'exciting',
  ]),
});

// ============================================================================
// WEEKLY METRICS (from MEASUREMENT_OS.md)
// ============================================================================

export const weeklyMetricsSchema = z.object({
  weekEnding: z.string(),

  // Top line
  emailsSent: z.number(),
  positiveReplyRate: z.number(),
  positiveReplyRatePrev: z.number().optional(),
  positiveReplyRateTrend: z.enum(['up', 'down', 'flat']).optional(),
  meetingsBooked: z.number(),
  pipelineAdded: z.number(),

  // Signal performance
  avgSignalStrength: z.number(),
  accountsAboveSix: z.number(),
  mostCommonSignalType: z.string(),
  weakestSignalType: z.string(),
  signalsHeld: z.number(),

  // Persona breakdown
  personaBreakdown: z.record(z.object({
    sent: z.number(),
    positiveReplyRate: z.number(),
    meetings: z.number(),
  })),

  // Sender performance
  senderPerformance: z.record(z.object({
    sent: z.number(),
    positiveReplyRate: z.number(),
  })),

  // Content performance
  contentPerformance: z.array(z.object({
    channel: z.string(),
    pieces: z.number(),
    avgEngagement: z.number(),
    topPost: z.string().optional(),
    topPostImpressions: z.number().optional(),
  })),
  contentToPipelineConnections: z.number(),

  // Pipeline health
  pipelineHealth: z.object({
    totalActive: z.number(),
    stageBreakdown: z.record(z.number()),
    daysSinceContactWarnings: z.number(),
    overdueCommitments: z.number(),
  }),

  // Deliverability
  deliverability: z.object({
    inboxPlacementRate: z.number(),
    spamComplaintRate: z.number(),
    unsubscribeRate: z.number(),
    domainHealthFlags: z.array(z.string()),
    warmupStatus: z.array(z.object({
      inbox: z.string(),
      status: z.enum(['warming', 'ready', 'flagged']),
    })),
  }),
});

// ============================================================================
// TYPES
// ============================================================================

export type ContentVariables = z.infer<typeof contentVariablesSchema>;
export type ContentBrief = z.infer<typeof contentBriefSchema>;
export type CarouselSlide = z.infer<typeof carouselSlideSchema>;
export type Carousel = z.infer<typeof carouselSchema>;
export type BrandSystem = z.infer<typeof brandSystemSchema>;
export type WeeklyMetrics = z.infer<typeof weeklyMetricsSchema>;
