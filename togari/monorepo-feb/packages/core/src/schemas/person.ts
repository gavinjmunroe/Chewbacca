import { z } from 'zod';

export const verticalSchema = z.enum([
  'healthcare',
  'mental_health',
  'wellness',
  'fitness',
  'digital_health',
  'medical_supply',
]);

export const routingTierSchema = z.enum([
  'high_touch',
  'standard',
  'nurture',
  'disqualify',
]);

export const sourceTypeSchema = z.enum([
  'amber_form',
  'csv_upload',
  'clay_push',
  'crm_sync',
  'website_visitor',
  'linkedin_engagement',
  'manual_entry',
]);

export const sourceChannelSchema = z.enum([
  'cold_outbound',
  'warm_referral',
  'event',
  'content',
  'website_visitor',
  'linkedin_engagement',
  'partnership',
]);

export const leadStatusSchema = z.enum([
  'new',
  'contacted',
  'engaged',
  'qualified',
  'opportunity',
  'customer',
  'churned',
  'disqualified',
]);

export const personaSchema = z.enum([
  'decision_maker',
  'influencer',
  'champion',
  'end_user',
  'gatekeeper',
]);

export const linkedInExperienceSchema = z.object({
  company: z.string(),
  title: z.string(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  current: z.boolean(),
  description: z.string().optional(),
});

export const companyDataSchema = z.object({
  name: z.string(),
  domain: z.string(),
  industry: z.string().optional(),
  employeeCount: z.number().optional(),
  foundedYear: z.number().optional(),
  description: z.string().optional(),
  location: z.string().optional(),
});

export const personSchema = z.object({
  personId: z.string(),
  linkedinUrl: z.string().url(),

  // Basic Info
  fullName: z.string(),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  workEmail: z.string().email().optional(),
  emailValid: z.boolean().optional(),
  phone: z.string().optional(),

  // Current Position
  currentTitle: z.string().optional(),
  currentCompany: z.string().optional(),
  companyDomain: z.string().optional(),
  linkedinHeadline: z.string().optional(),
  linkedinSummary: z.string().optional(),

  // Classification
  vertical: verticalSchema,
  persona: personaSchema.optional(),

  // Scoring
  internalScore: z.number().min(0).max(100),
  externalScore: z.number().min(0).max(100),
  compositeScore: z.number().min(0).max(100),
  routingTier: routingTierSchema,

  // Source
  sourceType: sourceTypeSchema,
  sourceChannel: sourceChannelSchema,
  sourceCampaign: z.string().optional(),
  submittedBy: z.string().optional(),

  // Status
  currentStatus: leadStatusSchema,
  lastContactedAt: z.date().optional(),
  totalTouches: z.number().default(0),

  // Enrichment
  linkedinExperience: z.array(linkedInExperienceSchema).optional(),
  companyData: companyDataSchema.optional(),
  techStack: z.array(z.string()).optional(),
  personalizationHook: z.string().optional(),
  enrichmentData: z.record(z.unknown()).optional(),

  // Multi-tenant
  organizationId: z.string(),

  // Metadata
  createdAt: z.date(),
  updatedAt: z.date(),
  createdBy: z.string().optional(),
});

export const createPersonSchema = z.object({
  linkedinUrl: z
    .string()
    .regex(
      /^https?:\/\/(www\.)?linkedin\.com\/in\/[a-zA-Z0-9_-]+\/?$/,
      'Invalid LinkedIn URL format'
    ),
  fullName: z.string().min(1, 'Full name is required'),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  workEmail: z.string().email().optional(),
  phone: z.string().optional(),

  currentTitle: z.string().optional(),
  currentCompany: z.string().optional(),
  companyDomain: z.string().optional(),

  vertical: verticalSchema,
  sourceType: sourceTypeSchema,
  sourceChannel: sourceChannelSchema,
  sourceCampaign: z.string().optional(),
  submittedBy: z.string().optional(),

  organizationId: z.string(),
  notes: z.string().optional(),
});

export const updatePersonSchema = createPersonSchema.partial().extend({
  personId: z.string(),
  currentStatus: leadStatusSchema.optional(),
  routingTier: routingTierSchema.optional(),
  internalScore: z.number().min(0).max(100).optional(),
  externalScore: z.number().min(0).max(100).optional(),
  compositeScore: z.number().min(0).max(100).optional(),
});

export const amberSubmissionSchema = z.object({
  linkedinUrl: z
    .string()
    .regex(
      /^https?:\/\/(www\.)?linkedin\.com\/in\/[a-zA-Z0-9_-]+\/?$/,
      'Invalid LinkedIn URL'
    ),
  submittedName: z.string().optional(),
  submittedCompany: z.string().optional(),
  submittedTitle: z.string().optional(),
  sourceChannel: sourceChannelSchema,
  sourceCampaign: z.string().optional(),
  notes: z.string().max(1000).optional(),
  submittedBy: z.string().email('Valid email required'),
  organizationId: z.string().min(1, 'Organization ID required'),
});

export type CreatePersonInput = z.infer<typeof createPersonSchema>;
export type UpdatePersonInput = z.infer<typeof updatePersonSchema>;
export type AmberSubmissionInput = z.infer<typeof amberSubmissionSchema>;
