import { z } from 'zod';

/**
 * Location schema for geographic information
 */
const LocationSchema = z.object({
  city: z.string().optional(),
  state: z.string().optional(),
  country: z.string().optional(),
}).optional();

/**
 * Helper to strip protocol and www from domain
 */
const normalizeDomain = (domain: string): string => {
  return domain
    .replace(/^https?:\/\//, '') // Remove protocol
    .replace(/^www\./, '') // Remove www
    .toLowerCase()
    .trim();
};

/**
 * Helper to validate LinkedIn URL format
 */
const isLinkedInUrl = (url: string): boolean => {
  return /^https?:\/\/(www\.)?linkedin\.com\/(company|in)\/[\w-]+\/?$/i.test(url);
};

/**
 * Helper to strip @ from Twitter handle
 */
const normalizeTwitterHandle = (handle: string): string => {
  return handle.replace(/^@/, '').trim();
};

/**
 * Company schema with full validation
 */
export const CompanySchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(1, 'Company name is required'),
  domain: z.string()
    .transform(normalizeDomain)
    .optional(),
  industry: z.string().optional(),
  employeeCount: z.number().positive().optional(),
  employeeRange: z.enum(['1-10', '11-50', '51-200', '201-500', '501-1000', '1000+']).optional(),
  location: LocationSchema,
  description: z.string().max(2000, 'Description cannot exceed 2000 characters').optional(),
  linkedinUrl: z.string()
    .refine(
      (url: string) => !url || isLinkedInUrl(url),
      'Invalid LinkedIn URL format'
    )
    .optional(),
  twitterHandle: z.string()
    .transform(normalizeTwitterHandle)
    .optional(),
  fundingStage: z.string().optional(),
  foundedYear: z.number()
    .int()
    .min(1800, 'Founded year must be 1800 or later')
    .max(2030, 'Founded year must be 2030 or earlier')
    .optional(),
  technologies: z.array(z.string()).optional(),
  website: z.string().url('Invalid website URL').optional(),
});

/**
 * Contact schema with full validation
 */
export const ContactSchema = z.object({
  id: z.string().uuid().optional(),
  fullName: z.string().min(1, 'Full name is required'),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  email: z.string()
    .email('Invalid email format')
    .transform((email: string) => email.toLowerCase())
    .optional(),
  phone: z.string().optional(),
  title: z.string().optional(),
  companyName: z.string().optional(),
  companyDomain: z.string()
    .transform(normalizeDomain)
    .optional(),
  linkedinUrl: z.string()
    .refine(
      (url: string) => !url || isLinkedInUrl(url),
      'Invalid LinkedIn URL format'
    )
    .optional(),
  location: LocationSchema,
});

/**
 * Lead schema as discriminated union
 */
export const LeadSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('company'),
    data: CompanySchema,
  }),
  z.object({
    type: z.literal('contact'),
    data: ContactSchema,
  }),
]);

/**
 * Enrichment entry schema
 */
const EnrichmentSchema = z.object({
  source: z.string(),
  timestamp: z.date(),
  data: z.unknown(),
});

/**
 * Stored lead schema with metadata
 */
export const StoredLeadSchema = z.intersection(
  LeadSchema,
  z.object({
    hash: z.string(),
    userId: z.string(),
    source: z.string(),
    client_id: z.string().min(1).describe('Auth0 Organization ID for tenant isolation'),
    enrichments: z.array(EnrichmentSchema).default([]),
    createdAt: z.date(),
    updatedAt: z.date(),
    tags: z.array(z.string()).default([]),
  })
);

// Export TypeScript types
export type Company = z.infer<typeof CompanySchema>;
export type Contact = z.infer<typeof ContactSchema>;
export type Lead = z.infer<typeof LeadSchema>;
export type StoredLead = z.infer<typeof StoredLeadSchema>;
export type Enrichment = z.infer<typeof EnrichmentSchema>;
export type Location = z.infer<typeof LocationSchema>;
