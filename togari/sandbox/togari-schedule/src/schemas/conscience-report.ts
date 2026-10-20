/**
 * @togari/bma-content/schemas/conscience-report
 * Zod schemas for the GLM Conscience Check (Agent 9)
 * from AGENT_COORDINATION.md
 *
 * Advisory only — generates reports for Sagar and Caleb.
 * Does not block outputs.
 */

import { z } from 'zod';

// ============================================================================
// SAMPLED OUTPUT (one of 20 randomly sampled agent outputs per week)
// ============================================================================

export const sampledOutputSchema = z.object({
  outputId: z.string(),
  agentName: z.string().describe('Which agent produced this output'),
  outputType: z.string().describe('email / content / reply_draft / signal_package / etc.'),
  outputDate: z.string().datetime(),
  outputContent: z.string().describe('The actual output text or summary'),
  serviceTestPassed: z.boolean().describe('Does this serve the human on the other end, or extract from them?'),
  serviceTestNotes: z.string().optional(),
});

// ============================================================================
// GLM CONSCIENCE REPORT (weekly, for Sagar and Caleb)
// ============================================================================

export const conscienceReportSchema = z.object({
  id: z.string(),
  weekOf: z.string(),
  generatedAt: z.string().datetime(),

  // Sample
  sampleSize: z.number().default(20),
  outputsSampled: z.array(sampledOutputSchema),

  // Theology line
  theologyViolations: z.object({
    count: z.number(),
    details: z.array(z.object({
      outputId: z.string(),
      agentName: z.string(),
      violation: z.string(),
      recommendedFix: z.string(),
    })),
  }),

  // Fear-based copy
  fearBasedCopy: z.object({
    count: z.number(),
    details: z.array(z.object({
      outputId: z.string(),
      language: z.string(),
      recommendedAlternative: z.string(),
    })),
  }),

  // Service vs extraction test
  serviceTest: z.object({
    passed: z.number(),
    failed: z.number(),
    failedDetails: z.array(z.object({
      outputId: z.string(),
      explanation: z.string(),
    })),
  }),

  // Ahimsa check (non-harm)
  ahimsaCheck: z.object({
    status: z.enum(['clear', 'flagged']),
    details: z.string().optional(),
  }),

  // Six dimensions health check
  sixDimensionsCheck: z.object({
    majorDecisionsReviewed: z.number(),
    gapsIdentified: z.array(z.object({
      decision: z.string(),
      missingDimension: z.string(),
      recommendation: z.string(),
    })),
  }),

  // Overall verdict
  overallVerdict: z.enum(['clean', 'needs_attention']),
  recommendedActions: z.array(z.string()),
});

// ============================================================================
// TYPES
// ============================================================================

export type SampledOutput = z.infer<typeof sampledOutputSchema>;
export type ConscienceReport = z.infer<typeof conscienceReportSchema>;
