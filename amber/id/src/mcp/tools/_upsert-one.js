/**
 * WRITING ONE CONTACT, ONCE, IN ONE PLACE.
 *
 * upsert_contact and bulk_upsert_contacts are the same operation at two scales.
 * Writing it twice is how the two drift, and a drift here means a push from Clay
 * dedupes differently depending on whether it arrived alone or in a batch of
 * four hundred. So both call this.
 *
 * Everything that makes the single-contact tool careful lives here: resolve
 * before writing, never merge on a bare name, fill blanks rather than
 * overwrite, and say out loud what was refused.
 */

import {
  mergeContact,
  getContactById,
  updateContactFields,
} from "../../db/store.js";
import { trustOf, TRUST } from "../../lib/source-trust.js";

/** Fields mergeContact does not itself write. Applied after, and only into blanks. */
const EXTRA_FIELDS = ["title", "city", "notes"];

/**
 * An externalId makes a repeat push idempotent, and a caller that omits one
 * still deserves that. But the fallback MUST NOT be the name.
 *
 * Rule 1 of the resolver matches on (source, externalId) and merges without
 * further evidence, because a source restating its own card is authoritative.
 * Synthesizing that key from the name therefore hands two different people who
 * happen to share a name -- from the same source, the likeliest case -- a single
 * identity, and merges them silently. That is precisely the merge the rest of
 * the cascade refuses to make, walked in through the back door.
 *
 * So the key is derived only from something that actually identifies a person:
 * the first email, else the first phone. With neither, there is no key.
 */
export function deriveExternalId(contact) {
  if (contact?.externalId) return contact.externalId;
  const firstEmail = (contact?.emails ?? []).map((e) => String(e).trim()).find(Boolean);
  if (firstEmail) return `email:${firstEmail.toLowerCase()}`;
  const firstPhone = (contact?.phoneNumbers ?? []).map((p) => String(p).trim()).find(Boolean);
  if (firstPhone) return `phone:${firstPhone.replace(/\D/g, "")}`;
  return null;
}

/**
 * Returns { ok: true, action, contactId, appliedAsFill, contact }
 *      or { ok: false, code, message }.
 *
 * Plain objects, not MCP envelopes: the batch tool needs to put four hundred of
 * these in one reply, and an envelope per record is not a reply anybody can read.
 */
export async function upsertOneContact(ownerId, contact, src) {
  if (!contact?.name || !String(contact.name).trim()) {
    return { ok: false, code: "missing_name", message: "contact.name is required." };
  }

  const callerTrust = trustOf(src);

  const merged = await mergeContact(ownerId, {
    source: src,
    externalId: deriveExternalId(contact),
    fullName: contact.name,
    firstName: contact.firstName ?? null,
    lastName: contact.lastName ?? null,
    emails: Array.isArray(contact.emails) ? contact.emails : [],
    phones: Array.isArray(contact.phoneNumbers) ? contact.phoneNumbers : [],
    company: contact.company ?? null,
    linkedinUrl: contact.linkedinUrl ?? null,
    raw: contact,
  }).catch((err) => {
    console.error(`MCP_UPSERT_MERGE_FAILED owner=${ownerId} ${err?.message || err}`);
    return null;
  });

  if (!merged?.contactId) {
    return {
      ok: false,
      code: "upsert_failed",
      message: "Could not resolve or create that contact. A name is required, and the owner must exist.",
    };
  }

  const existing = await getContactById(ownerId, merged.contactId).catch(() => null);

  // Fill only what is blank, unless this caller outranks the field's current
  // owner. Reading the card first is what makes that possible: without it we
  // would be back to overwriting and calling it an update.
  const fill = {};
  for (const field of EXTRA_FIELDS) {
    const incoming = contact[field];
    if (incoming == null || String(incoming).trim() === "") continue;
    const current = existing?.[field];
    const blank = current == null || String(current).trim() === "";
    if (blank || callerTrust >= TRUST.OWNER_STATED) fill[field] = incoming;
  }
  if (contact.sourceHandle && !existing?.sourceHandle) {
    fill.notes = [existing?.notes, `handle: ${contact.sourceHandle}`].filter(Boolean).join("\n");
  }
  if (Object.keys(fill).length > 0) {
    await updateContactFields({ ownerId, contactId: merged.contactId, ...fill }).catch(() => {});
  }

  const saved = await getContactById(ownerId, merged.contactId).catch(() => existing);

  return {
    ok: true,
    action: merged.action,
    contactId: String(merged.contactId),
    // Said out loud so an agent can see it did not get to overwrite, rather than
    // assuming its value landed and pushing it again on the next run.
    appliedAsFill: Object.keys(fill),
    contact: saved,
  };
}
