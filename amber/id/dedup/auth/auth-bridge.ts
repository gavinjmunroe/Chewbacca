/**
 * Privy validator bridge.
 *
 * Thin re-export of amber-id's session preHandler so the dedup-side
 * routes (WS-4 api-keys.routes, WS-4 magic-link.routes, WS-5 apple credential
 * routes) import from one place. If amber-id ever refactors its auth module,
 * only this file changes — dedup callers stay decoupled.
 *
 * The underlying `requireAuth(request, reply)` lives at `src/lib/auth-session.js`
 * and accepts EITHER an amber-id native session JWT (issued by /v1/otp/verify)
 * OR a legacy Privy bearer token. On success it sets:
 *
 *   request.privyUser = { userId, phone?, source }
 *
 * where `userId` is the canonical DID — `did:amber:...` for amber-id native
 * users or `did:privy:...` for Privy users. Dedup route handlers read
 * `request.privyUser.userId` as the `ownerDid` for BQ queries.
 *
 * On failure the underlying handler replies 401 directly; dedup routes do
 * not need to inspect the return value.
 */

import type { FastifyRequest, FastifyReply } from "fastify";

declare module "fastify" {
  interface FastifyRequest {
    privyUser?: {
      userId: string;
      phone?: string;
      source?: "amber-id" | "medha-id" | "privy";
    };
  }
}

// allowJs (set by WS-0's tsconfig.json) lets us import from the JS source
// without a separate .d.ts shim. If WS-0 introduces stricter types later,
// this file is the only place that needs to adapt.
import { requireAuth as underlyingRequireAuth } from "../../src/lib/auth-session.js";

export const validateSessionToken: (
  request: FastifyRequest,
  reply: FastifyReply,
) => Promise<void> = underlyingRequireAuth;
