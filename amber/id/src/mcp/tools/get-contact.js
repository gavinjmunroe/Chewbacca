/**
 * READ ONE CONTACT CARD, FROM ANYWHERE.
 *
 * The other half of upsert_contact. An agent in iMessage, WhatsApp, Claude or a
 * voice prompt can put people INTO the rolodex; this is how it gets them back
 * out -- "what's Maggie's number", "where does Patrick work now" -- without the
 * person having to open the app.
 *
 * IT NEVER CREATES. Every other path into contacts is a write that resolves or
 * inserts. This one resolves or says no. An agent asking about somebody who is
 * not in the rolodex must be told that, not handed a blank card that then exists.
 *
 * IT REFUSES TO GUESS BETWEEN TWO PEOPLE. A name matching two contacts comes
 * back as `ambiguous` with both, because an agent that picks one is reading out
 * the wrong person's phone number.
 */

import { z } from "zod";

import { getContactById, getFactsForContact } from "../../db/store.js";
import { ok, errorResult } from "./_result.js";
import { ownerFromDid, resolveContactRef } from "./_resolve.js";

export const name = "get_contact";
export const requiresOwnerDid = true;

export const config = {
  title: "Get a contact card",
  description:
    "Look up one person already in an Amber rolodex and return their card: names, phones, emails, company, title, links, and the notes recorded about them. Identify them by contactId, phone, email or name. A name matching several people returns those candidates instead of guessing. This never creates a contact -- use upsert_contact for that. `did` defaults to your own account when you authenticate with an API key bound to a DID.",
  inputSchema: {
    did: z.string().min(1).optional()
      .describe("The amber DID of the rolodex owner. Optional — defaults to the DID bound to your API key."),
    contactId: z.string().min(1).optional().describe("Exact contact id, if you have one."),
    phone: z.string().min(1).optional().describe("Any format; matched on digits."),
    email: z.string().min(1).optional(),
    name: z.string().min(1).optional()
      .describe("Used only when no phone, email or id is given, and only when it matches exactly one person."),
    includeNotes: z.boolean().optional()
      .describe("Include the notes and facts recorded about this person. Default true."),
  },
};

export async function handler({ did, contactId, phone, email, name, includeNotes = true }) {
  const owner = await ownerFromDid(did);
  if (!owner.ok) return errorResult(owner.code, owner.message);

  if (!contactId && !phone && !email && !name) {
    return errorResult(
      "missing_reference",
      "Give one of contactId, phone, email or name so I know who you mean.",
    );
  }

  const found = await resolveContactRef(owner.ownerId, { contactId, phone, email, name });
  if (!found.ok) {
    if (found.code === "ambiguous") {
      // Not an error the agent should retry blindly: the candidates are the
      // answer, and the next call should carry a contactId from this list.
      return ok({ did, resolved: false, reason: "ambiguous", candidates: found.candidates, message: found.message });
    }
    return errorResult(found.code, found.message);
  }

  const contact = await getContactById(owner.ownerId, found.contactId).catch(() => null);
  if (!contact) {
    return errorResult("not_found", "That contact existed a moment ago and does not now.");
  }

  let notes = [];
  if (includeNotes) {
    // Best-effort: a card without its notes is still the answer to "what is
    // her number", and a failing notes read must not withhold it.
    notes = await getFactsForContact(owner.ownerId, found.contactId).catch(() => []);
  }

  return ok({
    did,
    resolved: true,
    matchedBy: found.matchedBy,
    contact,
    notes,
  });
}
