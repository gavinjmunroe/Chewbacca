import { feedWindow } from '../lib/feed-window.js';
/**
 * Voice-note sharing routes (transcript-only). Reuses the circles / connections
 * audience infrastructure via note-shares-store.js.
 *
 *   PUT  /v1/me/notes/:id/share       — set/change a note's share scope (owner-only)
 *   GET  /v1/me/notes/:id/share       — the note's current share scope (owner-only)
 *   GET  /v1/me/feed                  — voice notes shared WITH the caller
 *                                       (network + circle + contact), newest first
 *   GET  /v1/me/circles/:id/feed      — voice notes shared to ONE circle; auto-marks
 *                                       the circle seen so its unseen dot clears
 *
 * `:id` on the note routes is the conversation_id (TEXT). `:id` on the circle
 * feed route is a positive-integer circle_id.
 *
 * Auth + owner resolution mirror circles.js / shares.js
 * (Privy JWT -> phone -> amber_id). Every query is scoped by the caller's
 * identity; a client-supplied target id is validated server-side and never
 * trusted for authorization.
 */

import { requireAuth as defaultRequireAuth } from "../lib/auth-session.js";
import { resolveAmberIdByPhone, getUserProfileByAmberId } from "../db/store.js";
import { query } from "../db/sql.js";
import { notifyAmberUsers } from "../lib/notify.js";
import { observeCircleShare } from "../db/interaction-observations.js";
import { listConversation } from "../db/csql-conversation-store.js";
// Imported HERE rather than inside note-shares-store, because note-media-store
// already imports VIEWER_REACH_SQL from that store — merging in the route keeps
// the two stores from importing each other.
import { getNoteMetaBatch } from "../db/note-media-store.js";
import {
  setNoteShare,
  getNoteShare,
  getSharedNotesForViewer,
  getCircleNoteFeed,
  markCircleFeedSeen,
} from "../db/note-shares-store.js";

async function resolveOwner(request, reply) {
  const privyDid = request.privyUser?.userId;
  if (!privyDid) {
    reply.code(401).send({ error: "no_user", message: "Auth required" });
    return null;
  }
  const phone = request.privyUser?.phone;
  const amberId = phone ? await resolveAmberIdByPhone(phone).catch(() => null) : null;
  if (!amberId) {
    reply.code(401).send({ error: "no_amber_id", message: "Account not found" });
    return null;
  }
  return amberId;
}

/**
 * Attach audio, reaction and comment data to feed items.
 *
 * THREE queries for the whole page, not three per note. A twenty-note feed asking
 * per row would be sixty round trips to a database that is currently a continent
 * away from the API — the difference between a feed that appears and a feed that
 * fills in.
 */
async function withMedia(items, viewerAmberId) {
  if (!Array.isArray(items) || items.length === 0) return items;
  const meta = await getNoteMetaBatch(
    items.map((it) => ({ ownerId: it.sharedBy?.amberId, conversationId: it.noteId })),
    viewerAmberId,
  ).catch(() => ({}));
  return items.map((it) => {
    const m = meta[`${it.sharedBy?.amberId}|${it.noteId}`];
    return {
      ...it,
      // null audio means transcript-only, which every note is until its sender
      // records one — the client renders those without a player rather than
      // showing a dead play button.
      audio: m?.audio ?? null,
      reactions: m?.reactions ?? null,
      commentCount: m?.commentCount ?? 0,
    };
  });
}

// Parse and validate an id route param as a uuid. Returns the canonical
// lowercase string, or null.
//
// IT USED TO REQUIRE A POSITIVE INTEGER, which is the whole of the bug: circles.id
// and contacts.id are uuid in the schema this app runs on, so every request that
// went through here answered 400 invalid_id before it reached a query. The ids
// were fine; the validator was checking for a type the database stopped using.
// circles.js was corrected for this months ago and these files were missed.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function parseId(raw) {
  return typeof raw === "string" && UUID_RE.test(raw.trim())
    ? raw.trim().toLowerCase()
    : null;
}

export function registerNoteShareRoutes(app, deps = {}) {
  const requireAuth = deps.requireAuth || defaultRequireAuth;

  // ── PUT /v1/me/notes/:id/share ────────────────────────────────────────────────
  // Set/change the share scope of one of the caller's notes. Body:
  //   { visibility: 'private'|'network'|'circle'|'contact', targetId? }
  // 'private' un-shares. 'circle'/'contact' require targetId (the caller's own
  // circle_id / contact_id), validated server-side.
  app.put(
    "/v1/me/notes/:id/share",
    {
      preHandler: [requireAuth],
      schema: {
        body: {
          type: "object",
          required: ["visibility"],
          properties: {
            visibility: { type: "string", enum: ["private", "network", "circle", "contact"] },
            targetId: { type: ["string", "integer", "null"] },
          },
        },
      },
    },
    async (request, reply) => {
      const amberId = await resolveOwner(request, reply);
      if (!amberId) return;

      const conversationId = String(request.params.id || "");
      if (!conversationId) {
        return reply
          .code(400)
          .send({ error: "invalid_note", message: "note id (conversation id) is required" });
      }
      const { visibility, targetId = null } = request.body || {};

      // The phone travels with the request so circle membership resolves the same
      // way for posting as it does for reading.
      const result = await setNoteShare(amberId, conversationId, {
        visibility,
        targetId,
        sharerPhone: request.privyUser?.phone ?? null,
      });
      if (!result.ok) {
        if (result.reason === "note_not_found") {
          return reply
            .code(404)
            .send({ error: "note_not_found", message: "Note not found or not owned" });
        }
        if (result.reason === "invalid_target") {
          return reply.code(400).send({
            error: "invalid_target",
            message: "targetId must reference one of your own circles / contacts",
          });
        }
        if (result.reason === "invalid") {
          return reply
            .code(400)
            .send({ error: "invalid_request", message: "Invalid visibility or target" });
        }
        return reply
          .code(500)
          .send({ error: "share_failed", message: "Could not update the note's share scope" });
      }
      // TELL THE PEOPLE IT WAS SHARED WITH. Sharing a note to a circle produced no
      // notification of any kind — the note simply appeared in the circle's feed for
      // anyone who happened to open it. That is the single most important thing in
      // this app to actually reach a phone, and it was silent.
      // 'network' included, and its absence is why the widest audience in the
      // app was the silent one. 'private' is the only visibility that notifies
      // nobody -- because there is nobody.
      if (
        result.visibility === "circle" ||
        result.visibility === "contact" ||
        result.visibility === "network"
      ) {
        await notifyNoteShared(amberId, result, conversationId, request.log);
      }

      // AND IT COUNTS AS TIME SPENT WITH THOSE PEOPLE. "Same with circles for
      // every member of the circle. That should feed into PeopleRank." One row
      // per member per hour, plus one on the sharer's side carrying everybody
      // as a participant — see db/interaction-observations.js. Fire-and-forget
      // after the response is decided: the share has already succeeded and
      // nothing here is allowed to take it back.
      if (result.visibility === "circle" && result.targetId) {
        void noteExcerpt(amberId, conversationId)
          .then((excerpt) =>
            observeCircleShare({
              sharerAmberId: amberId,
              circleId: String(result.targetId),
              excerpt,
              log: request.log,
            }),
          )
          .catch(() => {});
      }

      return {
        noteId: conversationId,
        visibility: result.visibility,
        targetId: result.targetId ?? null,
      };
    },
  );

  // ── GET /v1/me/notes/:id/share ────────────────────────────────────────────────
  // The note's current share scope, for the share sheet. Owner-only.
  app.get(
    "/v1/me/notes/:id/share",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const amberId = await resolveOwner(request, reply);
      if (!amberId) return;
      const conversationId = String(request.params.id || "");
      if (!conversationId) {
        return reply
          .code(400)
          .send({ error: "invalid_note", message: "note id (conversation id) is required" });
      }
      const scope = await getNoteShare(amberId, conversationId);
      return { noteId: conversationId, ...scope };
    },
  );

  // ── GET /v1/me/feed ───────────────────────────────────────────────────────────
  // Voice notes shared WITH the caller: network shares (from connections), circle
  // shares (from circles they're a member of), and contact shares (one-to-one).
  // Each item is labeled by shareType. Newest first.
  app.get(
    "/v1/me/feed",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const amberId = await resolveOwner(request, reply);
      if (!amberId) return;
      const window = feedWindow(request.query);
      if (!window) return reply.code(400).send({ error: 'bad_window' });
      const phone = request.privyUser?.phone ?? null;
      const limit = Math.min(Number(request.query?.limit) || 100, 200);
      const items = await withMedia(
        await getSharedNotesForViewer(amberId, phone, { limit, ...window }),
        amberId,
      );
      return { items };
    },
  );

  // ── GET /v1/me/circles/:id/feed ───────────────────────────────────────────────
  // Voice notes shared to ONE circle, newest first. The caller must own the
  // circle or be a current member; otherwise 404. Opening the plain feed marks
  // the circle seen so its unseen dot clears.
  //
  // Optional `?q=<keyword>` turns this into a transcript SEARCH: results are
  // filtered to notes whose transcript contains the keyword (case-insensitive),
  // under the SAME membership/visibility check. A search does NOT mark the
  // circle seen — searching must not clear the unread dot.
  app.get(
    "/v1/me/circles/:id/feed",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const amberId = await resolveOwner(request, reply);
      if (!amberId) return;
      const circleId = parseId(request.params.id);
      if (!circleId) {
        return reply
          .code(400)
          .send({ error: "invalid_id", message: "id must be a uuid" });
      }
      const phone = request.privyUser?.phone ?? null;
      const q = typeof request.query?.q === "string" ? request.query.q.trim() : "";
      const items = await getCircleNoteFeed(amberId, phone, circleId, {
        limit: Math.min(Number(request.query?.limit) || 100, 200),
        q,
      });
      if (items === null) {
        return reply
          .code(404)
          .send({ error: "not_found", message: "Circle not found or not a member" });
      }
      // Only the plain feed view clears the unseen dot (best-effort); a search
      // (q present) must leave the unread state untouched.
      if (!q) void markCircleFeedSeen(amberId, circleId);
      return { circleId: String(circleId), items: await withMedia(items, amberId) };
    },
  );
}

/**
 * Push "X shared a note with <circle>" to everyone it just became visible to.
 *
 * Recipients come from contacts.linked_amber_id, the same link the read-side
 * membership predicate uses, so the set notified and the set that can actually open
 * the note cannot drift apart. A member who is not on Amber has no link and gets
 * nothing, which is correct.
 *
 * The body deliberately does NOT contain the note. A voice note can be about
 * anything and anyone, and a lock-screen preview is the one place its contents would
 * be readable without unlocking the phone.
 *
 * `conversationId` IS A PARAMETER because it has to be. It used to be read as a free
 * variable here, which is a ReferenceError — and the catch below swallowed it, so
 * sharing a note with a single PERSON has been sending no notification at all while
 * looking like it worked. Sharing to a circle was unaffected, which is why it went
 * unnoticed.
 */
/**
 * Is this note spoken, and how long is the clip?
 *
 * Read straight from media_assets, which is the only thing that knows whether there
 * is something to listen to — the conversation's `voice` flag says a turn was
 * SPOKEN, not that a playable clip was ever uploaded, and a "tap to listen" on a
 * note with no audio is a broken promise.
 *
 * Never throws. A failure here costs a vaguer body line, not the notification.
 */
async function noteShareMeta(ownerId, conversationId) {
  if (!ownerId || !conversationId) return {};
  try {
    const { rows } = await query(
      `SELECT duration_ms FROM media_assets
        WHERE owner_id = $1::uuid AND conversation_id = $2::uuid
          AND status = 'ready' AND deleted_at IS NULL
        LIMIT 1`,
      [ownerId, String(conversationId)],
    );
    if (!rows[0]) return {};
    return { voice: true, durationMs: Number(rows[0].duration_ms) || 0 };
  } catch {
    return {};
  }
}

/**
 * The first thing the owner actually SAID in the note, for the observation body.
 *
 * Without it the row reads "Shared a note in USC Growth Team" and the dimension
 * classifier has nothing to classify — the interaction would count and the six
 * dimensions would not move, which is half of what was asked for. Bounded
 * because this is evidence, not a copy of the note: the note itself is still the
 * note.
 *
 * NOT USED FOR THE PUSH. shareBody deliberately carries no content, because a
 * lock-screen preview is readable without unlocking the phone. An observation is
 * inside the account of somebody the note was already shared with, so it is
 * subject to exactly the permission the share just granted.
 */
async function noteExcerpt(ownerId, conversationId) {
  try {
    const msgs = await listConversation(ownerId, conversationId, { limit: 8 });
    const first = (Array.isArray(msgs) ? msgs : []).find(
      (m) => m?.role === "user" && typeof m?.content === "string" && m.content.trim(),
    );
    return first ? first.content.trim().slice(0, 800) : null;
  } catch {
    return null;
  }
}

/**
 * The one line under the title.
 *
 * "Open Amber to listen." was the body on every share, which is both wrong (a
 * typed note has nothing to listen to) and empty (it tells the recipient nothing
 * they could not infer from the notification existing). This says what KIND of
 * thing arrived and how long it is, which is the difference between a nudge and
 * an interruption — enough to decide whether to open it now.
 *
 * Deliberately still no CONTENT. A voice note can be about anything and anyone,
 * and a lock-screen preview is the one place its words would be readable without
 * unlocking the phone.
 */
function shareBody({ voice, durationMs }) {
  const secs = Number(durationMs) > 0 ? Math.round(Number(durationMs) / 1000) : 0;
  if (voice && secs >= 5) {
    const label = secs < 60 ? `${secs}s` : `${Math.floor(secs / 60)}m ${secs % 60}s`;
    return `A ${label} voice note. Tap to listen.`;
  }
  if (voice) return "A voice note. Tap to listen.";
  return "Tap to read it.";
}

async function notifyNoteShared(ownerId, result, conversationId, log) {
  try {
    const targetId = result.targetId;
    // A NETWORK SHARE HAS NO TARGET, and this line used to send it home. The
    // audience is "everyone I am connected to", which is derived rather than
    // named, so targetId is legitimately null -- and a bare `if (!targetId)
    // return` treated that as nothing to do. Only the two targeted visibilities
    // need one.
    if (!targetId && result.visibility !== "network") return;
    const prof = await getUserProfileByAmberId(ownerId).catch(() => null);
    const who = prof?.name || prof?.fullName || "Someone";
    // What kind of note this is, for the body line. One query, and a failure here
    // costs a slightly vaguer notification rather than the notification itself.
    const meta = await noteShareMeta(ownerId, conversationId).catch(() => ({}));

    if (result.visibility === "contact") {
      const { rows } = await query(
        `SELECT linked_amber_id FROM contacts
          WHERE id = $1 AND owner_id = $2 AND deleted_at IS NULL`,
        [targetId, ownerId],
      );
      const recipient = rows[0]?.linked_amber_id;
      if (!recipient || String(recipient) === String(ownerId)) return;
      await notifyAmberUsers({
        ownerIds: [recipient],
        title: `${who} shared a note with you`,
        body: shareBody(meta),
        // conversationId, not "noteId": a note IS a conversation, and
        // setNoteShare never returned a noteId, so this key went out as the empty
        // string on every single send. The client needs an id it can actually open.
        data: { type: "note", shareType: "contact", conversationId: String(conversationId) },
        // So a recipient who has muted this person hears nothing, without
        // having to mute everyone who shares notes.
        fromAmberId: ownerId,
        log,
      });
      return;
    }

    if (result.visibility === "network") {
      // NETWORK SHARES NOTIFIED NOBODY AT ALL. This branch did not exist: the
      // function handled 'contact' and 'circle' and fell off the end for
      // 'network', so the broadest audience in the app was the one nobody was
      // told about. Everyone with a live connection, which is the same edge
      // VIEWER_REACH_SQL uses to decide who may read it -- so the set notified
      // and the set that can open it cannot drift apart.
      const { rows } = await query(
        `SELECT CASE WHEN cn.a_amber_id = $1 THEN cn.b_amber_id ELSE cn.a_amber_id END AS recipient
           FROM connections cn
          WHERE cn.status = 'active'
            AND (cn.a_amber_id = $1 OR cn.b_amber_id = $1)`,
        [ownerId],
      );
      const recipients = rows
        .map((r) => r.recipient)
        .filter((r) => r && String(r) !== String(ownerId));
      if (recipients.length === 0) return;
      await notifyAmberUsers({
        ownerIds: recipients,
        title: `${who} shared something with their network`,
        body: shareBody(meta),
        data: { type: "note", shareType: "network", conversationId: String(conversationId) },
        fromAmberId: ownerId,
        log,
      });
      return;
    }

    // ── circle ────────────────────────────────────────────────────────────────
    //
    // WHO IS IN A CIRCLE, and the old query got it wrong twice.
    //
    //   `WHERE cm.circle_id = $1 AND cm.owner_id = $2` with $2 = THE SHARER.
    // circle_members rows belong to the circle's OWNER. So when a member shared
    // into someone else's circle -- which is most sharing, since a circle has
    // one owner and several members -- that predicate matched zero rows and the
    // notification went to nobody. The note still appeared in the feed, because
    // the READ path resolves membership through VIEWER_REACH_SQL instead, so the
    // two halves disagreed silently and it looked like push was broken.
    //
    //   And the owner was never a recipient in any case. They are
    // `circles.owner_id`, not a `circle_members` row, so the one person
    // guaranteed to care about their own circle could not be told about it.
    //
    // Now: the owner, plus every member with a linked account, read off the
    // OWNER's member rows regardless of who is doing the sharing, minus the
    // sharer.
    const { rows } = await query(
      `WITH circ AS (
         SELECT id, name, owner_id
           FROM circles
          WHERE id = $1 AND deleted_at IS NULL
       )
       SELECT DISTINCT r.recipient, circ.name AS circle_name
         FROM circ
         CROSS JOIN LATERAL (
           SELECT circ.owner_id AS recipient
           UNION
           SELECT c.linked_amber_id
             FROM circle_members cm
             JOIN contacts c ON c.id = cm.contact_id AND c.deleted_at IS NULL
            WHERE cm.circle_id = circ.id
              AND cm.owner_id = circ.owner_id
              AND c.linked_amber_id IS NOT NULL
         ) r
        WHERE r.recipient IS NOT NULL
          AND r.recipient <> $2`,
      [targetId, ownerId],
    );
    const recipients = rows.map((r) => r.recipient).filter(Boolean);
    if (recipients.length === 0) return;
    const circleName = rows[0]?.circle_name || "your circle";
    await notifyAmberUsers({
      ownerIds: recipients,
      title: `${who} shared something in ${circleName}`,
      body: shareBody(meta),
      // circleId so the tap opens the circle, conversationId so it can open the
      // note inside it. shareType is what lets a per-person notification
      // preference say "circles yes, network no".
      data: {
        type: "circle",
        shareType: "circle",
        circleId: String(targetId),
        conversationId: String(conversationId),
      },
      fromAmberId: ownerId,
      log,
    });
  } catch (err) {
    log?.warn?.({ err: err?.message }, "[note-shares] share push failed");
  }
}
