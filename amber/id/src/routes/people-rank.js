import { requireAuth as defaultRequireAuth } from "../lib/auth-session.js";
import { rankDidViaTogari } from "../enrichment/togari-search-rank.js";

const BODY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    query: { type: "string", maxLength: 500 },
    limit: { type: "integer", minimum: 1, maximum: 50 },
    // Accepted for older app builds. The server derives this profile from the
    // verified account so a client cannot influence another user's rank inputs.
    me: { type: "object", additionalProperties: true },
  },
};

export function registerPeopleRankRoutes(app, deps = {}) {
  const requireAuth = deps.requireAuth || defaultRequireAuth;
  const rank = deps.rank || deps.rankDidViaTogari || rankDidViaTogari;

  app.post(
    "/v1/me/people-rank",
    { preHandler: [requireAuth], schema: { body: BODY_SCHEMA } },
    async (request, reply) => {
      const did = request.privyUser?.userId;
      if (!did) return reply.code(401).send({ error: "auth_required" });

      const query = typeof request.body?.query === "string"
        ? request.body.query.trim()
        : "";
      const limit = request.body?.limit ?? 15;
      try {
        const outcome = await rank(did, { query: query || undefined, limit });
        if (outcome?.ok && outcome.result) return outcome.result;
        if (outcome?.error === "no_contacts") {
          return {
            query: query || null,
            count: 0,
            people: [],
            answer: null,
            answer_status: "no_contacts",
            citations: [],
          };
        }
        request.log?.warn?.(
          { reason: outcome?.error || "invalid_rank_result" },
          "[people-rank] ranking unavailable",
        );
        return reply.code(503).send({ error: "people_rank_unavailable" });
      } catch (err) {
        request.log?.error?.({ err }, "[people-rank] request failed");
        return reply.code(503).send({ error: "people_rank_unavailable" });
      }
    },
  );
}
