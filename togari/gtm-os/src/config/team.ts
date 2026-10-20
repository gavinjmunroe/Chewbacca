/**
 * @togari/bma-content/config/team
 * Team member profiles, routing order, and voice guidelines
 * from TEAM_PERSONAS.md and CLAUDE_OS.md
 */

import type { TeamMember, MeetingRecipient, Channel, TheologyFrame, TeamRole } from '../schemas/enums';

// ============================================================================
// TEAM MEMBER PROFILES
// ============================================================================

export interface TeamMemberProfile {
  id: TeamMember;
  fullName: string;
  teamRole: TeamRole;
  voice: string;
  story: string;
  whatDrives: string;
  outboundStyle: string;
  channels: Channel[];
  theologyFrame: TheologyFrame;
  neverDo: string[];
  role: string;
}

export const TEAM_PROFILES: Record<TeamMember, TeamMemberProfile> = {
  sagar: {
    id: 'sagar',
    fullName: 'Sagar Tiwari',
    teamRole: 'strategist',
    voice: 'Precise, warm, slightly philosophical, never pretentious.',
    story: 'Grew up between worlds. Father taught independence so completely that being kicked out became a lesson. Stacked shelves at Walgreens to be self-sufficient. Returned not bitter but clearer.',
    whatDrives: 'Making the world fair. Equal opportunity. Compassion as infrastructure. Believes the Vedas hold patterns more durable than any modern framework.',
    outboundStyle: 'Always leads with something specific he noticed. Never sounds scripted. References real data, real companies, real moves. Warmth is in the specificity.',
    channels: ['gartiwar', 'bma_linkedin', 'rytual', 'sagar_linkedin'],
    theologyFrame: 'vedic_systems',
    neverDo: ['Jesus content', 'Personal spiritual declarations before he is certain', 'Fear-based copy', 'Generic anything'],
    role: 'Founder, strategist, healthcare data expert.',
  },
  caleb: {
    id: 'caleb',
    fullName: 'Caleb Newton',
    teamRole: 'strategist',
    voice: 'Direct, casual, technically precise, genuinely curious, honest to a fault.',
    story: 'USC freshman at Iovine & Young. Simultaneously running a personal AI OS, working as a software engineer, building prayer tools for Christians, and trying to become an AI/ML engineer.',
    whatDrives: 'Helping people flourish through technology. Building things that work, that last, that help humans do something hard.',
    outboundStyle: 'Crisp. No fluff. Technical credibility without jargon overload. Honest about what we can and cannot do.',
    channels: ['caleb_personal'],
    theologyFrame: 'jesus_service',
    neverDo: ['Vedic framing in his own voice', 'Content on Sagar\'s channels'],
    role: 'GTM machine owner. Owns Clay, Claude logic, routing, measurement, GTM engineer oversight.',
  },
  gwen: {
    id: 'gwen',
    fullName: 'Gwen',
    teamRole: 'strategist',
    voice: 'Warm, genuine, relational. She does not close — she opens.',
    story: 'Follows Jesus as a way of being. Foot-washing, leper-touching, greatest-among-you-is-servant energy.',
    whatDrives: 'Relationships that matter. Partnerships built on genuine mutual benefit, not extraction.',
    outboundStyle: 'Always personalizes, always acknowledges the human. Never transactional in tone even when transactional in purpose. Follows up because she actually cares.',
    channels: [],
    theologyFrame: 'peer_warm',
    neverDo: ['Transactional language', 'CRM-driven follow-up without personalization'],
    role: 'Client-facing and partnership-facing. Receives briefs when partnership or referral angle exists.',
  },
  drew: {
    id: 'drew',
    fullName: 'Drew',
    teamRole: 'strategist',
    voice: 'Warm, grounded, relational. Strategic thinker with genuine care.',
    story: 'Brings relational intelligence to GTM. Partners naturally with Gwen on partnership motions.',
    whatDrives: 'Building meaningful business relationships that create real value for both sides.',
    outboundStyle: 'Relational, thoughtful, always personalizes. Strategic about who to partner with and why.',
    channels: [],
    theologyFrame: 'peer_warm',
    neverDo: ['Transactional language', 'Generic outreach'],
    role: 'GTM Strategist. Research, prep, messaging, system building. Partners with Gwen on BD.',
  },
  kevin: {
    id: 'kevin',
    fullName: 'Kevin Kong',
    teamRole: 'strategist',
    voice: 'Steady, reliable, sharp. Does not over-promise. Shows up and delivers.',
    story: 'Bound by loyalty and family. Motivated by providing for the people he loves.',
    whatDrives: 'Providing for the people he loves. Doing good work because good work is how you provide.',
    outboundStyle: 'Prepared. Asks the right questions. Does not oversell — lets the data speak. Follows through on every commitment.',
    channels: ['kevin_linkedin'],
    theologyFrame: 'peer_warm',
    neverDo: ['Over-promising', 'Showing up unprepared'],
    role: 'Primary meeting recipient for all booked Togari meetings.',
  },
  mike: {
    id: 'mike',
    fullName: 'Mike',
    teamRole: 'engineer',
    voice: 'Loyal, execution-focused, no drama.',
    story: 'Bound by loyalty and family. Motivated by the people depending on him.',
    whatDrives: 'Family, loyalty, provision.',
    outboundStyle: 'Dependable follow-through.',
    channels: [],
    theologyFrame: 'peer_warm',
    neverDo: [],
    role: 'Secondary meeting recipient when Kevin is unavailable.',
  },
  maggie: {
    id: 'maggie',
    fullName: 'Maggie',
    teamRole: 'engineer',
    voice: 'Loyal, execution-focused, dependable.',
    story: 'Same core motivation — family, loyalty, provision.',
    whatDrives: 'Family, loyalty, provision.',
    outboundStyle: 'Shows up because showing up is how you take care of people.',
    channels: [],
    theologyFrame: 'peer_warm',
    neverDo: [],
    role: 'Third meeting recipient.',
  },
  karthik: {
    id: 'karthik',
    fullName: 'Karthik',
    teamRole: 'engineer',
    voice: 'Systems thinker, product-oriented, opinionated in the best way.',
    story: 'Understands many-to-many communication — multiple voices as a symphony. His product opinions are architectural convictions.',
    whatDrives: 'Building systems where humans can coordinate at scale without losing their individual voice.',
    outboundStyle: 'Precise about what he means. Challenges assumptions. Brings product instincts into GTM conversations.',
    channels: [],
    theologyFrame: 'enterprise_credible',
    neverDo: [],
    role: 'Product and coordination advisor. Bridge between Amber consumer product and enterprise middle-of-funnel.',
  },
};

// ============================================================================
// MEETING ROUTING (hard rule)
// Mike and Maggie TRIAGE all meetings to Kevin.
// Kevin is the closer. Mike and Maggie are engineers who triage.
// ============================================================================

export const MEETING_ROUTING_ORDER: MeetingRecipient[] = ['kevin', 'mike', 'maggie'];
export const MEETING_TRIAGE_NOTE = 'Mike and Maggie triage all meetings to Kevin. They do NOT run meetings — they route them.';

// ============================================================================
// TEAM ROLE GROUPS
// ============================================================================

export const STRATEGISTS: TeamMember[] = ['kevin', 'sagar', 'drew'];
export const ENGINEERS: TeamMember[] = ['mike', 'maggie', 'karthik'];

// ============================================================================
// DAILY PIPELINE DIGEST RECIPIENTS
// ============================================================================

export const DAILY_DIGEST_RECIPIENTS: TeamMember[] = ['kevin', 'mike', 'maggie', 'gwen', 'sagar', 'caleb'];

// ============================================================================
// CONSCIENCE REPORT RECIPIENTS (advisory only)
// ============================================================================

export const CONSCIENCE_REPORT_RECIPIENTS: TeamMember[] = ['sagar', 'caleb'];
