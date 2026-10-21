import { z } from "zod";

import { resolveAmberIdByPrivyDid } from "../../db/store.js";
import { normalizeSource } from "../../lib/source-trust.js";
import { upsertOneContact } from "./_upsert-one.js";

export const name = "upsert_contact";

// Defaults the `did` arg to the API-key-bound owner DID when omitted (see
// createMcpServer). A key-holder can call this without knowing their DID.
export const requiresOwnerDid = true;

/**
 * WHY THIS TOOL WAS REWRITTEN.
 *
 * It used to call upsertContact() in db/user-store.js, which is the only contact
 * writer in the codebase that does not go through the identity resolver. That had
 * three consequences, and this tool is the surface we are about to open to Clay,
 * Claude, Perplexity, iMessage and everything else -- so all three were about to
 * get much worse:
 *
 *   1. NO DEDUPE. It matched on the row id or the external id and nothing else.
 *      A push carrying a phone number we already had under a different external
 *      id created a second card. Repeat across five integrations and the rolodex
 *      is a pile of near-duplicates, which is the one failure a rolodex does not
 *      come back from.
 *
 *   2. IT OVERWROTE. `SET full_name = $3, company = $11, ...` unconditionally.
 *      An agent with a stale or wrong company clobbered the one the person typed
 *      by hand, silently, with no way to see it had happened.
 *
 *   3. NO PROVENANCE. Nothing was written to contact_sources, so afterwards
 *      there was no record of which system had claimed what.
 *
 * It now goes through mergeContact(), the same path Apple and Google sync use:
 * resolve by source id, then phone, then email, then folded name plus a
 * corroborating signal; never merge on a bare name; union every list; log refused
 * pairs for review. An agent gets exactly the same care a first-party sync does.
 */
export const config = {
  title: "Create or update contact",
  description:
    "Create or update a contact in a person's Amber rolodex. Deduplicates against the existing address book by phone, email and source id before writing, so pushing the same person twice updates one card rather than making two. Pass `externalId` to keep an upstream system (Clay, HubSpot) idempotently in sync. Fields already set by the person are never overwritten by this tool; new information fills blanks. `did` defaults to your own account when you authenticate with an API key bound to a DID; a contact name is always required.",
  inputSchema: {
    did: z
      .string()
      .min(1)
      .optional()
      .describe(
        "The amber DID of the contact's owner. Optional — defaults to the DID bound to your API key.",
      ),
    source: z
      .string()
      .optional()
      .describe(
        "Where this contact came from (e.g. 'clay', 'linkedin'). Recorded as provenance and used to decide what may overwrite what. Defaults to 'mcp'.",
      ),
    contact: z
      .object({
        externalId: z
          .string()
          .optional()
          .describe(
            "Stable id from the source system for idempotent upserts. Strongly recommended.",
          ),
        name: z.string().min(1).describe("Display name (required)."),
        firstName: z.string().optional(),
        lastName: z.string().optional(),
        company: z.string().optional(),
        title: z.string().optional(),
        phoneNumbers: z.array(z.string()).optional(),
        emails: z.array(z.string()).optional(),
        city: z.string().optional(),
        linkedinUrl: z.string().optional(),
        sourceHandle: z.string().optional().describe("@handle or social handle."),
        notes: z.string().optional(),
      })
      .describe("Contact fields. `name` is required; everything else optional."),
  },
};


export async function handler({ did, contact, source }) {
  if (!did) {
    return errorResult(
      "missing_did",
      "No `did` was provided and your API key is not bound to an owner DID. Pass `did`, or map a DID to your key (named-key `did` field or DEFAULT_OWNER_DID).",
    );
  }
  const ownerId = await resolveAmberIdByPrivyDid(did).catch(() => null);
  if (!ownerId) {
    return errorResult(
      "owner_not_found",
      "This DID has not been linked to an amber account yet. It will resolve after the user authenticates.",
    );
  }
  if (!contact?.name) {
    return errorResult("missing_name", "contact.name is required.");
  }

  const src = normalizeSource(source) || "mcp";

  // The writer is shared with bulk_upsert_contacts. Two copies of this is how a
  // push from Clay ends up deduping differently depending on whether it arrived
  // alone or in a batch of four hundred.
  const r = await upsertOneContact(ownerId, contact, src);
  if (!r.ok) return errorResult(r.code, r.message);

  return ok({
    did,
    action: r.action,
    source: src,
    // Said out loud so an agent can see it did not get to overwrite, rather than
    // assuming its value landed and pushing it again on the next run.
    appliedAsFill: r.appliedAsFill,
    contact: r.contact,
  });
}

function ok(payload) {
  return {
    content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
    structuredContent: payload,
  };
}

function errorResult(code, message) {
  return {
    isError: true,
    content: [{ type: "text", text: JSON.stringify({ error: code, message }) }],
  };
}
