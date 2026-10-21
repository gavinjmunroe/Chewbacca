/**
 * Contact notes — capture a note about a specific contact, server-side, through
 * the SAME capture pipeline as chat/voice. Nothing is stored on-device; a note
 * becomes real contact_facts/experiences that feed PeopleRank and can be shared,
 * gated by the owner's privacy like everything else.
 *
 *   POST /v1/me/contacts/:contactId/note        { text } -> { status, outcomes }
 *   GET  /v1/me/contacts/recently-mentioned    ?limit   -> { contacts[] }
 *
 * Returns the capture outcomes (what was logged, to whom) so the app can show a
 * confirmation card per person with a checkmark.
 */

import { requireAuth as defaultRequireAuth } from "../lib/auth-session.js";
import {
  resolveAmberIdByPhone,
  getContactById,
  getFactsForContact,
  insertContactNote,
  listRecentlyMentionedContacts,
} from "../db/store.js";
import { captureFromMessage } from "../lib/fact-capture.js";
import { reembedContactSoon } from "../lib/contact-vectors.js";
import { saveMemoContactNote } from "../db/memo-action-store.js";

async function resolveOwner(request, reply, resolve = resolveAmberIdByPhone) {
  const privyDid = request.privyUser?.userId;
  if (!privyDid) {
    reply.code(401).send({ error: "no_user", message: "Auth required" });
    return null;
  }
  const phone = request.privyUser?.phone;
  const amberId = phone ? await resolve(phone).catch(() => null) : null;
  if (!amberId) {
    reply.code(401).send({ error: "no_amber_id", message: "Account not found" });
    return null;
  }
  return amberId;
}

// Parse a contact id route param as a uuid.
//
// IT REQUIRED A POSITIVE INTEGER, and contacts.id is uuid — so POST
// /v1/me/contacts/:contactId/note answered 400 invalid_contact_id for every
// real contact, and the person page showed "Could not save the note." on every
// attempt. Recording a note about someone from their own card was completely
// broken.
//
// This was flagged and deliberately left alone in an earlier pass, because the
// route hands the parsed value on as `participantIds: [contactId]` and six
// tests were written against integers — so it looked like a design question
// rather than a validator typo. It was not: the tests were written to match a
// broken validator, and nothing else in the system has used integer contact ids
// since the uuid migration. The tests move with it.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function parseId(raw) {
  return typeof raw === "string" && UUID_RE.test(raw.trim())
    ? raw.trim().toLowerCase()
    : null;
}

export function registerContactNoteRoutes(app, deps = {}) {
  const requireAuth = deps.requireAuth || defaultRequireAuth;
  const capture = deps.captureFromMessage || captureFromMessage;
  const recentlyMentioned =
    deps.listRecentlyMentionedContacts || listRecentlyMentionedContacts;
  const addNote = deps.insertContactNote || insertContactNote;
  const resolveOwnerId = deps.resolveAmberIdByPhone || resolveAmberIdByPhone;
  const reembed = deps.reembedContactSoon || reembedContactSoon;
  const getContact = deps.getContactById || getContactById;
  const getFacts = deps.getFactsForContact || getFactsForContact;
  const saveAction = deps.saveMemoContactNote || saveMemoContactNote;

  /**
   * GET /v1/me/contacts/recently-mentioned
   *
   * Who the user has been TALKING ABOUT, newest first. Registered before the
   * /:contactId route below is irrelevant to Fastify (it routes on the static
   * segment first regardless), but "recently-mentioned" is also not a valid
   * contactId, so the two can never collide.
   */
  app.get(
    "/v1/me/contacts/recently-mentioned",
    {
      preHandler: [requireAuth],
      schema: {
        querystring: {
          type: "object",
          properties: { limit: { type: "integer", minimum: 1, maximum: 50 } },
        },
      },
    },
    async (request, reply) => {
      const amberId = await resolveOwner(request, reply, resolveOwnerId);
      if (!amberId) return;
      const limit = request.query?.limit ?? 10;
      const contacts = await recentlyMentioned(amberId, { limit }).catch(() => []);
      return { ok: true, contacts };
    },
  );

  app.post(
    "/v1/me/contacts/:contactId/note",
    {
      preHandler: [requireAuth],
      schema: {
        body: {
          type: "object",
          required: ["text"],
          properties: { text: { type: "string", minLength: 1, maxLength: 4000 }, requestId: { type: "string", format: "uuid" } },
        },
      },
    },
    async (request, reply) => {
      const amberId = await resolveOwner(request, reply, resolveOwnerId);
      if (!amberId) return;
      const contactId = parseId(request.params.contactId);
      if (!contactId) {
        return reply
          .code(400)
          .send({ error: "invalid_contact_id", message: "contactId must be a uuid" });
      }
      const text = String(request.body?.text ?? "").trim();
      if (!text) {
        return reply.code(400).send({ error: "empty_note", message: "text is required" });
      }

      // The contact must exist and be THIS owner's, or a valid-looking id would
      // let someone write a note against a row they cannot see.
      const contact = await getContact(amberId, contactId).catch(() => null);
      if (!contact) {
        return reply
          .code(404)
          .send({ error: "contact_not_found", message: "No such contact." });
      }
      const name = contact.full_name || contact.name || null;

      if (request.body.requestId) {
        let saved;
        try {
          saved = await saveAction({ ownerId: amberId, contactId, text, requestId: request.body.requestId });
        } catch (error) {
          const conflict = error?.message === "memo_action_conflict";
          return reply.code(conflict ? 409 : 500).send({ error: conflict ? "memo_action_conflict" : "note_write_failed" });
        }
        if (!saved?.noteId) return reply.code(500).send({ error: "note_write_failed" });
        if (!saved.replayed) {
          reembed(amberId, contactId, () => getFacts(amberId, contactId));
          // The note is durable and classified. Structured extraction is best-effort;
          // waiting for it made slow model calls look like failed writes on mobile.
          Promise.resolve().then(() => capture({
            ownerId: amberId, messageText: name ? `${name}: ${text}` : text,
            spaceId: `contact:${contactId}`, source: "contact_note", captureNote: false,
            log: request.log ?? { info() {}, warn() {} },
          })).catch(() => request.log?.warn?.("[contact-note] background extraction failed"));
        }
        return { noteId: String(saved.noteId), contactId, name, text,
          status: saved.replayed ? "saved" : "processing", outcomes: [], replayed: !!saved.replayed };
      }

      // WRITE IT DIRECTLY, AND WRITE IT FIRST.
      //
      // This route used to hand "Name: text" to the capture pipeline and let a
      // model work out who the note was about -- for a note the user opened on ONE
      // person's card, whose id is in the URL. That is why adding a note read as a
      // dead end: if extraction found nothing, or resolved the name to a different
      // same-named contact, or the name was ambiguous, the note simply did not
      // exist anywhere. There is no reason to infer a fact we were told.
      //
      // So the note is persisted deterministically, against this contact id, with
      // no model in the path. It is then searchable (the free-text contact search
      // reads contact_notes.note_text) and it is on their card. Extraction still
      // runs after, for the structured signals, but the memory no longer depends
      // on it.
      const noteId = await addNote({
        ownerId: amberId,
        noteText: text,
        participantIds: [contactId],
        rawNames: [],
        status: "resolved",
        source: "contact_note",
        sourceRef: `contact:${contactId}`,
      }).catch((err) => {
        request.log?.warn?.({ err: err?.message, contactId }, "[contact-note] write failed");
        return null;
      });
      if (noteId == null) {
        return reply
          .code(500)
          .send({ error: "note_write_failed", message: "Could not save that note." });
      }

      // Keep the vector index current so the next semantic question about this
      // person can actually reach what was just written. Fire-and-forget: the note
      // is already durable.
      reembed(amberId, contactId, () => getFacts(amberId, contactId));

      // Structured extraction, best-effort and no longer load-bearing. It adds
      // facts/experiences on top of the note; `captureNote: false` keeps it from
      // writing a SECOND copy of the same sentence as its own note row.
      const result = await capture({
        ownerId: amberId,
        messageText: name ? `${name}: ${text}` : text,
        spaceId: `contact:${contactId}`,
        source: "contact_note",
        captureNote: false,
        log: request.log ?? { info() {}, warn() {} },
      }).catch((err) => {
        request.log?.warn?.({ err: err?.message, contactId }, "[contact-note] capture failed");
        return { status: "error", outcomes: [] };
      });

      request.log?.info?.(
        { contactId, noteId, captureStatus: result?.status },
        "[contact-note] saved",
      );
      // noteId is the confirmation the client shows. It is present whenever the
      // note is real, which is the whole point: never claim a save we did not do.
      return {
        noteId: String(noteId),
        contactId: String(contactId),
        name,
        text,
        status: result?.status ?? "nothing",
        outcomes: result?.outcomes ?? [],
      };
    },
  );
}
