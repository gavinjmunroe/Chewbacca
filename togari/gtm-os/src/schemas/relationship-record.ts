/**
 * @togari/bma-content/schemas/relationship-record
 * Zod schemas for the living relationship record per prospect
 * from MIDDLE_FUNNEL_FOUNDATION.md
 *
 * PERSON-CENTRIC DATA MODEL:
 * Each person gets ONE BigQuery row that contains ALL context —
 * their company info, relationship history, team involvement, pipeline status,
 * meeting notes, and Togari data relevance. Everything lives under the person.
 */

import { z } from 'zod';
import {
  buyerPersonaSchema,
  pipelineStageSchema,
  teamMemberSchema,
  meetingRecipientSchema,
} from './enums';

// ============================================================================
// PROSPECT IDENTITY (top of the relationship record)
// ============================================================================

export const prospectIdentitySchema = z.object({
  name: z.string(),
  title: z.string(),
  company: z.string(),
  linkedinUrl: z.string().optional(),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  preferredCommunication: z.enum(['email', 'linkedin', 'phone']).default('email'),
  personalNotes: z.string().optional().describe(
    'Anything personal they mentioned — kids, hobbies, hometown. Makes them human.'
  ),
});

// ============================================================================
// COMPANY CONTEXT (nested under the person)
// ============================================================================

export const companyContextSchema = z.object({
  size: z.string().optional().describe('Headcount range'),
  stage: z.string().optional().describe('Funding stage'),
  segment: z.string().optional().describe('Healthcare subsegment'),
  revenue: z.string().optional().describe('Revenue range if known'),
  keyInitiatives: z.string().optional().describe('What they are working on right now'),
  keyChallenges: z.string().optional().describe('What keeps them up at night'),
  competitiveContext: z.string().optional().describe('Who else they are talking to'),
  budgetCycle: z.string().optional().describe('Fiscal year end / when budget decisions happen'),
});

// ============================================================================
// INTERACTION LOG (array of interactions, most recent first)
// ============================================================================

export const interactionSchema = z.object({
  id: z.string(),
  date: z.string().datetime(),
  type: z.enum([
    'email_sent',
    'email_reply_received',
    'meeting_held',
    'follow_up_sent',
    'artifact_delivered',
    'note_logged',
    'content_engaged',
  ]),
  summary: z.string().describe('What happened in plain language'),
  performedBy: teamMemberSchema.optional(),
  tone: z.string().optional().describe('Emotional register of the interaction'),
  details: z.record(z.unknown()).optional().describe('Type-specific metadata'),
});

// ============================================================================
// COMMITMENT TRACKING
// ============================================================================

export const commitmentSchema = z.object({
  id: z.string(),
  description: z.string(),
  madeBy: z.enum(['us', 'them']),
  madeByPerson: z.string().optional(),
  madeOn: z.string().datetime(),
  dueBy: z.string().optional(),
  fulfilled: z.boolean().default(false),
  fulfilledOn: z.string().datetime().optional(),
});

// ============================================================================
// TEAM INVOLVEMENT
// ============================================================================

export const teamInvolvementSchema = z.object({
  primaryOwner: meetingRecipientSchema.describe('Kevin / Mike / Maggie'),
  gwenInvolved: z.boolean().default(false),
  gwenRole: z.string().optional().describe('Why Gwen is involved — partnership angle etc.'),
  karthikInvolved: z.boolean().default(false),
  karthikRole: z.string().optional().describe('Product questions that have come up'),
  sagarInvolved: z.boolean().default(false),
  sagarRole: z.string().optional().describe('Strategic conversation in progress'),
  calebInvolved: z.boolean().default(false),
  calebRole: z.string().optional().describe('Technical conversation in progress'),
});

// ============================================================================
// TOGARI DATA RELEVANCE
// ============================================================================

export const togariRelevanceSchema = z.object({
  internalDataAsset: z.string().optional().describe('Most relevant Togari data for their situation'),
  proofPointDelivered: z.boolean().default(false),
  proofPointWhich: z.string().optional(),
  artifactDelivered: z.boolean().default(false),
  artifactWhich: z.string().optional(),
  artifactDeliveredOn: z.string().datetime().optional(),
  reactionToData: z.string().optional().describe('What they said when they saw it'),
});

// ============================================================================
// NEXT ACTIONS
// ============================================================================

export const nextActionSchema = z.object({
  action: z.string().describe('Exactly what happens next'),
  owner: teamMemberSchema,
  dueDate: z.string().optional(),
  flaggedForAttention: z.boolean().default(false),
  attentionReason: z.string().optional(),
});

// ============================================================================
// THE FULL RELATIONSHIP RECORD (one BigQuery row per person)
// ============================================================================

export const relationshipRecordSchema = z.object({
  // Document ID — matches the prospect's personId in the core person schema
  id: z.string(),

  // Prospect identity
  prospect: prospectIdentitySchema,

  // Company context
  company: companyContextSchema,

  // Classification
  persona: buyerPersonaSchema,
  segment: z.string(),

  // Relationship history (ordered most recent first)
  interactions: z.array(interactionSchema).default([]),

  // What triggered outreach
  originalSignal: z.string().optional().describe('The Why Now from original outreach'),
  originalSignalDate: z.string().datetime().optional(),

  // Thread history
  emailThreadSummary: z.string().optional().describe('Full thread summary — what we sent, what they replied'),

  // Commitments
  ourCommitments: z.array(commitmentSchema).default([]),
  theirCommitments: z.array(commitmentSchema).default([]),

  // Contact tracking
  lastContactDate: z.string().datetime().optional(),
  daysSinceContact: z.number().default(0).describe('Auto-calculated'),

  // Team
  team: teamInvolvementSchema,

  // Pipeline
  pipelineStage: pipelineStageSchema,
  expectedCloseDate: z.string().optional(),
  expectedDealValue: z.number().optional(),
  probability: z.enum(['low', 'medium', 'high']).optional(),
  blockers: z.string().optional().describe('What is in the way of moving forward'),

  // Next actions
  nextAction: nextActionSchema.optional(),

  // Togari data
  togariRelevance: togariRelevanceSchema,

  // Free form notes
  notes: z.string().optional().describe(
    'Observations about communication style, personal interests, off-record comments'
  ),

  // Metadata
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

// ============================================================================
// INPUT SCHEMAS
// ============================================================================

export const createRelationshipRecordSchema = z.object({
  prospect: prospectIdentitySchema,
  company: companyContextSchema,
  persona: buyerPersonaSchema,
  segment: z.string(),
  originalSignal: z.string().optional(),
  team: teamInvolvementSchema,
  pipelineStage: pipelineStageSchema.default('signal_generation'),
});

export const updateRelationshipRecordSchema = z.object({
  prospect: prospectIdentitySchema.partial().optional(),
  company: companyContextSchema.partial().optional(),
  pipelineStage: pipelineStageSchema.optional(),
  nextAction: nextActionSchema.optional(),
  emailThreadSummary: z.string().optional(),
  togariRelevance: togariRelevanceSchema.partial().optional(),
  notes: z.string().optional(),
  probability: z.enum(['low', 'medium', 'high']).optional(),
  expectedCloseDate: z.string().optional(),
  expectedDealValue: z.number().optional(),
  blockers: z.string().optional(),
});

// ============================================================================
// TYPES
// ============================================================================

export type ProspectIdentity = z.infer<typeof prospectIdentitySchema>;
export type CompanyContext = z.infer<typeof companyContextSchema>;
export type Interaction = z.infer<typeof interactionSchema>;
export type Commitment = z.infer<typeof commitmentSchema>;
export type TeamInvolvement = z.infer<typeof teamInvolvementSchema>;
export type TogariRelevance = z.infer<typeof togariRelevanceSchema>;
export type NextAction = z.infer<typeof nextActionSchema>;
export type RelationshipRecord = z.infer<typeof relationshipRecordSchema>;
export type CreateRelationshipRecordInput = z.infer<typeof createRelationshipRecordSchema>;
export type UpdateRelationshipRecordInput = z.infer<typeof updateRelationshipRecordSchema>;
