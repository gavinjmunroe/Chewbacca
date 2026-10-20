/**
 * @togari/admin — Shared enum schemas for the entire BMA GTM OS
 *
 * Canonical Zod enums for all content variables, pipeline stages, and team structure.
 * Product repos import these instead of defining their own.
 */

import { z } from 'zod';

// ============================================================================
// BUYER PERSONAS (from TOGARI_OUTBOUND.md)
// ============================================================================

export const buyerPersonaSchema = z.enum([
  'A',  // VP of Revenue Operations
  'B',  // Head of Strategy
  'C',  // Chief Commercial Officer (Digital Health Startup)
]);

// ============================================================================
// CHANNELS (from CONTENT_ENGINE.md)
// ============================================================================

export const channelSchema = z.enum([
  'bma_linkedin',         // BMA LinkedIn Company Page
  'gartiwar',             // Sagar's AI Avatar
  'rytual',               // Faceless psychedelic retreat brand
  'caleb_personal',       // Caleb's personal channels (Jesus content)
  'kevin_linkedin',       // Kevin Cong personal LinkedIn
  'sagar_linkedin',       // Sagar personal LinkedIn
  'cold_email',           // Togari cold outbound (high volume to TAM)
  'warm_email',           // Inbound signal response (posts, website visitors, GTME job postings)
  'linkedin_outbound',    // LinkedIn DM outbound (legacy alias)
  'linkedin_dm',          // LinkedIn DM — partnerships only
  'instagram_dm',         // Instagram DM (stub — no API connector)
  'imessage_dm',          // iMessage DM (stub — scripts exist, no sequence automation)
  'linkedin_posting',     // LinkedIn content publishing
  'instagram_posting',    // Instagram content posting (stub — no API connector)
  'x_posting',            // X/Twitter content posting (stub — no API connector)
]);

// ============================================================================
// THEOLOGY/TONE FRAMES (from CLAUDE_OS.md — the spiritual architecture)
// ============================================================================

export const theologyFrameSchema = z.enum([
  'vedic_systems',        // Sagar's channels — dharmic, nature, systems thinking
  'jesus_service',        // Caleb's channels — Jesus-centered, Holy Spirit
  'nature_reverent',      // Rytual, Gartiwar — plant medicine, contemplative
  'enterprise_credible',  // BMA LinkedIn — serious, credible, B2B
  'peer_warm',            // Gwen, Kevin — relational, dependable
]);

// ============================================================================
// CONTENT TYPES (from CONTENT_ENGINE.md — Variable 5)
// ============================================================================

export const contentTypeSchema = z.enum([
  'short_form_post',      // Under 300 words
  'long_form_post',       // 300-1500 words
  'carousel',             // 6-10 slides, each self-contained
  'short_form_video',     // Under 90 seconds
  'long_form_essay',      // 1500+ words
  'podcast',              // Long-form audio
  'data_visualization',   // Charts, graphs
  'case_study',           // Full case study document
]);

// ============================================================================
// CAROUSEL TEMPLATES (from BMA LinkedIn Content System MD)
// ============================================================================

export const carouselTemplateSchema = z.enum([
  'framework_explainer',  // Teach a BMA proprietary model
  'case_study',           // Before-after from client calls
  'myths_vs_reality',     // Fast-consumption, save-able
  'mini_playbook',        // Sequence of steps with micro-CTA
]);

// ============================================================================
// PIPELINE TYPES — Three distinct pipelines
// ============================================================================

export const pipelineTypeSchema = z.enum([
  'partnerships',   // BD/partner conversations
  'inbound',        // Warm intros, website forms, replies to campaigns
  'outbound',       // Cold email, LinkedIn, proactive outreach
]);

// ============================================================================
// PIPELINE STAGES — Canonical stage model for all three pipelines
// ============================================================================

export const pipelineStageSchema = z.enum([
  'new',                      // Just entered the pipeline
  'researching',              // Context gathering, enrichment
  'first_contact_sent',       // Initial outreach sent
  'conversation_started',     // Reply received, dialogue open
  'qualified_opportunity',    // Meets ICP, budget/timeline confirmed
  'proposal_evaluation',      // Proposal delivered, under review
  'verbal_commit',            // Handshake deal, pending paperwork
  'closed_won',               // Deal closed successfully
  'closed_lost',              // Deal lost (with explicit reason)
]);

// ============================================================================
// REPLY CLASSIFICATIONS (from TOGARI_OUTBOUND.md)
// ============================================================================

export const replyClassificationSchema = z.enum([
  'positive_interest',    // Curiosity, question about artifact, invitation to continue
  'objection',            // Already have vendor / not the right time / send more info
  'wrong_person',         // Referred to someone else
  'not_now',              // Follow up later, budget freeze, timing
  'unsubscribe',          // Remove me, not interested
]);

// ============================================================================
// OFFER TYPES (from TOGARI_OUTBOUND.md)
// ============================================================================

export const offerTypeSchema = z.enum([
  'top_5_list',           // Top 5 target accounts in their segment
  'market_map',           // TAM, key players, whitespace for their subsegment
  'competitive_signals',  // Where competitors are expanding/not
]);

// ============================================================================
// SENDER IDENTITIES (from TOGARI_OUTBOUND.md)
// ============================================================================

export const senderIdentitySchema = z.enum([
  'sagar',
  'kevin',
]);

// ============================================================================
// TEAM MEMBERS (from CLAUDE_OS.md)
// ============================================================================

export const teamMemberSchema = z.enum([
  'sagar',
  'caleb',
  'gwen',
  'drew',
  'kevin',
  'mike',
  'maggie',
  'karthik',
]);

// ============================================================================
// TEAM ROLES — Strategists (research, prep, messaging) vs Engineers (execution)
// ============================================================================

export const teamRoleSchema = z.enum([
  'strategist',  // Kevin, Sagar, Drew/Gwen — research, prep, messaging, system building
  'engineer',    // Mike, Maggie, Karthik — execution, triage, engineering
]);

export const strategistSchema = z.enum(['kevin', 'sagar', 'drew']);
export const engineerSchema = z.enum(['mike', 'maggie', 'karthik']);

// ============================================================================
// MEETING ROUTABLE MEMBERS (from CLAUDE_OS.md — routing rules)
// ============================================================================

export const meetingRecipientSchema = z.enum([
  'kevin',    // Primary — always first
  'mike',     // Secondary — when Kevin unavailable
  'maggie',   // Tertiary — when Mike unavailable
]);

// ============================================================================
// EXPERIMENT VARIABLES (from TOGARI_OUTBOUND.md)
// ============================================================================

export const experimentVariableSchema = z.enum([
  'signal_type',        // External only / Internal only / Combined
  'offer_type',         // Top 5 list / Market map / Competitive signals
  'sender_identity',    // Sagar / Kevin
  'email_length',       // Under 90 / Under 150 words
  'send_day',           // Tuesday / Thursday
]);

// ============================================================================
// CONTENT TIMING TRIGGERS (from CONTENT_ENGINE.md — Variable 6)
// ============================================================================

export const timingTriggerSchema = z.enum([
  'external_news',          // Triggered by news event
  'pipeline_insight',       // Triggered by Togari pipeline data
  'seasonal_regulatory',    // Triggered by calendar/regulatory
  'engagement_signal',      // Triggered by prospect engagement
  'planned_series',         // Part of a scheduled series
  'reactive_audience',      // Reactive to comment or question
]);

// ============================================================================
// PRODUCT (from CONTENT_ENGINE.md — Variable 1)
// ============================================================================

export const productSchema = z.enum([
  'togari',               // Health data GTM platform
  'bma_services',         // BMA GTM engineering services
  'rytual_retreat',       // Psychedelic retreat
  'gartiwar_guide',       // AI health guide persona
]);

// ============================================================================
// INTERACTION TYPES (from relationship record tracking)
// ============================================================================

export const interactionTypeSchema = z.enum([
  'email_sent',
  'email_reply_received',
  'meeting_held',
  'follow_up_sent',
  'artifact_delivered',
  'note_logged',
  'content_engaged',
]);

// ============================================================================
// TYPE EXPORTS
// ============================================================================

export type BuyerPersona = z.infer<typeof buyerPersonaSchema>;
export type Channel = z.infer<typeof channelSchema>;
export type TheologyFrame = z.infer<typeof theologyFrameSchema>;
export type ContentType = z.infer<typeof contentTypeSchema>;
export type CarouselTemplate = z.infer<typeof carouselTemplateSchema>;
export type PipelineType = z.infer<typeof pipelineTypeSchema>;
export type PipelineStage = z.infer<typeof pipelineStageSchema>;
export type ReplyClassification = z.infer<typeof replyClassificationSchema>;
export type OfferType = z.infer<typeof offerTypeSchema>;
export type SenderIdentity = z.infer<typeof senderIdentitySchema>;
export type TeamMember = z.infer<typeof teamMemberSchema>;
export type TeamRole = z.infer<typeof teamRoleSchema>;
export type MeetingRecipient = z.infer<typeof meetingRecipientSchema>;
export type ExperimentVariable = z.infer<typeof experimentVariableSchema>;
export type TimingTrigger = z.infer<typeof timingTriggerSchema>;
export type Product = z.infer<typeof productSchema>;
export type InteractionType = z.infer<typeof interactionTypeSchema>;
