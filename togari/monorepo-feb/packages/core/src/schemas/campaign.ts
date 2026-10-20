import { z } from 'zod';
import { verticalSchema, personaSchema, routingTierSchema } from './person';

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

export const campaignSchema = z.object({
  campaignId: z.string(),

  // Campaign Info
  name: z.string(),
  description: z.string().optional(),
  campaignType: campaignTypeSchema,

  // Targeting
  vertical: verticalSchema,
  targetPersonas: z.array(personaSchema).optional(),
  routingTiers: z.array(routingTierSchema).optional(),

  // Content
  messagingTheme: z.string().optional(),
  valueProposition: z.string().optional(),

  // Sequences
  emailSequenceId: z.string().optional(),
  linkedinSequenceId: z.string().optional(),

  // Status
  status: campaignStatusSchema,
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

  // Metadata
  createdAt: z.date(),
  updatedAt: z.date(),
  createdBy: z.string().optional(),
});

export const createCampaignSchema = z.object({
  name: z.string().min(1, 'Campaign name is required'),
  description: z.string().optional(),
  campaignType: campaignTypeSchema,
  vertical: verticalSchema,
  organizationId: z.string(),

  targetPersonas: z.array(personaSchema).optional(),
  routingTiers: z.array(routingTierSchema).optional(),
  messagingTheme: z.string().optional(),
  valueProposition: z.string().optional(),
});

export type CreateCampaignInput = z.infer<typeof createCampaignSchema>;
