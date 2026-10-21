/**
 * Circles routes — owner-scoped social grouping of contacts.
 *
 *   GET    /v1/me/circles                        — list circles with preview
 *   POST   /v1/me/circles                        — create a circle
 *   PATCH  /v1/me/circles/:id                    — update name / color
 *   DELETE /v1/me/circles/:id                    — soft-delete a circle
 *   GET    /v1/me/circles/:id/members            — list circle members
 *   POST   /v1/me/circles/:id/members            — add a contact to a circle
 *   PUT    /v1/me/circles/:id/members            — SET the whole membership at once
 *   DELETE /v1/me/circles/:id/members/:contactId — remove a contact from a circle
 *   GET    /v1/me/circles/inbound                — circles other people put you in
 *   POST   /v1/me/circles/:id/invite             — accept or decline being put in one
 *
 * Auth: amber-id / medha-id / Privy JWT via requireAuth.
 * Owner resolution: request.privyUser.phone → resolveAmberIdByPhone → amber_id.
 */

import { requireAuth as defaultRequireAuth } from "../lib/auth-session.js";
import { resolveAmberIdByPhone, getUserProfileByAmberId } from "../db/store.js";
import { query } from "../db/sql.js";
import { notifyAmberUsers } from "../lib/notify.js";
import {
  createCircle,
  updateCircle,
  softDeleteCircle,
  listCirclesWithPreview,
  getAllCircleMembers,
  getCircleMembers,
  addCircleMember,
  removeCircleMember,
  getCirclesForContact,
  getInboundCirclesForViewer,
  getInboundCircleMembers,
  markInboundCircleSeen,
  leaveInboundCircle,
  setCircleMembers,
} from "../db/circles-store.js";
import { getUnseenCircleShareCounts } from "../db/note-shares-store.js";
import {
  circleInviteStatuses,
  openCircleInvites,
  respondToCircleInvite,
} from "../db/circle-invites.js";

// Attach unseenCount / hasUnseen (the "amber glowing dot") to a circle list. The
// counts come from note_shares reaching the viewer, keyed by circle id; a circle
// with no unseen shares gets 0 / false. Best-effort: on any error the list is
// returned unchanged (dot simply does not show).
async function _withUnseen(viewerAmberId, viewerPhone, circles) {
  if (!Array.isArray(circles) || circles.length === 0) return circles;
  const ids = circles.map((c) => c.id);
  const counts = await getUnseenCircleShareCounts(viewerAmberId, viewerPhone, ids).catch(
    () => new Map(),
  );
  return circles.map((c) => {
    const n = counts.get(String(c.id)) ?? 0;
    return { ...c, unseenCount: n, hasUnseen: n > 0 };
  });
}

// Shared helper: resolve the caller's amber_id. Returns null and sends the
// appropriate error response when auth or account resolution fails.
async function resolveOwner(request, reply) {
  const privyDid = request.privyUser?.userId;
  if (!privyDid) {
    reply.code(401).send({ error: "no_user", message: "Auth required" });
    return null;
  }
  const phone = request.privyUser?.phone;
  const amberId = phone
    ? await resolveAmberIdByPhone(phone).catch(() => null)
    : null;
  if (!amberId) {
    reply.code(401).send({ error: "no_amber_id", message: "Account not found" });
    return null;
  }
  return amberId;
}

// Parse and validate a route param as a uuid. Returns the canonical lowercase
// string, or null.
//
// IT USED TO REQUIRE A POSITIVE INTEGER, and that is the whole of the bug: both
// circles.id and contacts.id are uuid in the schema this app runs on, so every
// circle request answered 400 invalid_id. The ids were fine; the validator was
// checking for a type the database stopped using. Nothing downstream failed,
// because nothing downstream was reached.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function parseId(raw) {
  return typeof raw === "string" && UUID_RE.test(raw.trim())
    ? raw.trim().toLowerCase()
    : null;
}

export function registerCirclesRoutes(app, deps = {}) {
  const requireAuth = deps.requireAuth || defaultRequireAuth;

  // ── GET /v1/me/circles ────────────────────────────────────────────────────────
  // Returns all active circles for the caller with member counts and a 4-member preview.
  app.get(
    "/v1/me/circles",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const amberId = await resolveOwner(request, reply);
      if (!amberId) return;
      const phone = request.privyUser?.phone ?? null;
      const circles = await _withUnseen(
        amberId,
        phone,
        await listCirclesWithPreview(amberId),
      );
      return { circles };
    },
  );

  // ── POST /v1/me/circles ───────────────────────────────────────────────────────
  // Creates a new circle. Responds 201 with the circle row (no members yet).
  app.post(
    "/v1/me/circles",
    {
      preHandler: [requireAuth],
      schema: {
        body: {
          type: "object",
          required: ["name"],
          properties: {
            name:        { type: "string", minLength: 1, maxLength: 100 },
            color:       { type: "string", maxLength: 50 },
            description: { type: "string", maxLength: 280 },
            // The kind, as the user set it: Work / Friends / Family / School
            // are offered and anything else can be typed. 24 is the longest a
            // tag can be and still fit the flag under a node in the profile
            // web, which is the only place it is rendered at size.
            kindTag:     { type: "string", maxLength: 24 },
          },
        },
      },
    },
    async (request, reply) => {
      const amberId = await resolveOwner(request, reply);
      if (!amberId) return;

      const body = request.body || {};
      const name = typeof body.name === "string" ? body.name.trim() : "";
      if (!name) {
        return reply
          .code(400)
          .send({ error: "name_required", message: "name is required" });
      }
      const color =
        typeof body.color === "string" ? body.color.trim() || null : null;
      const description =
        typeof body.description === "string" ? body.description.trim() || null : null;
      const kindTag =
        typeof body.kindTag === "string" ? body.kindTag.trim().slice(0, 24) || null : null;

      const row = await createCircle(amberId, { name, color, description, kindTag });
      if (!row) {
        return reply
          .code(500)
          .send({ error: "create_failed", message: "Could not create circle" });
      }
      return reply.code(201).send({
        circle: {
          id: String(row.id),
          name: row.name,
          color: row.color ?? null,
          description: row.description ?? null,
          // Echoed back rather than assumed: the client draws the flag from
          // this the moment the circle appears, and a create that silently
          // dropped the tag would look like it worked until the next refetch.
          kindTag: row.kind_tag ?? null,
          // Never set on a new circle. Kept in the response so CirclePreview
          // has the same shape on every path; nothing arranges itself around
          // it any more (see migration 034).
          classifiedKind: null,
          memberCount: 0,
          connectedCount: 0,
          preview: [],
          createdAt: row.created_at ?? null,
          updatedAt: row.updated_at ?? null,
        },
      });
    },
  );

  // ── PATCH /v1/me/circles/:id ──────────────────────────────────────────────────
  // Partial update — supply any subset of { name, color }. 404 if not owned.
  app.patch(
    "/v1/me/circles/:id",
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

      const body = request.body || {};
      const patch = {};
      if (typeof body.name === "string") {
        const trimmed = body.name.trim();
        if (!trimmed) {
          return reply
            .code(400)
            .send({ error: "invalid_name", message: "name cannot be empty" });
        }
        patch.name = trimmed;
      }
      if ("color" in body) {
        patch.color = typeof body.color === "string" ? body.color.trim() || null : null;
      }
      if ("description" in body) {
        patch.description =
          typeof body.description === "string" ? body.description.trim() || null : null;
      }
      if ("kindTag" in body) {
        // An explicit null or "" clears the tag, so a circle can go back to
        // untagged. updateCircle stores null for both.
        patch.kindTag =
          typeof body.kindTag === "string" ? body.kindTag.trim().slice(0, 24) : "";
      }
      if (Object.keys(patch).length === 0) {
        return reply.code(400).send({
          error: "no_fields",
          message: "Supply at least one of: name, color, description, kindTag",
        });
      }

      const row = await updateCircle(amberId, circleId, patch);
      if (!row) {
        return reply
          .code(404)
          .send({ error: "not_found", message: "Circle not found or not owned" });
      }
      return {
        circle: {
          id: String(row.id),
          name: row.name,
          color: row.color ?? null,
          description: row.description ?? null,
          kindTag: row.kind_tag ?? null,
          createdAt: row.created_at ?? null,
          updatedAt: row.updated_at ?? null,
        },
      };
    },
  );

  // ── DELETE /v1/me/circles/:id ─────────────────────────────────────────────────
  // Soft-delete a circle. Returns { deleted: 1 } on success, { deleted: 0 } if
  // the circle was not found or already deleted.
  app.delete(
    "/v1/me/circles/:id",
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

      const deleted = await softDeleteCircle(amberId, circleId);
      return { deleted };
    },
  );

  // ── GET /v1/me/circles/:id/members ───────────────────────────────────────────
  // All members of a circle, ordered by display name. 404 if not owned.
  app.get(
    "/v1/me/circles/:id/members",
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

      // Owner read first; if the caller does not own this circle, fall back to
      // an inbound read (they may be a member of someone else's circle).
      let members = await getCircleMembers(amberId, circleId);
      if (members === null) {
        const phone = request.privyUser?.phone ?? null;
        members = await getInboundCircleMembers(amberId, phone, circleId);
      }
      if (members === null) {
        return reply
          .code(404)
          .send({ error: "not_found", message: "Circle not found or not a member" });
      }
      return { members };
    },
  );

  // ── POST /v1/me/circles/:id/members ──────────────────────────────────────────
  // Add a contact (by contactId) to the circle. Both must belong to the caller.
  app.post(
    "/v1/me/circles/:id/members",
    {
      preHandler: [requireAuth],
      schema: {
        body: {
          type: "object",
          required: ["contactId"],
          properties: {
            contactId: { type: ["string", "integer"] },
          },
        },
      },
    },
    async (request, reply) => {
      const amberId = await resolveOwner(request, reply);
      if (!amberId) return;

      const circleId = parseId(request.params.id);
      if (!circleId) {
        return reply
          .code(400)
          .send({ error: "invalid_id", message: "id must be a uuid" });
      }

      const body = request.body || {};
      const contactId = parseId(body.contactId);
      if (!contactId) {
        return reply
          .code(400)
          .send({ error: "invalid_contact_id", message: "contactId must be a uuid" });
      }

      const result = await addCircleMember(amberId, circleId, contactId);

      if (result.status === "not_found") {
        return reply
          .code(404)
          .send({ error: "not_found", message: "Circle or contact not found or not owned" });
      }
      if (result.status === "invalid" || result.status === "error") {
        return reply
          .code(500)
          .send({ error: "member_add_failed", message: "Could not add member" });
      }
      // TELL THEM. Being added to someone's circle used to produce no signal of any
      // kind: no push, and nothing in the app until the member happened to open it
      // and the inbound query happened to resolve. "I made a circle and nobody saw
      // anything" was half a broken query and half this.
      //
      // Fired only on a genuinely new add, and only after addCircleMember has
      // stamped contacts.linked_amber_id — which is what makes the recipient
      // resolvable here at all. Awaited but fully swallowed inside notifyAmberUsers,
      // so it can slow this response slightly and can never fail it.
      if (result.status === "added") {
        // Detached, for the same reason as the batch route above: the response
        // does not depend on the push, and notifyAmberUsers already swallows
        // every failure of its own. Awaiting it put a push on the critical path
        // of a write the user was watching.
        void notifyCircleMemberAdded(app, amberId, circleId, contactId, request.log).catch(
          () => {},
        );
      }

      return {
        added: result.status === "added",
        alreadyPresent: result.status === "already_present",
        contactId: String(contactId),
      };
    },
  );

  // ── PUT /v1/me/circles/:id/members ──────────────────────────────────────────
  //
  // "I've been sitting here for 10 minutes trying to make one change to one
  //  circle and then create another one."
  //
  // The editor knows the final membership, so it sends the final membership.
  // Before this it computed a delta and applied it ONE CONTACT PER REQUEST,
  // sequentially, and each of those requests reconciled the facts for the whole
  // circle -- twenty members was twenty round trips over quadratic work, and any
  // one of them failing surfaced as "2 member changes didn't stick" with nothing
  // to act on.
  //
  // A SET rather than a delta, so a retry after a dropped response cannot
  // double-apply, and the client does not have to know what the server currently
  // believes. Ids that are not this owner's contacts come back in `unknown`
  // rather than failing the write: one stale id must not lose the other
  // nineteen.
  app.put(
    "/v1/me/circles/:id/members",
    {
      preHandler: [requireAuth],
      config: { rateLimit: { max: 60, timeWindow: "1 minute" } },
      schema: {
        body: {
          type: "object",
          required: ["contactIds"],
          properties: {
            // 200 is a ceiling against abuse, not a product limit on circle size.
            contactIds: { type: "array", maxItems: 200, items: { type: "string" } },
          },
        },
      },
    },
    async (request, reply) => {
      const amberId = await resolveOwner(request, reply);
      if (!amberId) return;

      const circleId = parseId(request.params.id);
      if (!circleId) {
        return reply
          .code(400)
          .send({ error: "invalid_id", message: "id must be a uuid" });
      }

      const result = await setCircleMembers(amberId, circleId, request.body?.contactIds);
      if (result.status === "not_found") {
        return reply
          .code(404)
          .send({ error: "not_found", message: "Circle not found or not owned" });
      }
      if (result.status !== "ok") {
        return reply
          .code(500)
          .send({ error: "members_set_failed", message: "Could not save the members" });
      }

      // TELL THE NEW MEMBERS, AND DO NOT MAKE HIM WAIT FOR IT.
      //
      // A push per member used to be awaited inside the add request, so twenty
      // members meant twenty pushes on the critical path of twenty requests.
      // The response does not depend on any of them, and notifyAmberUsers
      // swallows its own failures, so this is detached deliberately -- with
      // bounded concurrency so a thirty-person circle cannot flood the pool it
      // shares with the requests he is actually waiting on.
      if (result.added.length > 0) {
        void (async () => {
          for (let i = 0; i < result.added.length; i += 5) {
            await Promise.all(
              result.added
                .slice(i, i + 5)
                .map((ctid) =>
                  notifyCircleMemberAdded(app, amberId, circleId, ctid, request.log).catch(
                    () => {},
                  ),
                ),
            );
          }
        })();
      }

      request.log?.info?.(
        {
          circleId: String(circleId),
          added: result.added.length,
          removed: result.removed.length,
          unknown: result.unknown.length,
          total: result.total,
        },
        "[circles] membership set",
      );
      // COUNTS, not id arrays. The client renders a sentence ("18 added, 2
      // skipped") and refetches the membership on its way back, so the ids would
      // be dead weight in the payload and one more shape to keep in sync.
      return {
        added: result.added.length,
        removed: result.removed.length,
        // Reported, not fatal. Lets the client say "2 skipped" honestly instead of
        // "2 member changes didn't stick", which was never true and never actionable.
        unknown: result.unknown.length,
        memberCount: result.total,
      };
    },
  );

  // ── DELETE /v1/me/circles/:id/members/:contactId ──────────────────────────────
  // Remove a contact from a circle. Returns { removed: 1 } on success,
  // { removed: 0 } if the membership did not exist.
  app.delete(
    "/v1/me/circles/:id/members/:contactId",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const amberId = await resolveOwner(request, reply);
      if (!amberId) return;

      const circleId = parseId(request.params.id);
      const contactId = parseId(request.params.contactId);
      if (!circleId || !contactId) {
        return reply.code(400).send({
          error: "invalid_id",
          message: "id and contactId must be uuids",
        });
      }

      const removed = await removeCircleMember(amberId, circleId, contactId);
      return { removed };
    },
  );

  // ── GET /v1/me/contacts/:contactId/circles ────────────────────────────────────
  // Returns the circles a contact belongs to (for the caller). Used to render
  // circle badges on a contact profile card.
  app.get(
    "/v1/me/contacts/:contactId/circles",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const amberId = await resolveOwner(request, reply);
      if (!amberId) return;

      const contactId = parseId(request.params.contactId);
      if (!contactId) {
        return reply
          .code(400)
          .send({ error: "invalid_contact_id", message: "contactId must be a uuid" });
      }

      const circles = await getCirclesForContact(amberId, contactId);
      return { circles };
    },
  );

  // ── GET /v1/me/circles/members ────────────────────────────────────────────────
  //
  // Every member of every circle the caller owns, in one query.
  //
  // The web on Home draws one ring out of all of them at once and the filter
  // pills count all of them at once, so the page needs the whole set before it
  // can draw anything. Per-circle reads would mean a request per circle on every
  // open, with the ring assembling itself in front of the user.
  //
  // NOT A REPLACEMENT for the preview on /v1/me/circles: that carries the counts
  // and the first thirty faces for the pinned grid, which is all that grid
  // needs. This is for the surfaces that need everybody.
  app.get(
    "/v1/me/circles/members",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const amberId = await resolveOwner(request, reply);
      if (!amberId) return;
      const members = await getAllCircleMembers(amberId);
      if (members === null) {
        // A failed read is not "you have nobody". Saying so would make the web
        // draw an empty ring and every pill read zero, which is the exact
        // wrongness this endpoint exists to fix.
        return reply
          .code(503)
          .send({ error: "members_unavailable", message: "Could not read your circles." });
      }
      return { members };
    },
  );

  // ── GET /v1/me/circles/inbound ────────────────────────────────────────────────
  // Circles OTHER people added the caller to (resolved by account link or the
  // phone they registered with). Same preview shape as owned circles, plus
  // `owner`, `origin: "inbound"`, and `seen` (for the banner / new marker).
  app.get(
    "/v1/me/circles/inbound",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const amberId = await resolveOwner(request, reply);
      if (!amberId) return;
      const phone = request.privyUser?.phone ?? null;
      const inbound = await getInboundCirclesForViewer(amberId, phone);

      // ASK, RATHER THAN JUST APPEAR.
      //
      // Every circle here is one somebody ELSE made, containing people the
      // viewer may not know, and until now it simply showed up in their app with
      // no say in the matter. `openCircleInvites` materialises the question for
      // the circles that have not been asked yet -- seeding 'accepted' for any
      // the viewer has already opened, so nobody is asked to re-consent to a
      // circle they have been reading for weeks.
      //
      // The ids come from the inbound predicate above, never from the request.
      // Awaited because the answer decides what this response says: doing it in
      // the background would show the list as settled and then flip it to a
      // prompt on the next refresh.
      const inboundIds = inbound.map((c) => c.id);
      await openCircleInvites(amberId, inboundIds);
      const statuses = await circleInviteStatuses(amberId, inboundIds);

      const circles = await _withUnseen(
        amberId,
        phone,
        inbound
          // A circle they turned down stops being offered. The membership row is
          // already gone (the decline removes it); this is what stops the
          // owner's next address-book sync from putting it back in front of them.
          .filter((c) => statuses.get(c.id) !== "declined")
          .map((c) => ({
            ...c,
            // No row means accepted -- see the migration. The client shows the
            // accept prompt on 'pending' only, so an older client and a
            // grandfathered member both behave exactly as they do today.
            invite: statuses.get(c.id) ?? "accepted",
          })),
      );
      return { circles };
    },
  );

  // ── POST /v1/me/circles/:id/seen ──────────────────────────────────────────────
  // Mark an inbound circle as opened, so its "you were added" banner and new
  // marker stop showing. Idempotent.
  app.post(
    "/v1/me/circles/:id/seen",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const amberId = await resolveOwner(request, reply);
      if (!amberId) return;
      const id = parseId(request.params.id);
      if (!id) {
        return reply
          .code(400)
          .send({ error: "invalid_circle_id", message: "id must be a uuid" });
      }
      const ok = await markInboundCircleSeen(amberId, id);
      return { seen: ok };
    },
  );

  // ── POST /v1/me/circles/:id/invite ────────────────────────────────────────────
  //
  // "They should be notified that they are in the circle and be asked to accept
  //  if they want to join the circle."
  //
  // This is the answer. Body: { accept: boolean }.
  //
  // ACCEPT also marks the circle seen, because reading the prompt IS opening it
  // and leaving an unseen dot on a circle you just accepted is noise.
  //
  // DECLINE removes the membership as well as recording the answer. The two are
  // separate on purpose: leaving is reversible by the owner (they can add you
  // again tomorrow), and without the recorded decline their next address-book
  // sync would re-offer the same circle indefinitely.
  //
  // Membership is checked by leaveInboundCircle / the inbound predicate rather
  // than trusted from the caller: a circle id in a request body is not evidence
  // that the caller is in that circle.
  app.post(
    "/v1/me/circles/:id/invite",
    {
      preHandler: [requireAuth],
      schema: {
        body: {
          type: "object",
          required: ["accept"],
          properties: { accept: { type: "boolean" } },
        },
      },
    },
    async (request, reply) => {
      const amberId = await resolveOwner(request, reply);
      if (!amberId) return;
      const id = parseId(request.params.id);
      if (!id) {
        return reply
          .code(400)
          .send({ error: "invalid_circle_id", message: "id must be a uuid" });
      }
      const accept = request.body?.accept === true;
      const phone = request.privyUser?.phone ?? null;

      // THE AUTHORIZATION. An id the caller is not a member of resolves to no
      // circle here, and nothing is written.
      const inbound = await getInboundCirclesForViewer(amberId, phone);
      const match = inbound.find((c) => String(c.id) === String(id));
      if (!match) {
        return reply
          .code(404)
          .send({ error: "not_found", message: "You are not in that circle." });
      }

      const res = await respondToCircleInvite(amberId, id, accept);
      if (!res.status) {
        return reply
          .code(500)
          .send({ error: "respond_failed", message: "Could not record that." });
      }

      if (accept) {
        await markInboundCircleSeen(amberId, id).catch(() => {});
      } else {
        // Recorded first, removed second: if the removal fails the answer still
        // stands and the circle stops being offered, which is the direction that
        // respects what they said.
        await leaveInboundCircle(amberId, phone, id).catch(() => {});
      }

      request.log?.info?.(
        `[circles] invite ${res.status} viewer=${amberId} circle=${id}`,
      );
      return { status: res.status };
    },
  );

  // ── DELETE /v1/me/circles/:id/membership ──────────────────────────────────────
  // The caller leaves an inbound circle (a circle someone else owns). Owners use
  // DELETE /v1/me/circles/:id to remove the whole circle; this only removes the
  // caller's own membership. Returns { left: true } even if nothing matched, so
  // the app can treat it as idempotent.
  app.delete(
    "/v1/me/circles/:id/membership",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const amberId = await resolveOwner(request, reply);
      if (!amberId) return;
      const id = parseId(request.params.id);
      if (!id) {
        return reply
          .code(400)
          .send({ error: "invalid_circle_id", message: "id must be a uuid" });
      }
      const phone = request.privyUser?.phone ?? null;
      const removed = await leaveInboundCircle(amberId, phone, id);
      return { left: true, removed };
    },
  );
}

/**
 * Push "X added you to <circle>" to the newly added member, if that contact is a
 * registered Amber user.
 *
 * The recipient is read from contacts.linked_amber_id, which addCircleMember has
 * just stamped. A contact who is not on Amber has no link and gets nothing — which
 * is correct, and is why this reads the link rather than trying to resolve a phone
 * number a second time.
 */
async function notifyCircleMemberAdded(app, ownerId, circleId, contactId, log) {
  try {
    const { rows } = await query(
      `SELECT c.linked_amber_id, ci.name AS circle_name
         FROM contacts c
         JOIN circles ci ON ci.id = $3 AND ci.owner_id = $2 AND ci.deleted_at IS NULL
        WHERE c.id = $1 AND c.owner_id = $2 AND c.deleted_at IS NULL`,
      [contactId, ownerId, circleId],
    );
    const recipient = rows[0]?.linked_amber_id;
    if (!recipient || String(recipient) === String(ownerId)) return;
    const prof = await getUserProfileByAmberId(ownerId).catch(() => null);
    const who = prof?.name || prof?.fullName || "Someone";
    const circleName = rows[0]?.circle_name || "a circle";
    // THE PROMPT THAT GOES WITH THE PUSH. Without this the notification says
    // somebody added you to a circle and the app offers nothing to say back --
    // which is the whole complaint, one step earlier in the story. ON CONFLICT
    // DO NOTHING inside, so re-adding somebody who already accepted does not
    // re-ask them. The recipient is a member by construction here: the id came
    // from contacts.linked_amber_id on a row that is in this circle.
    await openCircleInvites(String(recipient), [String(circleId)]).catch(() => {});
    await notifyAmberUsers({
      ownerIds: [recipient],
      title: `${who} added you to ${circleName}`,
      body: "Open Amber to accept or decline.",
      // `type` must be one the app's notification handler routes on, or tapping
      // this does nothing.
      data: { type: "circle", circleId: String(circleId) },
      // The person who added them, so a mute means "not from them" rather than
      // "not about circles".
      fromAmberId: ownerId,
      log,
    });
  } catch (err) {
    log?.warn?.({ err: err?.message }, "[circles] member-added push failed");
  }
}
