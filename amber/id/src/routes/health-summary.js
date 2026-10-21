import { createHash } from "node:crypto";
import { requireAuth } from "../lib/auth-session.js";
import { resolveAmberIdByPhone } from "../db/store.js";
import { insertObservation } from "../db/observations-store.js";
/** Explicit, private summary only. No raw Health samples, contact attribution, inference or model call. */
export function registerHealthSummaryRoutes(app, deps = {}) {
  app.post(
    "/v1/me/health-summary",
    {
      preHandler: [deps.auth || requireAuth],
      config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["requestId", "from", "to", "consent"],
          properties: {
            requestId: { type: "string", format: "uuid" },
            consent: { const: true },
            from: { type: "string", format: "date-time" },
            to: { type: "string", format: "date-time" },
            steps: { type: "integer", minimum: 0, maximum: 200000 },
            workoutMinutes: { type: "integer", minimum: 0, maximum: 1440 },
          },
        },
      },
    },
    async (req, reply) => {
      const ownerId = req.privyUser?.phone
        ? await (deps.resolve || resolveAmberIdByPhone)(req.privyUser.phone)
        : null;
      if (!ownerId) return reply.code(401).send({ error: "no_session" });
      const { from, to, steps, workoutMinutes, requestId } = req.body;
      const start = Date.parse(from),
        end = Date.parse(to);
      if (
        end <= start ||
        end - start > 26 * 3600000 ||
        end > Date.now() + 300000 ||
        (steps == null && workoutMinutes == null)
      )
        return reply.code(400).send({ error: "invalid_summary" });
      const hash = createHash("sha256")
        .update(JSON.stringify([ownerId, "health-summary", requestId]))
        .digest("hex");
      const observationId = `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
      const body = `Apple Health activity summary, reviewed and saved by me. Window: ${from} to ${to}. ${steps == null ? "" : `Steps: ${steps}.`} ${workoutMinutes == null ? "" : `Workout minutes: ${workoutMinutes}.`}`;
      try {
        await (deps.insert || insertObservation)({
          ownerId,
          observationId,
          kind: "note",
          body,
          source: "manual",
          createEvent: false,
          dimensions: [],
          observedAt: to,
        });
        return { ok: true, observationId };
      } catch (error) {
        return reply
          .code(error.message === "memo_action_conflict" ? 409 : 503)
          .send({ error: "summary_save_unconfirmed" });
      }
    },
  );
}
