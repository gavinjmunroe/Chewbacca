/**
 * @togari/bma-content/schemas/pipeline-state
 * Zod schemas for all four shared state documents
 * from AGENT_COORDINATION.md
 *
 * These are the connective tissue between all 9 agents.
 * Every agent reads at start and writes at end.
 */

import { z } from 'zod';
import {
  pipelineStageSchema,
  teamMemberSchema,
  buyerPersonaSchema,
  channelSchema,
  contentTypeSchema,
  experimentVariableSchema,
} from './enums';

// ============================================================================
// PIPELINE_STATE — current status of every prospect
// Written by: Reply Handler, Meeting Router, Debrief Processor, Relationship Memory Writer
// Read by: all agents
// ============================================================================

export const pipelineEntrySchema = z.object({
  prospectId: z.string(),
  company: z.string(),
  contact: z.string(),
  stage: pipelineStageSchema,
  lastContact: z.string().datetime().optional(),
  nextAction: z.string(),
  nextActionOwner: teamMemberSchema,
  nextActionDue: z.string().optional(),
  daysSinceContact: z.number().min(0).default(0),
  pipelineValue: z.number().min(0).default(0),
  probability: z.enum(['low', 'medium', 'high']).optional(),
  relationshipRecordId: z.string().describe('BigQuery row ID for full relationship record'),
  flags: z.array(z.string()).default([]).describe('gwen_flag, follow_up_overdue, etc.'),
});

export const pipelineStateSchema = z.object({
  lastUpdated: z.string().datetime(),
  pipeline: z.array(pipelineEntrySchema),
});

// ============================================================================
// CAMPAIGN_STATE — all campaigns, experiments, and email queues
// Written by: Signal Scout, Email Writer, Experiment Tracker
// Read by: GTM engineers, Caleb
// ============================================================================

export const experimentSchema = z.object({
  experimentId: z.string(),
  variable: experimentVariableSchema,
  hypothesis: z.string(),
  versions: z.array(z.object({
    label: z.string().describe('A / B / C'),
    description: z.string(),
    emailsSent: z.number().default(0),
    positiveReplies: z.number().default(0),
    meetingsBooked: z.number().default(0),
  })),
  targetSampleSize: z.number().min(50).describe('Min 50 per version per persona'),
  status: z.enum(['running', 'called', 'pending']),
  winner: z.string().optional(),
  calledAt: z.string().datetime().optional(),
  learningLog: z.string().optional(),
});

export const campaignEntrySchema = z.object({
  campaignId: z.string(),
  name: z.string(),
  status: z.enum(['active', 'paused', 'completed']),
  persona: buyerPersonaSchema,
  totalAccounts: z.number().default(0),
  emailsSent: z.number().default(0),
  repliesReceived: z.number().default(0),
  positiveReplies: z.number().default(0),
  meetingsBooked: z.number().default(0),
  experiments: z.array(z.string()).default([]).describe('experiment IDs'),
});

export const campaignStateSchema = z.object({
  lastUpdated: z.string().datetime(),
  campaigns: z.array(campaignEntrySchema),
  experiments: z.array(experimentSchema),
  experimentQueue: z.array(z.string()).describe('Experiment IDs waiting to launch'),
});

// ============================================================================
// CONTENT_STATE — content calendar and performance
// Written by: Content Publisher
// Read by: content team, Sagar
// ============================================================================

export const contentPieceSchema = z.object({
  id: z.string(),
  channel: channelSchema,
  contentType: contentTypeSchema,
  title: z.string(),
  persona: z.string().optional(),
  status: z.enum(['idea', 'brief', 'draft', 'approved', 'scheduled', 'published']),
  scheduledDate: z.string().optional(),
  publishedDate: z.string().optional(),
  engagement: z.object({
    likes: z.number().default(0),
    comments: z.number().default(0),
    shares: z.number().default(0),
    saves: z.number().default(0),
    dmInquiries: z.number().default(0),
    impressions: z.number().default(0),
  }).optional(),
  pipelineImpact: z.array(z.string()).default([]).describe('prospect IDs who engaged'),
  qualitativeNotes: z.string().optional(),
});

export const weeklySignalHarvestSchema = z.object({
  weekOf: z.string(),
  ideas: z.array(z.object({
    idea: z.string(),
    source: z.string(),
    relevanceRank: z.number(),
    approved: z.boolean().default(false),
  })),
});

export const contentStateSchema = z.object({
  lastUpdated: z.string().datetime(),
  contentPieces: z.array(contentPieceSchema),
  signalHarvests: z.array(weeklySignalHarvestSchema),
  // Rolling 4-week calendar status
  calendarStatus: z.object({
    week1: z.enum(['locked', 'production', 'brief', 'harvest']).describe('Nearest week — should be locked'),
    week2: z.enum(['locked', 'production', 'brief', 'harvest']).describe('Second week — should be production'),
    week3: z.enum(['locked', 'production', 'brief', 'harvest']).describe('Third week — should be brief'),
    week4: z.enum(['locked', 'production', 'brief', 'harvest']).describe('Fourth week — should be harvest'),
  }),
});

// ============================================================================
// TEAM_STATE — availability and routing
// Written by: Meeting Router, calendar monitor
// Read by: all agents that route to humans
// ============================================================================

export const teamMemberAvailabilitySchema = z.object({
  member: teamMemberSchema,
  available: z.boolean(),
  calendarBookingLink: z.string().optional(),
  availableSlots: z.array(z.object({
    date: z.string(),
    startTime: z.string(),
    endTime: z.string(),
  })).default([]),
  outOfOffice: z.boolean().default(false),
  outOfOfficeUntil: z.string().optional(),
  focusTime: z.boolean().default(false),
  currentClientLoad: z.number().default(0).describe('Number of active relationships'),
});

export const teamStateSchema = z.object({
  lastUpdated: z.string().datetime(),
  members: z.array(teamMemberAvailabilitySchema),
});

// ============================================================================
// TYPES
// ============================================================================

export type PipelineEntry = z.infer<typeof pipelineEntrySchema>;
export type PipelineState = z.infer<typeof pipelineStateSchema>;
export type Experiment = z.infer<typeof experimentSchema>;
export type CampaignEntry = z.infer<typeof campaignEntrySchema>;
export type CampaignState = z.infer<typeof campaignStateSchema>;
export type ContentPiece = z.infer<typeof contentPieceSchema>;
export type ContentState = z.infer<typeof contentStateSchema>;
export type TeamMemberAvailability = z.infer<typeof teamMemberAvailabilitySchema>;
export type TeamState = z.infer<typeof teamStateSchema>;
