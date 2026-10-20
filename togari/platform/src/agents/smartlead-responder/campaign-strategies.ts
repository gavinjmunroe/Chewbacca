/**
 * @togari/admin — Campaign strategy registry
 *
 * Maps campaign names to specific response strategies.
 * Currently supports the job posting placement campaign with
 * SWE/BizOps LinkedIn profile attachments.
 */

export interface CampaignStrategy {
  name: string;
  /**
   * Replybot client(s) this strategy belongs to. A single id, a list of
   * ids (BMA runs the placement campaign from two personas), or
   * undefined for every client.
   */
  clientId?: string | string[];
  campaignNameMatchers: string[]; // case-insensitive substring matches
  attachments?: {
    type: 'linkedin_profiles';
    tracks: Record<string, string[]>; // e.g., { swe: [...urls], bizops: [...urls] }
  };
  classifierInstructions?: string; // extra guidance for Claude when this strategy is active
}

export const STRATEGIES: CampaignStrategy[] = [
  {
    name: 'job_posting_placement',
    // Both BMA personas run the placement campaign — Sagar (`amber`)
    // and Maggie (`bma`).
    clientId: ['amber', 'bma'],
    campaignNameMatchers: ['job posting', 'job postings'],
    attachments: {
      type: 'linkedin_profiles',
      tracks: {
        swe: [
          'https://www.linkedin.com/in/rajathsalegame/',
          'https://www.linkedin.com/in/michaelhuang2/',
          'https://www.linkedin.com/in/tinreydu/',
        ],
        bizops: [
          'https://www.linkedin.com/in/lagan-mongia/',
          'https://www.linkedin.com/in/matthewkiiim/',
        ],
      },
    },
    classifierInstructions:
      `This is a recruiting/placement outbound campaign. The lead is a hiring manager, recruiter, or job poster. Classify the role they are hiring for as "swe" (software engineering, devops, ML engineering, any technical IC or technical manager role), "bizops" (operations, strategy, consulting, business analyst, program/project management, any non-technical business role), or "ambiguous" when signals conflict (e.g., Technical PM, Solutions Engineer with ambiguous framing, or the outbound mentions no specific role).

CRITICAL MESSAGING RULE: The LinkedIn profiles you attach are PAST PLACEMENTS — professionals Blue Modern Advisory has successfully placed at other companies. They are NOT currently available. They are proof of the caliber of talent in our network. Frame them as credibility/track record, never as candidate suggestions.

Correct framing examples:
- 'Here are a few people we've placed recently — gives you a sense of the caliber in our network:'
- 'A snapshot of recent placements for context on who we work with:'
- 'These are folks we've placed into similar roles — not available, just to show the bar:'

WRONG framing (never use): 'people who would be a strong fit,' 'candidates for your role,' 'available talent,' 'folks who could fill your role,' anything implying these specific people are options for the lead's open role.

The goal is to earn a follow-up call by demonstrating track record, not to pitch specific people.`,
  },
];

/** True when the strategy is scoped to this client (or to every client). */
function appliesToClient(strategy: CampaignStrategy, clientId: string): boolean {
  if (!strategy.clientId) return true;
  return Array.isArray(strategy.clientId)
    ? strategy.clientId.includes(clientId)
    : strategy.clientId === clientId;
}

export function resolveStrategy(campaignName: string, clientId = 'amber'): CampaignStrategy | null {
  const lower = (campaignName || '').toLowerCase();
  return (
    STRATEGIES.find(
      (s) =>
        appliesToClient(s, clientId) &&
        s.campaignNameMatchers.some((m) => lower.includes(m.toLowerCase())),
    ) || null
  );
}
