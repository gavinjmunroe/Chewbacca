import { appendPlanMemo } from "../lib/plan-memo-note.js";
import { requireAuth } from "../lib/auth-session.js";
import { resolveAmberIdByPhone } from "../db/store.js";
import { findMemoPlans, updateMemoPlan } from "../lib/memo-plans.js";
export function registerMemoPlanRoutes(app, deps = {}) {
  const auth = deps.auth || requireAuth;
  async function owner(req) {
    return req.privyUser?.phone
      ? (deps.resolve || resolveAmberIdByPhone)(req.privyUser.phone)
      : null;
  }
  app.get(
    "/v1/me/memo-plans",
    {
      preHandler: [auth],
      schema: {
        querystring: {
          type: "object",
          required: ["q"],
          properties: { q: { type: "string", maxLength: 200 } },
        },
      },
    },
    async (req, reply) => {
      const ownerId = await owner(req);
      if (!ownerId) return reply.code(401).send({ error: "no_session" });
      return {
        plans: await (deps.find || findMemoPlans)(ownerId, req.query.q),
      };
    },
  );
  app.post(
    "/v1/me/memo-plans/:id/memos",
    {
      preHandler: [auth],
      schema: {
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string", format: "uuid" } },
        },
        body: {
          type: "object",
          additionalProperties: false,
          required: ["requestId", "conversationId", "text", "contactIds"],
          properties: {
            requestId: { type: "string", format: "uuid" },
            conversationId: { type: "string", format: "uuid" },
            text: { type: "string", minLength: 1, maxLength: 4000 },
            contactIds: {
              type: "array",
              maxItems: 30,
              uniqueItems: true,
              items: { type: "string", format: "uuid" },
            },
          },
        },
      },
    },
    async (req, reply) => {
      const ownerId = await owner(req);
      if (!ownerId) return reply.code(401).send({ error: "no_session" });
      try {
        return await (deps.append || appendPlanMemo)({
          ...req.body,
          eventId: req.params.id,
          ownerId,
        });
      } catch (error) {
        return reply
          .code(error.status || 503)
          .send({ error: "plan_memo_unconfirmed" });
      }
    },
  );
  app.patch(
    "/v1/me/memo-plans/:id",
    {
      preHandler: [auth],
      schema: {
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string", format: "uuid" } },
        },
        body: {
          type: "object",
          additionalProperties: false,
          required: [
            "version",
            "title",
            "startsAt",
            "endsAt",
            "description",
            "place",
          ],
          properties: {
            version: { type: "string", pattern: "^[a-f0-9]{64}$" },
            title: { type: "string", minLength: 1, maxLength: 200 },
            description: { type: "string", maxLength: 2000 },
            place: { type: "string", maxLength: 200 },
            startsAt: { type: "string", maxLength: 40 },
            endsAt: { type: "string", maxLength: 40 },
          },
        },
      },
    },
    async (req, reply) => {
      const ownerId = await owner(req);
      if (!ownerId) return reply.code(401).send({ error: "no_session" });
      try {
        return await (deps.update || updateMemoPlan)({
          ...req.body,
          id: req.params.id,
          ownerId,
        });
      } catch (e) {
        return reply.code(e.status || 503).send({
          error: e.code || "plan_update_unconfirmed",
          message:
            e.code === "plan_changed"
              ? "This plan changed. Choose it again to review the latest details."
              : "The plan update was not confirmed. Keep this draft and try again.",
        });
      }
    },
  );
}
