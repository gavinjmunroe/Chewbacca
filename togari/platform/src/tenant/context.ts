/**
 * @togari/admin — Tenant context using AsyncLocalStorage
 *
 * HTTP mode: Auth0 JWT → extract org_id → AsyncLocalStorage
 * stdio mode: TENANT_ID env var → module-level fallback
 *
 * The storage payload is wider than the base `TenantContext` to also
 * carry MCP auth claims (orgId/role/scopes/authSource) when the request
 * was authenticated via the new JWT layer (`MCP_JWT_SECRET`). Existing
 * callers that only read `tenantId` / `userId` / `tier` are unaffected.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import type { TenantContext } from './types';
import type { AuthSource } from '../auth/token';

export type AuthedTenantContext = TenantContext & {
  /** Org id from JWT `org_id` claim. Typically mirrors tenantId. */
  orgId?: string;
  /** User role from JWT. Absent in legacy/dev paths. */
  role?: 'admin' | 'member';
  /** Datasets the caller may query. Always populated by mcpAuth — legacy/dev paths get a default admin scope set. */
  scopes?: string[];
  /** Which auth path produced this context (for audit/observability). */
  authSource?: AuthSource;
};

export const tenantStorage = new AsyncLocalStorage<AuthedTenantContext>();

let _stdioFallbackCtx: AuthedTenantContext | null = null;

export function setStdioFallback(ctx: AuthedTenantContext): void {
  _stdioFallbackCtx = ctx;
}

export function getCurrentTenant(): AuthedTenantContext {
  const ctx = tenantStorage.getStore();
  if (ctx) return ctx;
  if (_stdioFallbackCtx) return _stdioFallbackCtx;
  throw new Error(
    'No tenant context available. ' +
    'Ensure the request passed through tenant middleware (HTTP) or ' +
    'createStdioTenantContext() was used (stdio).'
  );
}

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
