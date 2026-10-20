/**
 * @togari/core/constants
 * Business constants for lead scoring, routing, and healthcare-specific configurations
 */

import type { SourceChannel, RoutingTier, Vertical } from '../types';

// ============================================================================
// SCORING CONSTANTS
// ============================================================================

/**
 * Channel scores - points assigned based on lead source channel
 */
export const CHANNEL_SCORES: Record<SourceChannel, number> = {
  warm_referral: 25,
  event: 20,
  partner: 18,
  inbound_marketing: 15,
  direct: 12,
  social_media: 12,
  paid_ads: 10,
  cold_outbound: 10,
};

/**
 * Budget score thresholds based on employee count
 */
export const BUDGET_SCORE_THRESHOLDS = [
  { minEmployees: 0, maxEmployees: 10, score: 5 },
  { minEmployees: 11, maxEmployees: 50, score: 10 },
  { minEmployees: 51, maxEmployees: 200, score: 15 },
  { minEmployees: 201, maxEmployees: 500, score: 20 },
  { minEmployees: 501, maxEmployees: Infinity, score: 25 },
] as const;

/**
 * Routing tier thresholds based on composite score
 */
export const ROUTING_TIER_THRESHOLDS: Record<RoutingTier, { min: number; max: number }> = {
  high_touch: { min: 80, max: 100 },
  standard: { min: 60, max: 79 },
  nurture: { min: 40, max: 59 },
  disqualify: { min: 0, max: 39 },
};

/**
 * Composite score weights
 */
export const COMPOSITE_SCORE_WEIGHTS = {
  internalWeight: 0.5,
  externalWeight: 0.5,
} as const;

// ============================================================================
// ROLE CLASSIFICATION
// ============================================================================

/**
 * Decision maker title keywords (high authority score)
 */
export const DECISION_MAKER_TITLES = [
  'ceo',
  'chief executive',
  'founder',
  'co-founder',
  'president',
  'owner',
  'partner',
  'managing director',
  'vp',
  'vice president',
  'director',
  'head of',
  'chief',
  'cto',
  'cfo',
  'cmo',
  'coo',
  'cio',
  'cpo',
] as const;

/**
 * Influencer title keywords (medium authority score)
 */
export const INFLUENCER_TITLES = [
  'manager',
  'senior',
  'lead',
  'principal',
  'architect',
  'specialist',
  'analyst',
  'consultant',
  'advisor',
  'strategist',
] as const;

/**
 * Authority scores based on role
 */
export const AUTHORITY_SCORES = {
  decision_maker: 25,
  influencer: 15,
  champion: 12,
  end_user: 8,
  gatekeeper: 5,
  unknown: 10,
} as const;

// ============================================================================
// VERTICAL-SPECIFIC KEYWORDS
// ============================================================================

/**
 * Keywords to identify vertical from company/title
 */
export const VERTICAL_KEYWORDS: Record<Vertical, string[]> = {
  healthcare: [
    'hospital',
    'clinic',
    'medical center',
    'health system',
    'physician',
    'doctor',
    'healthcare',
    'health care',
    'medical',
    'clinical',
    'patient',
    'nursing',
    'surgical',
    'cardiology',
    'oncology',
    'pediatric',
    'orthopedic',
    'dermatology',
    'radiology',
  ],
  mental_health: [
    'therapy',
    'therapist',
    'counseling',
    'counselor',
    'psychologist',
    'psychiatrist',
    'mental health',
    'behavioral health',
    'psychology',
    'psychiatric',
    'addiction',
    'recovery',
    'mindfulness',
  ],
  wellness: [
    'wellness',
    'spa',
    'massage',
    'acupuncture',
    'chiropractic',
    'holistic',
    'integrative',
    'naturopath',
    'nutrition',
    'dietitian',
    'weight management',
    'preventive',
  ],
  fitness: [
    'fitness',
    'gym',
    'personal trainer',
    'crossfit',
    'yoga',
    'pilates',
    'athletic',
    'sports medicine',
    'physical therapy',
    'rehabilitation',
    'strength',
    'conditioning',
  ],
  digital_health: [
    'telehealth',
    'telemedicine',
    'digital health',
    'health tech',
    'healthtech',
    'medtech',
    'ehr',
    'emr',
    'health app',
    'remote monitoring',
    'wearable',
    'ai health',
    'health ai',
  ],
  medical_supply: [
    'medical device',
    'medical equipment',
    'medical supply',
    'pharmaceutical',
    'pharma',
    'biotech',
    'life science',
    'diagnostics',
    'laboratory',
    'imaging',
    'prosthetics',
    'implant',
  ],
};

// ============================================================================
// HEALTHCARE-SPECIFIC CONSTANTS
// ============================================================================

/**
 * Practice types for healthcare organizations
 */
export const PRACTICE_TYPES = [
  'solo_practice',
  'group_practice',
  'hospital_employed',
  'academic_medical_center',
  'community_health_center',
  'urgent_care',
  'specialty_clinic',
  'integrated_health_system',
] as const;

export type PracticeType = (typeof PRACTICE_TYPES)[number];

/**
 * Common EHR systems in healthcare
 */
export const EHR_SYSTEMS = [
  'Epic',
  'Cerner',
  'Meditech',
  'Allscripts',
  'athenahealth',
  'eClinicalWorks',
  'NextGen',
  'Greenway',
  'DrChrono',
  'Practice Fusion',
  'Kareo',
  'AdvancedMD',
  'ModMed',
  'Other',
] as const;

export type EHRSystem = (typeof EHR_SYSTEMS)[number];

/**
 * Patient volume ranges
 */
export const PATIENT_VOLUME_RANGES = [
  'under_500',
  '500_1000',
  '1000_2500',
  '2500_5000',
  '5000_10000',
  'over_10000',
] as const;

export type PatientVolumeRange = (typeof PATIENT_VOLUME_RANGES)[number];

/**
 * Medical specialties
 */
export const MEDICAL_SPECIALTIES = [
  'primary_care',
  'family_medicine',
  'internal_medicine',
  'pediatrics',
  'cardiology',
  'dermatology',
  'endocrinology',
  'gastroenterology',
  'neurology',
  'obstetrics_gynecology',
  'oncology',
  'ophthalmology',
  'orthopedics',
  'psychiatry',
  'pulmonology',
  'radiology',
  'rheumatology',
  'surgery',
  'urology',
  'other',
] as const;

export type MedicalSpecialty = (typeof MEDICAL_SPECIALTIES)[number];

// ============================================================================
// GTM MATURITY INDICATORS
// ============================================================================

/**
 * Tech stack indicators for GTM maturity scoring
 */
export const GTM_MATURITY_INDICATORS = {
  highMaturity: [
    'salesforce',
    'hubspot',
    'marketo',
    'pardot',
    'outreach',
    'salesloft',
    'gong',
    'chorus',
    'clari',
    'seismic',
  ],
  mediumMaturity: [
    'pipedrive',
    'zoho',
    'mailchimp',
    'constant contact',
    'activecampaign',
    'intercom',
    'drift',
    'calendly',
  ],
  lowMaturity: ['spreadsheet', 'excel', 'google sheets', 'email only', 'manual'],
} as const;

/**
 * GTM maturity scores
 */
export const GTM_MATURITY_SCORES = {
  high: 25,
  medium: 15,
  low: 5,
  unknown: 10,
} as const;

// ============================================================================
// API RATE LIMITS
// ============================================================================

/**
 * Rate limit configurations for external APIs
 */
export const API_RATE_LIMITS = {
  exa: {
    requestsPerMinute: 100,
    delayBetweenRequestsMs: 200,
  },
  clay: {
    requestsPerMinute: 60,
    delayBetweenRequestsMs: 1000,
  },
  structify: {
    requestsPerMinute: 100,
    delayBetweenRequestsMs: 100,
  },
} as const;

// ============================================================================
// DEFAULT VALUES
// ============================================================================

/**
 * Default values for new entities
 */
export const DEFAULTS = {
  person: {
    internalScore: 0,
    externalScore: 0,
    compositeScore: 0,
    routingTier: 'nurture' as RoutingTier,
    currentStatus: 'new' as const,
    touchCount: 0,
  },
  company: {
    vertical: 'healthcare' as Vertical,
  },
  campaign: {
    status: 'draft' as const,
    totalLeads: 0,
    emailsSent: 0,
    emailsOpened: 0,
    emailsReplied: 0,
    meetingsBooked: 0,
  },
  relationship: {
    strength: 50,
    interactionCount: 0,
  },
} as const;
