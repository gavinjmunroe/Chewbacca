/**
 * @togari/core/types
 * Healthcare-focused type definitions for lead management and engagement
 */

// ============================================================================
// ENUMS - Classification Systems
// ============================================================================

/**
 * Healthcare and wellness industry verticals
 */
export type Vertical =
  | 'healthcare'
  | 'mental_health'
  | 'wellness'
  | 'fitness'
  | 'digital_health'
  | 'medical_supply';

/**
 * Lead routing tiers based on composite scoring
 */
export type RoutingTier = 'high_touch' | 'standard' | 'nurture' | 'disqualify';

/**
 * Source types for how leads enter the system
 */
export type SourceType =
  | 'amber_form'
  | 'csv_upload'
  | 'manual_entry'
  | 'crm_sync'
  | 'website_visitor'
  | 'linkedin_import'
  | 'api_integration';

/**
 * Source channels for lead acquisition
 */
export type SourceChannel =
  | 'warm_referral'
  | 'event'
  | 'cold_outbound'
  | 'inbound_marketing'
  | 'partner'
  | 'direct'
  | 'social_media'
  | 'paid_ads';

/**
 * Lead status in the sales pipeline
 */
export type LeadStatus =
  | 'new'
  | 'contacted'
  | 'engaged'
  | 'qualified'
  | 'opportunity'
  | 'customer'
  | 'churned'
  | 'disqualified';

/**
 * Persona types for categorizing contacts
 */
export type Persona =
  | 'decision_maker'
  | 'influencer'
  | 'champion'
  | 'end_user'
  | 'gatekeeper';

/**
 * Company tiers based on size/type
 */
export type CompanyTier =
  | 'enterprise'
  | 'mid_market'
  | 'smb'
  | 'startup'
  | 'solo_practitioner';

/**
 * Campaign types
 */
export type CampaignType =
  | 'outbound_email'
  | 'linkedin'
  | 'nurture'
  | 'event'
  | 'retargeting'
  | 'referral';

/**
 * Campaign status
 */
export type CampaignStatus =
  | 'draft'
  | 'active'
  | 'paused'
  | 'completed'
  | 'archived';

/**
 * Touchpoint types
 */
export type TouchpointType =
  | 'email_sent'
  | 'email_opened'
  | 'email_clicked'
  | 'email_replied'
  | 'linkedin_connection'
  | 'linkedin_message'
  | 'linkedin_view'
  | 'call'
  | 'meeting'
  | 'demo'
  | 'note'
  | 'form_submission';

/**
 * Touchpoint sentiment
 */
export type TouchpointSentiment = 'positive' | 'neutral' | 'negative';

/**
 * Relationship types
 */
export type RelationshipType =
  | 'colleague'
  | 'manager'
  | 'direct_report'
  | 'peer'
  | 'external_contact'
  | 'referral';

// ============================================================================
// CORE ENTITIES
// ============================================================================

/**
 * Location information
 */
export interface Location {
  city?: string;
  state?: string;
  country?: string;
}

/**
 * LinkedIn experience entry
 */
export interface LinkedInExperience {
  title: string;
  company: string;
  startDate?: string;
  endDate?: string;
  current?: boolean;
  description?: string;
}

/**
 * Company data embedded in person records
 */
export interface CompanyData {
  name?: string;
  domain?: string;
  industry?: string;
  employeeCount?: number;
  revenueRange?: string;
  fundingStage?: string;
}

/**
 * Lead scoring configuration
 */
export interface LeadScoring {
  internalScore: number; // 0-100 based on internal factors
  externalScore: number; // 0-100 based on external signals
  compositeScore: number; // 0-100 weighted combination
  routingTier: RoutingTier;
}

/**
 * Person (Lead) entity - the primary contact record
 */
export interface Person {
  personId: string;
  linkedinUrl: string; // Required, validated
  fullName: string; // Required

  // Contact information
  firstName?: string;
  lastName?: string;
  workEmail?: string;
  emailValid?: boolean;
  phone?: string;

  // Professional information
  currentTitle?: string;
  currentCompany?: string;
  companyDomain?: string;
  linkedinHeadline?: string;
  linkedinSummary?: string;

  // Classification
  vertical: Vertical;
  persona?: Persona;

  // Scoring
  internalScore: number;
  externalScore: number;
  compositeScore: number;
  routingTier: RoutingTier;

  // Source tracking
  sourceType: SourceType;
  sourceChannel: SourceChannel;
  sourceCampaignId?: string;
  sourceSubmitter?: string;

  // Status management
  currentStatus: LeadStatus;
  lastContactedAt?: Date;
  touchCount: number;

  // Enrichment data
  linkedinExperience?: LinkedInExperience[];
  companyData?: CompanyData;
  techStack?: string[];
  enrichmentData?: Record<string, unknown>;
  personalizationHooks?: string[];

  // Multi-tenant
  organizationId: string;

  // Timestamps
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Company entity
 */
export interface Company {
  companyId: string;
  domain: string; // Required
  name: string; // Required

  // Firmographics
  industry?: string;
  subIndustry?: string;
  employeeCount?: number;
  revenueRange?: string;
  fundingStage?: string;
  totalRaised?: string;

  // Location
  headquartersCity?: string;
  headquartersState?: string;
  headquartersCountry?: string;
  locationCount?: number;

  // Classification
  vertical: Vertical;
  companyTier?: CompanyTier;

  // Healthcare-specific
  practiceType?: string;
  specialties?: string[];
  patientVolume?: string;
  ehrSystem?: string;

  // Enrichment
  techStack?: string[];
  description?: string;
  linkedinUrl?: string;
  websiteUrl?: string;

  // Multi-tenant
  organizationId: string;

  // Timestamps
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Campaign entity
 */
export interface Campaign {
  campaignId: string;
  name: string;
  description?: string;
  campaignType: CampaignType;

  // Targeting
  vertical: Vertical;
  targetPersonas?: Persona[];
  routingTiers?: RoutingTier[];

  // Content
  messagingTheme?: string;
  valueProposition?: string;
  emailSequenceId?: string;
  linkedinSequenceId?: string;

  // Status
  status: CampaignStatus;
  startDate?: Date;
  endDate?: Date;

  // Metrics
  totalLeads: number;
  emailsSent: number;
  emailsOpened: number;
  emailsReplied: number;
  meetingsBooked: number;

  // Multi-tenant
  organizationId: string;
  createdBy?: string;

  // Timestamps
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Touchpoint entity - interaction records
 */
export interface Touchpoint {
  touchpointId: string;
  personId: string;
  campaignId?: string;

  // Interaction details
  touchpointType: TouchpointType;
  channel: string;
  direction: 'inbound' | 'outbound';

  // Content
  subject?: string;
  body?: string;
  notes?: string;

  // Outcome
  outcome?: string;
  sentiment?: TouchpointSentiment;
  responseReceived?: boolean;
  responseTime?: number; // minutes

  // Context
  meetingScheduled?: boolean;
  meetingDate?: Date;
  nextSteps?: string;

  // Multi-tenant
  organizationId: string;
  performedBy?: string;

  // Timestamps
  occurredAt: Date;
  createdAt: Date;
}

/**
 * Relationship entity - connections between people
 */
export interface Relationship {
  relationshipId: string;
  personAId: string;
  personBId: string;

  // Connection details
  relationshipType: RelationshipType;
  strength: number; // 0-100
  context?: string;

  // Tracking
  interactionCount: number;
  lastInteractionAt?: Date;

  // Multi-tenant
  organizationId: string;

  // Timestamps
  createdAt: Date;
  updatedAt: Date;
}

// ============================================================================
// INPUT TYPES (for API requests)
// ============================================================================

/**
 * Create person input
 */
export interface CreatePersonInput {
  linkedinUrl: string;
  fullName: string;
  vertical: Vertical;
  sourceType: SourceType;
  sourceChannel: SourceChannel;
  organizationId: string;

  firstName?: string;
  lastName?: string;
  workEmail?: string;
  phone?: string;
  currentTitle?: string;
  currentCompany?: string;
  companyDomain?: string;
  persona?: Persona;
  sourceCampaignId?: string;
  sourceSubmitter?: string;
}

/**
 * Update person input
 */
export interface UpdatePersonInput extends Partial<CreatePersonInput> {
  currentStatus?: LeadStatus;
  routingTier?: RoutingTier;
  internalScore?: number;
  externalScore?: number;
  compositeScore?: number;
  linkedinHeadline?: string;
  linkedinSummary?: string;
  linkedinExperience?: LinkedInExperience[];
  companyData?: CompanyData;
  techStack?: string[];
  enrichmentData?: Record<string, unknown>;
  personalizationHooks?: string[];
  lastContactedAt?: Date;
}

/**
 * Create company input
 */
export interface CreateCompanyInput {
  domain: string;
  name: string;
  vertical: Vertical;
  organizationId: string;

  industry?: string;
  employeeCount?: number;
  companyTier?: CompanyTier;
  websiteUrl?: string;
}

/**
 * Create campaign input
 */
export interface CreateCampaignInput {
  name: string;
  campaignType: CampaignType;
  vertical: Vertical;
  organizationId: string;

  description?: string;
  targetPersonas?: Persona[];
  routingTiers?: RoutingTier[];
  messagingTheme?: string;
  valueProposition?: string;
}

/**
 * Create touchpoint input
 */
export interface CreateTouchpointInput {
  personId: string;
  touchpointType: TouchpointType;
  channel: string;
  direction: 'inbound' | 'outbound';
  organizationId: string;

  campaignId?: string;
  subject?: string;
  body?: string;
  notes?: string;
  outcome?: string;
  sentiment?: TouchpointSentiment;
  performedBy?: string;
  occurredAt?: Date;
}

/**
 * Create relationship input
 */
export interface CreateRelationshipInput {
  personAId: string;
  personBId: string;
  relationshipType: RelationshipType;
  organizationId: string;

  strength?: number;
  context?: string;
}

// ============================================================================
// AMBER INTEGRATION
// ============================================================================

/**
 * Amber form submission
 */
export interface AmberSubmission {
  linkedinUrl: string;
  fullName?: string;
  currentTitle?: string;
  currentCompany?: string;
  notes?: string;
  sourceChannel: SourceChannel;
  submitterEmail: string;
  organizationId: string;
}

// ============================================================================
// ENRICHMENT TYPES
// ============================================================================

/**
 * Enrichment source
 */
export type EnrichmentSource = 'exa' | 'clay' | 'structify' | 'manual';

/**
 * Enrichment result
 */
export interface EnrichmentResult {
  source: EnrichmentSource;
  timestamp: Date;
  data: Record<string, unknown>;
  confidence?: number;
}

/**
 * Clay enrichment data structure
 */
export interface ClayEnrichmentData {
  linkedinData?: {
    headline?: string;
    summary?: string;
    experience?: LinkedInExperience[];
    skills?: string[];
    connections?: number;
  };
  companyData?: {
    name?: string;
    domain?: string;
    industry?: string;
    employeeCount?: number;
    description?: string;
    technologies?: string[];
  };
  emailVerification?: {
    valid: boolean;
    deliverable?: boolean;
    disposable?: boolean;
  };
}

// ============================================================================
// SCORING TYPES
// ============================================================================

/**
 * Scoring update payload
 */
export interface ScoringUpdate {
  personId: string;
  internalScore: number;
  externalScore: number;
  compositeScore: number;
  routingTier: RoutingTier;
  organizationId: string;
}

/**
 * Internal scoring factors
 */
export interface InternalScoringFactors {
  channelScore: number; // 0-25 based on source channel
  budgetScore: number; // 0-25 based on company size
  authorityScore: number; // 0-25 based on title
  gtmMaturityScore: number; // 0-25 based on tech stack
}

/**
 * External scoring factors
 */
export interface ExternalScoringFactors {
  verticalFit: number; // 0-50
  engagementSignals: number; // 0-30
  timingIndicators: number; // 0-20
}
