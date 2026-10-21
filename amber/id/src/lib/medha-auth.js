/**
 * medha-auth — Fastify preHandler middleware for Medha dashboard sessions.
 *
 * Three flavors:
 *
 *   - requireMedhaJwt:        accept ONLY a valid medha-jwt Bearer token.
 *   - requireApiKeyOrMedha:   accept either a service API key (x-api-key)
 *                             OR a medha-jwt Bearer (used on endpoints
 *                             agents AND users both touch).
 *
 * On success the request is annotated with:
 *   - request.medhaSession = { personId, phone, issuedAt, expiresAt }
 *
 * The API-key path additionally stamps the same fields that requireApiKey
 * stamps in src/lib/auth.js so audit logs stay consistent.
 */

import { verifyBearerFromRequest } from "./medha-jwt.js";
import { identifyApiKey } from "./auth.js";
import { instanceId } from "./instance.js";

function firstHeaderValue(value) {
  if (Array.isArray(value)) {
    return typeof value[0] === "string" ? value[0] : null;
  }
  return typeof value === "string" ? value : null;
}

function stampApiKeyCaller(request, ident) {
  request.serviceAuth = true;
  request.instanceId = instanceId();
  const headerClient = firstHeaderValue(request.headers["x-amber-client"]);
  request.clientId = (headerClient && headerClient.slice(0, 64)) || ident.name;
}

export async function requireMedhaJwt(request, reply) {
  const session = verifyBearerFromRequest(request);
  if (!session) {
    return reply
      .code(401)
      .send({ error: "invalid_session", code: "invalid_session" });
  }
  request.medhaSession = session;
}

export async function requireApiKeyOrMedha(request, reply) {
  const apiKey = firstHeaderValue(request.headers["x-api-key"]);
  if (apiKey) {
    const ident = identifyApiKey(apiKey);
    if (ident) {
      stampApiKeyCaller(request, ident);
      return; // pass
    }
    // If an API key was presented but invalid, fail closed — don't fall
    // through to JWT (which would let a leaked token mask a bad key).
    return reply
      .code(401)
      .send({ error: "invalid_api_key", code: "invalid_api_key" });
  }
  const session = verifyBearerFromRequest(request);
  if (!session) {
    return reply
      .code(401)
      .send({ error: "missing_auth", code: "missing_auth" });
  }
  request.medhaSession = session;
}
