/**
 * @togari/core/schemas/campaign
 * Zod schemas for Campaign entity
 */

import { z } from 'zod';
import { verticalSchema, routingTierSchema, personaSchema } from './person';

// ============================================================================
// ENUM SCHEMAS
// ============================================================================

export const campaignTypeSchema = z.enum([
  'outbound_email',
  'linkedin',
  'nurture',
  'event',
  'retargeting',
  'referral',
]);

export const campaignStatusSchema = z.enum([
  'draft',
  'active',
  'paused',
  'completed',
  'archived',
]);

// ============================================================================
// CAMPAIGN SCHEMA
// ============================================================================

export const campaignSchema = z.object({
  campaignId: z.string(),
  name: z.string().min(1, 'Campaign name is required'),
  description: z.string().optional(),
  campaignType: campaignTypeSchema,

  // Targeting
  vertical: verticalSchema,
  targetPersonas: z.array(personaSchema).optional(),
  routingTiers: z.array(routingTierSchema).optional(),

  // Content
  messagingTheme: z.string().optional(),
  valueProposition: z.string().optional(),
  emailSequenceId: z.string().optional(),
  linkedinSequenceId: z.string().optional(),

  // Status
  status: campaignStatusSchema.default('draft'),
  startDate: z.date().optional(),
  endDate: z.date().optional(),

  // Metrics
  totalLeads: z.number().default(0),
  emailsSent: z.number().default(0),
  emailsOpened: z.number().default(0),
  emailsReplied: z.number().default(0),
  meetingsBooked: z.number().default(0),

  // Multi-tenant
  organizationId: z.string(),
  createdBy: z.string().optional(),

  // Timestamps
  createdAt: z.date(),
  updatedAt: z.date(),
});

// ============================================================================
// INPUT SCHEMAS
// ============================================================================

export const createCampaignSchema = z.object({
  name: z.string().min(1, 'Campaign name is required'),
  campaignType: campaignTypeSchema,
  vertical: verticalSchema,
  organizationId: z.string(),

  // Optional fields
  description: z.string().optional(),
  targetPersonas: z.array(personaSchema).optional(),
  routingTiers: z.array(routingTierSchema).optional(),
  messagingTheme: z.string().optional(),
  valueProposition: z.string().optional(),
  createdBy: z.string().optional(),
});

export const updateCampaignSchema = createCampaignSchema.partial().extend({
  status: campaignStatusSchema.optional(),
  startDate: z.date().optional(),
  endDate: z.date().optional(),
  emailSequenceId: z.string().optional(),
  linkedinSequenceId: z.string().optional(),
  totalLeads: z.number().optional(),
  emailsSent: z.number().optional(),
  emailsOpened: z.number().optional(),
  emailsReplied: z.number().optional(),
  meetingsBooked: z.number().optional(),
});

// ============================================================================
// TYPES
// ============================================================================

export type CampaignInput = z.input<typeof campaignSchema>;
export type CampaignOutput = z.output<typeof campaignSchema>;
export type CreateCampaignInput = z.infer<typeof createCampaignSchema>;
export type UpdateCampaignInput = z.infer<typeof updateCampaignSchema>;
