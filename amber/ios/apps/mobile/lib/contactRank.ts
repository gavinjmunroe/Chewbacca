import { callMedhaId, type MedhaIdResult } from './medhaId';

/**
 * WHERE ONE PERSON STANDS — warmth, cadence, and the six dimensions of health.
 *
 * The rollup on the server has been computing all of this for a while
 * (contact_scores, contact_interaction_stats, contact_dimension_state) and no
 * surface in the app could read a single row of it for a single person. The
 * ordering of the People list was the only visible consequence, so "why is
 * Amber ranking her above him" had no answer anywhere in the product.
 *
 * `computedAt: null` means the rollup has never reached this contact -- a
 * person added five minutes ago legitimately has nothing yet, and the honest
 * thing to render is "not enough yet" rather than a confident 0%, which reads
 * as a judgment rather than an absence.
 */
export type ContactDimension = {
  code: string;
  label: string;
  /** 0..1, saturating. */
  score: number;
  observations: number;
  lastSignalAt: string | null;
};

export type ContactRank = {
  contactId: string;
  name: string | null;
  /** 0..1 overall. Warmth, evidence and completeness, weighted server-side. */
  score: number;
  /** 0..1 recency and cadence only. */
  warmth: number;
  /** 0..1 how much of their card is filled in. */
  completeness: number;
  observations: number;
  lastInteractionAt: string | null;
  firstInteractionAt: string | null;
  interactions: { d30: number; d90: number; all: number };
  dimensions: ContactDimension[];
  /** null until the rollup has run for this owner. */
  computedAt: string | null;
};

export function getContactRank(contactId: string): Promise<MedhaIdResult<ContactRank>> {
  return callMedhaId<ContactRank>({
    path: `/v1/me/contacts/${encodeURIComponent(contactId)}/rank`,
    method: 'GET',
    requireAuth: true,
    tag: 'GET contact rank',
  });
}
