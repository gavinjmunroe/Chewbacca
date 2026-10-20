/**
 * JWT Authentication Middleware + Tenant Context
 *
 * Two responsibilities:
 *
 * 1. HTTP validation (Cloud Run)
 *    - requireJwt: Express middleware that validates the Bearer JWT against
 *      Auth0's JWKS, extracts client_id, and rejects with 403 before any
 *      tool handler runs.
 *
 * 2. Context propagation (all modes)
 *    - Uses AsyncLocalStorage so every tool handler — no matter how deeply
 *      nested — can call getRequestClientId() and get the current tenant's
 *      client_id without it being threaded through every function signature.
 *    - runWithClientId() wraps any async operation in the tenant context.
 *
 * stdio (local dev / Claude Desktop):
 *    - TENANT_ID env var is used as the client_id fallback.
 *    - getStdioClientId() throws at startup if TENANT_ID is missing, so
 *      the server never starts without tenant isolation configured.
 */

import { AsyncLocalStorage } from 'async_hooks';
import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import jwksRsa from 'jwks-rsa';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Auth0JwtPayload extends jwt.JwtPayload {
  /** Namespaced custom claim — Auth0 requires a URL namespace for custom claims */
  'https://togari.app/client_id'?: string;
  /** Root-level fallback if token was issued without a namespace */
  client_id?: string;
}

declare global {
  namespace Express {
    interface Request {
      /** Tenant identifier extracted from JWT claims (or TENANT_ID fallback) */
      clientId: string;
      /** Auth0 user subject (JWT sub claim) — uniquely identifies the user */
      userId?: string;
    }
  }
}

// ─── Async context store ──────────────────────────────────────────────────────

interface TenantContext {
  clientId: string;
  /** JWT sub — the Auth0 user ID. Undefined in stdio/local dev mode. */
  userId?: string;
}

const tenantStore = new AsyncLocalStorage<TenantContext>();

/**
 * Returns the client_id for the current request from the async context.
 * Returns undefined if called outside a runWithTenantContext() scope.
 */
export function getRequestClientId(): string | undefined {
  return tenantStore.getStore()?.clientId;
}

/**
 * Returns the user_id (JWT sub) for the current request from the async context.
 * Returns undefined in stdio mode or if the JWT had no sub claim.
 */
export function getRequestUserId(): string | undefined {
  return tenantStore.getStore()?.userId;
}

/**
 * Wraps an async operation in a tenant context.
 * Every tool handler called within fn() can use getRequestClientId() and getRequestUserId().
 */
export function runWithTenantContext<T>(
  clientId: string,
  userId: string | undefined,
  fn: () => Promise<T>,
): Promise<T> {
  return tenantStore.run({ clientId, userId }, fn);
}

/**
 * @deprecated Use runWithTenantContext(clientId, undefined, fn) instead.
 * Kept for any call sites that haven't been updated yet.
 */
export function runWithClientId<T>(clientId: string, fn: () => Promise<T>): Promise<T> {
  return tenantStore.run({ clientId, userId: undefined }, fn);
}

// ─── Auth0 / JWKS config ──────────────────────────────────────────────────────

const AUTH0_DOMAIN = 'bluemodern.us.auth0.com';
const ISSUER      = `https://${AUTH0_DOMAIN}/`;

/**
 * Your Auth0 API identifier — set AUTH0_AUDIENCE env var.
 * Example: https://api.togari.app
 * If unset, audience validation is skipped.
 */
const AUDIENCE = process.env.AUTH0_AUDIENCE;

/**
 * Custom claim key. Override via AUTH0_CLIENT_ID_CLAIM if you use a
 * different namespace in your Auth0 Action.
 */
const CLIENT_ID_CLAIM =
  process.env.AUTH0_CLIENT_ID_CLAIM ?? 'https://togari.app/client_id';

// ─── JWKS client (singleton — caches public keys) ────────────────────────────

const jwksClient = jwksRsa({
  jwksUri: `${ISSUER}.well-known/jwks.json`,
  cache: true,
  cacheMaxEntries: 10,
  cacheMaxAge: 60 * 60 * 1000, // 1 hour
  rateLimit: true,
  jwksRequestsPerMinute: 10,
});

function getKey(header: jwt.JwtHeader, callback: jwt.SigningKeyCallback): void {
  if (!header.kid) {
    callback(new Error('JWT header missing kid'));
    return;
  }
  jwksClient.getSigningKey(header.kid, (err, key) => {
    if (err) { callback(err); return; }
    callback(null, key?.getPublicKey());
  });
}

// ─── Token verification ───────────────────────────────────────────────────────

function verifyToken(token: string): Promise<Auth0JwtPayload> {
  return new Promise((resolve, reject) => {
    jwt.verify(
      token,
      getKey,
      {
        issuer: ISSUER,
        algorithms: ['RS256'],
        ...(AUDIENCE && { audience: AUDIENCE }),
      },
      (err, decoded) => {
        if (err) { reject(err); return; }
        resolve(decoded as Auth0JwtPayload);
      },
    );
  });
}

function extractClientId(payload: Auth0JwtPayload): string | undefined {
  return payload[CLIENT_ID_CLAIM] ?? payload.client_id;
}

// ─── requireJwt middleware ────────────────────────────────────────────────────

/**
 * Express middleware — must run before any tool handler.
 *
 * On success: sets req.clientId and stores it in AsyncLocalStorage so tool
 * handlers can retrieve it with getRequestClientId().
 *
 * On failure: returns 403 immediately — no tool handler is invoked.
 */
export function requireJwt(req: Request, res: Response, next: NextFunction): void {
  // Local dev fallback: if TENANT_ID is set, skip JWT entirely
  const tenantFallback = process.env.TENANT_ID;
  if (tenantFallback) {
    req.clientId = tenantFallback;
    next();
    return;
  }

  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(403).json({
      error: 'Forbidden',
      message: 'Authorization header with Bearer token is required',
    });
    return;
  }

  const token = authHeader.slice(7);

  verifyToken(token)
    .then((payload) => {
      const clientId = extractClientId(payload);
      if (!clientId) {
        res.status(403).json({
          error: 'Forbidden',
          message: `JWT is missing required claim: ${CLIENT_ID_CLAIM}`,
        });
        return;
      }
      req.clientId = clientId;
      req.userId   = payload.sub; // Auth0 user subject — e.g. "auth0|abc123"
      next();
    })
    .catch((err: unknown) => {
      if (err instanceof jwt.TokenExpiredError) {
        res.status(403).json({ error: 'Forbidden', message: 'Token has expired' });
        return;
      }
      if (err instanceof jwt.JsonWebTokenError || err instanceof jwt.NotBeforeError) {
        res.status(403).json({ error: 'Forbidden', message: 'Invalid token' });
        return;
      }
      // Network failure fetching JWKS or other unexpected error
      process.stderr.write(
        `[auth] JWKS verification error: ${err instanceof Error ? err.message : String(err)}\n`,
      );
      res.status(403).json({ error: 'Forbidden', message: 'Token verification failed' });
    });
}

// ─── stdio mode ───────────────────────────────────────────────────────────────

/**
 * Returns the TENANT_ID for stdio / Claude Desktop mode.
 * Throws at startup if not set — the server must never run without knowing its tenant.
 */
export function getStdioClientId(): string {
  const tenantId = process.env.TENANT_ID;
  if (!tenantId) {
    throw new Error(
      'TENANT_ID env var is required in stdio mode.\n' +
      'Add it to your .env file or Claude Desktop config:\n' +
      '  TENANT_ID=bma',
    );
  }
  return tenantId;
}
