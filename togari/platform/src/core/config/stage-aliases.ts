/**
 * Sales-team stage colloquialisms mapped to the canonical stage enum.
 * Both the classifier system prompt and the createDeal/updateDeal backstop
 * normalizer reference this — single source of truth.
 */

export const STAGE_ALIASES: Record<string, string> = {
  // closed_lost
  lost: "closed_lost",
  "we lost": "closed_lost",
  "we lost it": "closed_lost",
  "they ghosted": "closed_lost",
  ghosted: "closed_lost",
  "no response": "closed_lost",
  dead: "closed_lost",
  dropped: "closed_lost",
  "gone cold": "closed_lost",
  "didn't work out": "closed_lost",
  "didnt work out": "closed_lost",
  "fell through": "closed_lost",
  "closed lost": "closed_lost",

  // closed_won
  won: "closed_won",
  "we won": "closed_won",
  "they signed": "closed_won",
  signed: "closed_won",
  "closed it": "closed_won",
  "deal done": "closed_won",
  paid: "closed_won",
  live: "closed_won",
  "closed won": "closed_won",

  // closed_engagement (paused / back-burner)
  "back burner": "closed_engagement",
  "back-burner": "closed_engagement",
  pause: "closed_engagement",
  paused: "closed_engagement",
  "on hold": "closed_engagement",
  tabled: "closed_engagement",

  // discovery_scheduled / discovery_complete
  discovery: "discovery_scheduled",
  "discovery booked": "discovery_scheduled",
  "meeting booked": "discovery_scheduled",
  "first call booked": "discovery_scheduled",
  "discovery done": "discovery_complete",
  "discovery complete": "discovery_complete",
  "meeting 2": "discovery_complete",
  "second meeting": "discovery_complete",

  // proposal_sent
  "sent proposal": "proposal_sent",
  "sent sow": "proposal_sent",
  "sow out": "proposal_sent",
  "proposal out": "proposal_sent",
  "proposal sent": "proposal_sent",

  // negotiating
  negotiating: "negotiating",
  negotiation: "negotiating",
  "in negotiation": "negotiating",
  "in progress": "negotiating",
  in_progress: "negotiating",
  redlining: "negotiating",
  "finalizing terms": "negotiating",

  // common CRM synonyms mapped onto the canonical set so callers using a
  // generic pipeline vocabulary (lead/qualified) still resolve.
  lead: "researching",
  "new lead": "researching",
  qualified: "discovery_complete",
  "qualified lead": "discovery_complete",
  sql: "discovery_complete",

  // verbal_commit
  verbal: "verbal_commit",
  "verbal yes": "verbal_commit",
  "they said yes": "verbal_commit",

  // contract_sent
  "contract sent": "contract_sent",
  "contract out": "contract_sent",
  "sent contract": "contract_sent",

  // contacted / conversation_started
  "reached out": "contacted",
  "sent intro": "contacted",
  "first email": "contacted",
  talking: "conversation_started",
  "in convo": "conversation_started",
  "in conversation": "conversation_started",
};

export const VALID_STAGES = [
  "researching",
  "contacted",
  "conversation_started",
  "discovery_scheduled",
  "discovery_complete",
  "proposal_sent",
  "negotiating",
  "verbal_commit",
  "contract_sent",
  "closed_won",
  "closed_lost",
  "closed_engagement",
] as const;

export type Stage = (typeof VALID_STAGES)[number];

export function isValidStage(s: string | null | undefined): s is Stage {
  return !!s && (VALID_STAGES as readonly string[]).includes(s);
}

/**
 * Resolve any stage string — canonical, colloquial, or capitalized — to
 * the canonical enum value. Returns null if unresolvable (caller throws).
 */
export function normalizeStage(raw: string | null | undefined): Stage | null {
  if (!raw) return null;
  const t = raw.trim().toLowerCase();
  if (!t) return null;
  // Already canonical?
  if (isValidStage(t)) return t;
  // Colloquialism?
  const alias = STAGE_ALIASES[t];
  if (alias && isValidStage(alias)) return alias;
  return null;
}
