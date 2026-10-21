/**
 * Dashboard-facing API key management — Privy-gated.
 *
 * Auth: Privy bearer JWT (NOT the issued `tgi_live_` key). The dashboard user
 * logs in via Privy in medha-frontend, sends their bearer JWT here, and uses
 * these endpoints to mint / list / revoke long-lived keys that Clay will paste
 * into HTTP API columns.
 *
 * The Privy DID (request.privyUser.userId) is the `owner_did` stamped on every
 * issued key. Every read/write is scoped by that DID — one user cannot see or
 * revoke another user's keys.
 *
 * Ported from togari-bma-dvlp/src/dnc/api/api-keys.routes.ts with two changes:
 *   1. Express → Fastify (route options + reply.send)
 *   2. Auth0 JWT validator → session bridge from WS-2 (dedup/auth/auth-bridge.ts)
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";

import { issueKey, listKeys, revokeKey } from "../auth/api-keys.ts";
import { validateSessionToken } from "../auth/auth-bridge.ts";

interface CreateKeyBody {
  name?: unknown;
}

function getOwnerDid(request: FastifyRequest): string | null {
  const did = request.privyUser?.userId;
  return typeof did === "string" && did.length > 0 ? did : null;
}

export async function registerApiKeyRoutes(
  app: FastifyInstance,
): Promise<void> {
  app.post(
    "/api/v1/keys",
    { preHandler: validateSessionToken },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const ownerDid = getOwnerDid(request);
      if (!ownerDid) {
        return reply
          .code(401)
          .send({ error: "missing_user", code: "missing_user" });
      }

      const body = (request.body ?? {}) as CreateKeyBody;
      const rawName = body.name;
      const name =
        typeof rawName === "string" && rawName.trim() ? rawName.trim() : null;

      try {
        const issued = await issueKey(ownerDid, name);
        return reply.code(201).send(issued);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        request.log.error({ err }, "[api-keys] issue failed");
        return reply.code(500).send({
          error: "issue_failed",
          code: "issue_failed",
          detail: msg.slice(0, 400),
        });
      }
    },
  );

  app.get(
    "/api/v1/keys",
    { preHandler: validateSessionToken },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const ownerDid = getOwnerDid(request);
      if (!ownerDid) {
        return reply
          .code(401)
          .send({ error: "missing_user", code: "missing_user" });
      }

      try {
        const keys = await listKeys(ownerDid);
        return reply.send({ keys });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        request.log.error({ err }, "[api-keys] list failed");
        return reply.code(500).send({
          error: "list_failed",
          code: "list_failed",
          detail: msg.slice(0, 400),
        });
      }
    },
  );

  app.delete<{ Params: { keyId: string } }>(
    "/api/v1/keys/:keyId",
    { preHandler: validateSessionToken },
    async (request, reply) => {
      const ownerDid = getOwnerDid(request);
      if (!ownerDid) {
        return reply
          .code(401)
          .send({ error: "missing_user", code: "missing_user" });
      }

      const { keyId } = request.params;
      if (!keyId) {
        return reply
          .code(400)
          .send({ error: "missing_key_id", code: "missing_key_id" });
      }

      try {
        await revokeKey(keyId, ownerDid);
        return reply.code(204).send();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        request.log.error({ err, keyId }, "[api-keys] revoke failed");
        return reply.code(500).send({
          error: "revoke_failed",
          code: "revoke_failed",
          detail: msg.slice(0, 400),
        });
      }
    },
  );
}
