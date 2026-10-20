// ============================================
// ENUMS & CONSTANTS
// ============================================

export type Vertical =
  | 'healthcare'
  | 'mental_health'
  | 'wellness'
  | 'fitness'
  | 'digital_health'
  | 'medical_supply';

export type RoutingTier =
  | 'high_touch'
  | 'standard'
  | 'nurture'
  | 'disqualify';

export type SourceType =
  | 'amber_form'
  | 'csv_upload'
  | 'clay_push'
  | 'crm_sync'
  | 'website_visitor'
  | 'linkedin_engagement'
  | 'manual_entry';

export type SourceChannel =
  | 'cold_outbound'
  | 'warm_referral'
  | 'event'
  | 'content'
  | 'website_visitor'
  | 'linkedin_engagement'
  | 'partnership';

export type LeadStatus =
  | 'new'
  | 'contacted'
  | 'engaged'
  | 'qualified'
  | 'opportunity'
  | 'customer'
  | 'churned'
  | 'disqualified';

export type TouchpointType =
  | 'email_sent'
  | 'email_opened'
  | 'email_clicked'
  | 'email_replied'
  | 'linkedin_connect'
  | 'linkedin_message'
  | 'call'
  | 'meeting'
  | 'form_submission'
  | 'note';

export type Channel =
  | 'email'
  | 'linkedin'
  | 'phone'
  | 'in_person'
  | 'video'
  | 'website';

export type TouchpointOutcome =
  | 'delivered'
  | 'opened'
  | 'clicked'
  | 'replied'
  | 'bounced'
  | 'meeting_booked'
  | 'unsubscribed'
  | 'spam'
  | 'completed';

export type CampaignType =
  | 'outbound_email'
  | 'linkedin'
  | 'nurture'
  | 'event'
  | 'retargeting'
  | 'referral';

export type CampaignStatus =
  | 'draft'
  | 'active'
  | 'paused'
  | 'completed'
  | 'archived';

export type Persona =
  | 'decision_maker'
  | 'influencer'
  | 'champion'
  | 'end_user'
  | 'gatekeeper';

export type CompanyTier =
  | 'enterprise'
  | 'mid_market'
  | 'smb'
  | 'startup'
  | 'solo_practitioner';

export type RelationshipType =
  | 'referral_source'
  | 'strategic_partner'
  | 'vendor'
  | 'investor'
  | 'advisor'
  | 'colleague'
  | 'client';

// ============================================
// CORE ENTITIES
// ============================================

export interface Person {
  personId: string;
  linkedinUrl: string;

  // Basic Info
  fullName: string;
  firstName?: string;
  lastName?: string;
  workEmail?: string;
  emailValid?: boolean;
  phone?: string;

  // Current Position
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

  // Source
  sourceType: SourceType;
  sourceChannel: SourceChannel;
  sourceCampaign?: string;
  submittedBy?: string;

  // Status
  currentStatus: LeadStatus;
  lastContactedAt?: Date;
  totalTouches: number;

  // Enrichment
  linkedinExperience?: LinkedInExperience[];
  companyData?: CompanyData;
  techStack?: string[];
  personalizationHook?: string;
  enrichmentData?: Record<string, any>;

  // Multi-tenant
  organizationId: string;

  // Metadata
  createdAt: Date;
  updatedAt: Date;
  createdBy?: string;
}

export interface Company {
  companyId: string;
  domain: string;
  name: string;

  // Firmographics
  industry?: string;
  subIndustry?: string;
  employeeCount?: number;
  revenueRange?: string;
  fundingStage?: string;
  totalRaised?: number;

  // Location
  headquartersCity?: string;
  headquartersState?: string;
  headquartersCountry?: string;
  locationCount?: number;

  // Classification
  vertical: Vertical;
  companyTier: CompanyTier;

  // Health-specific
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

  // Metadata
  createdAt: Date;
  updatedAt: Date;
}

export interface Touchpoint {
  touchpointId: string;
  personId: string;
  companyId?: string;

  touchpointType: TouchpointType;
  channel: Channel;
  direction: 'outbound' | 'inbound';

  subject?: string;
  bodyPreview?: string;
  sentiment?: 'positive' | 'neutral' | 'negative';

  campaignId?: string;
  sequenceId?: string;
  sequenceStep?: number;

  outcome?: TouchpointOutcome;
  responseTimeHours?: number;

  // Multi-tenant
  organizationId: string;

  occurredAt: Date;
  createdAt: Date;
  createdBy?: string;
}

export interface Campaign {
  campaignId: string;

  // Campaign Info
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

  // Sequences
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

  // Metadata
  createdAt: Date;
  updatedAt: Date;
  createdBy?: string;
}

export interface Relationship {
  relationshipId: string;

  // Parties
  personAId: string;
  personBId?: string;
  companyId?: string;

  // Relationship Type
  relationshipType: RelationshipType;

  // Strength & Activity
  strengthScore: number; // 0-100
  lastInteractionAt?: Date;
  interactionCount: number;

  // Context
  contextNotes?: string;
  introducedBy?: string;

  // Multi-tenant
  organizationId: string;

  // Metadata
  createdAt: Date;
  updatedAt: Date;
}

// ============================================
// SUPPORTING TYPES
// ============================================

export interface LinkedInExperience {
  company: string;
  title: string;
  startDate?: string;
  endDate?: string;
  current: boolean;
  description?: string;
}

export interface CompanyData {
  name: string;
  domain: string;
  industry?: string;
  employeeCount?: number;
  foundedYear?: number;
  description?: string;
  location?: string;
}

// ============================================
// SCORING INTERFACES
// ============================================

export interface ScoringInput {
  person: Partial<Person>;
  company?: Partial<Company>;
  vertical: Vertical;
}

export interface InternalScore {
  channelScore: number;      // 0-25
  budgetScore: number;       // 0-25
  authorityScore: number;    // 0-25
  gtmMaturityScore: number;  // 0-25
  total: number;             // 0-100
}

export interface ExternalScore {
  [key: string]: number;
  total: number;
}

export interface CompositeScore {
  internal: InternalScore;
  external: ExternalScore;
  composite: number;
  routingTier: RoutingTier;
}

// ============================================
// AMBER INTERFACES
// ============================================

export interface AmberSubmission {
  linkedinUrl: string;
  submittedName?: string;
  submittedCompany?: string;
  submittedTitle?: string;
  sourceChannel: SourceChannel;
  sourceCampaign?: string;
  notes?: string;
  submittedBy: string;
  organizationId: string;
}

export interface AmberSubmissionResponse {
  success: boolean;
  personId?: string;
  message: string;
}

export interface AmberContact {
  personId: string;
  displayName: string;
  company?: string;
  title?: string;
  relationshipStrength: number;
  lastInteraction?: Date;
  nextAction?: {
    type: string;
    suggestedDate: Date;
    reason: string;
  };
}
