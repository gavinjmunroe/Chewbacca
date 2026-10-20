/**
 * @togari/core/connectors/clay/types
 * Type definitions for Clay API integration
 */

/**
 * Clay client configuration
 */
export interface ClayConfig {
  apiKey: string;
  baseUrl?: string;
  tableId?: string; // Default table for people intake
}

/**
 * Clay enrichment request
 */
export interface ClayEnrichmentRequest {
  linkedinUrl?: string;
  email?: string;
  fullName?: string;
  companyDomain?: string;
  companyName?: string;
}

/**
 * LinkedIn data from Clay enrichment
 */
export interface ClayLinkedInData {
  headline?: string;
  summary?: string;
  experience?: Array<{
    title: string;
    company: string;
    startDate?: string;
    endDate?: string;
    current?: boolean;
    description?: string;
  }>;
  skills?: string[];
  connections?: number;
  profilePictureUrl?: string;
  location?: string;
}

/**
 * Company data from Clay enrichment
 */
export interface ClayCompanyData {
  name?: string;
  domain?: string;
  industry?: string;
  employeeCount?: number;
  employeeRange?: string;
  description?: string;
  technologies?: string[];
  fundingStage?: string;
  totalRaised?: string;
  linkedinUrl?: string;
  websiteUrl?: string;
  headquartersCity?: string;
  headquartersState?: string;
  headquartersCountry?: string;
}

/**
 * Email verification data
 */
export interface ClayEmailVerification {
  valid: boolean;
  deliverable?: boolean;
  disposable?: boolean;
  catchAll?: boolean;
  reason?: string;
}

/**
 * Complete Clay enrichment data response
 */
export interface ClayEnrichmentData {
  linkedinData?: ClayLinkedInData;
  companyData?: ClayCompanyData;
  emailVerification?: ClayEmailVerification;
  enrichedAt?: string;
  source?: string;
}

/**
 * Clay API response wrapper
 */
export interface ClayApiResponse<T> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
  };
}

/**
 * Clay webhook payload for enrichment callbacks
 */
export interface ClayWebhookPayload {
  personId: string;
  organizationId: string;
  enrichmentData: ClayEnrichmentData;
  status: 'completed' | 'failed' | 'partial';
  timestamp: string;
}

/**
 * Clay table row for push operations
 */
export interface ClayTableRow {
  id?: string;
  linkedinUrl?: string;
  email?: string;
  fullName?: string;
  companyDomain?: string;
  [key: string]: unknown;
}

/**
 * Clay batch operation result
 */
export interface ClayBatchResult {
  total: number;
  successful: number;
  failed: number;
  errors: Array<{
    rowId: string;
    error: string;
  }>;
}
