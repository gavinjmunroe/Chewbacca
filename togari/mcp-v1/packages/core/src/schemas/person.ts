/**
 * @togari/core/schemas/person
 * Zod schemas for Person (Lead) entity
 */

import { z } from 'zod';

// ============================================================================
// ENUM SCHEMAS
// ============================================================================

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
  'manual_entry',
  'crm_sync',
  'website_visitor',
  'linkedin_import',
  'api_integration',
]);

export const sourceChannelSchema = z.enum([
  'warm_referral',
  'event',
  'cold_outbound',
  'inbound_marketing',
  'partner',
  'direct',
  'social_media',
  'paid_ads',
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

// ============================================================================
// HELPER SCHEMAS
// ============================================================================

/**
 * Validate LinkedIn URL format
 */
const linkedinUrlPattern = /^https?:\/\/(www\.)?linkedin\.com\/in\/[\w-]+\/?$/i;

const isValidLinkedInUrl = (url: string): boolean => {
  return linkedinUrlPattern.test(url);
};

/**
 * Normalize LinkedIn URL
 */
const normalizeLinkedInUrl = (url: string): string => {
  let normalized = url.trim().toLowerCase();

  // Ensure https
  if (normalized.startsWith('http://')) {
    normalized = normalized.replace('http://', 'https://');
  }
  if (!normalized.startsWith('https://')) {
    normalized = 'https://' + normalized;
  }

  // Remove trailing slash
  if (normalized.endsWith('/')) {
    normalized = normalized.slice(0, -1);
  }

  // Remove query parameters
  const queryIndex = normalized.indexOf('?');
  if (queryIndex !== -1) {
    normalized = normalized.slice(0, queryIndex);
  }

  return normalized;
};

export const linkedInExperienceSchema = z.object({
  title: z.string(),
  company: z.string(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  current: z.boolean().optional(),
  description: z.string().optional(),
});

export const companyDataSchema = z.object({
  name: z.string().optional(),
  domain: z.string().optional(),
  industry: z.string().optional(),
  employeeCount: z.number().optional(),
  revenueRange: z.string().optional(),
  fundingStage: z.string().optional(),
});

// ============================================================================
// PERSON SCHEMA
// ============================================================================

export const personSchema = z.object({
  personId: z.string(),
  linkedinUrl: z.string()
    .transform(normalizeLinkedInUrl)
    .refine(isValidLinkedInUrl, 'Invalid LinkedIn URL format'),
  fullName: z.string().min(1, 'Full name is required'),

  // Contact information
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  workEmail: z.string().email().optional(),
  emailValid: z.boolean().optional(),
  phone: z.string().optional(),

  // Professional information
  currentTitle: z.string().optional(),
  currentCompany: z.string().optional(),
  companyDomain: z.string().optional(),
  linkedinHeadline: z.string().optional(),
  linkedinSummary: z.string().optional(),

  // Classification
  vertical: verticalSchema,
  persona: personaSchema.optional(),

  // Scoring
  internalScore: z.number().min(0).max(100).default(0),
  externalScore: z.number().min(0).max(100).default(0),
  compositeScore: z.number().min(0).max(100).default(0),
  routingTier: routingTierSchema.default('nurture'),

  // Source tracking
  sourceType: sourceTypeSchema,
  sourceChannel: sourceChannelSchema,
  sourceCampaignId: z.string().optional(),
  sourceSubmitter: z.string().optional(),

  // Status management
  currentStatus: leadStatusSchema.default('new'),
  lastContactedAt: z.date().optional(),
  touchCount: z.number().default(0),

  // Enrichment data
  linkedinExperience: z.array(linkedInExperienceSchema).optional(),
  companyData: companyDataSchema.optional(),
  techStack: z.array(z.string()).optional(),
  enrichmentData: z.record(z.unknown()).optional(),
  personalizationHooks: z.array(z.string()).optional(),

  // Multi-tenant
  organizationId: z.string(),

  // Timestamps
  createdAt: z.date(),
  updatedAt: z.date(),
});

// ============================================================================
// INPUT SCHEMAS
// ============================================================================

export const createPersonSchema = z.object({
  linkedinUrl: z.string()
    .transform(normalizeLinkedInUrl)
    .refine(isValidLinkedInUrl, 'Invalid LinkedIn URL format'),
  fullName: z.string().min(1, 'Full name is required'),
  vertical: verticalSchema,
  sourceType: sourceTypeSchema,
  sourceChannel: sourceChannelSchema,
  organizationId: z.string(),

  // Optional fields
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  workEmail: z.string().email().optional(),
  phone: z.string().optional(),
  currentTitle: z.string().optional(),
  currentCompany: z.string().optional(),
  companyDomain: z.string().optional(),
  persona: personaSchema.optional(),
  sourceCampaignId: z.string().optional(),
  sourceSubmitter: z.string().optional(),
});

export const updatePersonSchema = createPersonSchema.partial().extend({
  currentStatus: leadStatusSchema.optional(),
  routingTier: routingTierSchema.optional(),
  internalScore: z.number().min(0).max(100).optional(),
  externalScore: z.number().min(0).max(100).optional(),
  compositeScore: z.number().min(0).max(100).optional(),
  linkedinHeadline: z.string().optional(),
  linkedinSummary: z.string().optional(),
  linkedinExperience: z.array(linkedInExperienceSchema).optional(),
  companyData: companyDataSchema.optional(),
  techStack: z.array(z.string()).optional(),
  enrichmentData: z.record(z.unknown()).optional(),
  personalizationHooks: z.array(z.string()).optional(),
  emailValid: z.boolean().optional(),
});

export const amberSubmissionSchema = z.object({
  linkedinUrl: z.string()
    .transform(normalizeLinkedInUrl)
    .refine(isValidLinkedInUrl, 'Invalid LinkedIn URL format'),
  fullName: z.string().optional(),
  currentTitle: z.string().optional(),
  currentCompany: z.string().optional(),
  notes: z.string().optional(),
  sourceChannel: sourceChannelSchema,
  submitterEmail: z.string().email(),
  organizationId: z.string(),
});

// ============================================================================
// TYPES
// ============================================================================

export type PersonInput = z.input<typeof personSchema>;
export type PersonOutput = z.output<typeof personSchema>;
export type CreatePersonInput = z.infer<typeof createPersonSchema>;
export type UpdatePersonInput = z.infer<typeof updatePersonSchema>;
export type AmberSubmission = z.infer<typeof amberSubmissionSchema>;
export type LinkedInExperience = z.infer<typeof linkedInExperienceSchema>;
export type CompanyDataEmbedded = z.infer<typeof companyDataSchema>;
