import type { ContactCadence } from './contactProvenance';
import { normalizeContactFacts, type ContactFact } from './contactContext';
import { callMedhaId, type MedhaIdResult } from './medhaId';
import { bustContactsCache } from './network';
// Type-only import: erased at compile time, so this does not create a runtime
// import cycle with lib/enrichment.ts (which imports MedhaContactFull's type).
import type { ContactEnrichment, EnrichmentCandidate, EnrichmentStatus } from './enrichment';

export type { ContactFact } from './contactContext';

export type MedhaContactFull = {
  id: string;
  name?: string;
  /** Source-provided profile image, when returned by the contact API. */
  avatarUrl?: string | null;
  firstName?: string;
  lastName?: string;
  phoneNumbers?: string[];
  phone?: string;
  emails?: string[];
  email?: string;
  company?: string;
  title?: string;
  city?: string;
  notes?: string;
  source?: string;
  /**
   * WHO THIS CARD IS ON AMBER, once the two have been reconciled.
   *
   * The server has returned this for a while and the app ignored it, resolving
   * the same question with a second round trip by phone -- which is why the
   * card sat there for a beat before admitting it knew somebody, and why a card
   * saved with only an email never admitted it at all.
   *
   * This is the stored link (contacts.linked_amber_id), written when a
   * connection is established. It is the authoritative answer to "is this card
   * that account", and it is the same field circles, note sharing and the DM
   * candidate list read.
   */
  linkedAmberId?: string | null;
  // Enrichment (F6): populated by the server once contacts are enriched.
  linkedinUrl?: string | null;
  enrichmentStatus?: EnrichmentStatus | null;
  enrichment?: ContactEnrichment | null;
  enrichmentCandidates?: EnrichmentCandidate[] | null;
};

export function getContact(
  contactId: string,
): Promise<MedhaIdResult<{ contact: MedhaContactFull; cadence?: ContactCadence | null }>> {
  return callMedhaId<{ contact: MedhaContactFull; cadence?: ContactCadence | null }>({
    path: `/v1/me/contacts/${encodeURIComponent(contactId)}`,
    method: 'GET',
    requireAuth: true,
  });
}

export type ContactPatch = {
  name?: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  email?: string;
  company?: string;
  title?: string;
  city?: string;
  notes?: string;
};

export function updateContact(
  contactId: string,
  patch: ContactPatch,
): Promise<MedhaIdResult<{ contact: MedhaContactFull }>> {
  return callMedhaId<{ contact: MedhaContactFull }>({
    path: `/v1/me/contacts/${encodeURIComponent(contactId)}`,
    method: 'PATCH',
    body: patch,
    requireAuth: true,
  });
}

/**
 * Delete a contact and everything derived from them.
 *
 * The server does the cascade — facts, notes, experiences, name memories, the
 * embedding, identity keys, favorites, circle memberships, contact-scoped shares
 * and the Pinecone vector — in one transaction. `rows` is the total number of
 * database rows removed, which is worth surfacing: "Deleted Raj and 34 records"
 * tells the user something a bare "Deleted" does not.
 */
export function deleteContact(
  contactId: string,
): Promise<MedhaIdResult<{ deleted: boolean; rows: number }>> {
  return callMedhaId<{ deleted: boolean; rows: number }>({
    path: `/v1/me/contacts/${encodeURIComponent(contactId)}`,
    method: 'DELETE',
    requireAuth: true,
  });
}

export async function getContactFacts(
  contactId: string,
): Promise<MedhaIdResult<{ facts: ContactFact[] }>> {
  const result = await callMedhaId<{ facts: unknown }>({
    path: `/v1/me/contacts/${encodeURIComponent(contactId)}/facts`,
    method: 'GET',
    requireAuth: true,
  });
  return result.ok
    ? { ...result, data: { facts: normalizeContactFacts(result.data.facts) } }
    : result;
}

// ── Recently mentioned ────────────────────────────────────────────────────────
// Who you have been TALKING ABOUT, newest first — not who you last messaged.
// A person lands here by being a participant on a captured note or experience,
// which is what a voice note becomes after fact-capture runs.
export type MentionedContact = {
  contactId: string;
  name: string | null;
  company: string | null;
  title: string | null;
  kind: string | null;
  /** One trimmed line of what was actually said. */
  excerpt: string | null;
  /** ISO date, or null when the row carries no timestamp. */
  mentionedAt: string | null;
  mentionCount: number;
};

export function listRecentlyMentioned(
  limit = 10,
): Promise<MedhaIdResult<{ contacts: MentionedContact[] }>> {
  return callMedhaId<{ contacts: MentionedContact[] }>({
    path: `/v1/me/contacts/recently-mentioned?limit=${encodeURIComponent(String(limit))}`,
    method: 'GET',
    requireAuth: true,
  });
}

// ── Saving someone found on the open web ──────────────────────────────────────
// Not `/v1/me/contacts/create`: that route requires a phone, email or Amber ID, and
// a person found on LinkedIn has none of them. Their profile URL is the identifier
// instead — unique, checkable, and how you'd find them again.
export function createContactFromWeb(input: {
  name: string;
  profileUrl: string;
  title?: string | null;
  company?: string | null;
  /** What the search card showed under them. The server passes it to extraction so
   *  a profile page that blocks crawlers still has something to read. */
  snippet?: string | null;
  tags?: string[];
  note?: string;
}): Promise<
  MedhaIdResult<{
    contactId: string;
    tags: string[];
    /** Which link columns the save filled -- ['linkedin_url'] for a LinkedIn save. */
    links?: string[];
    /** True when the server is reading their profile page in the background to fill
     *  in title, company, city, email and the rest. The card is complete a second or
     *  two AFTER this resolves, not at the moment it resolves. */
    enriching?: boolean;
  }>
> {
  const tags = (input.tags ?? []).map((t) => t.trim()).filter(Boolean);
  const note = (input.note ?? '').trim();
  const snippet = (input.snippet ?? '').trim();
  return callMedhaId<{
    contactId: string;
    tags: string[];
    links?: string[];
    enriching?: boolean;
  }>({
    path: '/v1/me/contacts/from-web',
    method: 'POST',
    requireAuth: true,
    body: {
      name: input.name.trim(),
      profileUrl: input.profileUrl.trim(),
      ...(input.title ? { title: input.title } : {}),
      ...(input.company ? { company: input.company } : {}),
      ...(snippet ? { snippet: snippet.slice(0, 2000) } : {}),
      ...(tags.length > 0 ? { tags } : {}),
      ...(note ? { note } : {}),
    },
    tag: 'POST /v1/me/contacts/from-web',
  }).then((res) => {
    if (res.ok) {
      // The contact list is memoized for five minutes, so without this the person
      // you just saved is missing from Contacts and from search until the TTL
      // lapses -- which reads as the save having silently failed.
      bustContactsCache();
      // The background fill lands a beat later. One more bust means the NEXT read
      // sees the filled card (title, company, city, links) instead of the bare
      // name that got cached a second after the save.
      if (res.data?.enriching) setTimeout(bustContactsCache, 8000);
    }
    return res;
  });
}

export function getContactDetails(
  contactId: string,
): Promise<MedhaIdResult<{ contactId: string; details: Record<string, unknown> }>> {
  return callMedhaId({
    path: `/v1/me/contacts/${encodeURIComponent(contactId)}/details`,
    requireAuth: true,
  });
}
