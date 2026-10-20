/**
 * @togari/bma-content/schemas/signal-package
 * Zod schemas for the 4-step signal generation system
 * from TOGARI_OUTBOUND.md and TOGARI_MCP.md
 */

import { z } from 'zod';
import {
  buyerPersonaSchema,
  offerTypeSchema,
  senderIdentitySchema,
} from './enums';

// ============================================================================
// STEP 1: INTERNAL SIGNAL
// ============================================================================

export const internalSignalSchema = z.object({
  found: z.boolean(),
  segmentData: z.string().optional().describe('What healthcare segment data Togari has for them'),
  dataDepth: z.string().optional().describe('Depth and freshness of the data'),
  mostValuableAsset: z.string().optional().describe('Single most valuable Togari data asset'),
  signalStatement: z.string().describe('One-sentence internal signal statement'),
  isProxySignal: z.boolean().default(false).describe('True if using segment-level proxy, not direct company data'),
});

// ============================================================================
// STEP 2: EXTERNAL SIGNAL
// ============================================================================

export const externalSignalSchema = z.object({
  signal: z.string().describe('What the company did publicly'),
  category: z.enum([
    'funding',
    'executive_hire',
    'product_launch',
    'conference',
    'press_coverage',
    'job_posting',
    'regulatory',
    'partnership',
    'earnings',
    'expansion',
    'competitive_move',
  ]),
  source: z.string().describe('Where we found this signal'),
  date: z.string().describe('When this happened'),
  relevanceRank: z.number().min(1).max(3).describe('Ranked 1-3 by relevance to GTM intelligence conversation'),
});

// ============================================================================
// STEP 3: RELEVANCE JUDGMENT
// ============================================================================

export const relevanceJudgmentSchema = z.object({
  dataServes: z.enum(['yes', 'partial', 'no']).describe('Does Togari data directly serve their signaled move?'),
  dataServesExplanation: z.string(),
  timingGenuine: z.boolean().describe('Is timing genuinely right, or just plausible-sounding?'),
  timingExplanation: z.string(),
  signalStrengthScore: z.number().min(1).max(10).describe('Combined signal strength — below 6 means HOLD'),
  holdRecommendation: z.string().optional().describe('If below 6: what to look for instead'),
});

// ============================================================================
// STEP 4: FULL SIGNAL PACKAGE
// ============================================================================

export const signalPackageSchema = z.object({
  // Identity
  prospectId: z.string(),
  company: z.string(),
  domain: z.string(),
  contactName: z.string(),
  contactTitle: z.string(),
  persona: buyerPersonaSchema,
  segment: z.string().describe('Healthcare subsegment'),

  // The four steps
  internalSignal: internalSignalSchema,
  externalSignals: z.array(externalSignalSchema).min(1).max(3),
  relevanceJudgment: relevanceJudgmentSchema,

  // Step 4 synthesis
  whyNow: z.string().describe(
    'Format: "[Company] just [external signal], which means they are about to [implication], ' +
    'and Togari has [specific data asset] that maps directly to that move."'
  ),

  // Recommendations
  recommendedOffer: offerTypeSchema,
  bestProofPoint: z.string().describe('Most relevant case or data example'),
  recommendedSender: senderIdentitySchema,
  sendThisWeek: z.enum(['yes', 'no', 'hold']),
  holdReason: z.string().optional(),

  // Metadata
  generatedAt: z.string().datetime(),
  generatedBy: z.enum(['signal_scout', 'manual']).default('signal_scout'),
});

// ============================================================================
// BATCH SUMMARY (output after processing all accounts)
// ============================================================================

export const signalBatchSummarySchema = z.object({
  batchDate: z.string().datetime(),
  totalProcessed: z.number(),
  approvedForSend: z.number(),
  onHold: z.number(),
  holdReasons: z.array(z.object({
    company: z.string(),
    reason: z.string(),
  })),
  personaDistribution: z.object({
    A: z.number(),
    B: z.number(),
    C: z.number(),
  }),
  avgSignalStrength: z.number(),
  topSignalCategories: z.array(z.object({
    category: z.string(),
    count: z.number(),
  })).max(3),
});

// ============================================================================
// TYPES
// ============================================================================

export type InternalSignal = z.infer<typeof internalSignalSchema>;
export type ExternalSignal = z.infer<typeof externalSignalSchema>;
export type RelevanceJudgment = z.infer<typeof relevanceJudgmentSchema>;
export type SignalPackage = z.infer<typeof signalPackageSchema>;
export type SignalBatchSummary = z.infer<typeof signalBatchSummarySchema>;
