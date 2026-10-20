/**
 * @togari/core/schemas/company
 * Zod schemas for Company entity
 */

import { z } from 'zod';
import { verticalSchema } from './person';

// ============================================================================
// ENUM SCHEMAS
// ============================================================================

export const companyTierSchema = z.enum([
  'enterprise',
  'mid_market',
  'smb',
  'startup',
  'solo_practitioner',
]);

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Normalize domain by removing protocol and www
 */
const normalizeDomain = (domain: string): string => {
  return domain
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .toLowerCase()
    .trim()
    .split('/')[0]; // Remove any path
};

// ============================================================================
// COMPANY SCHEMA
// ============================================================================

export const companySchema = z.object({
  companyId: z.string(),
  domain: z.string().transform(normalizeDomain),
  name: z.string().min(1, 'Company name is required'),

  // Firmographics
  industry: z.string().optional(),
  subIndustry: z.string().optional(),
  employeeCount: z.number().positive().optional(),
  revenueRange: z.string().optional(),
  fundingStage: z.string().optional(),
  totalRaised: z.string().optional(),

  // Location
  headquartersCity: z.string().optional(),
  headquartersState: z.string().optional(),
  headquartersCountry: z.string().optional(),
  locationCount: z.number().optional(),

  // Classification
  vertical: verticalSchema,
  companyTier: companyTierSchema.optional(),

  // Healthcare-specific
  practiceType: z.string().optional(),
  specialties: z.array(z.string()).optional(),
  patientVolume: z.string().optional(),
  ehrSystem: z.string().optional(),

  // Enrichment
  techStack: z.array(z.string()).optional(),
  description: z.string().max(2000).optional(),
  linkedinUrl: z.string().url().optional(),
  websiteUrl: z.string().url().optional(),

  // Multi-tenant
  organizationId: z.string(),

  // Timestamps
  createdAt: z.date(),
  updatedAt: z.date(),
});

// ============================================================================
// INPUT SCHEMAS
// ============================================================================

export const createCompanySchema = z.object({
  domain: z.string().transform(normalizeDomain),
  name: z.string().min(1, 'Company name is required'),
  vertical: verticalSchema,
  organizationId: z.string(),

  // Optional fields
  industry: z.string().optional(),
  subIndustry: z.string().optional(),
  employeeCount: z.number().positive().optional(),
  companyTier: companyTierSchema.optional(),
  websiteUrl: z.string().url().optional(),
  headquartersCity: z.string().optional(),
  headquartersState: z.string().optional(),
  headquartersCountry: z.string().optional(),
});

export const updateCompanySchema = createCompanySchema.partial().extend({
  revenueRange: z.string().optional(),
  fundingStage: z.string().optional(),
  totalRaised: z.string().optional(),
  locationCount: z.number().optional(),
  practiceType: z.string().optional(),
  specialties: z.array(z.string()).optional(),
  patientVolume: z.string().optional(),
  ehrSystem: z.string().optional(),
  techStack: z.array(z.string()).optional(),
  description: z.string().max(2000).optional(),
  linkedinUrl: z.string().url().optional(),
});

// ============================================================================
// TYPES
// ============================================================================

export type CompanyInput = z.input<typeof companySchema>;
export type CompanyOutput = z.output<typeof companySchema>;
export type CreateCompanyInput = z.infer<typeof createCompanySchema>;
export type UpdateCompanyInput = z.infer<typeof updateCompanySchema>;
