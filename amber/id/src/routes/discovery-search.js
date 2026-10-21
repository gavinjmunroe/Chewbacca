import { requireAuth } from "../lib/auth-session.js";
import { resolveAmberIdByPhone } from "../db/store.js";
import { getClayJob, reserveClayJob, updateClayJob } from "../db/clay-jobs.js";
import { registerDiscoverySave } from "./discovery-save.js";
import { exaDiscovery, exaDiscoveryKey } from "../lib/exa-discovery.js";
const messages = {
  exa_not_configured:
    "Global search is not available yet. Your saved People and Plans are still searchable.",
  search_unavailable:
    "Web search could not finish this search. Please try again.",
  search_quota: "The search allowance has been reached. Please try later.",
  request_conflict:
    "This request belongs to a different search. Start a new search.",
};
const envelope = (job) => {
  const started = Date.parse(job.created_at || job.createdAt);
  if (["pending", "processing"].includes(job.status) && Number.isFinite(started) && Date.now() - started > 120000)
    return { id: job.id, status: "error", error: "search_unavailable", message: messages.search_unavailable };
  return { id: job.id, status: job.status, ...job.output };
};
const uuid = { type: "string", format: "uuid" };
export function registerDiscoverySearchRoutes(app, deps = {}) {
  registerDiscoverySave(app, deps);
  const auth = deps.auth || requireAuth,
    resolve = deps.resolve || resolveAmberIdByPhone;
  const get = deps.get || getClayJob,
    reserve = deps.reserve || reserveClayJob;
  const update = deps.update || updateClayJob,
    search = deps.search || exaDiscovery;
  async function owner(req) {
    return req.privyUser?.phone ? resolve(req.privyUser.phone) : null;
  }
  app.get(
    "/v1/me/discovery/jobs/:id",
    {
      preHandler: [auth],
      schema: {
        params: { type: "object", required: ["id"], properties: { id: uuid } },
      },
    },
    async (req, reply) => {
      const id = await owner(req);
      if (!id) return reply.code(401).send({ error: "no_session" });
      const job = await get(id, req.params.id);
      if (!job || !["perplexity", "exa"].includes(job.input?.provider))
        return reply.code(404).send({ error: "not_found" });
      return envelope(job);
    },
  );
  app.post(
    "/v1/me/discovery/search",
    {
      preHandler: [auth],
      config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["requestId", "query", "scope"],
          properties: {
            requestId: uuid,
            query: { type: "string", minLength: 2, maxLength: 500 },
            scope: { type: "string", enum: ["people", "plans"] },
            location: { type: "string", minLength: 2, maxLength: 160 },
          },
        },
      },
    },
    async (req, reply) => {
      const ownerId = await owner(req);
      if (!ownerId) return reply.code(401).send({ error: "no_session" });
      const input = {
        query: req.body.query.trim(),
        scope: req.body.scope,
        provider: "exa",
        ...(req.body.scope === "plans" ? { location: (req.body.location || "").trim() } : {}),
      };
      const id = req.body.requestId;
      if (input.scope === "plans" && input.location.length < 2)
        return reply.code(400).send({ error: "location_required", message: "Choose a city to find places." });
      if (input.query.length < 2)
        return reply.code(400).send({ error: "invalid_query" });
      try {
        // Existing results can be re-read even during a provider outage.
        const prior = await get(ownerId, id);
        if (!prior && !deps.search) exaDiscoveryKey();
        const { created, job } = prior
          ? { created: false, job: prior }
          : await reserve(ownerId, { id, kind: "search", input });
        if (
          job.kind !== "search" ||
          Object.keys(input).some((k) => job.input[k] !== input[k])
        )
          throw Error("request_conflict");
        if (!created) return envelope(job);
        try {
          return envelope(
            await update(ownerId, id, {
              status: "complete",
              output: await search(input),
            }),
          );
        } catch (err) {
          const error = messages[err.message]
            ? err.message
            : "search_unavailable";
          return envelope(
            await update(ownerId, id, {
              status: "error",
              output: { error, message: messages[error] },
            }),
          );
        }
      } catch (err) {
        const error =
          err.message === "clay_quota"
            ? "search_quota"
            : messages[err.message]
              ? err.message
              : "search_unavailable";
        return reply
          .code(
            error === "request_conflict"
              ? 409
              : error === "search_quota"
                ? 429
                : 503,
          )
          .send({ error, message: messages[error] });
      }
    },
  );
}
