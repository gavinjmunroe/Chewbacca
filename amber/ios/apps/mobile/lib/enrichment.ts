import { callMedhaId, type MedhaIdResult } from './medhaId';
import { type MedhaContactFull } from './contacts';

// Enrichment (F6) REST surface on medha-id. Same authed transport + typed {ok}
// envelope as lib/contacts.ts — callers branch on `res.ok` the same way.

export type ContactSummary = {
  total: number;
  bySource: Record<string, number>;
  byStatus: Record<string, number>;
  /**
   * Duplicate contacts the server collapsed into one.
   *
   * Optional because /v1/me/contacts/summary is not known to return it yet —
   * this type is hand-written against the live payload, so an absent field just
   * reads as undefined. The contacts strip renders the "N duplicates merged"
   * clause only when a real number arrives and omits it otherwise, which is why
   * this can be added ahead of the server without showing a wrong count.
   *
   * Deliberately NOT derived from the sync response's `updated`: that counts
   * idempotent re-upserts of contacts already stored from a previous sync, which
   * is a different thing from two contacts merging into one.
   */
  merged?: number;
};

export type EnrichTally = {
  enriched: number;
  needsResolution: number;
  failed: number;
  skipped: number;
};

// A ranked disambiguation candidate for a contact, matching the stored shape.
export type EnrichmentCandidate = {
  name: string;
  linkedinUrl: string;
  title: string | null;
  company: string | null;
  city: string | null;
  score: number;
  signals: string[];
};

// The resolved professional enrichment persisted on a contact.
export type ContactEnrichment = {
  clayFields?: Partial<import('./contactExport').ContactExport>;
  linkedinUrl?: string | null;
  title?: string | null;
  company?: string | null;
  industry?: string | null;
  tags?: string[] | null;
};

export type EnrichmentStatus = 'pending' | 'resolved' | 'ambiguous' | 'failed' | 'none';

export type EnrichResult = {
  contactId: string;
  status: string;
  candidates?: EnrichmentCandidate[];
};

// One of: pick a ranked candidate by index, pick by an explicit LinkedIn URL,
// or explicitly resolve to "none of these".
export type ResolveChoice =
  | { candidateIndex: number }
  | { candidateLinkedinUrl: string }
  | { none: true };

export function getContactsSummary(): Promise<MedhaIdResult<ContactSummary>> {
  return callMedhaId<ContactSummary>({
    path: '/v1/me/contacts/summary',
    method: 'GET',
    requireAuth: true,
  });
}

export function enrichContacts(
  contactIds: string[],
): Promise<MedhaIdResult<{ results: EnrichResult[]; tally: EnrichTally }>> {
  return callMedhaId<{ results: EnrichResult[]; tally: EnrichTally }>({
    path: '/v1/me/contacts/enrich',
    method: 'POST',
    body: { contactIds },
    requireAuth: true,
  });
}

export function resolveEnrichment(
  contactId: string,
  choice: ResolveChoice,
): Promise<MedhaIdResult<{ contact: MedhaContactFull }>> {
  return callMedhaId<{ contact: MedhaContactFull }>({
    path: `/v1/me/contacts/${encodeURIComponent(contactId)}/enrichment/resolve`,
    method: 'POST',
    body: choice,
    requireAuth: true,
  });
}
