/**
 * WRITE SOMETHING DOWN ABOUT SOMEBODY, FROM ANYWHERE.
 *
 * "Patrick just moved to Austin." "Maggie's kid started at Northwestern."
 * Said into iMessage, WhatsApp, a voice prompt or a Claude thread, and landing
 * on the right card in the rolodex.
 *
 * THE NOTE IS WRITTEN DETERMINISTICALLY, AGAINST A CONTACT ID. No model decides
 * who it is about; this tool resolves the person first and refuses if it cannot
 * do so unambiguously. Structured extraction runs afterwards and adds facts on
 * top, but the sentence itself is durable the moment this returns -- which is
 * the whole difference between a memory and an intention.
 *
 * IT DOES NOT CREATE PEOPLE. A note about somebody not in the rolodex is a
 * refusal naming upsert_contact, not a card conjured from a first name. The
 * alternative is an address book that fills with half-people every time an
 * agent mishears a name.
 */

import { z } from "zod";

import { insertContactNote, getContactById, getFactsForContact } from "../../db/store.js";
import { reembedContactSoon } from "../../lib/contact-vectors.js";
import { normalizeSource } from "../../lib/source-trust.js";
import { ok, errorResult } from "./_result.js";
import { ownerFromDid, resolveContactRef } from "./_resolve.js";

/**
 * The store calls, in one place a test can replace.
 *
 * The in-memory SQL fake has no observations table, so a unit test cannot prove
 * a note reached Postgres -- and the routes that write notes already inject this
 * same dependency for the same reason. What a unit test CAN prove, and what
 * actually matters here, is that the note was written against the contact this
 * tool resolved rather than one it guessed at.
 */
export const __deps = {
  insertContactNote,
  getContactById,
  getFactsForContact,
  reembedContactSoon,
};

export const name = "add_contact_note";
export const requiresOwnerDid = true;

export const config = {
  title: "Add a note about a contact",
  description:
    "Record something about a person already in an Amber rolodex — where they moved, what they are working on, what you talked about. Identify them by contactId, phone, email or name; a name matching several people returns those candidates instead of guessing. The note is searchable and appears on their card immediately. This never creates a contact: if they are not in the rolodex yet, call upsert_contact first. `did` defaults to your own account when you authenticate with an API key bound to a DID.",
  inputSchema: {
    did: z.string().min(1).optional()
      .describe("The amber DID of the rolodex owner. Optional — defaults to the DID bound to your API key."),
    contactId: z.string().min(1).optional(),
    phone: z.string().min(1).optional(),
    email: z.string().min(1).optional(),
    name: z.string().min(1).optional()
      .describe("Used only when no phone, email or id is given, and only when it matches exactly one person."),
    note: z.string().min(1).max(4000)
      .describe("What to record, in the words it was said in. Required."),
    source: z.string().optional()
      .describe("Where this came from (e.g. 'imessage', 'whatsapp', 'claude'). Recorded as provenance. Defaults to 'mcp'."),
  },
};

export async function handler({ did, contactId, phone, email, name, note, source }) {
  const owner = await ownerFromDid(did);
  if (!owner.ok) return errorResult(owner.code, owner.message);

  const text = String(note ?? "").trim();
  if (!text) return errorResult("empty_note", "There is nothing to record.");

  if (!contactId && !phone && !email && !name) {
    return errorResult(
      "missing_reference",
      "Give one of contactId, phone, email or name so I know who this is about.",
    );
  }

  const found = await resolveContactRef(owner.ownerId, { contactId, phone, email, name });
  if (!found.ok) {
    if (found.code === "ambiguous") {
      return ok({ did, written: false, reason: "ambiguous", candidates: found.candidates, message: found.message });
    }
    if (found.code === "not_found") {
      return errorResult(
        "contact_not_found",
        "Nobody in this rolodex matches that. Call upsert_contact to add them first — this tool will not invent a card from a name.",
      );
    }
    return errorResult(found.code, found.message);
  }

  const src = normalizeSource(source) || "mcp";
  const noteId = await __deps.insertContactNote({
    ownerId: owner.ownerId,
    noteText: text,
    participantIds: [found.contactId],
    rawNames: [],
    status: "resolved",
    source: src,
    sourceRef: `mcp:${src}:${found.contactId}`,
  }).catch((err) => {
    console.error(`MCP_NOTE_WRITE_FAILED owner=${owner.ownerId} ${err?.message || err}`);
    return null;
  });

  if (noteId == null) {
    return errorResult("note_write_failed", "Could not save that note.");
  }

  // Keep the vector index current so the next semantic question about this
  // person can reach what was just written. Fire-and-forget: the note is
  // already durable, and a failing re-embed must not read as a failed write.
  try {
    __deps.reembedContactSoon(owner.ownerId, found.contactId, () =>
      __deps.getFactsForContact(owner.ownerId, found.contactId),
    );
  } catch {
    /* best-effort by design */
  }

  const contact = await __deps.getContactById(owner.ownerId, found.contactId).catch(() => null);

  return ok({
    did,
    written: true,
    noteId: String(noteId),
    matchedBy: found.matchedBy,
    source: src,
    contact: contact ? { contactId: found.contactId, name: contact.name ?? contact.fullName ?? null } : null,
  });
}
