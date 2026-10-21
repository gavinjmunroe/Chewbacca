/**
 * API key middleware (Fastify preHandler).
 *
 * Validates `Authorization: Bearer tgi_live_...` headers against
 * togari_dnc.api_keys (SHA-256 hash lookup). On hit (and not revoked),
 * stashes the ApiKeyContext on `request.apiKey` and async-bumps last_used_at.
 * On miss or malformed, replies 401.
 *
 * Used by every Clay-callable route in dedup/api/ — people/match, people/:id,
 * push-to-apple — so route handlers can read `request.apiKey.ownerDid` and
 * filter all BQ queries by it.
 */

import type { FastifyRequest, FastifyReply } from "fastify";
import type { ApiKeyContext } from "../types/index.ts";
import { verifyKey } from "./api-keys.ts";

declare module "fastify" {
  interface FastifyRequest {
    apiKey?: ApiKeyContext;
  }
}

export async function validateApiKey(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const headers = request.headers;
  const rawAuth = headers["authorization"] ?? headers["Authorization"];
  const auth = Array.isArray(rawAuth) ? rawAuth[0] : rawAuth;

  if (typeof auth !== "string" || !auth.toLowerCase().startsWith("bearer ")) {
    await reply.status(401).send({
      error: "Missing or malformed Authorization header (expected Bearer)",
    });
    return;
  }

  const token = auth.slice(7).trim();
  if (!token.startsWith("tgi_live_")) {
    await reply
      .status(401)
      .send({ error: "Invalid API key format (expected tgi_live_*)" });
    return;
  }

  try {
    const ctx = await verifyKey(token);
    if (!ctx) {
      await reply.status(401).send({ error: "Invalid or revoked API key" });
      return;
    }
    request.apiKey = ctx;
  } catch (err) {
    process.stderr.write(
      `[api-keys] verify failed: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    await reply.status(500).send({ error: "Key verification failed" });
  }
}
