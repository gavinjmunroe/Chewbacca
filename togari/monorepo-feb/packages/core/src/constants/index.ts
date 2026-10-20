import type { Vertical, SourceChannel, RoutingTier } from '../types';

/**
 * Scoring weights for different source channels
 */
export const CHANNEL_SCORES: Record<SourceChannel, number> = {
  warm_referral: 25,
  event: 22,
  website_visitor: 20,
  linkedin_engagement: 18,
  content: 15,
  partnership: 20,
  cold_outbound: 10,
};

/**
 * Budget score thresholds based on employee count
 */
export const BUDGET_SCORE_THRESHOLDS = [
  { minEmployees: 200, score: 25 },
  { minEmployees: 51, score: 20 },
  { minEmployees: 11, score: 15 },
  { minEmployees: 1, score: 10 },
  { minEmployees: 0, score: 5 },
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
 * Decision maker title keywords
 */
export const DECISION_MAKER_TITLES = [
  'ceo',
  'chief',
  'founder',
  'owner',
  'president',
  'director',
  'vp',
  'vice president',
  'head of',
  'partner',
  'principal',
];

/**
 * Influencer title keywords
 */
export const INFLUENCER_TITLES = [
  'manager',
  'lead',
  'senior',
  'principal',
  'architect',
  'strategist',
];

/**
 * Vertical-specific keywords for external scoring
 */
export const VERTICAL_KEYWORDS: Record<Vertical, string[]> = {
  healthcare: [
    'patient',
    'clinical',
    'medical',
    'healthcare',
    'health system',
    'hospital',
    'physician',
    'doctor',
    'nurse',
  ],
  mental_health: [
    'therapy',
    'counseling',
    'psychiatry',
    'psychologist',
    'mental health',
    'behavioral health',
    'wellness',
  ],
  wellness: [
    'wellness',
    'holistic',
    'integrative',
    'alternative',
    'naturopathic',
    'functional medicine',
    'nutrition',
  ],
  fitness: [
    'fitness',
    'gym',
    'training',
    'exercise',
    'personal trainer',
    'yoga',
    'pilates',
    'crossfit',
  ],
  digital_health: [
    'telehealth',
    'digital health',
    'healthtech',
    'telemedicine',
    'virtual care',
    'health app',
    'wearable',
  ],
  medical_supply: [
    'medical device',
    'medical supply',
    'healthcare equipment',
    'medical equipment',
    'surgical',
    'medical distributor',
  ],
};

/**
 * Practice types for healthcare vertical
 */
export const PRACTICE_TYPES = [
  'Solo Practice',
  'Group Practice',
  'Hospital',
  'Clinic',
  'Outpatient Center',
  'Surgery Center',
  'Urgent Care',
  'Specialty Practice',
  'Integrated Health System',
] as const;

/**
 * Common EHR systems
 */
export const EHR_SYSTEMS = [
  'Epic',
  'Cerner',
  'Meditech',
  'Allscripts',
  'athenahealth',
  'eClinicalWorks',
  'NextGen',
  'Practice Fusion',
  'Other',
  'None',
] as const;

/**
 * Patient volume ranges
 */
export const PATIENT_VOLUME_RANGES = [
  '1-50 patients/week',
  '51-100 patients/week',
  '101-250 patients/week',
  '251-500 patients/week',
  '500+ patients/week',
] as const;

/**
 * Internal score weights
 */
export const INTERNAL_SCORE_WEIGHTS = {
  channel: 0.25,
  budget: 0.25,
  authority: 0.25,
  gtmMaturity: 0.25,
} as const;

/**
 * Composite score weights
 */
export const COMPOSITE_SCORE_WEIGHTS = {
  internal: 0.5,
  external: 0.5,
} as const;
