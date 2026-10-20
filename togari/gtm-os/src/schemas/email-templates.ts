/**
 * @togari/bma-content/schemas/email-templates
 * Zod schemas for persona-specific email generation
 * from TOGARI_OUTBOUND.md
 */

import { z } from 'zod';
import {
  buyerPersonaSchema,
  offerTypeSchema,
  senderIdentitySchema,
  replyClassificationSchema,
} from './enums';

// ============================================================================
// PERSONA-SPECIFIC CONSTRAINTS
// ============================================================================

/**
 * Hard word count limits per persona — enforced, not suggested
 * Persona A (VP RevOps): under 120 words
 * Persona B (Head of Strategy): under 150 words
 * Persona C (CCO Digital Health): under 90 words
 */
export const PERSONA_WORD_LIMITS: Record<string, number> = {
  A: 120,
  B: 150,
  C: 90,
};

// ============================================================================
// EMAIL DRAFT SCHEMA
// ============================================================================

export const emailDraftSchema = z.object({
  // Identity
  prospectId: z.string(),
  company: z.string(),
  contactName: z.string(),
  contactTitle: z.string(),
  contactEmail: z.string().email(),
  persona: buyerPersonaSchema,

  // Signal reference
  signalPackageId: z.string().describe('References the signal package that generated this email'),
  whyNow: z.string(),

  // Email content
  subjectLine: z.string().max(100).describe('Subject line following persona-specific formula'),
  emailBody: z.string().describe('Full email body within persona word limits'),
  wordCount: z.number().describe('Must be within PERSONA_WORD_LIMITS for the persona tag'),

  // Offer
  offerType: offerTypeSchema,
  offerDescription: z.string().describe('The specific artifact being offered'),

  // Sending
  senderIdentity: senderIdentitySchema,
  sendDate: z.string().describe('Scheduled send date — Tue-Thu only, 8am-11am recipient timezone'),

  // Campaign tracking
  campaignId: z.string(),
  experimentId: z.string().optional(),
  experimentVersion: z.string().optional().describe('A / B / C variant label'),

  // Status
  status: z.enum(['drafted', 'approved', 'revision_needed', 'scheduled', 'sent']).default('drafted'),
  revisionNotes: z.string().optional().describe('GTM engineer feedback if revision needed'),

  // Metadata
  generatedAt: z.string().datetime(),
});

// ============================================================================
// EMAIL REVIEW CHECKLIST (from GTM_ENGINEER_PLAYBOOK.md)
// ============================================================================

export const emailReviewChecklistSchema = z.object({
  emailDraftId: z.string(),
  reviewedBy: z.string().describe('GTM engineer who reviewed'),
  reviewedAt: z.string().datetime(),

  // The 7 checks from the playbook
  firstLineSpecific: z.boolean().describe('Does the first line reference something specific about this company?'),
  signalSpecificAndRecent: z.boolean().describe('Is the signal specific and recent?'),
  soundsLikeHuman: z.boolean().describe('Does it sound like Sagar or Kevin actually wrote it?'),
  offerIsSpecific: z.boolean().describe('Is the offer a specific artifact, not a vague meeting ask?'),
  withinWordLimit: z.boolean().describe('Within persona word limits?'),
  singleCta: z.boolean().describe('Asks for one thing and only one thing?'),
  noManipulation: z.boolean().describe('Nothing that would make a reasonable person feel manipulated?'),

  // Result
  approved: z.boolean(),
  notes: z.string().optional(),
});

// ============================================================================
// REPLY SCHEMA
// ============================================================================

export const replySchema = z.object({
  prospectId: z.string(),
  company: z.string(),
  contactName: z.string(),

  // Original email reference
  originalEmailId: z.string(),
  threadSummary: z.string().describe('Full thread — what we sent, what they replied'),

  // Classification
  classification: replyClassificationSchema,
  classificationConfidence: z.number().min(0).max(1),
  classificationReasoning: z.string(),

  // Reply content
  replyBody: z.string().describe('What they actually said'),
  replyTone: z.string().describe('Brief description of their emotional register'),
  receivedAt: z.string().datetime(),

  // Drafted response
  draftedResponse: z.string().describe('Claude-drafted response for human review'),
  responseStatus: z.enum(['drafted', 'approved', 'sent']).default('drafted'),

  // Routing (if positive interest)
  meetingRequested: z.boolean().default(false),
  meetingRoutedTo: z.string().optional().describe('kevin / mike / maggie'),

  // Referral handling (if wrong person)
  referredContactName: z.string().optional(),
  referredContactTitle: z.string().optional(),
  referredContactAdded: z.boolean().optional(),

  // Follow-up scheduling (if not now)
  followUpDate: z.string().optional().describe('When they said to reach back out'),
  reEngagementEmailDrafted: z.boolean().optional(),

  // Metadata
  classifiedAt: z.string().datetime(),
});

// ============================================================================
// BLACKLIST RULES — things that NEVER appear in any email
// ============================================================================

export const EMAIL_BLACKLIST = [
  'I hope this email finds you well',
  'We work with companies like yours',
  'synergy',
  'synergies',
  'leverage', // as a verb
  'ecosystem', // without specifics
  'exciting', // describing our own work
  'I wanted to reach out',
  'Just following up',
  'Quick question',
  'Do you have 15 minutes',
  'I\'d love to pick your brain',
] as const;

// ============================================================================
// SEND RULES (from TOGARI_OUTBOUND.md)
// ============================================================================

export const SEND_RULES = {
  maxPerInboxPerDay: 40,
  maxPerDomainPerDay: 200,
  sendDays: ['tuesday', 'wednesday', 'thursday'] as const,
  sendWindowStart: 8, // 8am recipient timezone
  sendWindowEnd: 11,  // 11am recipient timezone
  neverSendDays: ['friday', 'saturday', 'sunday', 'monday'] as const,
} as const;

// ============================================================================
// TYPES
// ============================================================================

export type EmailDraft = z.infer<typeof emailDraftSchema>;
export type EmailReviewChecklist = z.infer<typeof emailReviewChecklistSchema>;
export type Reply = z.infer<typeof replySchema>;
