/**
 * Pinned circles — the ones the user wants on their profile, in their order.
 *
 *   GET    /v1/me/circle-favorites          → { circles: [{id,name,color,classifiedKind,memberCount,preview,position}] }
 *   POST   /v1/me/circle-favorites          → { ok }  ; body { circleId }
 *   PUT    /v1/me/circle-favorites/order    → { ok }  ; body { circleIds: [...] }
 *   DELETE /v1/me/circle-favorites/:circleId → { ok }
 *
 * Owner-scoped: nothing accepts an owner id from the body or the path. The
 * shape mirrors /v1/me/favorites (contacts) on purpose, because the client
 * reuses one drag-and-drop grid for both and a second set of conventions for
 * one interaction is how the two drift apart.
 *
 * The cap (nine) is enforced HERE rather than in the store, because pinning is
 * an upsert: re-pinning a circle already in the nine is not a new pin and must
 * not be refused for being over the limit.
 */

import { requireAuth as defaultRequireAuth } from "../lib/auth-session.js";
import { resolveAmberIdByPhone as defaultResolveAmberIdByPhone } from "../db/store.js";
import {
  listPinnedCircles,
  pinCircle,
  unpinCircle,
  reorderPinnedCircles,
  circleExistsForOwner,
  countPinnedCircles,
  MAX_PINNED_CIRCLES,
} from "../db/circle-favorites-store.js";

const _UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function registerCircleFavoritesRoutes(app, deps = {}) {
  const requireAuth = deps.requireAuth || defaultRequireAuth;
  const resolveAmberIdByPhone = deps.resolveAmberIdByPhone || defaultResolveAmberIdByPhone;
  const list = deps.listPinnedCircles || listPinnedCircles;
  const pin = deps.pinCircle || pinCircle;
  const unpin = deps.unpinCircle || unpinCircle;
  const reorder = deps.reorderPinnedCircles || reorderPinnedCircles;
  const exists = deps.circleExistsForOwner || circleExistsForOwner;
  const count = deps.countPinnedCircles || countPinnedCircles;

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
      reply
        .code(400)
        .send({ error: "could_not_resolve_owner", message: "Could not resolve owner." });
      return null;
    }
    return amberId;
  }

  // ── GET ────────────────────────────────────────────────────────────────
  app.get("/v1/me/circle-favorites", { preHandler: [requireAuth] }, async (request, reply) => {
    const ownerId = await resolveOwner(request, reply);
    if (!ownerId) return;
    try {
      return { circles: await list(ownerId) };
    } catch (e) {
      // A 500 rather than an empty list: the app can render "couldn't load",
      // and "you have no pinned circles" is a different sentence from "we could
      // not ask". This is the exact failure that hid the broken contact
      // favorites join for weeks.
      request.log?.error?.(`CIRCLE_FAVORITES_LIST_FAILED owner=${ownerId}: ${e?.message}`);
      return reply
        .code(500)
        .send({ error: "list_failed", message: "Could not load your pinned circles." });
    }
  });

  // ── POST ───────────────────────────────────────────────────────────────
  app.post(
    "/v1/me/circle-favorites",
    {
      preHandler: [requireAuth],
      schema: {
        body: {
          type: "object",
          required: ["circleId"],
          properties: { circleId: { type: "string", maxLength: 64 } },
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      const ownerId = await resolveOwner(request, reply);
      if (!ownerId) return;
      const circleId = String(request.body?.circleId || "").trim();
      if (!_UUID_RE.test(circleId)) {
        return reply.code(400).send({ error: "invalid_circle_id" });
      }
      // BEFORE INSERTING. The read INNER JOINs circles, so a stale or foreign id
      // would insert, answer ok, and then be invisible forever.
      if (!(await exists(ownerId, circleId))) {
        return reply
          .code(404)
          .send({ error: "circle_not_found", message: "No circle of yours with that id." });
      }

      const already = await list(ownerId).catch(() => null);
      if (already && !already.some((c) => c.id === circleId)) {
        const n = already.length;
        if (n >= MAX_PINNED_CIRCLES) {
          return reply.code(409).send({
            error: "too_many_pinned",
            message: `You can pin ${MAX_PINNED_CIRCLES} circles. Unpin one first.`,
            max: MAX_PINNED_CIRCLES,
          });
        }
      } else if (!already) {
        // The list read failed, so we cannot tell a re-pin from a new pin and
        // cannot know the count. Refuse rather than risk a tenth pin — the cap
        // is the whole shape of the grid.
        const n = await count(ownerId);
        if (n < 0 || n >= MAX_PINNED_CIRCLES) {
          return reply
            .code(409)
            .send({ error: "too_many_pinned", max: MAX_PINNED_CIRCLES });
        }
      }

      const ok = await pin(ownerId, circleId);
      if (!ok) {
        return reply
          .code(500)
          .send({ error: "pin_failed", message: "Could not pin that circle." });
      }
      return { ok: true };
    },
  );

  // ── PUT /order ─────────────────────────────────────────────────────────
  app.put(
    "/v1/me/circle-favorites/order",
    {
      preHandler: [requireAuth],
      schema: {
        body: {
          type: "object",
          required: ["circleIds"],
          properties: {
            circleIds: {
              type: "array",
              maxItems: MAX_PINNED_CIRCLES,
              items: { type: "string", maxLength: 64 },
            },
          },
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      const ownerId = await resolveOwner(request, reply);
      if (!ownerId) return;
      const ids = (request.body?.circleIds ?? []).map((x) => String(x).trim());
      if (ids.length === 0 || ids.some((id) => !_UUID_RE.test(id))) {
        return reply.code(400).send({ error: "invalid_circle_ids" });
      }
      const ok = await reorder(ownerId, ids);
      if (!ok) {
        return reply
          .code(500)
          .send({ error: "reorder_failed", message: "Could not save that order." });
      }
      return { ok: true };
    },
  );

  // ── DELETE ─────────────────────────────────────────────────────────────
  app.delete(
    "/v1/me/circle-favorites/:circleId",
    { preHandler: [requireAuth] },
    async (request, reply) => {
      const ownerId = await resolveOwner(request, reply);
      if (!ownerId) return;
      const circleId = String(request.params?.circleId || "").trim();
      if (!_UUID_RE.test(circleId)) {
        return reply.code(400).send({ error: "invalid_circle_id" });
      }
      const ok = await unpin(ownerId, circleId);
      if (!ok) {
        return reply
          .code(500)
          .send({ error: "unpin_failed", message: "Could not unpin that circle." });
      }
      return { ok: true };
    },
  );
}
