/**
 * Amber Network favorites — the people the user hand-picks as their real
 * relationships. Owner-scoped; nothing accepts an owner id from the body.
 *
 *   GET    /v1/me/favorites            → { favorites: [{id,name,title,company,tags,position}] }
 *   POST   /v1/me/favorites            → { ok } ; body { contactId, note?, tags? }
 *   PUT    /v1/me/favorites/order      → { ok } ; body { contactIds: [...] }
 *   DELETE /v1/me/favorites/:contactId → { ok }
 *
 * Favorites are a hand-arranged 4x4 grid, so their ORDER is part of the data and
 * the count is capped at 16 (MAX_FAVORITES). The cap is enforced here rather than in
 * the store because a repeat POST for someone already pinned is an update, not a new
 * pin, and must not be refused for being over the limit.
 *
 * On add, an optional `note` (already transcribed on the device from a voice
 * memo — "how I know them", "why they matter") is written straight to that
 * contact via insertContactNote with the contact id as the sole participant, so
 * it lands on their card with no name-resolution ambiguity.
 */

import { requireAuth as defaultRequireAuth } from "../lib/auth-session.js";
import {
  resolveAmberIdByPhone as defaultResolveAmberIdByPhone,
  insertContactNote,
} from "../db/store.js";
import {


  listFavorites,
  addFavorite,
  contactExistsForOwner,
  countFavorites,
  removeFavorite,
  reorderFavorites,
  MAX_FAVORITES,
} from "../db/favorites-store.js";

// A contact id is a uuid. Declared here rather than inlined so the checks in
// this file cannot drift apart.
const _CONTACT_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;


export function registerFavoritesRoutes(app, deps = {}) {
  const requireAuth = deps.requireAuth || defaultRequireAuth;
  const resolveAmberIdByPhone = deps.resolveAmberIdByPhone || defaultResolveAmberIdByPhone;

  async function resolveOwner(request, reply) {
    if (!request.privyUser?.userId) {
      reply.code(401).send({ error: "no_user", message: "Auth required" });
      return null;
    }
    const phone = request.privyUser?.phone;
    if (!phone) {
      reply.code(400).send({ error: "no_phone_on_session", message: "Session carries no phone." });
      return null;
    }
    const amberId = await resolveAmberIdByPhone(phone).catch(() => null);
    if (!amberId) {
      reply.code(400).send({ error: "could_not_resolve_owner", message: "Could not resolve owner." });
      return null;
    }
    return amberId;
  }

  app.get("/v1/me/favorites", { preHandler: [requireAuth] }, async (request, reply) => {
    const ownerId = await resolveOwner(request, reply);
    if (!ownerId) return;
    try {
      const favorites = await listFavorites(ownerId);
      request.log.info({ count: favorites.length, ownerId }, "[favorites] list");
      return { favorites };
    } catch (e) {
      request.log.error({ err: e?.message }, "[favorites] list FAILED");
      return reply
        .code(500)
        .send({ error: "favorites_unavailable", message: "Could not load favorites." });
    }
  });

  app.post(
    "/v1/me/favorites",
    {
      preHandler: [requireAuth],
      schema: {
        body: {
          type: "object",
          required: ["contactId"],
          properties: {
            contactId: { type: "string", minLength: 1, maxLength: 100 },
            note: { type: "string", maxLength: 4000 },
            tags: {
              type: "array",
              maxItems: 12,
              items: { type: "string", maxLength: 40 },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const ownerId = await resolveOwner(request, reply);
      if (!ownerId) return;

      const body = request.body || {};
      const contactId = String(body.contactId).trim();
      if (!contactId) {
        return reply.code(400).send({ error: "contact_required", message: "contactId is required" });
      }

      // Verify the contact belongs to this owner BEFORE inserting. listFavorites
       // inner-joins contacts, so pinning an id that isn't a real contact row would
       // return ok:true and then never appear — the exact bug this guards.
      const exists = await contactExistsForOwner(ownerId, contactId);
      request.log.info({ ownerId, contactId, exists }, "[favorites] pin attempt");
      if (!exists) {
        return reply.code(404).send({
          error: "contact_not_found",
          message:
            "That contact isn't in your Amber address book yet, so it can't be pinned. Sync your contacts and try again.",
        });
      }

      // THE CAP, and only for a genuinely NEW pin. A repeat POST for someone
      // already in the grid is how a note that finished transcribing after the tap
      // gets attached, and rejecting that would lose the note.
      const already = (await listFavorites(ownerId).catch(() => [])).some(
        (f) => String(f.id) === contactId,
      );
      if (!already) {
        const n = await countFavorites(ownerId);
        // -1 means the count could not be read. Refuse rather than guess: silently
        // allowing a 17th would leave a grid the client cannot lay out.
        if (n < 0) {
          return reply
            .code(503)
            .send({ error: "favorites_unavailable", message: "Could not check your favorites." });
        }
        if (n >= MAX_FAVORITES) {
          return reply.code(409).send({
            error: "favorites_full",
            max: MAX_FAVORITES,
            message: `You can pin ${MAX_FAVORITES} favorites. Unpin someone first.`,
          });
        }
      }

      const ok = await addFavorite(ownerId, contactId, body.tags);
      if (!ok) {
        return reply.code(500).send({ error: "add_failed", message: "Could not add favorite." });
      }

      const note = typeof body.note === "string" ? body.note.trim() : "";
      if (note) {
        // Number() of a uuid is NaN, Number.isFinite said no, and the note was
        // written with NO participants -- attached to nobody, on the person's own
        // favorite.
        const cid = _CONTACT_ID_RE.test(String(contactId)) ? String(contactId) : null;
        await insertContactNote({
          ownerId,
          noteText: note,
          participantIds: cid ? [cid] : [],
          rawNames: [],
          status: "resolved",
          source: "app_favorite",
        }).catch((err) => {
          request.log?.warn?.({ err: err?.message }, "[favorites] note write failed");
          return null;
        });
      }

      request.log.info({ ownerId, contactId }, "[favorites] pinned OK");
      return { ok: true };
    },
  );

  /**
   * PUT /v1/me/favorites/order — the hand-arranged grid order.
   *
   * Takes the FULL list of ids in their new order rather than a moved-item delta.
   * A delta needs the server and the client to agree on the order they started
   * from, and after a drag on a stale list they do not; the whole array cannot
   * disagree with itself.
   */
  app.put(
    "/v1/me/favorites/order",
    {
      preHandler: [requireAuth],
      schema: {
        body: {
          type: "object",
          required: ["contactIds"],
          properties: {
            contactIds: {
              type: "array",
              minItems: 1,
              maxItems: MAX_FAVORITES,
              items: { type: "string", minLength: 1, maxLength: 100 },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const ownerId = await resolveOwner(request, reply);
      if (!ownerId) return;
      const ok = await reorderFavorites(ownerId, request.body.contactIds);
      if (!ok) {
        return reply
          .code(500)
          .send({ error: "reorder_failed", message: "Could not save that order." });
      }
      return { ok: true };
    },
  );

  app.delete(
    "/v1/me/favorites/:contactId",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const ownerId = await resolveOwner(request, reply);
      if (!ownerId) return;
      const contactId = String(request.params?.contactId || "").trim();
      if (!contactId) {
        return reply.code(400).send({ error: "contact_required", message: "contactId is required" });
      }
      await removeFavorite(ownerId, contactId);
      return { ok: true };
    },
  );
}
