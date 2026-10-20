/**
 * @togari/bma-content/prompts/email-generation
 * Email generation prompts per persona
 * from TOGARI_OUTBOUND.md
 * Used by the Email Writer agent (Agent 2)
 */

import type { BuyerPersona } from '../schemas/enums';
import { PERSONAS } from '../config/personas';
import { EMAIL_BLACKLIST } from '../schemas/email-templates';

export function buildEmailGenerationPrompt(params: {
  persona: BuyerPersona;
  companyName: string;
  contactName: string;
  contactTitle: string;
  whyNow: string;
  internalSignal: string;
  externalSignal: string;
  recommendedOffer: string;
  bestProofPoint: string;
  senderIdentity: string;
  segment: string;
}): string {
  const personaConfig = PERSONAS[params.persona];

  return `You are writing a cold email for Togari, a health data platform that scrapes, cleans, and data-engineers complex healthcare datasets so healthcare enterprises can do smarter go-to-market work.

In one sentence: "We turn the messiest data in healthcare into the most specific sales intelligence in healthcare."

THE PERSONA YOU ARE WRITING TO:
Title: ${personaConfig.title}
Their pain: ${personaConfig.pain}
Their fear: ${personaConfig.fear}
Their win: ${personaConfig.win}
Signal that moves them: ${personaConfig.signalThatMovesThem}

THE SPECIFIC PROSPECT:
Company: ${params.companyName}
Contact: ${params.contactName}, ${params.contactTitle}
Segment: ${params.segment}

THE SIGNAL:
Why Now: ${params.whyNow}
Internal Signal: ${params.internalSignal}
External Signal: ${params.externalSignal}

THE OFFER:
Type: ${params.recommendedOffer}
Best Proof Point: ${params.bestProofPoint}

SENDER: ${params.senderIdentity === 'sagar' ? 'Sagar Tiwari, Founder of Blue Monitor Advisory' : 'Kevin Kong, Blue Monitor Advisory'}

EMAIL CONSTRAINTS:
- Maximum words: ${personaConfig.emailMaxWords}
- Tone: ${personaConfig.emailTone}
- Subject line formula: ${personaConfig.subjectLineFormula}
- Example subject: ${personaConfig.subjectLineExample}

BODY STRUCTURE:
${personaConfig.bodyStructure.map((line, i) => `${i + 1}. ${line}`).join('\n')}

ABSOLUTE PROHIBITIONS (if you write any of these, the email fails):
${EMAIL_BLACKLIST.map(item => `- "${item}"`).join('\n')}
- NO list of our features
- NO ask for a 30-minute call in the first email
- NO generic opener about ourselves
- NO "We work with companies like yours"
- NO fear-based language
- NO more than one CTA

OUTPUT FORMAT:
Return a JSON object:
{
  "subjectLine": "...",
  "emailBody": "...",
  "wordCount": number,
  "offerDescription": "The specific artifact being offered in one sentence"
}

Count the words carefully. If over the limit, cut what is not pulling weight. Every word must earn its place.`;
}
