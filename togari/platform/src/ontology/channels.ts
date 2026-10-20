/**
 * @togari/admin — Channel definitions with theology lines and content rules
 *
 * From CONTENT_ENGINE.md and CLAUDE_OS.md.
 * Product repos import this to validate channel constraints.
 */

import type { Channel, TheologyFrame, ContentType, TeamMember } from './enums';

// ============================================================================
// CHANNEL CONFIGURATION
// ============================================================================

export interface ChannelConfig {
  id: Channel;
  displayName: string;
  owner: TeamMember;
  approvers: TeamMember[];
  theologyFrame: TheologyFrame;
  allowedContentTypes: ContentType[];
  cadence: string;
  personaServed: string;
  theologyLine: string;
  prohibitedContent: string[];
  toneDescription: string;
}

export const CHANNELS: Record<Channel, ChannelConfig> = {
  bma_linkedin: {
    id: 'bma_linkedin',
    displayName: 'BMA LinkedIn (Company Page)',
    owner: 'sagar',
    approvers: ['sagar', 'caleb'],
    theologyFrame: 'enterprise_credible',
    allowedContentTypes: ['short_form_post', 'long_form_post', 'carousel', 'data_visualization', 'case_study'],
    cadence: '3 posts per week minimum. Tuesday, Thursday, Saturday.',
    personaServed: 'VP RevOps, Head of Strategy, CCO at healthcare companies. Also potential BMA clients outside Togari TAM.',
    theologyLine: 'Vedic/nature/systems framing welcome. Jesus content NEVER appears here.',
    prohibitedContent: ['jesus_content', 'personal_spiritual_declarations'],
    toneDescription: 'Enterprise GTM strategy + health data intelligence + Vedic/systems thinking undertone. Serious. Credible. Occasionally surprising in depth.',
  },
  gartiwar: {
    id: 'gartiwar',
    displayName: 'Gartiwar (Sagar AI Avatar)',
    owner: 'sagar',
    approvers: ['sagar'],
    theologyFrame: 'nature_reverent',
    allowedContentTypes: ['short_form_video', 'long_form_essay', 'data_visualization'],
    cadence: '2 pieces per week',
    personaServed: 'Healthcare founders interested in wellness, spirituality, future of holistic health. Also potential Rytual clients.',
    theologyLine: 'Vedic, dharmic, nature-based. No declarations of settled belief. Always exploring, always seeking.',
    prohibitedContent: ['jesus_content', 'settled_spiritual_declarations', 'corporate_language'],
    toneDescription: 'Behavioral health guide. Dharmic. Nature-rooted. Psychedelic-adjacent but always safety-first.',
  },
  rytual: {
    id: 'rytual',
    displayName: 'Rytual (Faceless Brand)',
    owner: 'sagar',
    approvers: ['sagar'],
    theologyFrame: 'nature_reverent',
    allowedContentTypes: ['short_form_video', 'long_form_essay', 'case_study'],
    cadence: '2 pieces per week',
    personaServed: 'People exploring psychedelic therapy. Healthcare professionals curious about research. Potential retreat participants.',
    theologyLine: 'Nature as teacher. Vedic reverence for plant medicines as ancient teachers. Medicine holds wisdom; human approaches with humility.',
    prohibitedContent: ['jesus_content', 'corporate_language', 'hype', 'urgency', 'countdown_timers'],
    toneDescription: 'Contemplative. Reverent. Nature — mycology, forests, water, light. Never hype. Never urgency. "We will be here when you are ready."',
  },
  caleb_personal: {
    id: 'caleb_personal',
    displayName: 'Caleb Personal Channels',
    owner: 'caleb',
    approvers: ['caleb'],
    theologyFrame: 'jesus_service',
    allowedContentTypes: ['short_form_post', 'long_form_post', 'short_form_video'],
    cadence: 'Organic. Not forced. Posts when he has something real to say.',
    personaServed: 'Young Christian technologists. People exploring faith + tech intersection.',
    theologyLine: 'Jesus only. All of it. Unapologetically. No Vedic framing. No BMA GTM content unless genuinely connected to his personal story.',
    prohibitedContent: ['vedic_framing', 'bma_gtm_content_unless_personal'],
    toneDescription: 'Jesus-centered. Service-oriented. Technical depth with spiritual grounding. Building things for God and for people.',
  },
  kevin_linkedin: {
    id: 'kevin_linkedin',
    displayName: 'Kevin Cong Personal LinkedIn',
    owner: 'kevin',
    approvers: ['kevin'],
    theologyFrame: 'peer_warm',
    allowedContentTypes: ['short_form_post', 'long_form_post'],
    cadence: '2 posts per week',
    personaServed: 'VP RevOps and CCOs — same people he meets in cold outreach. Credibility building.',
    theologyLine: 'No specific theology. Dependable, expert, family-motivated.',
    prohibitedContent: [],
    toneDescription: 'Dependable. Expert. Family-motivated. Healthcare GTM practitioner. Not performative. Real.',
  },
  sagar_linkedin: {
    id: 'sagar_linkedin',
    displayName: 'Sagar Personal LinkedIn',
    owner: 'sagar',
    approvers: ['sagar'],
    theologyFrame: 'vedic_systems',
    allowedContentTypes: ['short_form_post', 'long_form_post', 'carousel', 'data_visualization'],
    cadence: '3 posts per week',
    personaServed: 'Healthcare enterprise buyers, investors, potential hires, strategic partners.',
    theologyLine: 'Vedic and dharmic framing welcome. Always seeking, never declaring settled belief.',
    prohibitedContent: ['jesus_content', 'settled_spiritual_declarations'],
    toneDescription: 'Founder building in public. Vedic-informed systems thinker. Healthcare data expert. Immigrant story. Never performative vulnerability.',
  },
  cold_email: {
    id: 'cold_email',
    displayName: 'Togari Cold Email',
    owner: 'caleb',
    approvers: ['caleb'],
    theologyFrame: 'enterprise_credible',
    allowedContentTypes: [],
    cadence: 'Continuous — max 40/inbox/day, Tue-Thu only',
    personaServed: 'VP RevOps (A), Head of Strategy (B), CCO (C)',
    theologyLine: 'No theology. Pure signal-driven, persona-matched outreach.',
    prohibitedContent: ['any_spiritual_content', 'fear_based_copy', 'generic_openers'],
    toneDescription: 'Peer-to-peer. Direct. One specific thing. One artifact offer. One CTA.',
  },
  linkedin_outbound: {
    id: 'linkedin_outbound',
    displayName: 'LinkedIn DM Outbound (Legacy)',
    owner: 'caleb',
    approvers: ['caleb'],
    theologyFrame: 'enterprise_credible',
    allowedContentTypes: [],
    cadence: 'Legacy alias — use linkedin_dm instead',
    personaServed: 'Same as cold email — A, B, C personas',
    theologyLine: 'No theology. Signal-driven.',
    prohibitedContent: ['any_spiritual_content', 'fear_based_copy'],
    toneDescription: 'Even shorter than email. Conversational. One message, one ask.',
  },
  warm_email: {
    id: 'warm_email',
    displayName: 'Warm Email (Inbound Signal Response)',
    owner: 'sagar',
    approvers: ['sagar', 'caleb'],
    theologyFrame: 'enterprise_credible',
    allowedContentTypes: [],
    cadence: 'Real-time — respond within 24h of trigger',
    personaServed: 'Anyone who engaged: LinkedIn post likers, website visitors, GTME job posters',
    theologyLine: 'No theology. Signal-driven. Warmer than cold — they already showed interest.',
    prohibitedContent: ['any_spiritual_content', 'fear_based_copy', 'generic_openers', 'pretending_we_dont_know_they_engaged'],
    toneDescription: 'Responsive, specific to the trigger. They did something — acknowledge it. Still peer-to-peer, still one CTA.',
  },
  linkedin_dm: {
    id: 'linkedin_dm',
    displayName: 'LinkedIn DM (Partnerships)',
    owner: 'sagar',
    approvers: ['sagar', 'gwen'],
    theologyFrame: 'peer_warm',
    allowedContentTypes: [],
    cadence: 'As needed — partnership opportunities only',
    personaServed: 'Potential partners, referral sources, strategic allies',
    theologyLine: 'No theology. Relational. Partnership-focused.',
    prohibitedContent: ['any_spiritual_content', 'fear_based_copy', 'cold_outreach_language'],
    toneDescription: 'Casual, direct, human. Like texting a colleague. Short. One question to open conversation.',
  },
  instagram_dm: {
    id: 'instagram_dm',
    displayName: 'Instagram DM (Stub)',
    owner: 'sagar',
    approvers: ['sagar'],
    theologyFrame: 'nature_reverent',
    allowedContentTypes: [],
    cadence: 'Not yet implemented',
    personaServed: 'TBD',
    theologyLine: 'TBD — follows gartiwar/rytual theology lines',
    prohibitedContent: ['jesus_content', 'fear_based_copy'],
    toneDescription: 'TBD — will be casual, visual-first, nature-rooted.',
  },
  imessage_dm: {
    id: 'imessage_dm',
    displayName: 'iMessage DM (Stub)',
    owner: 'sagar',
    approvers: ['sagar'],
    theologyFrame: 'peer_warm',
    allowedContentTypes: [],
    cadence: 'Not yet implemented',
    personaServed: 'Close contacts, warm referrals',
    theologyLine: 'No theology. Personal, direct.',
    prohibitedContent: ['fear_based_copy', 'corporate_language'],
    toneDescription: 'TBD — very personal, matches Sagar\'s texting style.',
  },
  linkedin_posting: {
    id: 'linkedin_posting',
    displayName: 'LinkedIn Content Publishing',
    owner: 'sagar',
    approvers: ['sagar', 'caleb'],
    theologyFrame: 'enterprise_credible',
    allowedContentTypes: ['short_form_post', 'long_form_post', 'carousel', 'data_visualization', 'case_study'],
    cadence: '3+ posts per week across all LinkedIn channels',
    personaServed: 'VP RevOps, Head of Strategy, CCO, investors, potential hires, strategic partners',
    theologyLine: 'Varies by target channel — check target channel theology line. BMA LinkedIn = enterprise credible. Sagar LinkedIn = Vedic systems.',
    prohibitedContent: ['fear_based_copy', 'generic_content', 'synergy', 'leverage_as_verb'],
    toneDescription: 'Varies by target channel. Always: specific, data-driven, never starts with "I", never uses banned words.',
  },
  instagram_posting: {
    id: 'instagram_posting',
    displayName: 'Instagram Content Posting (Stub)',
    owner: 'sagar',
    approvers: ['sagar'],
    theologyFrame: 'nature_reverent',
    allowedContentTypes: ['short_form_video', 'data_visualization'],
    cadence: 'Not yet implemented',
    personaServed: 'Gartiwar and Rytual audience — wellness, psychedelic-adjacent, healthcare founders',
    theologyLine: 'Follows gartiwar/rytual theology — Vedic, nature-rooted, no Jesus content, no hype.',
    prohibitedContent: ['jesus_content', 'hype', 'urgency', 'corporate_language'],
    toneDescription: 'TBD — contemplative, visual, nature-first.',
  },
  x_posting: {
    id: 'x_posting',
    displayName: 'X/Twitter Content Posting (Stub)',
    owner: 'sagar',
    approvers: ['sagar'],
    theologyFrame: 'vedic_systems',
    allowedContentTypes: ['short_form_post'],
    cadence: 'Not yet implemented',
    personaServed: 'Tech/healthcare crossover audience',
    theologyLine: 'Follows Sagar channel theology — Vedic systems, no Jesus content.',
    prohibitedContent: ['jesus_content', 'fear_based_copy'],
    toneDescription: 'TBD — sharp, direct, systems-thinking. Shorter than LinkedIn.',
  },
};

// ============================================================================
// THEOLOGY LINE VALIDATOR
// Returns true if content is ALLOWED on this channel.
// ============================================================================

export function validateTheologyLine(channel: Channel, contentText: string): {
  valid: boolean;
  violations: string[];
} {
  const config = CHANNELS[channel];
  const violations: string[] = [];

  // Check for Jesus content on Sagar's channels
  if (['bma_linkedin', 'gartiwar', 'rytual', 'sagar_linkedin'].includes(channel)) {
    const jesusPatterns = [
      /\bjesus\b/i, /\bchrist\b/i, /\bholy spirit\b/i,
      /\bgospel\b/i, /\bscripture\b/i, /\bbible\b/i,
      /\bprayer\b/i, /\bchurch\b/i, /\bfaith in god\b/i,
    ];
    for (const pattern of jesusPatterns) {
      if (pattern.test(contentText)) {
        violations.push(`Jesus/Christian content detected on ${config.displayName} — theology line violation`);
      }
    }
  }

  // Check for Vedic content on Caleb's channels
  if (channel === 'caleb_personal') {
    const vedicPatterns = [
      /\bveda\b/i, /\bvedic\b/i, /\bdharma\b/i, /\bdharmic\b/i,
      /\bahimsa\b/i, /\bindra.?s net\b/i, /\brig veda\b/i,
      /\bsama veda\b/i, /\byajur veda\b/i,
    ];
    for (const pattern of vedicPatterns) {
      if (pattern.test(contentText)) {
        violations.push(`Vedic/dharmic content detected on ${config.displayName} — theology line violation`);
      }
    }
  }

  // Check for fear-based copy on any channel
  const fearPatterns = [
    /\byou.?re falling behind\b/i, /\byour competitors are\b/i,
    /\bdon.?t miss out\b/i, /\blast chance\b/i,
    /\burgent\b/i, /\bact now\b/i, /\blimited time\b/i,
  ];
  for (const pattern of fearPatterns) {
    if (pattern.test(contentText)) {
      violations.push(`Fear-based copy detected: "${contentText.match(pattern)?.[0]}" — ethical floor violation`);
    }
  }

  return {
    valid: violations.length === 0,
    violations,
  };
}
