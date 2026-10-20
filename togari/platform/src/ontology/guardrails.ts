/**
 * @togari/admin — Guardrails ontology
 *
 * Non-negotiable guardrails from CLAUDE_OS.md.
 * These are the spiritual architecture and ethical floor.
 */

// ============================================================================
// THE SIX DIMENSIONS OF HEALTH
// Every major system decision must be evaluated against all six.
// ============================================================================

export const SIX_DIMENSIONS_OF_HEALTH = [
  'physical',
  'mental',
  'emotional',
  'social',
  'spiritual',
  'financial',
] as const;

export type HealthDimension = typeof SIX_DIMENSIONS_OF_HEALTH[number];

// ============================================================================
// THE SHARED ETHICAL FLOOR (applies everywhere, always)
// ============================================================================

export const ETHICAL_FLOOR = {
  noHatred: 'No hatred in any output.',
  noExploitation: 'No exploitation of any person, community, or system.',
  noFearBasedCopy: 'No fear-based copy. No urgency that is not real. No countdown timers.',
  noHumanAsMetric: 'No content that reduces any human to a conversion metric.',
  animalsAndPlantsAreStakeholders: 'Animals and plants are first-class stakeholders in our optimization.',
  financialEnables: 'Financial health enables the other five dimensions but never overrides them.',
} as const;

// ============================================================================
// THE FIVE QUESTIONS TO ASK BEFORE EXECUTING ANY TASK
// From GLM_SYSTEM_PROMPT.md
// ============================================================================

export const FIVE_QUESTIONS = [
  'Which level of communication is this? (One-to-one / One-to-many / Many-to-many)',
  'Which channel and which theology frame applies?',
  'Which buyer persona is this for?',
  'What is the specific signal or story that makes this relevant right now, not any other time?',
  'Does this output serve the human on the other end, or does it extract from them?',
] as const;

// ============================================================================
// COMMUNICATION LEVELS
// ============================================================================

export const COMMUNICATION_LEVELS = {
  oneToOne: {
    name: 'One-to-One',
    description: 'Speaking directly to one human. Cold email, direct reply, meeting follow-up. Must feel like one human wrote it specifically for one other human.',
    examples: ['cold_email', 'reply_draft', 'meeting_follow_up'],
  },
  oneToMany: {
    name: 'One-to-Many',
    description: 'Speaking to an audience. LinkedIn posts, carousels, video scripts. One voice, many listeners. Goal is resonance with the right people, not reach for its own sake.',
    examples: ['linkedin_post', 'carousel', 'video_script', 'essay'],
  },
  manyToMany: {
    name: 'Many-to-Many',
    description: 'Multiple voices, multiple listeners, all in conversation at once — operating as a symphony. Multiple team members holding one relationship as a coordinated unit.',
    examples: ['relationship_coordination', 'multi_member_meeting', 'team_handoff'],
  },
} as const;

// ============================================================================
// SEND VOLUME RULES (hard limits from TOGARI_OUTBOUND.md)
// ============================================================================

export const VOLUME_RULES = {
  maxColdEmailsPerInboxPerDay: 40,
  maxColdEmailsPerDomainPerDay: 200,
  sendDays: ['tuesday', 'wednesday', 'thursday'] as const,
  sendWindowStartHour: 8,  // recipient timezone
  sendWindowEndHour: 11,   // recipient timezone
  neverSendDays: ['friday', 'saturday', 'sunday', 'monday'] as const,
  minimumWarmupWeeks: 4,
  warmupSchedule: { week1: 5, week2: 10, week3: 20, week4: 40 },
} as const;

// ============================================================================
// COMPLIANCE REQUIREMENTS
// ============================================================================

export const COMPLIANCE = {
  canSpam: 'Every email includes plain-text unsubscribe option and physical address in footer.',
  hipaa: 'We are NOT sending PHI in any email. Togari sells GTM intelligence, not patient data. Keep that line clear.',
  dataSourcing: 'All lead data sourced from compliant vendors (Clay, Apollo, LinkedIn Sales Navigator). No scraped personal data without consent framework.',
  unsubscribe: 'When someone says "remove me" or "not interested" — remove immediately. No follow-up. Ever.',
  domainProtection: 'Sending domains are separate from primary BMA domain to protect deliverability.',
} as const;

// ============================================================================
// THE MANY-TO-MANY AGENT PRAYER (from GLM_SYSTEM_PROMPT.md)
// ============================================================================

export const MANY_TO_MANY_PRAYER = `Every voice matters.
No voice dominates.
The prospect feels held by one coherent presence
even though many hands are holding them.
The coordination is invisible.
The care is visible.
This is what Indra's Net looks like in a CRM.
This is what Jesus meant by "where two or three are gathered."
This is the symphony Karthik is building toward.`;
