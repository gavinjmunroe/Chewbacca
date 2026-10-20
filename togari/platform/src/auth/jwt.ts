/**
 * @togari/admin — Auth0 JWT validation + OAuth discovery
 */

import type { Request, Response, NextFunction } from "express";
import { tenantStorage } from "../tenant/context";
import type { TenantContext } from "../tenant/types";

export function createAuthMiddleware(domain: string, audience: string) {
  const { auth } = require("express-oauth2-jwt-bearer");

  const jwtCheck = auth({
    issuerBaseURL: `https://${domain}/`,
    audience,
    tokenSigningAlg: "RS256",
  });

  return [jwtCheck, extractTenantFromJwt];
}

function extractTenantFromJwt(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  const auth = (req as any).auth;
  if (!auth?.payload) {
    next(new Error("Missing JWT payload after auth middleware"));
    return;
  }

  const payload = auth.payload;
  const tenantId =
    (payload["https://togari.app/client_id"] as string | undefined) ??
    (payload.org_id as string | undefined);
  if (!tenantId) {
    next(
      new Error(
        "Missing tenant claim in JWT (expected https://togari.app/client_id or org_id).",
      ),
    );
    return;
  }

  const ctx: TenantContext = {
    tenantId,
    userId: payload.sub,
    userEmail: payload.email || payload["https://togari.app/email"],
    tier:
      (payload["https://togari.app/tier"] as TenantContext["tier"]) || "free",
  };

  tenantStorage.run(ctx, () => next());
}

export function oauthProtectedResourceHandler(
  _req: Request,
  res: Response,
): void {
  // Only advertise OAuth when Auth0 is actually configured. When AUTH0_DOMAIN
  // is unset the discovery would point at "https://undefined/..." — a broken
  // authorization server. MCP clients (e.g. Perplexity) that see that try to
  // auto-register against it and fail with "Server does not support automatic
  // registration". Returning 404 makes those clients fall back to the
  // JWT-in-URL (?token=) auth we actually use, which works.
  if (!process.env.AUTH0_DOMAIN) {
    res.status(404).json({ error: "oauth_not_configured" });
    return;
  }
  res.json({
    resource:
      process.env.OAUTH_RESOURCE_URL || "https://togari-admin.up.railway.app",
    authorization_servers: [
      `https://${process.env.AUTH0_DOMAIN}/.well-known/oauth-authorization-server`,
    ],
    scopes_supported: [
      "openid",
      "profile",
      "email",
      "togari:read",
      "togari:write",
    ],
  });
}

export function oauthDiscoveryHandler(_req: Request, res: Response): void {
  // Same guard: no Auth0 configured -> no OAuth advertised (use ?token= auth).
  if (!process.env.AUTH0_DOMAIN) {
    res.status(404).json({ error: "oauth_not_configured" });
    return;
  }
  const domain = process.env.AUTH0_DOMAIN;
  res.json({
    issuer: `https://${domain}/`,
    authorization_endpoint: `https://${domain}/authorize`,
    token_endpoint: `https://${domain}/oauth/token`,
    userinfo_endpoint: `https://${domain}/userinfo`,
    jwks_uri: `https://${domain}/.well-known/jwks.json`,
    scopes_supported: [
      "openid",
      "profile",
      "email",
      "togari:read",
      "togari:write",
    ],
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "client_credentials"],
    token_endpoint_auth_methods_supported: [
      "client_secret_post",
      "client_secret_basic",
    ],
    code_challenge_methods_supported: ["S256"],
  });
}
