/**
 * @togari/bma-content/agents/top-of-funnel/shared/meeting-booking
 * Internal library — NOT an MCP tool
 * Wraps MOF meeting-router for booking meetings from positive channel signals
 * Routes: Kevin → Mike → Maggie (hard rule)
 */

import { MEETING_ROUTING_ORDER } from '../../../config/team';

export interface MeetingRequest {
  channel: string;
  companyName: string;
  contactName: string;
  contactTitle: string;
  contactEmail: string;
  persona: string;
  signalSummary: string;
  urgency: 'immediate' | 'this_week' | 'next_week';
  partnershipAngle?: boolean;
}

/**
 * Build a meeting booking prompt that delegates to MOF meeting-router.
 * This ensures all positive signals from any channel route through
 * the same Kevin → Mike → Maggie pipeline.
 */
function buildMeetingBookingPrompt(request: MeetingRequest): string {
  const routingOrder = MEETING_ROUTING_ORDER.join(' → ');
  const gwenFlag = request.partnershipAngle
    ? '\nGWEN FLAG: Partnership/referral angle detected. Flag for Gwen review.'
    : '';

  return `You are the Meeting Booking subagent for the ${request.channel} channel in the BMA GTM OS.

A positive signal has been detected. Route this to a meeting.

PROSPECT:
Company: ${request.companyName}
Contact: ${request.contactName}, ${request.contactTitle}
Email: ${request.contactEmail}
Persona: ${request.persona}

SIGNAL SUMMARY:
${request.signalSummary}

URGENCY: ${request.urgency}

ROUTING ORDER (HARD RULE): ${routingOrder}
1. Kevin Kong — always first
2. Mike — when Kevin unavailable
3. Maggie — when Mike unavailable
${gwenFlag}

INSTRUCTIONS:
1. Use the MOF meeting-router tool (route_meeting) to check Kevin's availability
2. If Kevin is unavailable, check Mike, then Maggie
3. Generate a pre-meeting brief using generate_meeting_brief
4. Return the meeting details including:
   - Assigned to (who got the meeting)
   - Proposed time slots
   - Pre-meeting brief
   - Channel this came from (${request.channel})

Return JSON with meetingAssignment, proposedSlots, and meetingBrief.`;
}

export const meetingBooking = {
  buildMeetingBookingPrompt,
};
