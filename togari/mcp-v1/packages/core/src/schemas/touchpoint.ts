/**
 * @togari/core/schemas/touchpoint
 * Zod schemas for Touchpoint entity
 */

import { z } from 'zod';

// ============================================================================
// ENUM SCHEMAS
// ============================================================================

export const touchpointTypeSchema = z.enum([
  'email_sent',
  'email_opened',
  'email_clicked',
  'email_replied',
  'linkedin_connection',
  'linkedin_message',
  'linkedin_view',
  'call',
  'meeting',
  'demo',
  'note',
  'form_submission',
]);

export const touchpointSentimentSchema = z.enum([
  'positive',
  'neutral',
  'negative',
]);

export const touchpointDirectionSchema = z.enum([
  'inbound',
  'outbound',
]);

// ============================================================================
// TOUCHPOINT SCHEMA
// ============================================================================

export const touchpointSchema = z.object({
  touchpointId: z.string(),
  personId: z.string(),
  campaignId: z.string().optional(),

  // Interaction details
  touchpointType: touchpointTypeSchema,
  channel: z.string(),
  direction: touchpointDirectionSchema,

  // Content
  subject: z.string().optional(),
  body: z.string().optional(),
  notes: z.string().optional(),

  // Outcome
  outcome: z.string().optional(),
  sentiment: touchpointSentimentSchema.optional(),
  responseReceived: z.boolean().optional(),
  responseTime: z.number().optional(), // minutes

  // Context
  meetingScheduled: z.boolean().optional(),
  meetingDate: z.date().optional(),
  nextSteps: z.string().optional(),

  // Multi-tenant
  organizationId: z.string(),
  performedBy: z.string().optional(),

  // Timestamps
  occurredAt: z.date(),
  createdAt: z.date(),
});

// ============================================================================
// INPUT SCHEMAS
// ============================================================================

export const createTouchpointSchema = z.object({
  personId: z.string(),
  touchpointType: touchpointTypeSchema,
  channel: z.string(),
  direction: touchpointDirectionSchema,
  organizationId: z.string(),

  // Optional fields
  campaignId: z.string().optional(),
  subject: z.string().optional(),
  body: z.string().optional(),
  notes: z.string().optional(),
  outcome: z.string().optional(),
  sentiment: touchpointSentimentSchema.optional(),
  performedBy: z.string().optional(),
  meetingScheduled: z.boolean().optional(),
  meetingDate: z.date().optional(),
  nextSteps: z.string().optional(),
  occurredAt: z.date().optional(), // Defaults to now
});

export const updateTouchpointSchema = createTouchpointSchema.partial().extend({
  responseReceived: z.boolean().optional(),
  responseTime: z.number().optional(),
});

// ============================================================================
// TYPES
// ============================================================================

export type TouchpointInput = z.input<typeof touchpointSchema>;
export type TouchpointOutput = z.output<typeof touchpointSchema>;
export type CreateTouchpointInput = z.infer<typeof createTouchpointSchema>;
export type UpdateTouchpointInput = z.infer<typeof updateTouchpointSchema>;
