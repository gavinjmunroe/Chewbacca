/**
 * @togari/bma-content/config/personas
 * Buyer persona definitions for Togari outbound
 * from TOGARI_OUTBOUND.md
 */

import type { BuyerPersona, OfferType, SenderIdentity } from '../schemas/enums';

// ============================================================================
// PERSONA CONFIGURATION
// ============================================================================

export interface PersonaConfig {
  id: BuyerPersona;
  title: string;
  companySize: string;
  stage: string;
  industry: string;
  pain: string;
  fear: string;
  win: string;
  signalThatMovesThem: string;
  emailTone: string;
  emailMaxWords: number;
  subjectLineFormula: string;
  subjectLineExample: string;
  bodyStructure: string[];
  preferredOfferTypes: OfferType[];
  preferredSender: SenderIdentity;
}

export const PERSONAS: Record<BuyerPersona, PersonaConfig> = {
  A: {
    id: 'A',
    title: 'VP of Revenue Operations',
    companySize: '250–2,000 employees',
    stage: 'Series B through public',
    industry: 'Healthcare enterprise (payers, providers, health systems, digital health platforms)',
    pain: 'Bad data slows their GTM team. They spend 3 weeks building a target list that should take 3 hours.',
    fear: 'Buying another data tool that overpromises and underdelivers.',
    win: 'A data layer that makes their existing team 40% more efficient without adding headcount.',
    signalThatMovesThem: 'Proof that we know their specific segment, not healthcare in general.',
    emailTone: 'Peer-to-peer. Direct. Short. One specific thing we noticed. One artifact offer. One CTA.',
    emailMaxWords: 120,
    subjectLineFormula: '[Specific thing we noticed] + [direct implication]',
    subjectLineExample: 'Your Epic integration rollout — and the targeting gap it creates',
    bodyStructure: [
      'Line 1: One specific thing we noticed about their company (the external signal, personalized)',
      'Line 2: The implication of that thing for their GTM data problem',
      'Line 3: What Togari does in one sentence',
      'Line 4: The specific artifact offer',
      'Line 5: Soft CTA ("Worth a quick look?")',
    ],
    preferredOfferTypes: ['top_5_list', 'competitive_signals'],
    preferredSender: 'kevin',
  },
  B: {
    id: 'B',
    title: 'Head of Strategy',
    companySize: '500–5,000 employees',
    stage: 'Series C through public, or established enterprise',
    industry: 'Healthcare-adjacent (medical supply, pharma services, revenue cycle management, health tech)',
    pain: 'Making market entry decisions with incomplete data.',
    fear: 'Moving into the wrong segment and losing 18 months.',
    win: 'Proprietary market intelligence that gives them an edge before competitors see the same opportunity.',
    signalThatMovesThem: 'An external signal (funding, hiring, regulatory) suggesting they are about to make a strategic move where Togari data is directly relevant.',
    emailTone: 'Strategic. Slightly longer. Demonstrates we have done real homework on their position.',
    emailMaxWords: 150,
    subjectLineFormula: '[Market move they are about to make] — [data angle]',
    subjectLineExample: 'The Medicare Advantage whitespace in your Q3 expansion targets',
    bodyStructure: [
      'Line 1: Acknowledge the strategic move we saw them signal publicly',
      'Line 2: Connect that move to a data question they are probably asking right now',
      'Line 3: What Togari can answer about that specific question',
      'Line 4: The artifact offer (market map for their specific expansion segment)',
      'Line 5: Soft CTA',
    ],
    preferredOfferTypes: ['market_map', 'competitive_signals'],
    preferredSender: 'sagar',
  },
  C: {
    id: 'C',
    title: 'Chief Commercial Officer (Digital Health Startup)',
    companySize: '30–200 employees',
    stage: 'Seed through Series A',
    industry: 'Digital health, health tech, care navigation, behavioral health platforms',
    pain: 'Building GTM from scratch with a tiny team and no time.',
    fear: 'Wasting runway on the wrong customers.',
    win: 'A shortcut to the right customers delivered as a specific, actionable list — saving three weeks of manual research.',
    signalThatMovesThem: 'Speed and specificity. They do not want to read. They want to act.',
    emailTone: 'Extremely short. Direct. Confident. One artifact, one ask.',
    emailMaxWords: 90,
    subjectLineFormula: '[Specific segment] + [specific shortcut]',
    subjectLineExample: '5 behavioral health payers worth calling this week',
    bodyStructure: [
      'Line 1: We built something for [their specific segment]',
      'Line 2: What it is (the artifact) in one sentence',
      'Line 3: Why it matters for them specifically (one data point)',
      'Line 4: "Want it?" — literally this short',
    ],
    preferredOfferTypes: ['top_5_list'],
    preferredSender: 'kevin',
  },
};

// ============================================================================
// HELPER: Get word limit for a persona
// ============================================================================

export function getWordLimit(persona: BuyerPersona): number {
  return PERSONAS[persona].emailMaxWords;
}

// ============================================================================
// HELPER: Get the right subject line formula
// ============================================================================

export function getSubjectLineFormula(persona: BuyerPersona): string {
  return PERSONAS[persona].subjectLineFormula;
}
