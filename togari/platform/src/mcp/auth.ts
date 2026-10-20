/**
 * Auth middleware for Togari MCP endpoints.
 *
 * Three accepted credentials, checked in priority order:
 *
 *   1. `Authorization: Bearer <jwt>` header — validated against Auth0
 *      (issuer: AUTH0_DOMAIN, audience: AUTH0_AUDIENCE) via
 *      `express-oauth2-jwt-bearer`. Tenant id read from the
 *      `https://togari/tenant_id` namespace claim, with `org_id`
 *      falling back as a secondary source.
 *
 *   2. `?token=<JWT>` URL query param — when MCP_JWT_SECRET is set,
 *      verified as a JWT signed with that secret; tenant/scopes
 *      derived from claims. This is the new auth path. Required for
 *      Claude.ai / ChatGPT custom connectors that cannot inject auth
 *      headers.
 *
 *   3. `?token=<value>` URL query param — when MCP_JWT_SECRET is NOT
 *      set, falls back to the legacy constant-time compare against
 *      MCP_BEARER_TOKEN.
 *
 * Dev mode: if none of MCP_JWT_SECRET / MCP_BEARER_TOKEN / AUTH0_DOMAIN
 * is configured, every request is admitted as `dev-anonymous` with the
 * BMA admin scope set. A one-time boot warning is logged from
 * `setupMcpRoutes` so the noise doesn't show up per-request.
 *
 * On success, the rest of the request runs inside `tenantStorage`
 * (AsyncLocalStorage), so tool handlers reach the resolved context via
 * `getCurrentTenant()` — including the new `scopes` / `role` /
 * `authSource` fields when present.
 */

import crypto from "crypto";
import type { Request, Response, NextFunction } from "express";
import { tenantStorage, type AuthedTenantContext } from "../tenant/context";
import type { TenantContext } from "../tenant/types";
import { createLogger } from "../observability/logger";
import {
  authEnabled,
  resolveAuthFromToken,
  DEV_ANONYMOUS_CONTEXT,
  type AuthContext,
} from "../auth/token";

// Lazy-loaded to avoid pulling express-oauth2-jwt-bearer's global type
// augmentation (which redefines Request.auth) into the program-wide
// type graph. The MCP SDK augments Request.auth differently, and a
// static import here causes type conflicts in src/transports/mcp/server.ts.
// Existing src/auth/jwt.ts uses the same require() pattern.
type JwtMiddleware = (
  req: Request,
  res: Response,
  next: (err?: unknown) => void,
) => void;

const logger = createLogger("mcp/auth");

export type McpAuthKind =
  | "auth0-jwt"
  | "mcp-jwt"
  | "legacy-url-token"
  | "dev-anonymous";

export interface McpAuthInfo {
  kind: McpAuthKind;
  userId: string;
  tenantId: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      mcpAuth?: McpAuthInfo;
    }
  }
}

const DEFAULT_TENANT_ID = "bma";
const TENANT_CLAIM = "https://togari/tenant_id";

// Default scopes for non-JWT auth paths (Auth0 bearer, legacy URL
// token, dev-anonymous). Matches DEV_ANONYMOUS_CONTEXT so existing
// BMA-admin behavior is preserved end-to-end.
const LEGACY_DEFAULT_SCOPES = DEV_ANONYMOUS_CONTEXT.scopes;

let cachedJwtMiddleware: JwtMiddleware | null = null;
function getJwtMiddleware(): JwtMiddleware | null {
  if (cachedJwtMiddleware) return cachedJwtMiddleware;
  const domain = process.env.AUTH0_DOMAIN;
  const audience = process.env.AUTH0_AUDIENCE;
  if (!domain || !audience) return null;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { auth: jwtAuth } = require("express-oauth2-jwt-bearer");
  cachedJwtMiddleware = jwtAuth({
    issuerBaseURL: `https://${domain}/`,
    audience,
    tokenSigningAlg: "RS256",
  }) as JwtMiddleware;
  return cachedJwtMiddleware;
}

function constantTimeStringEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a, "utf8");
  const bBuf = Buffer.from(b, "utf8");
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}

function runWithTenantCtx(ctx: AuthedTenantContext, next: NextFunction): void {
  tenantStorage.run(ctx, () => next());
}

function unauthorized(res: Response, message: string): void {
  res.status(401).json({ error: message });
}

export function mcpAuth(req: Request, res: Response, next: NextFunction): void {
  const bearer = readBearerToken(req);
  const urlToken = readUrlToken(req);

  // ── 1. Authorization: Bearer (Auth0 JWT) ────────────────────────
  if (bearer) {
    const jwt = getJwtMiddleware();
    if (!jwt) {
      logger.warn(
        "Bearer token presented but AUTH0_DOMAIN / AUTH0_AUDIENCE not configured",
      );
      unauthorized(res, "JWT auth not configured on this server");
      return;
    }
    jwt(req, res, (err?: unknown) => {
      if (err) {
        unauthorized(res, "Invalid JWT");
        return;
      }
      const payload = (req as any).auth?.payload;
      if (!payload) {
        unauthorized(res, "Missing JWT payload");
        return;
      }
      const tenantId =
        (payload[TENANT_CLAIM] as string | undefined) ??
        (payload.org_id as string | undefined) ??
        DEFAULT_TENANT_ID;
      const userId = (payload.sub as string | undefined) ?? "jwt-user";
      const info: McpAuthInfo = { kind: "auth0-jwt", userId, tenantId };
      req.mcpAuth = info;
      runWithTenantCtx(
        {
          tenantId,
          userId,
          userEmail: payload.email,
          tier:
            (payload["https://togari.app/tier"] as TenantContext["tier"]) ||
            "free",
          orgId: tenantId,
          scopes: LEGACY_DEFAULT_SCOPES,
          authSource: "legacy-bearer",
        },
        next,
      );
    });
    return;
  }

  // ── 2. ?token= URL param ────────────────────────────────────────
  if (urlToken) {
    // (a) NEW: JWT path when MCP_JWT_SECRET is configured.
    if (authEnabled()) {
      let authCtx: AuthContext;
      try {
        authCtx = resolveAuthFromToken(urlToken);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.warn(`URL JWT verify failed: ${msg}`);
        unauthorized(res, `Invalid token: ${msg}`);
        return;
      }
      const info: McpAuthInfo = {
        kind: "mcp-jwt",
        userId: authCtx.sub,
        tenantId: authCtx.orgId,
      };
      req.mcpAuth = info;
      runWithTenantCtx(
        {
          tenantId: authCtx.orgId,
          userId: authCtx.sub,
          userEmail: authCtx.email,
          tier: "free",
          orgId: authCtx.orgId,
          role: authCtx.role,
          scopes: authCtx.scopes,
          authSource: authCtx.source,
        },
        next,
      );
      return;
    }

    // (b) LEGACY: constant-time compare against MCP_BEARER_TOKEN.
    const expected = process.env.MCP_BEARER_TOKEN;
    if (!expected) {
      logger.warn(
        "URL token presented but neither MCP_JWT_SECRET nor MCP_BEARER_TOKEN configured",
      );
      unauthorized(res, "URL-token auth not configured on this server");
      return;
    }
    if (!constantTimeStringEqual(urlToken, expected)) {
      unauthorized(res, "Invalid URL token");
      return;
    }
    const tenantId = process.env.MCP_DEFAULT_TENANT_ID || DEFAULT_TENANT_ID;
    const info: McpAuthInfo = {
      kind: "legacy-url-token",
      userId: "mcp-client",
      tenantId,
    };
    req.mcpAuth = info;
    runWithTenantCtx(
      {
        tenantId,
        userId: "mcp-client",
        tier: "free",
        orgId: tenantId,
        scopes: LEGACY_DEFAULT_SCOPES,
        authSource: "legacy-url-token",
      },
      next,
    );
    return;
  }

  // ── 3. Dev-anonymous fallback ───────────────────────────────────
  if (
    !process.env.MCP_JWT_SECRET &&
    !process.env.MCP_BEARER_TOKEN &&
    !process.env.AUTH0_DOMAIN
  ) {
    const tenantId = process.env.MCP_DEFAULT_TENANT_ID || DEFAULT_TENANT_ID;
    const info: McpAuthInfo = {
      kind: "dev-anonymous",
      userId: "dev-anonymous",
      tenantId,
    };
    req.mcpAuth = info;
    runWithTenantCtx(
      {
        tenantId,
        userId: "dev-anonymous",
        userEmail: DEV_ANONYMOUS_CONTEXT.email,
        tier: "free",
        orgId: tenantId,
        role: DEV_ANONYMOUS_CONTEXT.role,
        scopes: DEV_ANONYMOUS_CONTEXT.scopes,
        authSource: "dev-anonymous",
      },
      next,
    );
    return;
  }

  unauthorized(
    res,
    "Unauthorized. Provide Bearer JWT or ?token= URL param.",
  );
}

function readBearerToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match ? match[1].trim() : null;
}

function readUrlToken(req: Request): string | null {
  const t = req.query?.token;
  if (typeof t !== "string" || t.length === 0) return null;
  return t;
}
