/**
 * @togari/bma-content/agents/top-of-funnel/shared/sequencing
 * Internal library — NOT an MCP tool
 * Multi-step sequence builder with timing and reply branching
 * Used by channel agents' create_sequence tools
 */

export interface SequenceStep {
  stepNumber: number;
  action: string;
  channel: string;
  delayDays: number;
  content?: string;
  condition?: string;
  branchOnReply?: {
    positive: string;
    objection: string;
    no_reply: string;
  };
}

export interface SequenceConfig {
  channel: string;
  persona: string;
  companyName: string;
  contactName: string;
  totalSteps: number;
  cadenceDays: number[];
}

/**
 * Build a sequence prompt for Claude to generate a multi-step outreach sequence.
 */
function buildSequencePrompt(config: SequenceConfig): string {
  const channelTemplates: Record<string, string> = {
    cold_email: `COLD EMAIL SEQUENCE (outbound, high volume):
Step 1 (Day 0): Initial cold email — signal-driven, one artifact offer
Step 2 (Day 3): Follow-up if no reply — different angle, same artifact
Step 3 (Day 7): Break-up email — "No worries if not a fit, here's the artifact anyway"
Step 4 (Day 14): LinkedIn connection request with note referencing the email

REPLY BRANCHING:
- Positive interest → Route to meeting-booking
- Objection → Acknowledge, offer different artifact, one more touch
- Wrong person → Ask for referral, mark original contact
- Not now → Add to nurture list, revisit in 90 days
- Unsubscribe → Immediate removal, no further contact`,

    warm_email: `WARM EMAIL SEQUENCE (inbound signal response):
Step 1 (Day 0): Immediate response to trigger — acknowledge what they did, offer artifact
Step 2 (Day 2): If no reply — share a relevant insight related to their trigger
Step 3 (Day 5): Follow-up with social proof — similar company that benefited
Step 4 (Day 10): Soft close — "The artifact is ready whenever you want it"

REPLY BRANCHING:
- Positive interest → Route to meeting-booking immediately (warm = faster)
- Objection → Offer lighter touch (just the data, no meeting)
- No reply after all steps → Move to cold nurture`,

    linkedin_dm: `LINKEDIN DM SEQUENCE (partnerships):
Step 1 (Day 0): Connection request with short note
Step 2 (Day 2): After accepted — DM with partnership angle
Step 3 (Day 7): Share relevant content, tag in post
Step 4 (Day 14): Direct ask for partnership conversation`,

    linkedin_posting: `LINKEDIN POSTING SEQUENCE (content calendar):
Step 1 (Week 1): Thought leadership post — establish the problem
Step 2 (Week 1): Carousel — framework or data visualization
Step 3 (Week 2): Case study or before/after post
Step 4 (Week 2): Engagement post — question or poll
Step 5 (Week 3): Signal harvest post — what we're seeing in the data`,

    default: `GENERIC SEQUENCE:
Step 1 (Day 0): Initial outreach
Step 2 (Day 3): Follow-up
Step 3 (Day 7): Final touch`,
  };

  const template = channelTemplates[config.channel] || channelTemplates.default;

  return `You are the Sequencing engine for the ${config.channel} channel in the BMA GTM OS.

TARGET:
Company: ${config.companyName}
Contact: ${config.contactName}
Persona: ${config.persona}

SEQUENCE TEMPLATE:
${template}

Generate a ${config.totalSteps}-step sequence for this prospect.
For each step, specify:
1. stepNumber
2. action (what to do)
3. channel (which channel this step uses)
4. delayDays (days after previous step)
5. content (draft content or content brief)
6. condition (what triggers this step)
7. branchOnReply (what to do if they reply at this step)

Return JSON matching the Sequence schema (array of SequenceStep objects).`;
}

export const sequencing = {
  buildSequencePrompt,
};
