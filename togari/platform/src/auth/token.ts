/**
 * Token-based auth for the Togari MCP.
 *
 * Feature-flagged on MCP_JWT_SECRET:
 *   - unset → all requests admitted as dev-anonymous BMA admin (status quo)
 *   - set   → every request must carry ?token=<JWT> signed with the secret
 *
 * Token payload shape:
 *   {
 *     sub:    string       // stable user identifier
 *     email:  string
 *     org_id: "bma" | ...
 *     role:   "admin" | "member"
 *     scopes: string[]     // BigQuery datasets the user may query
 *     iat:    number
 *     exp:    number
 *   }
 *
 * NOTE: the runtime auth wiring lives in `src/mcp/auth.ts`. This module
 * provides the verifier + the AuthContext type. The dev-anonymous default
 * is consumed by `mcpAuth` when no auth env vars are configured.
 */

import jwt from "jsonwebtoken";

export interface TokenPayload {
  sub: string;
  email: string;
  org_id: string;
  role: "admin" | "member";
  scopes: string[];
  iat?: number;
  exp?: number;
}

export type AuthSource =
  | "jwt"
  | "dev-anonymous"
  | "legacy-bearer"
  | "legacy-url-token"
  | "slack";

export interface AuthContext {
  sub: string;
  email: string;
  orgId: string;
  role: "admin" | "member";
  scopes: string[];
  source: AuthSource;
}

export const DEV_ANONYMOUS_CONTEXT: AuthContext = {
  sub: "dev-anonymous",
  email: "dev@bluemodernadvisory.com",
  orgId: "bma",
  role: "admin",
  scopes: ["togari_data_lake"],
  source: "dev-anonymous",
};

export function authEnabled(): boolean {
  return Boolean(process.env.MCP_JWT_SECRET);
}

/**
 * Verify a token against the server's JWT secret.
 * Throws on missing / malformed / expired token.
 */
export function verifyToken(token: string): TokenPayload {
  const secret = process.env.MCP_JWT_SECRET;
  if (!secret) {
    throw new Error("MCP_JWT_SECRET not set on server");
  }
  const payload = jwt.verify(token, secret) as TokenPayload;
  if (!payload.org_id || !Array.isArray(payload.scopes)) {
    throw new Error("Token payload missing required claims (org_id, scopes)");
  }
  return payload;
}

/**
 * Resolve the AuthContext for an incoming request based solely on a
 * presented JWT token. Used by `mcpAuth` when MCP_JWT_SECRET is set.
 *
 *   - missing token  → throws (auth is enabled, so absence is rejection)
 *   - valid token    → AuthContext derived from claims
 *   - invalid token  → throws (jsonwebtoken's verify error)
 */
export function resolveAuthFromToken(
  rawToken: string | undefined,
): AuthContext {
  if (!rawToken) {
    throw new Error("Missing ?token= query parameter (auth is enabled)");
  }
  const payload = verifyToken(rawToken);
  return {
    sub: payload.sub,
    email: payload.email,
    orgId: payload.org_id,
    role: payload.role,
    scopes: payload.scopes,
    source: "jwt",
  };
}
