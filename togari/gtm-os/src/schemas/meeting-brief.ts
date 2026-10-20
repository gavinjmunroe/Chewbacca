/**
 * @togari/bma-content/schemas/meeting-brief
 * Zod schemas for pre-meeting briefs and post-meeting debriefs
 * from MIDDLE_FUNNEL_FOUNDATION.md
 */

import { z } from 'zod';
import { teamMemberSchema } from './enums';

// ============================================================================
// ROLE-SPECIFIC BRIEFING
// ============================================================================

export const roleBriefingSchema = z.object({
  member: teamMemberSchema,
  guidance: z.string().describe('Specific guidance — your job is X, watch for Y, if Z happens do W'),
});

// ============================================================================
// LIKELY QUESTION AND ANSWER
// ============================================================================

export const likelyQASchema = z.object({
  question: z.string(),
  answer: z.string().describe('How to answer it — specific, not generic'),
  isObjection: z.boolean().default(false).describe('Is this a skeptical or objection question?'),
});

// ============================================================================
// SUCCESS OUTCOMES (ranked best to acceptable)
// ============================================================================

export const successOutcomeSchema = z.object({
  tier: z.enum(['best', 'good', 'acceptable']),
  description: z.string().describe('Specific measurable outcome, not "explore synergies"'),
});

// ============================================================================
// PRE-MEETING BRIEF (the full brief delivered 24 hours before)
// ============================================================================

export const preMeetingBriefSchema = z.object({
  // Identity
  id: z.string(),
  prospectId: z.string(),
  generatedAt: z.string().datetime(),

  // Meeting details
  meetingDate: z.string(),
  meetingTime: z.string(),
  meetingDuration: z.string(),
  platform: z.enum(['zoom', 'google_meet', 'in_person', 'phone']),

  // Attendees
  ourTeam: z.array(z.object({
    name: z.string(),
    role: z.string().describe('Their role in THIS meeting specifically'),
  })),
  theirTeam: z.array(z.object({
    name: z.string(),
    title: z.string(),
  })),

  // Context sections (the meat of the brief)
  whoTheyAre: z.string().describe(
    '3-4 sentences as if introducing to a friend. Not a bio. A human picture.'
  ),
  whyWeAreInThisRoom: z.string().describe(
    'The exact Why Now signal. Plain English. Not corporate. One paragraph.'
  ),
  whatHasBeenSaid: z.string().describe(
    'Full thread summary — what we sent, what they said, tone, interests, skepticism.'
  ),
  whatTheyCareAbout: z.string().describe(
    'Based on everything we know — the ONE thing that matters most to THEM. Not what we want to talk about.'
  ),

  // The one goal
  oneGoal: z.string().describe(
    'One sentence. Specific. Measurable. Not "explore synergies."'
  ),

  // Data and proof
  togariDataToReference: z.string().describe(
    'Specific data asset. How to introduce it naturally. What to show if they ask.'
  ),
  proofPointToLeadWith: z.string().describe(
    'Most relevant case or data example. How to tell it in 90 seconds.'
  ),

  // Q&A prep
  likelyQuestions: z.array(likelyQASchema).min(2).max(5),

  // Role briefings
  roleBriefings: z.array(roleBriefingSchema),

  // Success definition
  successOutcomes: z.array(successOutcomeSchema).length(3),

  // Flags
  gwenFlag: z.boolean().default(false),
  gwenAngle: z.string().optional().describe('The specific partnership or relationship angle'),

  // Delivery tracking
  deliveredTo: z.array(teamMemberSchema),
  deliveredAt: z.string().datetime().optional(),
});

// ============================================================================
// POST-MEETING DEBRIEF (10-question format from MIDDLE_FUNNEL_FOUNDATION.md)
// ============================================================================

export const postMeetingDebriefSchema = z.object({
  id: z.string(),
  prospectId: z.string(),
  meetingBriefId: z.string().describe('Links to the pre-meeting brief'),

  // Meeting identity
  meetingDate: z.string(),
  attendees: z.array(z.string()),

  // The 10 questions
  roomEnergy: z.object({
    score: z.number().min(1).max(10),
    description: z.string(),
  }),
  reactionToData: z.string().describe('What they said when they saw Togari data — exact words if remembered'),
  newInsight: z.string().describe('One thing they care about that we did not know before'),
  ourCommitments: z.string().describe('What we committed to — what exactly, by when, sent by whom'),
  theirCommitments: z.string().describe('What they committed to — specific'),
  actualNextStep: z.string().describe('What was explicitly agreed. Not hopes — agreements.'),
  dealLikelihood: z.object({
    direction: z.enum(['more_likely', 'less_likely', 'same']),
    reasoning: z.string(),
  }),
  partnershipAngle: z.string().optional().describe('Anything Gwen should know about'),
  productQuestion: z.string().optional().describe('Anything Karthik should weigh in on'),
  freeFormNotes: z.string().optional().describe('Anything else that felt important'),

  // Metadata
  loggedBy: teamMemberSchema,
  loggedAt: z.string().datetime(),
  loggedWithinTwoHours: z.boolean().describe('Did we log this while the conversation was still fresh?'),
});

// ============================================================================
// TYPES
// ============================================================================

export type RoleBriefing = z.infer<typeof roleBriefingSchema>;
export type LikelyQA = z.infer<typeof likelyQASchema>;
export type SuccessOutcome = z.infer<typeof successOutcomeSchema>;
export type PreMeetingBrief = z.infer<typeof preMeetingBriefSchema>;
export type PostMeetingDebrief = z.infer<typeof postMeetingDebriefSchema>;
