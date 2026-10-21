/**
 * Clay-callable people API. Single-record only — batch lives elsewhere.
 *
 *   POST   /api/v1/people/match           → MatchResult
 *   POST   /api/v1/people                 → 201 { contact }
 *   PATCH  /api/v1/people/:contact_id     → 200 { contact }
 *
 * All routes sit behind validateApiKey. The owner_did is sourced from
 * request.apiKey — never from the request body, so a caller cannot
 * mutate another tenant's data.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { validateApiKey } from "../auth/api-key-middleware.ts";
import { Matcher, MatcherError } from "../dedup/matcher.ts";
import type {
  ApiKeyContext,
  MatchRequest,
  UnifiedContact,
} from "../types/index.ts";

function getOwnerDid(request: FastifyRequest): string {
  const ctx = request.apiKey as ApiKeyContext | undefined;
  if (!ctx?.ownerDid) throw new Error("apiKey context missing on request");
  return ctx.ownerDid;
}

async function bad(reply: FastifyReply, message: string): Promise<void> {
  await reply.status(400).send({ error: message });
}

export async function registerPeopleRoutes(
  app: FastifyInstance,
): Promise<void> {
  const matcher = new Matcher();

  app.post<{ Body: MatchRequest }>(
    "/api/v1/people/match",
    { preHandler: validateApiKey },
    async (request, reply) => {
      const ownerDid = getOwnerDid(request);
      const body = (request.body ?? {}) as MatchRequest;

      if (
        typeof body !== "object" ||
        (!body.email && !body.linkedin && !body.phone && !body.name)
      ) {
        await bad(
          reply,
          "match requires at least one of: email, linkedin, phone, name",
        );
        return;
      }

      return matcher.match(ownerDid, {
        name: body.name,
        email: body.email,
        linkedin: body.linkedin,
        phone: body.phone,
      });
    },
  );

  app.post<{ Body: Partial<UnifiedContact> }>(
    "/api/v1/people",
    { preHandler: validateApiKey },
    async (request, reply) => {
      const ownerDid = getOwnerDid(request);
      const body = (request.body ?? {}) as Partial<UnifiedContact>;

      if (typeof body !== "object" || Object.keys(body).length === 0) {
        await bad(reply, "create requires a contact body");
        return;
      }

      const contact = await matcher.create(ownerDid, body);
      await reply.status(201).send({ contact });
    },
  );

  app.patch<{
    Params: { contact_id: string };
    Body: Partial<UnifiedContact>;
  }>(
    "/api/v1/people/:contact_id",
    { preHandler: validateApiKey },
    async (request, reply) => {
      const ownerDid = getOwnerDid(request);
      const contactId = request.params.contact_id;
      const body = (request.body ?? {}) as Partial<UnifiedContact>;

      if (!contactId) {
        await bad(reply, "contact_id path param is required");
        return;
      }

      if (typeof body !== "object" || Object.keys(body).length === 0) {
        await bad(reply, "patch requires at least one field");
        return;
      }

      try {
        const contact = await matcher.update(ownerDid, contactId, body);
        return { contact };
      } catch (err) {
        if (err instanceof MatcherError && err.code === "not_found") {
          await reply.status(404).send({ error: err.message });
          return;
        }
        throw err;
      }
    },
  );

  app.log.info("[dedup] people routes mounted (match, create, update)");
}
