/**
 * THOUSANDS OF CONTACTS, WITHOUT THOUSANDS OF DUPLICATES.
 *
 * This is the door Clay, Perplexity and every other sourcing tool comes through.
 * The single-contact tool is the same operation, and both call the same writer,
 * so a batch of four hundred dedupes exactly the way one does.
 *
 * WHY IT IS SEQUENTIAL, WHICH LOOKS LIKE A MISTAKE. A batch routinely contains
 * the same person twice -- Clay finds them under a work email and a personal
 * one, or a list has been concatenated from two exports. Resolved concurrently,
 * both records see an empty rolodex, both insert, and the batch creates the
 * duplicate it was supposed to prevent. Done in order, the second one finds the
 * first. Correctness over throughput: a fast import that duplicates is worth
 * less than no import at all, because somebody then has to un-merge by hand.
 *
 * WHY THE CAP IS 500 AND NOT "THOUSANDS". An MCP call is a request with a
 * timeout at the other end, and a tool that works at 400 and hangs at 4000 is
 * worse than one that says 500. The reply says how many are left so the caller
 * can page, which is a thing agents do reliably and silently.
 *
 * NOTHING IS ALL-OR-NOTHING. Each record is its own write. One malformed row in
 * a batch of five hundred costs that row, is named in the reply with the reason,
 * and costs nothing else -- an import that rolls back four hundred good contacts
 * because the four hundred and first had no name is not a feature.
 */

import { z } from "zod";

import { ok, errorResult } from "./_result.js";
import { ownerFromDid } from "./_resolve.js";
import { upsertOneContact } from "./_upsert-one.js";
import { normalizeSource } from "../../lib/source-trust.js";

export const name = "bulk_upsert_contacts";
export const requiresOwnerDid = true;

/** Past this, the call is likelier to time out than to finish. See the header. */
const MAX_PER_CALL = 500;

export const config = {
  title: "Create or update many contacts",
  description:
    "Add or update up to 500 contacts in one call, deduplicating each against the existing rolodex by phone, email and source id — the same resolution a single upsert_contact does, so pushing a list twice updates cards rather than doubling them. Records are processed in order, so the same person appearing twice within one batch becomes one card. Fields the person set by hand are never overwritten; new information fills blanks. Each record reports its own outcome, and one bad record does not fail the rest. To load more than 500, call again with the next page. `did` defaults to your own account when you authenticate with an API key bound to a DID.",
  inputSchema: {
    did: z.string().min(1).optional()
      .describe("The amber DID of the rolodex owner. Optional — defaults to the DID bound to your API key."),
    source: z.string().optional()
      .describe("Where these came from (e.g. 'clay', 'perplexity'). Recorded as provenance and used to decide what may overwrite what. Defaults to 'mcp'."),
    contacts: z
      .array(
        z.object({
          externalId: z.string().optional()
            .describe("Stable id from the source system for idempotent upserts. Strongly recommended."),
          name: z.string().min(1).describe("Display name (required)."),
          firstName: z.string().optional(),
          lastName: z.string().optional(),
          emails: z.array(z.string()).optional(),
          phoneNumbers: z.array(z.string()).optional(),
          company: z.string().optional(),
          title: z.string().optional(),
          city: z.string().optional(),
          linkedinUrl: z.string().optional(),
          sourceHandle: z.string().optional(),
          notes: z.string().optional(),
        }),
      )
      .min(1)
      .max(MAX_PER_CALL)
      .describe(`The contacts to write. At most ${MAX_PER_CALL} per call.`),
  },
};

export async function handler({ did, contacts, source }) {
  const owner = await ownerFromDid(did);
  if (!owner.ok) return errorResult(owner.code, owner.message);

  const list = Array.isArray(contacts) ? contacts : [];
  if (list.length === 0) {
    return errorResult("empty_batch", "There were no contacts to write.");
  }
  if (list.length > MAX_PER_CALL) {
    return errorResult(
      "batch_too_large",
      `${list.length} contacts in one call is more than this tool will take. Send at most ${MAX_PER_CALL} and page.`,
    );
  }

  const src = normalizeSource(source) || "mcp";
  const results = [];
  const totals = { created: 0, updated: 0, merged: 0, failed: 0 };

  for (let i = 0; i < list.length; i += 1) {
    const record = list[i];
    // One record's failure is one record's failure. A throw here would take the
    // batch down and lose every write already reported as done.
    let r;
    try {
      r = await upsertOneContact(owner.ownerId, record, src);
    } catch (err) {
      console.error(`MCP_BULK_RECORD_THREW owner=${owner.ownerId} index=${i} ${err?.message || err}`);
      r = { ok: false, code: "unexpected_error", message: String(err?.message || err) };
    }

    if (r.ok) {
      const action = r.action ?? "updated";
      if (action in totals) totals[action] += 1;
      else totals.updated += 1;
      results.push({
        index: i,
        name: record?.name ?? null,
        action,
        contactId: r.contactId,
        appliedAsFill: r.appliedAsFill,
      });
    } else {
      totals.failed += 1;
      results.push({
        index: i,
        name: record?.name ?? null,
        error: r.code,
        message: r.message,
      });
    }
  }

  return ok({
    did,
    source: src,
    received: list.length,
    ...totals,
    // Named individually so a caller can retry exactly the rows that failed
    // rather than re-pushing the whole page and hoping.
    failures: results.filter((r) => r.error),
    results,
    maxPerCall: MAX_PER_CALL,
  });
}
