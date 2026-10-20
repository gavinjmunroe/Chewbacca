/**
 * @togari/core/middleware/tenant
 * Tenant context middleware using AsyncLocalStorage for multi-tenant isolation.
 *
 * HTTP mode: Auth0 JWT → extract org_id → AsyncLocalStorage
 * stdio mode: TENANT_ID env var → AsyncLocalStorage
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import type { Request, Response, NextFunction } from 'express';
import type { TenantContext } from '../types/tenant';

// ============================================================================
// ASYNC LOCAL STORAGE
// ============================================================================

/**
 * Global tenant storage — one instance per process.
 * Every tool handler reads from this via getCurrentTenant().
 */
export const tenantStorage = new AsyncLocalStorage<TenantContext>();

/**
 * Module-level fallback for stdio mode. Set once at startup via setStdioFallback().
 * Needed because the MCP SDK's StdioServerTransport dispatches tool handlers in
 * async contexts that don't inherit AsyncLocalStorage stores set via enterWith().
 */
let _stdioFallbackCtx: TenantContext | null = null;

/**
 * Set the stdio-mode tenant context fallback. Call this once at startup
 * alongside tenantStorage.enterWith(). Safe for stdio only (one process = one tenant).
 */
export function setStdioFallback(ctx: TenantContext): void {
  _stdioFallbackCtx = ctx;
}

/**
 * Get the current tenant context. Checks AsyncLocalStorage first, then the
 * stdio fallback, then throws if neither is available.
 */
export function getCurrentTenant(): TenantContext {
  const ctx = tenantStorage.getStore();
  if (ctx) return ctx;
  if (_stdioFallbackCtx) return _stdioFallbackCtx;
  throw new Error(
    'No tenant context available. ' +
    'Ensure the request passed through tenant middleware (HTTP) or ' +
    'createStdioTenantContext() was used (stdio).'
  );
}

// ============================================================================
// AUTH0 JWT MIDDLEWARE (HTTP MODE)
// ============================================================================

/**
 * Create Auth0 JWT validation + tenant extraction middleware chain.
 * Returns an array of Express middleware to apply on the /mcp route.
 *
 * Flow: JWT validation → extract org_id → populate AsyncLocalStorage
 */
export function createAuthMiddleware(domain: string, audience: string) {
  // Lazy import so the module doesn't fail if express-oauth2-jwt-bearer
  // isn't installed (e.g., in stdio-only environments)
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { auth } = require('express-oauth2-jwt-bearer');

  const jwtCheck = auth({
    issuerBaseURL: `https://${domain}/`,
    audience,
    tokenSigningAlg: 'RS256',
  });

  return [jwtCheck, extractTenantFromJwt];
}

/**
 * Extract tenant context from a validated Auth0 JWT.
 * Expects req.auth to be populated by express-oauth2-jwt-bearer.
 */
function extractTenantFromJwt(req: Request, _res: Response, next: NextFunction): void {
  const auth = (req as any).auth;
  if (!auth?.payload) {
    next(new Error('Missing JWT payload after auth middleware'));
    return;
  }

  const payload = auth.payload;

  const tenantId = payload.org_id as string | undefined;
  if (!tenantId) {
    next(new Error('Missing org_id claim in JWT. Ensure Auth0 Organization tokens are configured.'));
    return;
  }

  const ctx: TenantContext = {
    tenantId,
    userId: payload.sub,
    userEmail: payload.email || payload[`https://togari.health/email`],
    tier: (payload[`https://togari.health/tier`] as TenantContext['tier']) || 'free',
  };

  // Wrap the rest of the middleware/handler chain in tenant context
  tenantStorage.run(ctx, () => next());
}

// ============================================================================
// STDIO FALLBACK (LOCAL DEV)
// ============================================================================

/**
 * Create a TenantContext from environment variables for stdio (Claude Desktop) mode.
 * Used when there's no HTTP request / JWT to extract from.
 *
 * Env vars:
 *   TENANT_ID  — required (e.g., "org_test123")
 *   TENANT_TIER — optional, defaults to "free"
 *   USER_ID — optional
 *   USER_EMAIL — optional
 */
export function createStdioTenantContext(): TenantContext {
  const tenantId = process.env.TENANT_ID;
  if (!tenantId) {
    throw new Error(
      'TENANT_ID environment variable is required in stdio mode. ' +
      'Set it in your Claude Desktop config or shell environment.'
    );
  }

  const tier = (process.env.TENANT_TIER || 'free') as TenantContext['tier'];
  if (!['free', 'pro', 'enterprise'].includes(tier)) {
    throw new Error(`Invalid TENANT_TIER: "${tier}". Must be one of: free, pro, enterprise`);
  }

  return {
    tenantId,
    userId: process.env.USER_ID,
    userEmail: process.env.USER_EMAIL,
    tier,
  };
}
