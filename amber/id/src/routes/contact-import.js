/**
 * IMPORTING A FILE SOMEBODY EXPORTED FROM SOMEWHERE ELSE.
 *
 *   POST /v1/me/contacts/import-file   { content, source?, filename? }
 *
 * A .vcf from Apple Contacts or Android, a .csv from LinkedIn, Google Contacts,
 * Outlook or a spreadsheet. The file is parsed into the same record shape the
 * resolver already takes and handed to importContactRecords -- the identical
 * function the Google sync uses. So an upload dedupes against the address book
 * exactly the way a sync does, and a file containing people already in the book
 * updates their cards instead of doubling them.
 *
 * WHY JSON RATHER THAN MULTIPART. A contact export is text, usually well under
 * a megabyte, and multipart would mean a new dependency plus a streaming parser
 * in front of the one surface where somebody uploads their entire social graph.
 * The client reads the file and posts the text.
 *
 * THE FILENAME IS NOT TRUSTED. Format is sniffed from the bytes, because people
 * rename things and because a .csv that is really a vCard should still import.
 */

import { requireAuth as defaultRequireAuth } from "../lib/auth-session.js";
import { ownerIdFromSession } from "../lib/owner-id.js";
import { parseContactFile } from "../lib/contact-files.js";
import { importContactRecords } from "../lib/google-contacts.js";
import { normalizeSource } from "../lib/source-trust.js";

/**
 * Five megabytes of text. An address book of ten thousand vCards with photos
 * stripped is about two, and anything past this is not a contact export.
 */
const MAX_CHARS = 5_000_000;

/**
 * A single upload will not create more than this many contacts. A malformed
 * file that parses into a hundred thousand one-character names should not be
 * able to bury somebody's address book before anyone notices.
 */
const MAX_RECORDS = 5000;

export function registerContactImportRoutes(app, deps = {}) {
  const {
    requireAuth = defaultRequireAuth,
    resolveOwnerId = ownerIdFromSession,
    parse = parseContactFile,
    importRecords = importContactRecords,
  } = deps;

  app.post(
    "/v1/me/contacts/import-file",
    {
      preHandler: [requireAuth],
      schema: {
        body: {
          type: "object",
          required: ["content"],
          properties: {
            content: { type: "string", maxLength: MAX_CHARS },
            // Recorded as provenance, and it decides what this import may
            // overwrite. Left alone it is "upload", which sits below anything
            // the person typed by hand.
            source: { type: "string", maxLength: 64 },
            filename: { type: "string", maxLength: 255 },
          },
        },
      },
    },
    async (request, reply) => {
      /*
       * THE OWNER, BY PHONE OR BY THE TOKEN'S SUBJECT.
       *
       * This refused outright when a session carried no phone, which made
       * uploading an address book impossible for exactly the accounts that
       * most need it: an employee invited by work email, who has no phone on
       * file and no iOS app doing the sync for them.
       */
      const ownerId = await resolveOwnerId(request.privyUser).catch(() => null);
      if (!ownerId) {
        return reply.code(500).send({ error: "could_not_resolve_owner" });
      }

      const { content, source, filename } = request.body ?? {};
      const parsed = parse(content);

      if (!parsed.records || parsed.records.length === 0) {
        // Naming the reason matters here: "we could not read that file" and
        // "that file had nobody in it" send somebody to different places.
        return reply.code(422).send({
          error: parsed.reason ?? "no_contacts_found",
          format: parsed.format ?? "unknown",
          message:
            parsed.reason === "no_recognizable_header"
              ? "That looks like a spreadsheet, but none of its columns are names, emails or phone numbers."
              : parsed.format === "unknown"
                ? "That file is not a vCard or a CSV."
                : "That file parsed, but there were no contacts in it.",
        });
      }

      if (parsed.records.length > MAX_RECORDS) {
        return reply.code(413).send({
          error: "too_many_records",
          found: parsed.records.length,
          max: MAX_RECORDS,
          message: `That file holds ${parsed.records.length} contacts, which is more than one upload will take. Split it.`,
        });
      }

      const src = normalizeSource(source) || "upload";
      const records = parsed.records.map((r) => ({
        ...r,
        source: src,
        // Whatever the file offered. A vCard UID makes a re-upload of the same
        // export idempotent; a CSV has nothing, and falls through to the
        // resolver's email-then-phone matching like any other write.
        externalId: r.externalId ?? null,
        raw: { ...r, filename: filename ?? null },
      }));

      const counts = await importRecords(ownerId, records).catch((err) => {
        request.log?.error?.({ err: err?.message }, "[import] write failed");
        return null;
      });
      if (!counts) return reply.code(503).send({ error: "import_failed" });

      return {
        ok: true,
        format: parsed.format,
        source: src,
        filename: filename ?? null,
        found: parsed.records.length,
        ...counts,
      };
    },
  );
}
