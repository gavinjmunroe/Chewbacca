/**
 * TURNING WHAT AN AGENT KNOWS INTO A CONTACT ID.
 *
 * An agent reaching Amber from iMessage, WhatsApp, Clay or a voice prompt does
 * not have contact ids. It has "Maggie", or a phone number, or an email. This
 * turns those into one row, and -- the important half -- refuses to turn them
 * into a guess.
 *
 * THE RULE IS THE SAME ONE THE RESOLVER USES ON WRITES. A phone or an email
 * identifies a person. A bare name does not: two Maggies are two people, and an
 * agent that acts on the wrong one writes somebody's note onto a stranger's
 * card. So a name that matches more than one contact comes back as `ambiguous`
 * with the candidates listed, and the agent has to ask. That is a worse
 * experience than guessing exactly once, and a better one every time after.
 */

import {
  getContactById,
  getContactByPhone,
  searchContactsByName,
  resolveAmberIdByPrivyDid,
} from "../../db/store.js";
import { resolveContactIdentity } from "../../db/contact-identity.js";

/** Map a Privy DID to the amber owner id every store call is scoped by. */
export async function ownerFromDid(did) {
  if (!did) return { ok: false, code: "missing_did", message:
    "No `did` was provided and your API key is not bound to an owner DID. Pass `did`, or map a DID to your key (named-key `did` field or DEFAULT_OWNER_DID)." };
  const ownerId = await resolveAmberIdByPrivyDid(did).catch(() => null);
  if (!ownerId) return { ok: false, code: "owner_not_found", message:
    "This DID has not been linked to an amber account yet. It will resolve after the user authenticates." };
  return { ok: true, ownerId };
}

/**
 * Find one existing contact. Never creates. Returns one of:
 *   { ok: true, contactId, matchedBy }
 *   { ok: false, code: "ambiguous", candidates: [...] }
 *   { ok: false, code: "not_found" }
 */
export async function resolveContactRef(ownerId, { contactId, phone, email, name }) {
  if (contactId) {
    const row = await getContactById(ownerId, contactId).catch(() => null);
    return row
      ? { ok: true, contactId: String(row.id ?? contactId), matchedBy: "id" }
      : { ok: false, code: "not_found", message: "No contact with that id in this account." };
  }

  // A phone is an identifier, so it decides on its own.
  if (phone) {
    const row = await getContactByPhone(ownerId, phone).catch(() => null);
    if (row?.id) return { ok: true, contactId: String(row.id), matchedBy: "phone" };
  }

  // So is an email. resolveContactIdentity is the same read the write path uses,
  // which is what keeps "who does this belong to" one answer rather than two.
  if (email) {
    const hit = await resolveContactIdentity(ownerId, {
      emails: [email],
      phones: [],
      fullName: name ?? null,
    }).catch(() => null);
    if (hit?.contactId) return { ok: true, contactId: String(hit.contactId), matchedBy: "email" };
  }

  if (name) {
    const matches = await searchContactsByName(ownerId, name, 8).catch(() => []);
    if (matches.length === 1) {
      return { ok: true, contactId: String(matches[0].id), matchedBy: "name" };
    }
    if (matches.length > 1) {
      return {
        ok: false,
        code: "ambiguous",
        message:
          `"${name}" matches ${matches.length} contacts. Ask which one, then call again with contactId.`,
        candidates: matches.map((m) => ({
          contactId: String(m.id),
          name: m.full_name ?? m.fullName ?? m.name ?? null,
          company: m.company ?? null,
          title: m.title ?? null,
        })),
      };
    }
  }

  return {
    ok: false,
    code: "not_found",
    message:
      "Nobody in this account matches that. Pass a contactId, a phone, an email, or a name that is already in the rolodex.",
  };
}
