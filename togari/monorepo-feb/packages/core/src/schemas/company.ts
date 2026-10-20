import { z } from 'zod';
import { verticalSchema } from './person';

export const companyTierSchema = z.enum([
  'enterprise',
  'mid_market',
  'smb',
  'startup',
  'solo_practitioner',
]);

export const companySchema = z.object({
  companyId: z.string(),
  domain: z.string(),
  name: z.string(),

  // Firmographics
  industry: z.string().optional(),
  subIndustry: z.string().optional(),
  employeeCount: z.number().optional(),
  revenueRange: z.string().optional(),
  fundingStage: z.string().optional(),
  totalRaised: z.number().optional(),

  // Location
  headquartersCity: z.string().optional(),
  headquartersState: z.string().optional(),
  headquartersCountry: z.string().optional(),
  locationCount: z.number().optional(),

  // Classification
  vertical: verticalSchema,
  companyTier: companyTierSchema,

  // Health-specific
  practiceType: z.string().optional(),
  specialties: z.array(z.string()).optional(),
  patientVolume: z.string().optional(),
  ehrSystem: z.string().optional(),

  // Enrichment
  techStack: z.array(z.string()).optional(),
  description: z.string().optional(),
  linkedinUrl: z.string().url().optional(),
  websiteUrl: z.string().url().optional(),

  // Multi-tenant
  organizationId: z.string(),

  // Metadata
  createdAt: z.date(),
  updatedAt: z.date(),
});

export const createCompanySchema = z.object({
  domain: z.string().min(1, 'Domain is required'),
  name: z.string().min(1, 'Company name is required'),
  vertical: verticalSchema,
  organizationId: z.string(),

  industry: z.string().optional(),
  employeeCount: z.number().optional(),
  companyTier: companyTierSchema.optional(),
  websiteUrl: z.string().url().optional(),
});

export type CreateCompanyInput = z.infer<typeof createCompanySchema>;
