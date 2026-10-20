/**
 * @togari/bma-content/agents/top-of-funnel/shared/personalization
 * Internal library — NOT an MCP tool
 * Product/persona/pricing engine for generating channel-appropriate outreach content
 * Used by channel agents' personalize tools
 */

import type { BuyerPersona } from '../../../schemas/enums';
import { PERSONAS } from '../../../config/personas';

export interface PersonalizationInput {
  channel: string;
  companyName: string;
  contactName: string;
  contactTitle: string;
  persona: BuyerPersona;
  segment: string;
  signals: string[];
  whyNow?: string;
  additionalContext?: string;
}

export type PersonalizationFormat =
  | 'cold_email'       // Short, signal-driven, one CTA
  | 'warm_email'       // Responsive to inbound signal, warmer
  | 'linkedin_dm'      // Very short, conversational
  | 'linkedin_post'    // Content brief + hook + CTA
  | 'generic';         // Fallback

/**
 * Build a personalization prompt for a specific channel format.
 * Each channel calls this with its format to get channel-appropriate content.
 */
function buildPersonalizationPrompt(
  input: PersonalizationInput,
  format: PersonalizationFormat
): string {
  const personaConfig = PERSONAS[input.persona];

  const formatInstructions: Record<PersonalizationFormat, string> = {
    cold_email: `FORMAT: Cold Email (outbound, high volume to TAM)
- Max words: ${personaConfig.emailMaxWords}
- Tone: ${personaConfig.emailTone}
- Subject line formula: ${personaConfig.subjectLineFormula}
- Body structure: ${personaConfig.bodyStructure.map((s, i) => `\n  ${i + 1}. ${s}`).join('')}
- One CTA only. One artifact offer. Peer-to-peer.
- NEVER: fear-based copy, generic openers, feature lists, "30-minute call" asks`,

    warm_email: `FORMAT: Warm Email (responding to inbound signal/trigger)
- Max words: ${personaConfig.emailMaxWords + 30} (slightly more room for context)
- Tone: Responsive, specific to the trigger. They did something — acknowledge it.
- Reference the exact trigger (post they engaged with, page they visited, job they posted)
- Warmer than cold — they already showed interest
- Still one CTA, still one artifact offer
- NEVER: pretend you don't know they engaged, generic "following up"`,

    linkedin_dm: `FORMAT: LinkedIn DM (partnerships only)
- Max words: 60
- Tone: Casual, direct, human. Like texting a colleague.
- One sentence about why you're reaching out
- One sentence about what you're proposing
- One question to open the conversation
- NEVER: formal language, long paragraphs, multiple CTAs`,

    linkedin_post: `FORMAT: LinkedIn Post (content publishing)
- Generate a content brief, not the final post
- Include: 5 hook variations, 3 key points, CTA, visual direction
- Never start with "I"
- Never use: synergy, leverage (as verb), ecosystem (without specifics), exciting (about our own work)
- Tone and theology frame must match the channel`,

    generic: `FORMAT: Generic outreach
- Keep it short and signal-driven
- One CTA, peer-to-peer tone`,
  };

  return `You are the Personalization engine for the ${input.channel} channel in the BMA GTM OS.

TARGET:
Company: ${input.companyName}
Contact: ${input.contactName}, ${input.contactTitle}
Persona: ${personaConfig.title} (${input.persona})
Segment: ${input.segment}

SIGNALS:
${input.signals.map(s => `- ${s}`).join('\n')}
${input.whyNow ? `\nWhy Now: ${input.whyNow}` : ''}
${input.additionalContext ? `\nAdditional Context: ${input.additionalContext}` : ''}

PERSONA DETAILS:
Pain: ${personaConfig.pain}
Fear: ${personaConfig.fear}
Win: ${personaConfig.win}
What moves them: ${personaConfig.signalThatMovesThem}

${formatInstructions[format]}

Generate personalized outreach content for this prospect on the ${input.channel} channel.
Return as structured JSON.`;
}

export const personalization = {
  buildPersonalizationPrompt,
};
