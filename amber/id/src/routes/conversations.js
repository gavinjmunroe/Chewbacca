/**
 * Read endpoints for the chat-history sidebar:
 *   GET    /v1/conversations               — list the caller's threads (+ title)
 *   GET    /v1/conversations/:conversationId — one thread's messages
 *   DELETE /v1/conversations/:conversationId — soft-delete a thread
 *
 * All scoped to the authed user via requireAuth → request.privyUser.userId.
 * The store helpers (listRecentConversations / listConversation /
 * softDeleteConversation) already filter by owner_id, so a user can only ever
 * see or delete their own threads; a mismatched id just returns []/0.
 */

import { requireAuth as defaultRequireAuth } from "../lib/auth-session.js";
import {
  pendingTagsForNote,
  resolvePendingTag,
  retagNote,
} from "../db/note-tags.js";
import {
  resolveAmberIdByPhone,
  getFiledPeopleForConversation,
  mergeFiledWithStoredPeople,
} from "../db/store.js";
import {
  listRecentConversations as defaultListRecentConversations,
  listConversation as defaultListConversation,
  softDeleteConversation as defaultSoftDeleteConversation,
} from "../db/csql-conversation-store.js";
import { deleteNoteSharesForConversation } from "../db/note-shares-store.js";
import { getAudioRow, getMessageAudioForConversation } from "../db/note-media-store.js";

function requirePrivyDid(request, reply) {
  const privyDid = request.privyUser?.userId;
  if (!privyDid) {
    reply.code(401).send({ error: "no_user", message: "Auth required" });
    return null;
  }
  return privyDid;
}

/** First user message, cleaned. `max` caps it (short for a row title, long for
 *  a Today voice-note card that wants to show more of what you said). */
function firstUserText(messages, max) {
  const first = (messages || []).find((m) => m.role === "user") || messages?.[0];
  const text = String(first?.content || "").replace(/\s+/g, " ").trim();
  if (!text) return max >= 100 ? "" : "New conversation";
  return text.length > max ? text.slice(0, max - 1).trimEnd() + "…" : text;
}
function titleFrom(messages) {
  return firstUserText(messages, 60);
}

export function registerConversationRoutes(app, deps = {}) {
  const requireAuth = deps.requireAuth || defaultRequireAuth;
  const listRecentConversations =
    deps.listRecentConversations || defaultListRecentConversations;
  const listConversation = deps.listConversation || defaultListConversation;
  const readAudio = deps.getAudioRow || getAudioRow;
  const resolveOwnerId = deps.resolveAmberIdByPhone || resolveAmberIdByPhone;
  const filedPeople = deps.getFiledPeopleForConversation || getFiledPeopleForConversation;
  const messageAudio = deps.getMessageAudioForConversation || getMessageAudioForConversation;
  const softDeleteConversation =
    deps.softDeleteConversation || defaultSoftDeleteConversation;

  // GET /v1/conversations — recent threads with a readable title.
  app.get(
    "/v1/conversations",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const did = requirePrivyDid(request, reply);
      if (!did) return;
      const phone = request.privyUser?.phone;
      const amberId = phone ? await resolveOwnerId(phone).catch(() => null) : null;
      if (!amberId) return { conversations: [] };
      /**
       * THE DAY IS THE CALLER'S TO NAME, and the default is unchanged.
       *
       * "My notes and journals from yesterday are not showing up either."
       *
       * Home's Notes & Journal list shows one day, and it was picking that day
       * out of whatever the newest thirty threads happened to contain. Every Ask
       * conversation is a thread too, so thirty is one busy day -- after which
       * yesterday's notes are still in the database and permanently unreachable.
       * See listRecentConversations for the whole story.
       *
       * `from`/`to` are two instants, half-open, and the TIMEZONE IS THE
       * CLIENT'S PROBLEM on purpose -- the same contract /v1/me/agenda already
       * uses. The phone knows what "yesterday" means where the person is
       * standing; a server that guesses shows the wrong day to anybody
       * traveling.
       *
       * Both absent means exactly the old behavior, so nothing that already
       * calls this changes.
       */
      const from = typeof request.query?.from === "string" ? request.query.from : null;
      const to = typeof request.query?.to === "string" ? request.query.to : null;
      const bothOrNeither = Boolean(from) === Boolean(to);
      if (!bothOrNeither) {
        reply.code(400);
        return { error: "bad_window", message: "from and to must be given together" };
      }
      // A NAMED DAY IS NOT A PREVIEW, so it does not share the preview's cap.
      // Thirty is plenty of "recent threads" for a sidebar; a day the person
      // actually asked to see should not silently stop at thirty notes.
      const threads = await listRecentConversations(amberId, {
        limit: from ? 200 : 30,
        from,
        to,
      });
      // Read the opening messages of each thread: the first user line is the
      // title, and the assistant metadata tells us who the note was filed to
      // (the "filed to …" chips on the Today voice-note cards).
      const conversations = await Promise.all(
        threads.map(async (t) => {
          // SNAKE_CASE ROWS, READ AS camelCase -- THE REASON HOME LOOKED EMPTY.
          //
          // listRecentConversations returns raw pg rows: conversation_id,
          // last_at, message_count. Every read below was t.conversationId /
          // t.lastAt / t.messageCount, so all three were undefined. The client
          // then drops any conversation without a lastAt when bucketing notes
          // into days, which silently filtered out EVERY note, on every day.
          //
          // The only cards on Home were the optimistic local stand-in created the
          // moment a note is recorded -- which is exactly why a note appeared,
          // looked saved, and was gone after clearing the app. Nothing was ever
          // lost; the feed simply could not read what it had been handed.
          //
          // Third time this exact seam has bitten today: getContactNameMemory and
          // getFiledPeopleForConversation had it too. Normalized here at the
          // boundary rather than at each use.
          const conversationId = t.conversation_id ?? t.conversationId;
          const lastAt = t.last_at ?? t.lastAt ?? t.updated_at ?? t.created_at ?? null;
          const messageCount = Number(t.message_count ?? t.messageCount ?? 0);
          // Title/preview come from the messages; the "filed to" chips come from
          // the ACTUAL note participants (source of truth), not message metadata,
          // so follow-up questions in the note never mis-tag it and a
          // correction/clarification shows immediately.
          const [msgs, filed] = await Promise.all([
            listConversation(amberId, conversationId, { limit: 8 }).catch(() => []),
            filedPeople(amberId, conversationId).catch(() => ({
              people: [],
              pendingNames: [],
            })),
          ]);
          // Only CONFIRMED contacts become "filed to" chips. Unconfirmed raw
          // names (spoken but not yet linked to a real contact) are handled by
          // the confirmation card on the feed, never shown as a gold chip that
          // looks settled. A chip means "this is definitely this person."
          //
          // MERGED WITH WHAT THE TURN RECORDED, and this is the fix for "it only
          // tags one time in five". The filed query reads notes, experiences and
          // facts — and "Lexi and Amanda both live in the Bay Area" produces none
          // of those. A pure statement of where someone lives routes to
          // contact_field, which updates columns on the contact and writes no row
          // at all, so that note could never show a chip no matter how cleanly it
          // was understood. It was not inconsistent; it was deterministic by route,
          // which is why some notes always worked and others never did.
          //
          // The turn's own metadata does know who it was about, so the two are
          // merged on the same rule the thread view uses: filed wins on identity so
          // corrections still take, stored survives when the filed query cannot see
          // it. See mergeFiledWithStoredPeople.
          const storedPeople = msgs
            .filter((m) => m.role === "assistant" && Array.isArray(m.metadata?.people))
            .flatMap((m) => m.metadata.people);
          const people = mergeFiledWithStoredPeople(filed.people, storedPeople).filter(
            (p) => p && p.contactId != null,
          );
          return {
            conversationId,
            kind: t.kind ?? null,
            title: titleFrom(msgs),
            // A fuller preview for the Today voice-note card, so it shows more of
            // what was said than the short row title.
            preview: firstUserText(msgs, 240),
            // Falls back to the thread's own timestamps: a conversation whose
            // messages were all deleted still happened, and a null here removes
            // it from the feed entirely rather than showing it as empty.
            lastAt,
            messageCount,
            // true spoken / false typed / null unknown (pre-dates the field).
            voice: t.voice ?? msgs.find((m) => m.role === "user")?.metadata?.voice ?? (t.kind === "note" ? true : null),
            people,
          };
        }),
      );
      return { conversations };
    },
  );

  // GET /v1/conversations/:conversationId — one thread's messages (oldest-first).
  app.get(
    "/v1/conversations/:conversationId",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const did = requirePrivyDid(request, reply);
      if (!did) return;
      const conversationId = String(request.params.conversationId);
      const phone = request.privyUser?.phone;
      const amberId = phone ? await resolveOwnerId(phone).catch(() => null) : null;
      if (!amberId) return { conversationId, messages: [] };
      const messages = await listConversation(amberId, conversationId, {
        limit: 100,
      });
      // The people shown when you open a note must come from the note's ACTUAL
      // participants (the same source of truth as the Today "filed to" chips),
      // not the people frozen into the assistant message when it was first
      // recorded. Otherwise a name you later corrected (e.g. Josh Berman ->
      // Josh Segal) stays wrong here while it's right on the feed.
      const filed = await filedPeople(amberId, conversationId).catch(() => ({
        people: [],
        pendingNames: [],
      }));
      // MERGED, NOT REPLACED. Overwriting made corrections win — which is right —
      // but it also deleted everyone the filed query cannot see, and that is why a
      // note about Sagar showed his card while it streamed and none when reopened.
      // mergeFiledWithStoredPeople keeps corrections authoritative and keeps a
      // field-only person alive; see its comment for how the two are told apart.
      for (const m of messages) {
        if (m.role !== "assistant" || !m.metadata) continue;
        const stored = Array.isArray(m.metadata.people) ? m.metadata.people : [];
        const merged = mergeFiledWithStoredPeople(filed.people || [], stored);
        if (merged.length === 0) continue;
        m.metadata.people = merged;
        m.metadata.peopleIds = merged.map((p) => p.contactId);
      }
      // THE RECORDING OF A SPOKEN FOLLOW-UP, ON THE MESSAGE IT BELONGS TO.
      //
      // A follow-up said out loud is stored as its transcript -- that is the
      // message, and it is what Amber answered -- with the audio kept beside it.
      // Duration and waveform come back HERE, in the same request as the thread,
      // because the player cannot draw without them: fetching them per message
      // would show the words first and pop a player in underneath each one a
      // moment later. The playback URL is not here on purpose -- it is signed,
      // short-lived, and minted only when somebody actually presses play.
      const clips = await messageAudio(amberId, conversationId).catch(() => ({}));
      for (const m of messages) {
        const clip = clips[String(m.id)];
        if (!clip) continue;
        m.audio = clip;
      }
      const recording = await readAudio(amberId, conversationId).catch(() => null);
      const audio = recording?.status === 'ready' ? {
        durationMs: Number(recording.duration_ms) || 0,
        byteSize: Number(recording.byte_size) || 0,
        peaks: (recording.peaks ?? []).map((p) => Number(p) || 0),
      } : null;
      // Only metadata here. The existing audio route checks ownership again and
      // signs a fresh URL when the user presses play.
      return { conversationId, ownerId: amberId, messages, audio };
    },
  );

  /**
   * PATCH /v1/conversations/:conversationId/tags
   *
   *   { fromContactId, toContactId }  — it was Mei, it is actually Mee
   *   { fromContactId, remove: true } — this note is not about them at all
   *
   * The chips under a note come from observation_participants, and until now
   * nothing could change them: Amber guessed, asked, was told no, and the wrong
   * guess stayed on the note with no gesture anywhere to fix it.
   */
  app.patch(
    "/v1/conversations/:conversationId/tags",
    {
      preHandler: [requireAuth],
      schema: {
        body: {
          type: "object",
          required: ["fromContactId"],
          properties: {
            fromContactId: { type: "string" },
            toContactId: { type: "string" },
            remove: { type: "boolean" },
          },
        },
      },
    },
    async (request, reply) => {
      const did = requirePrivyDid(request, reply);
      if (!did) return;
      const phone = request.privyUser?.phone;
      const amberId = phone ? await resolveOwnerId(phone).catch(() => null) : null;
      if (!amberId) return reply.code(500).send({ error: "could_not_resolve_owner" });

      const conversationId = String(request.params.conversationId);
      const { fromContactId, toContactId, remove } = request.body || {};
      // `remove` and a destination are mutually exclusive: one says "nobody",
      // the other says "this person", and honoring both would be a guess.
      if (remove && toContactId) {
        return reply.code(400).send({
          error: "ambiguous",
          message: "Send a destination or remove: true, not both.",
        });
      }
      const res = await retagNote(
        amberId,
        conversationId,
        fromContactId,
        remove ? null : (toContactId ?? null),
      );
      if (!res.ok) {
        const code =
          res.reason === "note_not_found" || res.reason === "target_not_found" ? 404 : 400;
        return reply.code(code).send({ error: res.reason ?? "retag_failed" });
      }
      return { retagged: true, participants: res.participants, observations: res.observations };
    },
  );

  /**
   * GET /v1/conversations/:conversationId/pending-tags
   *
   * The names in this note that Amber could not attribute — the unanswered
   * "which Maggie?"s. They were being written and then never surfaced, so the
   * question was asked once in a chat and lost the moment it scrolled.
   */
  app.get(
    "/v1/conversations/:conversationId/pending-tags",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const did = requirePrivyDid(request, reply);
      if (!did) return;
      const phone = request.privyUser?.phone;
      const amberId = phone ? await resolveOwnerId(phone).catch(() => null) : null;
      if (!amberId) return { pending: [] };
      return {
        pending: await pendingTagsForNote(amberId, String(request.params.conversationId)),
      };
    },
  );

  /**
   * POST /v1/conversations/:conversationId/pending-tags/resolve
   *   { rawName, contactId }
   *
   * "The Mee in this note is this contact." Settles every pending observation
   * in the note carrying that name at once, because they are all the same
   * person mentioned more than once.
   */
  app.post(
    "/v1/conversations/:conversationId/pending-tags/resolve",
    {
      preHandler: [requireAuth],
      schema: {
        body: {
          type: "object",
          required: ["rawName", "contactId"],
          properties: {
            rawName: { type: "string", minLength: 1 },
            contactId: { type: "string" },
          },
        },
      },
    },
    async (request, reply) => {
      const did = requirePrivyDid(request, reply);
      if (!did) return;
      const phone = request.privyUser?.phone;
      const amberId = phone ? await resolveOwnerId(phone).catch(() => null) : null;
      if (!amberId) return reply.code(500).send({ error: "could_not_resolve_owner" });
      const { rawName, contactId } = request.body || {};
      const res = await resolvePendingTag(
        amberId,
        String(request.params.conversationId),
        rawName,
        contactId,
      );
      if (!res.ok) {
        const code =
          res.reason === "target_not_found" || res.reason === "nothing_pending" ? 404 : 400;
        return reply.code(code).send({ error: res.reason ?? "resolve_failed" });
      }
      return { resolved: res.resolved };
    },
  );

  // DELETE /v1/conversations/:conversationId — soft-delete (swipe-to-delete).
  app.delete(
    "/v1/conversations/:conversationId",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const did = requirePrivyDid(request, reply);
      if (!did) return;
      const conversationId = String(request.params.conversationId);
      const phone = request.privyUser?.phone;
      const amberId = phone ? await resolveOwnerId(phone).catch(() => null) : null;
      if (!amberId) return { deleted: 0 };
      const deleted = await softDeleteConversation(amberId, conversationId);
      // Deleting the note also un-shares it, so it cannot linger in any feed.
      // Best-effort: feeds also drop notes whose transcript resolves to nothing.
      void deleteNoteSharesForConversation(amberId, conversationId);
      return { deleted };
    },
  );
}
